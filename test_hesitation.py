from hesitation_detector import detect_hesitation

tests = [
    "I want to go to the market",                      # normal
    "I, um, want to, uh, go to the... the market",      # fillers + repeat
    "I don't understand, can you say that again",       # explicit trigger
]

for t in tests:
    result = detect_hesitation(t)
    print(f"{t!r} -> {result}")
    