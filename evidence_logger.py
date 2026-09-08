import json
from datetime import datetime

LOG_FILE = "evidence_log.jsonl"

def log_turn(transcript, hesitation, reply_text, speed):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "user_transcript": transcript,
        "hesitation_detected": hesitation["struggle"],
        "hesitation_reason": hesitation["reason"],
        "hesitation_score": hesitation["score"],
        "reply_text": reply_text,
        "reply_word_count": len(reply_text.split()),
        "playback_speed": speed
    }
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"[Logged] struggle={hesitation['struggle']} speed={speed}", flush=True)