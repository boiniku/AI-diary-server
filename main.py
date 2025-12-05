import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# === ここがAIの人格設定（システムプロンプト） ===
# 日記アプリ向けに、聞き上手なインタビュアーとして振る舞わせます
SYSTEM_PROMPT = """
あなたは、ユーザーの一日を記録するための「聞き上手な日記インタビュアー」です。
以下のルールを守って対話してください。

1. ユーザーの回答に対して、共感を示してください。
2. ユーザーの回答を深掘りするような質問を「1つだけ」投げかけてください。
3. 質問攻めにせず、会話のような自然なトーンで話してください。
4. 最終的に、ユーザーのポジティブな感情や、気付きを引き出すことを目指してください。
"""

def chat_with_ai():
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT}
    ]
    
    print("AI: こんにちは！今日はどんな一日でしたか？（終了するには 'exit' と入力）")

    while True:
        #ユーザーの入力を受け取る
        user_input = input("あなた: ")
        
        if user_input.lower() == "exit":
            print("AI: ありがとうございました！またお話ししましょうね。")
            break
        
        messages.append({"role": "user", "content": user_input})
        
        try:
            #AIに返答を生成させる
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.7,
            )
            
            #AIの返答を取り出す
            ai_response = response.choices[0].message.content
            #AIの発言を表示
            print(f"AI:{ai_response}")
            
            #会話履歴にAIの発言を追加
            messages.append({"role": "assistant", "content": ai_response})
            
        except Exception as e:
            print(f"エラーが発生しました: {e}")
            break
if __name__ == "__main__":
    chat_with_ai()
    