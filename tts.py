import os
import time
import threading
from dotenv import load_dotenv
import requests
import pygame
from state import state

load_dotenv()

RIME_API_KEY = os.getenv("RIME_API_KEY", "")

try:
    pygame.mixer.init()
except Exception:
    pass

_last_file = None
_speak_lock = threading.Lock()   # NEW

session = requests.Session()
session.headers.update({
    "Authorization": f"Bearer {RIME_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "audio/mpeg"
})

def synthesize(text: str, speed: float = 1.0, lang: str = "es", output_path: str = None) -> str:
    if output_path is None:
        output_path = f"reply_{int(time.time()*1000)}.mp3"
    url = "https://users.rime.ai/v1/rime-tts"
    data = {
        "speaker": "astra",
        "text": text,
        "modelId": "coda",
        "lang": lang,
        "speed": speed
    }
    response = session.post(url, json=data)
    if response.status_code == 200:
        with open(output_path, "wb") as f:
            f.write(response.content)
        return output_path
    else:
        raise Exception(f"Rime TTS failed: {response.status_code} {response.text}")

def speak(text: str, speed: float = 1.0, lang: str = "es"):
    global _last_file

    with _speak_lock:   # NEW — serializes all speak() calls
        path = synthesize(text, speed=speed, lang=lang)

        if pygame.mixer.music.get_busy():
            pygame.mixer.music.stop()

        pygame.mixer.music.load(path)
        state.interrupt.clear()
        state.is_speaking.set()
        pygame.mixer.music.play()

        result = "completed"
        while pygame.mixer.music.get_busy():
            if state.interrupt.is_set():
                t2 = time.time()
                pygame.mixer.music.stop()
                interrupt_t1 = getattr(state, 'interrupt_t1', None)
                latency_msg = f" (t2-t1 = {(t2 - interrupt_t1)*1000:.1f}ms)" if interrupt_t1 else ""
                print(f"[INTERRUPT] Audio stopped at t2={t2:.4f}{latency_msg}", flush=True)
                state.interrupt.clear()
                result = "interrupted"
                break
            pygame.time.Clock().tick(20)

        pygame.mixer.music.unload()
        state.is_speaking.clear()

        if _last_file and os.path.exists(_last_file) and _last_file != path:
            try:
                os.remove(_last_file)
            except PermissionError:
                pass

        _last_file = path
        return result