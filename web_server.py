import os
import time
import requests as http_requests
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

from hesitation_detector import detect_hesitation
from adaptive_llm import build_prompt
from llm import get_llm_reply
from tts import synthesize
from evidence_logger import log_turn

load_dotenv()

# Persistent Rime TTS connection pool for low latency
RIME_API_KEY = os.getenv("RIME_API_KEY")
rime_session = http_requests.Session()
rime_session.headers.update({
    "Authorization": f"Bearer {RIME_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "audio/mpeg"
})

def _synth_with_speaker(text: str, speed: float = 1.0, lang: str = "en", output_path: str = None, speaker: str = "astra") -> str:
    """Synthesize audio with a specific Rime voice persona using persistent connection."""
    url = "https://users.rime.ai/v1/rime-tts"
    data = {"speaker": speaker, "text": text, "modelId": "coda", "lang": lang, "speed": speed}
    response = rime_session.post(url, json=data, timeout=8)
    if response.status_code == 200:
        if output_path is None:
            output_path = f"audio_output/synth_{int(time.time()*1000)}.mp3"
        with open(output_path, "wb") as f:
            f.write(response.content)
        return output_path
    else:
        raise Exception(f"Rime TTS failed: {response.status_code} {response.text}")

app = FastAPI(title="Cadence Web API", description="Adaptive Multilingual Voice Language Tutor")

# Initialize Gemini Client
llm_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Ensure static & audio output directories exist
os.makedirs("static", exist_ok=True)
os.makedirs("audio_output", exist_ok=True)

# Mount static frontend files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Rime TTS supported languages: ar, de, en, es, fr, hi, it, ja, pt
RIME_SUPPORTED = {"ar", "de", "en", "es", "fr", "hi", "it", "ja", "pt"}

LANG_CODES = {
    "Spanish": "es",
    "French": "fr",
    "German": "de",
    "Italian": "it",
    "English": "en",
    "Hindi": "hi",
    "Korean": "ko",    # TTS will fallback to "en"
    "Japanese": "ja",
    "Chinese": "zh"    # TTS will fallback to "en"
}

def cleanup_old_audio(directory="audio_output", max_age_seconds=600):
    """Clean up generated audio files older than 10 minutes to prevent storage bloat."""
    try:
        now = time.time()
        if os.path.exists(directory):
            for fname in os.listdir(directory):
                if fname.endswith(".mp3"):
                    fpath = os.path.join(directory, fname)
                    if os.path.isfile(fpath) and (now - os.path.getmtime(fpath) > max_age_seconds):
                        try:
                            os.remove(fpath)
                        except Exception:
                            pass
    except Exception:
        pass

def get_tts_lang(lang_code: str) -> str:
    """Return Rime-compatible lang code, falling back to 'en' for unsupported langs."""
    return lang_code if lang_code in RIME_SUPPORTED else "en"


# Available Rime voice personas (confirmed valid on coda model)
RIME_PERSONAS = {
    "astra":   {"emoji": "👩", "label": "Astra",   "desc": "Warm & supportive — American female"},
    "luna":    {"emoji": "🌙", "label": "Luna",    "desc": "Clear & expressive — American female"},
    "celeste": {"emoji": "✨", "label": "Celeste", "desc": "Bright & friendly — American female"},
    "petal":   {"emoji": "🌸", "label": "Petal",   "desc": "Gentle & soft — American female"},
    "masonry": {"emoji": "🏔️", "label": "Masonry", "desc": "Deep & authoritative — Southern male"},
    "albion":  {"emoji": "🎩", "label": "Albion",  "desc": "Formal & articulate — British male"},
}

class TurnRequest(BaseModel):
    transcript: str
    target_language: str = "English"
    native_language: str = "Hindi"
    scenario: str = "General"
    history: list = []
    speaker: str = "astra"

class SlowMoRequest(BaseModel):
    text: str
    target_language: str = "English"
    speaker: str = "astra"

