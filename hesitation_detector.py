import re

FILLER_WORDS = {"um", "uh", "umm", "uhh", "err", "hmm", "like", "actually"}
STRUGGLE_PHRASES = [
    "i don't understand", "what does that mean", "repeat that",
    "say that again", "i didn't get that", "can you slow down",
    "confused", "not sure what"
]

def detect_hesitation(transcript: str, word_timestamps: list = None) -> dict:
    """
    transcript: final STT text
    word_timestamps: optional list of dicts like
        [{"word": "um", "start": 1.2, "end": 1.4}, ...]
        (Deepgram gives this if you request word-level timing)
    Returns: {"struggle": bool, "reason": str, "score": int}
    """
    text_lower = transcript.lower().strip()
    reasons = []
    score = 0

    # 1. Explicit trigger phrases (most reliable signal)
    for phrase in STRUGGLE_PHRASES:
        if phrase in text_lower:
            reasons.append(f"explicit_phrase:{phrase}")
            score += 3

    # 2. Filler word count
    words = re.findall(r"\b\w+\b", text_lower)
    filler_count = sum(1 for w in words if w in FILLER_WORDS)
    if filler_count >= 2:
        reasons.append(f"filler_words:{filler_count}")
        score += filler_count

    # 3. Repeated consecutive words (false starts): "the the", "I I"
    repeated = sum(1 for i in range(len(words) - 1) if words[i] == words[i + 1])
    if repeated > 0:
        reasons.append(f"repeated_words:{repeated}")
        score += repeated * 2

    # 4. Long pauses between words (needs word_timestamps from Deepgram)
    if word_timestamps and len(word_timestamps) > 1:
        max_gap = 0
        for i in range(len(word_timestamps) - 1):
            gap = word_timestamps[i + 1]["start"] - word_timestamps[i]["end"]
            max_gap = max(max_gap, gap)
        if max_gap > 1.5:  # 1.5s+ pause mid-sentence = hesitation
            reasons.append(f"long_pause:{round(max_gap, 2)}s")
            score += 3

    return {
        "struggle": score >= 3,
        "reason": ", ".join(reasons) if reasons else "none",
        "score": score
    }