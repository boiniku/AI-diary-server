import os
import json
import base64
import uuid
from datetime import date, datetime, timedelta
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles # ★画像配信に必要
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Text
from sqlalchemy.orm import sessionmaker, declarative_base

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

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class DiaryModel(Base):
    __tablename__ = "diaries"
    date_id = Column(String, primary_key=True, index=True)
    messages_json = Column(Text, default="[]")
    emotion_score = Column(Integer, default=3)
    title = Column(String, default="")
    icon = Column(String, default="📝") 

Base.metadata.create_all(bind=engine)

app = FastAPI()

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
"""

class ChatMessage(BaseModel):
    role: str
    content: str
    image: str | None = None # 画像ファイル名が入る

class ChatRequest(BaseModel):
    date_id: str
    messages: list[ChatMessage]
    new_image: str | None = None # Base64データ

def get_diary_by_date(db, date_str):
    return db.query(DiaryModel).filter(DiaryModel.date_id == date_str).first()

# === エンドポイント ===

@app.get("/calendar")
def get_calendar_data():
    db = SessionLocal()
    diaries = db.query(DiaryModel).all()
    calendar_data = {}
    for diary in diaries:
        calendar_data[diary.date_id] = { "score": diary.emotion_score, "icon": diary.icon }
    db.close()
    return calendar_data

@app.get("/history")
def get_history(date_id: str = Query(..., description="YYYY-MM-DD")):
    db = SessionLocal()
    diary = get_diary_by_date(db, date_id)
    db.close()
    if diary:
        return { "messages": json.loads(diary.messages_json), "title": diary.title, "icon": diary.icon }
    else:
        return {"messages": [], "title": "", "icon": ""}

@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    target_date_str = req.date_id
    
    # 昨日の文脈取得
    target_date_obj = datetime.strptime(target_date_str, '%Y-%m-%d').date()
    yesterday_str = (target_date_obj - timedelta(days=1)).strftime('%Y-%m-%d')
    
    db = SessionLocal()
    yesterday_diary = get_diary_by_date(db, yesterday_str)
    
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

    # 保存処理
    diary = get_diary_by_date(db, target_date_str)
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

@app.put("/history")
def update_history(req: ChatRequest):
    target_date = req.date_id
    new_messages = [m.model_dump() for m in req.messages]
    db = SessionLocal()
    diary = get_diary_by_date(db, target_date)
    if diary:
        diary.messages_json = json.dumps(new_messages, ensure_ascii=False)
        db.commit()
        db.close()
        return {"status": "updated"}
    else:
        db.close()
        return {"status": "error"}