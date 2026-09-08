import os
from dotenv import load_dotenv

load_dotenv()  # loads your .env file

rime_api_key = os.getenv("RIME_API_KEY")
print("Key loaded:", rime_api_key[:8] + "..." if rime_api_key else "NOT FOUND")

# --- PASTE RIME'S OFFICIAL TTS EXAMPLE CODE HERE ---
import requests

url = "https://users.rime.ai/v1/rime-tts"

headers = {
    "Authorization": f"Bearer {rime_api_key}",
    "Content-Type": "application/json",
    "Accept": "audio/mpeg"
}

data = {
    "speaker": "astra",
    "text": "Hello from Rime.",
    "modelId": "coda",
    "lang": "en"
}

response = requests.post(url, headers=headers, json=data)

if response.status_code == 200:
    with open("hello.mp3", "wb") as f:
        f.write(response.content)
    print("Success! Saved as hello.mp3")
else:
    print("Error:", response.status_code, response.text)