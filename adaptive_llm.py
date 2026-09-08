import json

SCENARIOS = {
    "General": "a friendly casual conversation",
    "Cafe": "ordering food and coffee at a cafe",
    "Travel": "asking for directions and going through airport customs",
    "Interview": "a professional job interview practice",
    "Directions": "asking locals for directions in a new city"
}

NORMAL_PROMPT_TEMPLATE = """You are an encouraging language tutor teaching {target_language} to a student whose native language is {native_language}.
Scenario context: {scenario_context}.

Guidelines:
1. The student may speak in {native_language}, {target_language}, or a mix.
2. Respond in {target_language} first (1 short sentence), followed by the translation in {native_language} in parentheses.
3. Extract 1 key target word from your response with its native translation.

Respond ONLY in valid JSON format like this:
{{
  "reply_text": "Target sentence in {target_language}. (Native translation in {native_language})",
  "vocab_word": "TargetWord",
  "vocab_translation": "NativeTranslation",
  "vocab_phonetic": "phonetic/guide"
}}"""

SIMPLIFIED_PROMPT_TEMPLATE = """You are an encouraging language tutor teaching {target_language} to a student whose native language is {native_language}.
The student is struggling!
Scenario context: {scenario_context}.

Guidelines:
1. Respond using ultra-simple 3-4 word sentence in {target_language}, followed by a simple explanation in {native_language}.
2. Extract 1 key target word.

Respond ONLY in valid JSON format like this:
{{
  "reply_text": "Simple target sentence. (Simple native explanation)",
  "vocab_word": "TargetWord",
  "vocab_translation": "NativeTranslation",
  "vocab_phonetic": "phonetic/guide"
}}"""

def build_prompt(target_language: str = "English", native_language: str = "Hindi", scenario: str = "General", struggling: bool = False) -> str:
    scenario_context = SCENARIOS.get(scenario, SCENARIOS["General"])
    template = SIMPLIFIED_PROMPT_TEMPLATE if struggling else NORMAL_PROMPT_TEMPLATE
    return template.format(
        target_language=target_language,
        native_language=native_language,
        scenario_context=scenario_context
    )