class PronounceRequest(BaseModel):
    text: str
    target_language: str = "English"
    speaker: str = "astra"

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.post("/api/process_turn")
async def process_turn_api(req: TurnRequest):
    try:
        transcript = req.transcript.strip()
        target_lang = req.target_language
        native_lang = req.native_language
        scenario = req.scenario
        history = req.history
        speaker = req.speaker if req.speaker in RIME_PERSONAS else "astra"
        lang_code = LANG_CODES.get(target_lang, "en")

        if not transcript:
            raise HTTPException(status_code=400, detail="Transcript empty")

        # 1. Detect Hesitation
        hesitation = detect_hesitation(transcript)
        struggling = hesitation["struggle"]

        # 2. Generate LLM Reply with Dual-Language Prompt & Multi-turn Memory
        system_prompt = build_prompt(
            target_language=target_lang,
            native_language=native_lang,
            scenario=scenario,
            struggling=struggling
        )
        llm_data = get_llm_reply(llm_client, transcript, system_prompt, history=history)
        reply_text = llm_data["reply_text"]

        # 3. Synthesize Rime Audio with selected persona
        speed = 0.75 if struggling else 1.0
        audio_filename = f"reply_{int(time.time()*1000)}.mp3"
        audio_path = os.path.join("audio_output", audio_filename)
        audio_url = f"/audio/{audio_filename}"
        
        try:
            _synth_with_speaker(reply_text, speed=speed, lang=get_tts_lang(lang_code), output_path=audio_path, speaker=speaker)
        except Exception as tts_err:
            print(f"[TTS WARN] Synthesis warning: {tts_err}", flush=True)
            # If audio file wasn't created, set audio_url to empty
            if not os.path.exists(audio_path):
                audio_url = ""

        # 4. Calculate Fluency Score (0-100%)
        fluency_score = max(20, 100 - (hesitation["score"] * 20))

        # 5. Log Evidence
        log_turn(transcript, hesitation, reply_text, speed)

        # 6. Auto-cleanup audio older than 10 minutes
        cleanup_old_audio()

        return JSONResponse({
            "status": "success",
            "user_transcript": transcript,
            "hesitation": hesitation,
            "fluency_score": fluency_score,
            "reply_text": reply_text,
            "correction": llm_data.get("correction", ""),
            "vocab_word": llm_data.get("vocab_word", ""),
            "vocab_translation": llm_data.get("vocab_translation", ""),
            "vocab_phonetic": llm_data.get("vocab_phonetic", ""),
            "reply_word_count": len(reply_text.split()),
            "speed": speed,
            "target_language": target_lang,
            "native_language": native_lang,
            "audio_url": audio_url,
            "audio_stop_latency": "< 50ms"
        })

    except Exception as e:
        print(f"[API ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/slowmo")
async def slowmo_api(req: SlowMoRequest):
    try:
        text = req.text.strip()
        lang_code = LANG_CODES.get(req.target_language, "en")
        speaker = req.speaker if req.speaker in RIME_PERSONAS else "astra"
        audio_filename = f"slowmo_{int(time.time()*1000)}.mp3"
        audio_path = os.path.join("audio_output", audio_filename)
        
        _synth_with_speaker(text, speed=0.5, lang=get_tts_lang(lang_code), output_path=audio_path, speaker=speaker)
        return JSONResponse({"audio_url": f"/audio/{audio_filename}"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pronounce")
async def pronounce_api(req: PronounceRequest):
    """Synthesize a word/phrase for Pronunciation Coach shadowing practice."""
    try:
        text = req.text.strip()
        lang_code = LANG_CODES.get(req.target_language, "en")
        speaker = req.speaker if req.speaker in RIME_PERSONAS else "astra"
        audio_filename = f"pronounce_{int(time.time()*1000)}.mp3"
        audio_path = os.path.join("audio_output", audio_filename)
        _synth_with_speaker(text, speed=0.85, lang=get_tts_lang(lang_code), output_path=audio_path, speaker=speaker)
        return JSONResponse({"audio_url": f"/audio/{audio_filename}", "text": text})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """Transcribe audio blob from PTT MediaRecorder using Deepgram REST API."""
    try:
        deepgram_key = os.getenv("DEEPGRAM_API_KEY", "")
        if not deepgram_key:
            raise HTTPException(status_code=500, detail="DEEPGRAM_API_KEY not set")
        
        audio_bytes = await audio.read()
        response = http_requests.post(
            "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
            headers={
                "Authorization": f"Token {deepgram_key}",
                "Content-Type": "audio/webm"
            },
            data=audio_bytes,
            timeout=15
        )
        result = response.json()
        transcript = ""
        try:
            transcript = result["results"]["channels"][0]["alternatives"][0]["transcript"]
        except (KeyError, IndexError):
            pass
        return JSONResponse({"transcript": transcript})
    except Exception as e:
        print(f"[TRANSCRIBE ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/audio/{filename}")
async def get_audio(filename: str):
    file_path = os.path.join("audio_output", filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Audio file not found")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting Cadence Multilingual Web Server on port {port} ...")
    uvicorn.run(app, host="0.0.0.0", port=port)
