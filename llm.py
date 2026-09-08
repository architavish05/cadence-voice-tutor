import json
import re
from google.genai import types

def parse_llm_json(raw_text: str):
    """Attempts to parse JSON from LLM response or falls back to raw text dict."""
    try:
        # Clean markdown codeblocks ```json ... ```
        cleaned = re.sub(r"```json\s*", "", raw_text)
        cleaned = re.sub(r"```\s*", "", cleaned).strip()
        # Search for first JSON object {...}
        json_match = re.search(r"\{[\s\S]*\}", cleaned)
        if json_match:
            cleaned = json_match.group(0)
        data = json.loads(cleaned)
        return {
            "reply_text": data.get("reply_text", raw_text),
            "correction": data.get("correction", ""),
            "vocab_word": data.get("vocab_word", ""),
            "vocab_translation": data.get("vocab_translation", ""),
            "vocab_phonetic": data.get("vocab_phonetic", "")
        }
    except Exception:
        return {
            "reply_text": raw_text,
            "correction": "",
            "vocab_word": "",
            "vocab_translation": "",
            "vocab_phonetic": ""
        }

def get_llm_reply(client, transcript: str, system_prompt: str, history: list = None, model_name: str = "gemini-flash-lite-latest") -> dict:
    models_to_try = [model_name, "gemini-flash-latest", "gemini-3.6-flash"]
    
    contents = []
    if history:
        for turn in history[-6:]: # Keep up to last 6 turns for conversational context
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
                    max_output_tokens=150,
                    temperature=0.3
                )
            )
            if response and response.text:
                return parse_llm_json(response.text.strip())
        except Exception as e:
            print(f"[LLM WARN] Model {m} failed: {e}. Trying fallback...", flush=True)
            last_error = e

    raise Exception(f"All Gemini models failed. Last error: {last_error}")