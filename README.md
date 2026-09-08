# Cadence — Adaptive Multilingual Voice Language Tutor

> **DataForge (IIT Kharagpur) x Rime "Voice AI" Challenge Submission**

Cadence is a real-time adaptive multilingual voice tutor that teaches any language to anyone — in their own native language. Speak in Hindi, get taught in English. Speak in English, get taught in Japanese. Cadence detects struggle, adapts its speech speed, and explains bilingually so learners are never left behind.

---

## What Makes Cadence Special

- **Speaks YOUR language** — Native Hindi speaker learning English? Cadence explains in both English AND Hindi every time.
- **Detects when you struggle** — Long pauses, filler words (um, uh), and phrases like "I don't understand" trigger automatic simplification.
- **Slows down for you** — Rime TTS switches from `1.0x` to `0.75x` speed when you're struggling, and `0.5x` slow-mo replay on demand.
- **Stops instantly when interrupted** — Barge-in audio kill in <60ms, seamless context recovery.
- **Tracks your progress** — Streak, words learned, turns, and avg fluency saved persistently.

---

## Hard Voice Problems Solved

| Problem | Solution |
|---|---|
| Adaptive pronunciation delivery | Hesitation detection + Rime `speed` parameter switching |
| Real-time barge-in & interruption | Thread-safe state + <60ms pygame audio kill |
| Bilingual output for beginners | Gemini LLM structured JSON with dual-language replies |
| Live vocabulary extraction | Per-turn flashcard auto-extraction |
| Multi-language STT | Browser Web Speech API with dynamic locale switching |

---

## Architecture

```
Browser (index.html + app.js)
  |
  |-- Web Speech API (STT) → live transcript in input bar
  |
  └── POST /api/process_turn
        |
        ├── hesitation_detector.py  → {struggle, score, reason}
        ├── adaptive_llm.py         → bilingual system prompt
        ├── llm.py (Gemini)         → {reply_text, vocab_word, vocab_translation}
        ├── tts.py (Rime TTS)       → MP3 saved to audio_output/
        └── JSON response → audio played in browser

  └── POST /api/slowmo             → Rime re-synthesis at 0.5x
  └── POST /api/transcribe         → Deepgram REST fallback STT
```

---

## Supported Languages

| Language | Learn | Native | Rime TTS |
|---|---|---|---|
| English | Yes | Yes | `en` |
| Hindi | Yes | Yes | `hi` |
| Spanish | Yes | Yes | `es` |
| French | Yes | Yes | `fr` |
| German | Yes | Yes | `de` |
| Italian | Yes | Yes | `it` |
| Japanese | Yes | Yes | `ja` |
| Korean | Yes | Yes | `en` (fallback) |
| Chinese | Yes | Yes | `en` (fallback) |

---

## Quickstart

### Requirements
- Python 3.10+
- API keys for: **Rime TTS**, **Deepgram STT**, **Google Gemini**

### Setup

```powershell
# Clone and set up virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Environment Variables
Create `.env` in the project root:
```env
RIME_API_KEY=your_rime_api_key_here
DEEPGRAM_API_KEY=your_deepgram_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### Run the Web App

**Option A — One-click launcher (Windows):**
Double-click `start.bat`

**Option B — Manual:**
```powershell
.venv\Scripts\python.exe web_server.py
```
Open **http://localhost:8000** in Chrome or Edge.

### Run the Terminal Mic Loop
```powershell
.venv\Scripts\python.exe main.py
```
> Wear headphones to prevent speaker echo feedback.

---

## File Structure

| File | Purpose |
|---|---|
| `web_server.py` | FastAPI server: `/api/process_turn`, `/api/slowmo`, `/api/transcribe` |
| `static/index.html` | Full web dashboard UI |
| `static/app.js` | Browser controller: STT, audio, progress tracker, UI updates |
| `static/styles.css` | Dark mode cyberpunk UI styles |
| `main.py` | Terminal mic loop entry point |
| `tts.py` | Rime TTS API integration + interruptible pygame playback |
| `llm.py` | Gemini LLM client with fallback chain |
| `adaptive_llm.py` | Bilingual prompt templates (normal + simplified) |
| `hesitation_detector.py` | Real-time struggle detection (pauses, fillers, triggers) |
| `state.py` | Thread-safe state flags for interrupt handling |
| `evidence_logger.py` | Structured benchmark logging to `evidence_log.jsonl` |
| `RIME_EVIDENCE.md` | Full evidence report for challenge judges |
| `start.bat` | One-click Windows launcher |

---

## Challenge Evidence

See [`RIME_EVIDENCE.md`](RIME_EVIDENCE.md) for full benchmark results, empirical logs, and verified capability table.
