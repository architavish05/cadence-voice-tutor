import os
from dotenv import load_dotenv
from deepgram import DeepgramClient, FileSource, PrerecordedOptions

load_dotenv()

deepgram = DeepgramClient(os.getenv("DEEPGRAM_API_KEY"))

with open("hello.mp3", "rb") as audio_file:
    buffer_data = audio_file.read()

payload: FileSource = {
    "buffer": buffer_data,
}

options = PrerecordedOptions(
    model="nova-2",
    smart_format=True,
)

response = deepgram.listen.prerecorded.v("1").transcribe_file(payload, options)
print(response.results.channels[0].alternatives[0].transcript)
