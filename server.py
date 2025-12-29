import os
import traceback
import json
import base64
import uuid
from datetime import date, datetime, timedelta
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles # ★画像配信に必要
from fastapi.responses import FileResponse # 追加
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import jwt

# Auth Config
SECRET_KEY = os.environ.get("SECRET_KEY", "supersecretkey") # 本番では環境変数で設定推奨
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 3 * 24 * 60 # 3日間

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# 設定読み込み
load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# データベース設定
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./diary.db"

# PostgreSQLを使う場合のための調整（"postgresql://"で始まる必要がある）
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class UserModel(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

class DiaryModel(Base):
    __tablename__ = "user_diaries" # テーブル名を変更してスキーマ不整合を回避（古いデータはdiariesに残る）
    id = Column(Integer, primary_key=True, index=True) # IDを追加（主キー用）
    user_id = Column(Integer, ForeignKey("users.id")) # ユーザー紐付け
    date_id = Column(String, index=True) # date_idはユニークではなくなる（各ユーザーが同じ日付を持つため）
    messages_json = Column(Text, default="[]")
    emotion_score = Column(Integer, default=3)
    title = Column(String, default="")
    icon = Column(String, default="📝") 

Base.metadata.create_all(bind=engine)

# ドキュメント表示制御
SHOW_DOCS = os.environ.get("SHOW_DOCS", "false").lower() == "true"
app = FastAPI(docs_url="/docs" if SHOW_DOCS else None, redoc_url="/redoc" if SHOW_DOCS else None)

@app.get("/app-ads.txt")
def serve_ads_txt():
    return FileResponse("app-ads.txt")

# ★重要：画像を保存する「images」フォルダを公開設定にする
# これで http://IPアドレス:8000/images/ファイル名.jpg でアクセスできるようになる
os.makedirs("images", exist_ok=True)
app.mount("/images", StaticFiles(directory="images"), name="images")

BASE_SYSTEM_PROMPT = """
あなたは「聞き上手な友達のような日記インタビュアー」です。
ユーザーの回答に共感しつつ、会話が弾むような質問を返してください。
敬語を使ってください。

【重要】
レスポンスは必ず以下のJSON形式のみで返してください。
{
  "reply": "AIの返答テキスト",
  "emotion_score": 1〜5の整数,
  "title": "日記の内容を要約した10文字以内のタイトル",
  "icon": "内容を象徴する絵文字1文字"
}

【emotion_scoreの採点基準】
1: 非常に悲しい、辛い、怒り、不安（ネガティブ）
2: 少し落ち込んでいる、不満がある
3: 普通、日常、特に感情の起伏なし
4: 少し楽しい、充実している
5: 非常に楽しい、嬉しい、最高の気分（ポジティブ）

※ユーザーがネガティブなことを言っている場合は、慰める返答をしつつ、スコアは正直に「1」や「2」をつけてください。無理にポジティブなスコアにする必要はありません。
"""

class ChatMessage(BaseModel):
    role: str
    content: str
    image: str | None = None # 画像ファイル名が入る

class ChatRequest(BaseModel):
    date_id: str
    messages: list[ChatMessage]
    new_image: str | None = None # Base64データ

class SummaryRequest(BaseModel):
    date_id: str

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    
    db = SessionLocal()
    user = db.query(UserModel).filter(UserModel.username == username).first()
    db.close()
    if user is None:
        raise credentials_exception
    return user

def get_diary_by_date(db, user_id, date_str):
    return db.query(DiaryModel).filter(DiaryModel.user_id == user_id, DiaryModel.date_id == date_str).first()

# === Auth Endpoints ===

@app.post("/register", response_model=Token)
def register(user: UserCreate):
    db = SessionLocal()
    db_user = db.query(UserModel).filter(UserModel.username == user.username).first()
    if db_user:
        db.close()
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = UserModel(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    db.close()
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": new_user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/token", response_model=Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    db = SessionLocal()
    user = db.query(UserModel).filter(UserModel.username == form_data.username).first()
    db.close()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# === エンドポイント ===

@app.get("/calendar")
def get_calendar_data(current_user: UserModel = Depends(get_current_user)):
    db = SessionLocal()
    diaries = db.query(DiaryModel).filter(DiaryModel.user_id == current_user.id).all()
    calendar_data = {}
    for diary in diaries:
        calendar_data[diary.date_id] = { "score": diary.emotion_score, "icon": diary.icon }
    db.close()
    return calendar_data

@app.get("/history")
def get_history(date_id: str = Query(..., description="YYYY-MM-DD"), current_user: UserModel = Depends(get_current_user)):
    db = SessionLocal()
    diary = get_diary_by_date(db, current_user.id, date_id)
    db.close()
    if diary:
        return { "messages": json.loads(diary.messages_json), "title": diary.title, "icon": diary.icon }
    else:
        return {"messages": [], "title": "", "icon": ""}

@app.post("/chat")
def chat_endpoint(req: ChatRequest, current_user: UserModel = Depends(get_current_user)):
    target_date_str = req.date_id
    
    # 昨日の文脈取得
    target_date_obj = datetime.strptime(target_date_str, '%Y-%m-%d').date()
    yesterday_str = (target_date_obj - timedelta(days=1)).strftime('%Y-%m-%d')
    
    db = SessionLocal()
    yesterday_diary = get_diary_by_date(db, current_user.id, yesterday_str)
    
    yesterday_context = ""
    if yesterday_diary:
        past_messages = json.loads(yesterday_diary.messages_json)
        for msg in past_messages:
            content_summary = msg['content']
            role_label = "ユーザー" if msg['role'] == "user" else "AI"
            yesterday_context += f"{role_label}: {content_summary}\n"

    system_prompt = BASE_SYSTEM_PROMPT
    if yesterday_context:
        system_prompt += f"\n\n【昨日の会話 ({yesterday_str})】\n{yesterday_context}"

    input_messages = [m.model_dump() for m in req.messages]
    
    is_start_trigger = False
    if len(input_messages) > 0 and input_messages[-1]['content'] == "__START__":
        is_start_trigger = True
        input_messages[-1]['content'] = "（ユーザーがアプリを開きました。挨拶してください。また、必ず「今日はどうだった？」と聞いてください。）"

    # ★画像の保存処理
    saved_filename = None
    if req.new_image:
        try:
            # Base64をデコードしてファイルに保存
            image_data = base64.b64decode(req.new_image)
            filename = f"{uuid.uuid4()}.jpg" # ランダムな名前を生成
            file_path = f"images/{filename}"
            
            with open(file_path, "wb") as f:
                f.write(image_data)
            
            saved_filename = filename # 保存成功
            print(f"📸 画像を保存しました: {file_path}")
            
        except Exception as e:
            print(f"⚠️ 画像保存エラー: {e}")

    # AIへのリクエスト準備
    latest_msg = input_messages[-1]
    if req.new_image:
        user_content_with_image = [
            {"type": "text", "text": latest_msg['content']},
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{req.new_image}"
                }
            }
        ]
        final_input_messages = input_messages[:-1] + [{"role": "user", "content": user_content_with_image}]
    else:
        final_input_messages = input_messages

    full_messages = [{"role": "system", "content": system_prompt}] + final_input_messages
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=full_messages,
            temperature=0.7,
            response_format={"type": "json_object"}
        )
        
        ai_json_str = response.choices[0].message.content
        ai_data = json.loads(ai_json_str)
        
        ai_text = ai_data.get("reply", "")
        emotion_score = ai_data.get("emotion_score", 3)
        title = ai_data.get("title", "") 
        icon = ai_data.get("icon", "📝")
    except Exception as e:
        print("Error in OpenAI call or processing:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) 

    # 保存処理
    diary = get_diary_by_date(db, current_user.id, target_date_str)
    current_history = json.loads(diary.messages_json) if diary else []

    if is_start_trigger:
        updated_messages = current_history + [{"role": "assistant", "content": ai_text}]
    else:
        # ★ここで画像ファイル名も一緒に保存する！
        user_msg_to_save = {
            "role": "user", 
            "content": req.messages[-1].content,
            "image": saved_filename # ファイル名（例: xxxx.jpg）またはNone
        }
        updated_messages = current_history + [user_msg_to_save, {"role": "assistant", "content": ai_text}]

    if diary:
        diary.messages_json = json.dumps(updated_messages, ensure_ascii=False)
        diary.emotion_score = emotion_score
        diary.title = title
        diary.icon = icon
    else:

        new_diary = DiaryModel(
            user_id=current_user.id, # ユーザーIDを設定
            date_id=target_date_str,
            messages_json=json.dumps(updated_messages, ensure_ascii=False),
            emotion_score=emotion_score,
            title=title,
            icon=icon
        )
        db.add(new_diary)
    
    db.commit()
    db.close()

    return {"reply": ai_text, "title": title, "icon": icon}

@app.post("/summary")
def generate_summary(req: SummaryRequest, current_user: UserModel = Depends(get_current_user)):
    db = SessionLocal()
    diary = get_diary_by_date(db, current_user.id, req.date_id)
    db.close()

    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")

    messages = json.loads(diary.messages_json)
    
    # 会話履歴をテキスト化
    context = ""
    for msg in messages:
        role = "ユーザー" if msg['role'] == "user" else "AI"
        context += f"{role}: {msg['content']}\n"

    prompt = f"""
    以下は今日のユーザーとの会話です。
    会話全体を短く要約し、最後にユーザーを元気づける温かい励ましの言葉をかけてください。
    出力はJSON形式で、キーは "summary" としてください。

    【会話内容】
    {context}
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": prompt}],
            temperature=0.7,
            response_format={"type": "json_object"}
        )
        data = json.loads(response.choices[0].message.content)
        return {"summary": data.get("summary", "お疲れ様でした！明日も良い一日になりますように。")}
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail="Failed to generate summary")

@app.put("/history")
def update_history(req: ChatRequest, current_user: UserModel = Depends(get_current_user)):
    target_date = req.date_id
    new_messages = [m.model_dump() for m in req.messages]
    db = SessionLocal()
    diary = get_diary_by_date(db, current_user.id, target_date)
    if diary:
        diary.messages_json = json.dumps(new_messages, ensure_ascii=False)
        db.commit()
        db.close()
        return {"status": "updated"}
    else:
        db.close()
@app.delete("/delete_account")
def delete_account(current_user: UserModel = Depends(get_current_user)):
    db = SessionLocal()
    try:
        # ユーザーの日記を全て削除
        db.query(DiaryModel).filter(DiaryModel.user_id == current_user.id).delete()
        # ユーザー自身を削除
        db.query(UserModel).filter(UserModel.id == current_user.id).delete()
        db.commit()
        return {"status": "deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()