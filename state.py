import threading

class ConversationState:
    def __init__(self):
        self.is_speaking = threading.Event()
        self.interrupt = threading.Event()
        self.processing = threading.Event()   # NEW — set as soon as a turn starts
        self.pending_transcript = None
        self.interrupt_t1 = None           # epoch time when interrupt was triggered
        self.lock = threading.Lock()

state = ConversationState()