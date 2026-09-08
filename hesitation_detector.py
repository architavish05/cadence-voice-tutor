import re

FILLER_WORDS = {"um", "uh", "umm", "uhh", "err", "er", "hmm", "hm", "like", "actually", "ah", "ahh"}

STRUGGLE_PHRASES = [
    # Understanding issues
    "i don't understand", "i dont understand", "i didn't understand", "i didnt understand",
    "what does that mean", "what do you mean", "repeat that", "repeat please",
    "say that again", "say again", "i didn't get that", "i didnt get that",
    "can you slow down", "slow down", "too fast", "speak slowly", "slower",
    "confused", "i am confused", "im confused", "not sure what", "not sure how",
    # Expression / knowledge struggle
    "i don't know how to say", "i dont know how to say", "don't know how to say", "dont know how to say",
    "i don't know what to say", "i dont know what to say",
    "i don't know", "i dont know", "don't know", "dont know",
    "how do i say", "how to say", "what is the word for",
    "i forgot", "hard", "too difficult", "it's difficult", "its difficult",
    "help me", "i'm stuck", "im stuck", "can you help",
    # Hindi / Hinglish struggle triggers
    "samajh nahi aaya", "samajh nahi aa raha", "kya matlab", "phir se bolo",
    "kaise bolte", "nahi pata", "pata nahi", "dheere bolo"
]

def detect_hesitation(transcript: str, word_timestamps: list = None) -> dict:
    """
    transcript: final STT text
    word_timestamps: optional list of dicts like
        [{"word": "um", "start": 1.2, "end": 1.4}, ...]
    Returns: {"struggle": bool, "reason": str, "score": int}
    """
    text_lower = transcript.lower().strip()
    clean_text = re.sub(r"[^\w\s']", " ", text_lower)
    no_apos_text = clean_text.replace("'", "")
    
    reasons = []
    score = 0

    # 1. Explicit trigger phrases (immediate struggle signal)
    for phrase in STRUGGLE_PHRASES:
        phrase_no_apos = phrase.replace("'", "")
        if phrase in clean_text or phrase_no_apos in no_apos_text:
            reasons.append(f"explicit_phrase:{phrase}")
            score += 3
            break

    # 2. Filler word count
    words = re.findall(r"\b\w+\b", text_lower)
    filler_count = sum(1 for w in words if w in FILLER_WORDS)
    if filler_count >= 1:
        reasons.append(f"filler_words:{filler_count}")
        score += filler_count * 2

    # 3. Repeated consecutive words (false starts): "the the", "I I"
    repeated = sum(1 for i in range(len(words) - 1) if words[i] == words[i + 1])
    if repeated > 0:
        reasons.append(f"repeated_words:{repeated}")
        score += repeated * 2

    # 4. Long pauses between words
    if word_timestamps and len(word_timestamps) > 1:
        max_gap = 0
        for i in range(len(word_timestamps) - 1):
            gap = word_timestamps[i + 1]["start"] - word_timestamps[i]["end"]
            max_gap = max(max_gap, gap)
        if max_gap > 1.5:
            reasons.append(f"long_pause:{round(max_gap, 2)}s")
            score += 3

    # Struggle if score >= 2 (1 filler or 1 struggle phrase triggers it)
    is_struggle = score >= 2

    return {
        "struggle": is_struggle,
        "reason": ", ".join(reasons) if reasons else "none",
        "score": score
    }