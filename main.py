from google import genai
from google.genai import types
import os
import time
import queue
import threading
import sounddevice as sd
from dotenv import load_dotenv
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)
from tts import speak
from hesitation_detector import detect_hesitation
from evidence_logger import log_turn
from adaptive_llm import build_prompt
from llm import get_llm_reply
from state import state

load_dotenv()
llm_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

SAMPLE_RATE = 16000
audio_queue = queue.Queue()
MIN_INTERRUPT_WORDS = 3

def audio_callback(indata, frames, time_info, status):
    if status:
        print(status, flush=True)
    audio_queue.put(bytes(indata))

def process_turn(transcript, word_timestamps=None):
    """Handles one full turn: hesitation -> LLM -> speak. Manages its own processing flag."""
    try:
        hesitation = detect_hesitation(transcript, word_timestamps)
        print("Hesitation:", hesitation, flush=True)

        system_prompt = build_prompt(target_language="Spanish", struggling=hesitation["struggle"])
        response_text = get_llm_reply(llm_client, transcript, system_prompt)
        print("LLM reply:", response_text, flush=True)

        speed = 0.75 if hesitation["struggle"] else 1.0
        result = speak(response_text, speed=speed)

        log_turn(transcript, hesitation, response_text, speed)

        if result == "interrupted":
            with state.lock:
                new_transcript = state.pending_transcript
                state.pending_transcript = None
                interrupt_t1 = getattr(state, 'interrupt_t1', None)
            if new_transcript:
                t3 = time.time()
                print(f"[INTERRUPT] Re-processing at t3={t3:.4f}: {new_transcript}", flush=True)
                if interrupt_t1:
                    print(f"[INTERRUPT] Latency: t3-t1 = {(t3 - interrupt_t1)*1000:.1f}ms (trigger→re-process)", flush=True)
                process_turn(new_transcript)   # recurse — same thread, flag stays held

    except Exception as e:
        print("LLM error:", e, flush=True)

def call_llm(transcript, word_timestamps=None):
    """Thread entry point — owns the processing flag for the whole turn (incl. recursion)."""
    try:
        process_turn(transcript, word_timestamps)
    finally:
        state.processing.clear()

def main():
    deepgram = DeepgramClient(os.getenv("DEEPGRAM_API_KEY"))
    dg_connection = deepgram.listen.live.v("1")

    def on_message(self, result, **kwargs):
        transcript = result.channel.alternatives[0].transcript
        words = result.channel.alternatives[0].words

        if not transcript or not transcript.strip():
            return
        if not result.is_final:
            return

        print(f"Transcript: {transcript}", flush=True)

        word_timestamps = [
            {"word": w.word, "start": w.start, "end": w.end}
            for w in words
        ] if words else []

        if state.is_speaking.is_set():
            if len(transcript.split()) >= MIN_INTERRUPT_WORDS:
                t1 = time.time()
                print(f"[INTERRUPT] Trigger detected at t1={t1:.4f}: {transcript}", flush=True)
                with state.lock:
                    state.pending_transcript = transcript
                    state.interrupt_t1 = t1  # store for latency calculation
                state.interrupt.set()
            return

        if state.processing.is_set():
            # a turn is already being handled (LLM in flight) — drop duplicate/overlapping final
            print(f"[SKIP] Already processing, ignoring duplicate: {transcript}", flush=True)
            return

        state.processing.set()
        threading.Thread(
            target=call_llm,
            args=(transcript, word_timestamps),
            daemon=True
        ).start()

    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)

    options = LiveOptions(
        model="nova-2",
        smart_format=True,
        punctuate=True,
        interim_results=False,
        encoding="linear16",
        sample_rate=SAMPLE_RATE,
        channels=1,
    )

    started = dg_connection.start(options)
    print(f"Connection started: {started}", flush=True)

    stream = sd.RawInputStream(
        samplerate=SAMPLE_RATE,
        blocksize=8000,
        dtype="int16",
        channels=1,
        callback=audio_callback,
    )
    stream.start()

    def send_audio():
        while True:
            data = audio_queue.get()
            dg_connection.send(data)

    send_thread = threading.Thread(target=send_audio, daemon=True)
    send_thread.start()

    print("Listening... Press Enter to stop.", flush=True)
    input()

    stream.stop()
    stream.close()
    dg_connection.finish()

if __name__ == "__main__":
    main()
