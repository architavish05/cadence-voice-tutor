import json
import re
from google.genai import types

def parse_llm_json(raw_text: str) -> dict:
    """Safely extracts fields from JSON or falls back to regex field extraction."""
    cleaned = raw_text.strip()
    # Strip markdown fences if present
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    
    # Try standard json parse first
    try:
        # Search for first JSON object {...}
        json_match = re.search(r"\{[\s\S]*\}", cleaned)
        if json_match:
            candidate = json_match.group(0)
            data = json.loads(candidate)
            return {
                "reply_text": data.get("reply_text", "").strip() or clean_fallback_text(raw_text),
                "correction": data.get("correction", "").strip(),
                "vocab_word": data.get("vocab_word", "").strip(),
                "vocab_translation": data.get("vocab_translation", "").strip(),
                "vocab_phonetic": data.get("vocab_phonetic", "").strip()
            }
    except Exception:
        pass

    # Regex field extraction (handles truncated or malformed JSON without leaking raw JSON)
    reply_match = re.search(r'"reply_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?', cleaned)
    corr_match = re.search(r'"correction"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?', cleaned)
    word_match = re.search(r'"vocab_word"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?', cleaned)
    trans_match = re.search(r'"vocab_translation"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?', cleaned)
    phon_match = re.search(r'"vocab_phonetic"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?', cleaned)

    reply_text = reply_match.group(1).replace('\\"', '"') if reply_match else clean_fallback_text(raw_text)
    correction = corr_match.group(1).replace('\\"', '"') if corr_match else ""
    vocab_word = word_match.group(1).replace('\\"', '"') if word_match else ""
    vocab_trans = trans_match.group(1).replace('\\"', '"') if trans_match else ""
    vocab_phon = phon_match.group(1).replace('\\"', '"') if phon_match else ""

    return {
        "reply_text": reply_text.strip() or clean_fallback_text(raw_text),
        "correction": correction.strip(),
        "vocab_word": vocab_word.strip(),
        "vocab_translation": vocab_trans.strip(),
        "vocab_phonetic": vocab_phon.strip()
    }

def clean_fallback_text(text: str) -> str:
    """Cleans any stray JSON formatting from text before showing to user."""
    cleaned = re.sub(r'```(?:json)?', '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'["\{\}]', '', cleaned)
    cleaned = re.sub(r'(?:reply_text|correction|vocab_word|vocab_translation|vocab_phonetic)\s*:', '', cleaned)
    return cleaned.strip()

def get_llm_reply(client, transcript: str, system_prompt: str, history: list = None, model_name: str = "gemini-flash-lite-latest") -> dict:
    models_to_try = [model_name, "gemini-flash-latest", "gemini-3.6-flash"]
    
    contents = []
    if history:
        for turn in history[-6:]:  # Keep up to last 6 turns for conversational context
            role = "user" if turn.get("role") in ["user", "human"] else "model"
            text_val = str(turn.get("text", "")).strip()
            if text_val:
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text_val)]))
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=transcript)]))

    last_error = None
    for m in models_to_try:
        try:
            response = client.models.generate_content(
                model=m,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    max_output_tokens=500,
                    temperature=0.3
                )
            )
            if response and response.text:
                return parse_llm_json(response.text.strip())
        except Exception as e:
            print(f"[LLM WARN] Model {m} failed: {e}. Trying fallback...", flush=True)
            last_error = e

    raise Exception(f"All Gemini models failed. Last error: {last_error}")