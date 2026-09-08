// Cadence Multilingual Web App Controller

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const toggleSessionBtn = document.getElementById('toggleSessionBtn');
    const interruptBtn = document.getElementById('interruptBtn');
    const avatarRing = document.getElementById('avatarRing');
    const avatarEmoji = document.getElementById('avatarEmoji');
    const tutorStateBadge = document.getElementById('tutorStateBadge');
    const tutorStateText = document.getElementById('tutorStateText');
    const chatStream = document.getElementById('chatStream');
    const manualTextInput = document.getElementById('manualTextInput');
    const sendTextBtn = document.getElementById('sendTextBtn');
    const rimeAudioPlayer = document.getElementById('rimeAudioPlayer');
    const clearChatBtn = document.getElementById('clearChatBtn');
    
    // Selectors
    const targetLangSelect = document.getElementById('targetLanguageSelect');
    const nativeLangSelect = document.getElementById('nativeLanguageSelect');
    const scenarioSelect = document.getElementById('scenarioSelect');

    // Telemetry & Flashcard Elements
    const speedVal = document.getElementById('speedVal');
    const scoreVal = document.getElementById('scoreVal');
    const struggleBadge = document.getElementById('struggleBadge');
    const reasonVal = document.getElementById('reasonVal');
    const fluencyVal = document.getElementById('fluencyVal');
    const fluencyBarFill = document.getElementById('fluencyBarFill');
    const flashcardsPanel = document.getElementById('flashcardsPanel');
    const logTerminal = document.getElementById('logTerminal');

    let isSessionActive = false;
    let audioContext, analyser, microphone, dataArray;
    let animationFrameId;
    let recognition;
    const flashcardStore = [];

    // ── Progress Tracker (localStorage) ──
    const PROGRESS_KEY = 'cadence_progress';

    function loadProgress() {
        try {
            return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {
                streak: 0,
                lastSessionDate: null,
                totalWords: 0,
                totalTurns: 0,
                fluencySum: 0,
                fluencyCount: 0,
                learnedWords: []
            };
        } catch { return { streak: 0, lastSessionDate: null, totalWords: 0, totalTurns: 0, fluencySum: 0, fluencyCount: 0, learnedWords: [] }; }
    }

    function saveProgress(p) {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    }

    function calcStreak(p) {
        const today = new Date().toDateString();
        const last = p.lastSessionDate;
        if (!last) return 1;
        const diff = (new Date(today) - new Date(last)) / 86400000;
        if (diff === 0) return p.streak;       // same day, keep
        if (diff === 1) return p.streak + 1;   // next day, increment
        return 1;                               // gap — reset
    }

    function renderProgress(p) {
        document.getElementById('streakVal').textContent = p.streak;
        document.getElementById('totalWordsVal').textContent = p.totalWords;
        document.getElementById('totalTurnsVal').textContent = p.totalTurns;
        const avg = p.fluencyCount > 0 ? Math.round(p.fluencySum / p.fluencyCount) : null;
        document.getElementById('avgFluencyVal').textContent = avg !== null ? avg + '%' : '—';

        // Glow streak card if >1
        const streakStat = document.getElementById('streakVal').closest('.progress-stat');
        if (streakStat) streakStat.classList.toggle('streak-active', p.streak > 1);
    }

    function trackTurn(fluencyScore, vocabWord) {
        const p = loadProgress();
        const today = new Date().toDateString();
        p.streak = calcStreak(p);
        p.lastSessionDate = today;
        p.totalTurns += 1;
        p.fluencySum += fluencyScore;
        p.fluencyCount += 1;
        if (vocabWord && !p.learnedWords.includes(vocabWord.toLowerCase())) {
            p.learnedWords.push(vocabWord.toLowerCase());
            p.totalWords = p.learnedWords.length;
        }
        saveProgress(p);
        renderProgress(p);
    }

    // Init progress display on load
    renderProgress(loadProgress());

    // Reset button
    const resetProgressBtn = document.getElementById('resetProgressBtn');
    if (resetProgressBtn) {
        resetProgressBtn.addEventListener('click', () => {
            if (confirm('Reset all progress? This cannot be undone.')) {
                localStorage.removeItem(PROGRESS_KEY);
                renderProgress(loadProgress());
                appendLog('[PROGRESS] Progress reset.');
            }
        });
    }

    // Waveform Setup
    const canvas = document.getElementById('waveformCanvas');
    const canvasCtx = canvas.getContext('2d');

    function resizeCanvas() {
        if (canvas.parentElement) {
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
        }
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    function drawIdleWaveform() {
        canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        canvasCtx.beginPath();
        
        const sliceWidth = canvas.width / 100;
        let x = 0;
        for (let i = 0; i < 100; i++) {
            const y = (canvas.height / 2) + Math.sin(i * 0.1 + Date.now() * 0.003) * 3;
            if (i === 0) canvasCtx.moveTo(x, y);
            else canvasCtx.lineTo(x, y);
            x += sliceWidth;
        }
        canvasCtx.stroke();
        if (!isSessionActive) requestAnimationFrame(drawIdleWaveform);
    }
    drawIdleWaveform();

    // Toggle Session
    toggleSessionBtn.addEventListener('click', () => {
        if (!isSessionActive) {
            startSession();
        } else {
            stopSession();
        }
    });

    function startSession() {
        isSessionActive = true;
        toggleSessionBtn.innerHTML = '<span class="btn-icon">⏹️</span> Stop Session';
        toggleSessionBtn.classList.replace('btn-primary', 'btn-danger');
        interruptBtn.disabled = false;
        setConnectionStatus(true);
        setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
        appendLog('Session started. Multilingual live mic active.');
        initMicrophone();
    }

    function stopSession() {
        isSessionActive = false;
        toggleSessionBtn.innerHTML = '<span class="btn-icon">🎙️</span> Start Session';
        toggleSessionBtn.classList.replace('btn-danger', 'btn-primary');
        interruptBtn.disabled = true;
        setConnectionStatus(false);
        setTutorState('idle', '🎧', 'IDLE', 'Ready to begin conversation');
        appendLog('Session stopped.');

        if (recognition) {
            try { recognition.stop(); } catch(e) {}
        }
        if (audioContext) audioContext.close();
        rimeAudioPlayer.pause();
    }

    // Microphone & Speech Recognition setup
    async function initMicrophone() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        // ── STEP 1: Start SpeechRecognition FIRST (before getUserMedia grabs the mic stream)
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;

            const langMap = {
                'Hindi': 'hi-IN', 'English': 'en-US', 'Spanish': 'es-ES',
                'French': 'fr-FR', 'German': 'de-DE', 'Italian': 'it-IT',
                'Korean': 'ko-KR', 'Japanese': 'ja-JP', 'Chinese': 'zh-CN'
            };

            function updateRecognitionLang() {
                const nativeLang = nativeLangSelect ? nativeLangSelect.value : 'Hindi';
                recognition.lang = langMap[nativeLang] || 'hi-IN';
                appendLog(`[STT] Recognition language: ${recognition.lang}`);
            }
            updateRecognitionLang();
            if (nativeLangSelect) nativeLangSelect.addEventListener('change', updateRecognitionLang);

            let speechBuffer = '';
            let silenceTimer = null;

            recognition.onspeechstart = () => {
                appendLog('[STT] 🎙️ Speech detected!');
                setTutorState('listening', '🎙️', 'HEARING', 'Speech detected...');
            };
            recognition.onspeechend = () => appendLog('[STT] Silence detected.');

            recognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        speechBuffer += event.results[i][0].transcript + ' ';
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }
                const currentText = (speechBuffer + interim).trim();
                if (currentText) {
                    manualTextInput.value = currentText;
                    clearTimeout(silenceTimer);
                    silenceTimer = setTimeout(() => {
                        const finalText = (speechBuffer + interim).trim();
                        if (finalText) {
                            speechBuffer = '';
                            manualTextInput.value = '';
                            appendLog(`[STT Captured] "${finalText}"`);
                            submitUtterance(finalText);
                        }
                    }, 1000);
                }
            };

            recognition.onerror = (event) => {
                if (event.error === 'not-allowed') {
                    appendLog('[STT ERROR] ❌ Mic access denied! Allow mic in Chrome: Settings → Privacy → Site Settings → Microphone.');
                    showPTTFallback();
                } else if (event.error === 'network') {
                    appendLog('[STT ERROR] Network error — STT requires internet connection.');
                } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
                    appendLog(`[STT Error] ${event.error}`);
                }
            };

            recognition.onend = () => {
                if (isSessionActive) {
                    setTimeout(() => {
                        if (isSessionActive) {
                            try { recognition.start(); } catch(e) {}
                        }
                    }, 250);
                }
            };

            try {
                recognition.start();
                appendLog('[STT] ✅ SpeechRecognition started. Speak now!');
            } catch(e) {
                appendLog('[STT] Could not start recognition: ' + e.message);
                showPTTFallback();
            }
        } else {
            appendLog('[WARN] Web Speech API not supported. Use Chrome/Edge.');
            showPTTFallback();
        }

        // ── STEP 2: THEN set up AudioContext visualizer (after STT is already running)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);
            analyser.fftSize = 256;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            drawLiveWaveform();
            appendLog('[MIC] 🎛️ Audio visualizer active.');
        } catch (err) {
            appendLog('[MIC] Visualizer unavailable: ' + err.message);
        }
    }

    // ── Push-To-Talk MediaRecorder fallback (bypasses Web Speech API entirely)
    let pttActive = false;
    let mediaRecorder = null;
    let recordedChunks = [];

    function showPTTFallback() {
        appendLog('[FALLBACK] Activating Push-To-Talk button (hold to record).');
        const pttBtn = document.getElementById('pttBtn');
        if (pttBtn) pttBtn.style.display = 'inline-flex';
    }

    window.pttStart = async function() {
        if (pttActive) return;
        pttActive = true;
        recordedChunks = [];
        appendLog('[PTT] 🔴 Recording... (release to send)');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(recordedChunks, { type: 'audio/webm' });
                appendLog('[PTT] Sending audio to transcription...');
                const formData = new FormData();
                formData.append('audio', blob, 'recording.webm');
                try {
                    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
                    const data = await res.json();
                    if (data.transcript) {
                        manualTextInput.value = data.transcript;
                        appendLog(`[PTT Captured] "${data.transcript}"`);
                        submitUtterance(data.transcript);
                    } else {
                        appendLog('[PTT] No speech detected in recording.');
                    }
                } catch(e) {
                    appendLog('[PTT Error] Transcription failed: ' + e.message);
                }
            };
            mediaRecorder.start();
        } catch(e) {
            appendLog('[PTT Error] Could not access mic: ' + e.message);
            pttActive = false;
        }
    };

    window.pttStop = function() {
        if (!pttActive || !mediaRecorder) return;
        pttActive = false;
        appendLog('[PTT] ⏹️ Recording stopped.');
        mediaRecorder.stop();
    };

    function drawLiveWaveform() {
        if (!isSessionActive) return;
        animationFrameId = requestAnimationFrame(drawLiveWaveform);
        analyser.getByteFrequencyData(dataArray);

        canvasCtx.fillStyle = 'rgba(11, 15, 25, 0.4)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / dataArray.length) * 2.5;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            canvasCtx.fillStyle = '#6366f1';
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    function setTutorState(state, emoji, badgeText, text) {
        avatarRing.className = `avatar-ring ${state}`;
        avatarEmoji.textContent = emoji;
        tutorStateBadge.className = `badge-state ${state}`;
        tutorStateBadge.textContent = badgeText;
        tutorStateText.textContent = text;
    }

    // ── Typing Indicator ──
    const typingIndicator = document.getElementById('typingIndicator');
    function showTyping(show) {
        if (!typingIndicator) return;
        typingIndicator.style.display = show ? 'flex' : 'none';
        if (show) chatStream.scrollTop = chatStream.scrollHeight;
    }

    // ── Connection Status ──
    const connectionStatus = document.getElementById('connectionStatus');
    function setConnectionStatus(active) {
        if (!connectionStatus) return;
        if (active) {
            connectionStatus.classList.add('active');
            connectionStatus.innerHTML = '<span class="dot"></span> Live';
        } else {
            connectionStatus.classList.remove('active');
            connectionStatus.innerHTML = '<span class="dot gray"></span> Idle';
        }
    }

    // ── Dynamic Welcome Message & Placeholder ──
    const welcomeText = document.getElementById('welcomeText');
    function updateWelcome() {
        const target = targetLangSelect ? targetLangSelect.value : 'English';
        const native = nativeLangSelect ? nativeLangSelect.value : 'Hindi';
        if (welcomeText) {
            welcomeText.innerHTML = `👋 <strong>Welcome to Cadence!</strong><br/>
                You are learning <strong style="color:var(--accent-green)">${target}</strong> 
                using <strong style="color:var(--accent-blue)">${native}</strong> as your guide language.<br/>
                Click <strong>Start Session</strong> and speak — Cadence will reply in both languages!`;
        }
        if (manualTextInput) {
            manualTextInput.placeholder = `Type in ${native} or ${target} and press Enter...`;
        }
    }
    updateWelcome();
    if (targetLangSelect) targetLangSelect.addEventListener('change', updateWelcome);
    if (nativeLangSelect) nativeLangSelect.addEventListener('change', updateWelcome);



    sendTextBtn.addEventListener('click', () => submitUtterance(manualTextInput.value));
    manualTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitUtterance(manualTextInput.value);
    });

    // Clear Chat button
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            chatStream.innerHTML = '';
            conversationHistory = [];
            lastReplyText = '';
            lastReplyAudioUrl = '';
            appendLog('[CHAT] Conversation & history cleared.');
        });
    }

    if (scenarioSelect) {
        scenarioSelect.addEventListener('change', () => {
            conversationHistory = [];
            appendLog(`[SCENARIO] Switched to ${scenarioSelect.value} (memory reset).`);
        });
    }

    window.sendSimulatedUtterance = function(text) {
        submitUtterance(text);
    };

    // Track conversation history and last tutor reply
    let conversationHistory = [];
    let lastReplyText = '';
    let lastReplyAudioUrl = '';

    // Keywords that trigger local instant repeat (no API call needed)
    const REPEAT_TRIGGERS = ['repeat', 'dobara', 'dobara bolo', 'phir se', 'again', 'say it again', 'replay', 'ek baar aur'];

    async function submitUtterance(text) {
        if (!text.trim()) return;
        manualTextInput.value = '';

        // ── Local Repeat Handler — instant, no API call ──
        const lower = text.trim().toLowerCase();
        const isRepeat = REPEAT_TRIGGERS.some(t => lower.includes(t));
        if (isRepeat && lastReplyAudioUrl) {
            appendChatBubble('user', text);
            appendLog('[COMMAND] Repeat detected — replaying last reply instantly!');
            appendChatBubble('tutor', `🔁 Repeating: ${lastReplyText}`);
            rimeAudioPlayer.src = lastReplyAudioUrl;
            rimeAudioPlayer.play();
            setTutorState('speaking', '🔁', 'REPEATING', 'Replaying last reply...');
            rimeAudioPlayer.onended = () => setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
            return;
        }

        appendChatBubble('user', text);
        // Show typing indicator + processing avatar
        showTyping(true);
        setTutorState('processing', '🧠', 'ANALYZING', 'Generating bilingual reply...');

        appendLog(`[USER] "${text}"`);

        const targetLang = targetLangSelect ? targetLangSelect.value : 'English';
        const nativeLang = nativeLangSelect ? nativeLangSelect.value : 'Hindi';
        const scenario = scenarioSelect ? scenarioSelect.value : 'General';
        const historyPayload = conversationHistory.slice(-6);

        // Record user turn in local history
        conversationHistory.push({ role: 'user', text: text });

        try {
            const response = await fetch('/api/process_turn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript: text,
                    target_language: targetLang,
                    native_language: nativeLang,
                    scenario: scenario,
                    history: historyPayload
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'API error');
            showTyping(false);
            handleTurnResponse(data);
        } catch (err) {
            showTyping(false);
            appendLog(`[ERROR] Server call failed: ${err.message}`);
            setTutorState('idle', '⚠️', 'ERROR', 'Turn processing error');
        }
    }

    function handleTurnResponse(data) {
        const isStruggling = data.hesitation.struggle;
        const speed = data.speed;
        
        speedVal.textContent = `${speed}x`;
        speedVal.className = `metric-value ${isStruggling ? 'amber' : 'green'}`;
        
        scoreVal.textContent = `${data.hesitation.score} / 5`;
        struggleBadge.textContent = isStruggling ? 'STRUGGLE DETECTED' : 'Normal Fluency';
        struggleBadge.style.color = isStruggling ? 'var(--accent-amber)' : 'var(--text-muted)';
        
        reasonVal.textContent = data.hesitation.reason;

        // Update Fluency Score Meter
        const fluency = data.fluency_score || 100;
        fluencyVal.textContent = `${fluency}%`;
        fluencyBarFill.style.width = `${fluency}%`;

        // Update Flashcards if word extracted
        if (data.vocab_word && data.vocab_translation) {
            addFlashcard(data.vocab_word, data.vocab_translation, data.vocab_phonetic);
        }

        const stateName = isStruggling ? 'adapted' : 'speaking';
        const emoji = isStruggling ? '🐢' : '🔊';
        const badge = isStruggling ? `ADAPTED (${speed}x)` : `SPEAKING (${speed}x)`;
        const text = isStruggling ? `Bilingual explanation at ${speed}x speed...` : `Speaking ${data.target_language} + ${data.native_language}...`;

        setTutorState(stateName, emoji, badge, text);

        appendChatBubble('tutor', data.reply_text, isStruggling, speed, data.target_language);

        if (data.audio_url) {
            lastReplyText = data.reply_text;
            lastReplyAudioUrl = data.audio_url;
            rimeAudioPlayer.src = data.audio_url;
            rimeAudioPlayer.play();
            rimeAudioPlayer.onended = () => {
                setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
            };
        }

        appendLog(`[TUTOR] Target=${data.target_language} | Native=${data.native_language} | speed=${speed}x`);
        appendLog(`[TEXT] "${data.reply_text}"`);

        // Update progress tracker
        trackTurn(data.fluency_score || 100, data.vocab_word || '');

        // Record tutor reply into conversation memory
        if (data.reply_text) {
            conversationHistory.push({ role: 'model', text: data.reply_text });
            if (conversationHistory.length > 20) {
                conversationHistory = conversationHistory.slice(-20);
            }
        }
    }

    function addFlashcard(word, translation, phonetic) {
        flashcardStore.unshift({ word, translation, phonetic });
        if (flashcardStore.length > 5) flashcardStore.pop();

        flashcardsPanel.innerHTML = '';
        flashcardStore.forEach(card => {
            const item = document.createElement('div');
            item.className = 'flashcard-item';
            item.innerHTML = `
                <div>
                    <span class="flashcard-word">${card.word}</span>
                    ${card.phonetic ? `<small style="color:var(--text-muted);"> (${card.phonetic})</small>` : ''}
                </div>
                <span class="flashcard-trans">➔ ${card.translation}</span>
            `;
            flashcardsPanel.appendChild(item);
        });
    }

    // Slow-Mo Replay Trigger (0.5x)
    window.playSlowMo = async function(text) {
        const targetLang = targetLangSelect ? targetLangSelect.value : 'English';
        appendLog(`[SLOW-MO] Synthesizing 0.5x ultra-slow audio for: "${text}"...`);
        try {
            const res = await fetch('/api/slowmo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, target_language: targetLang })
            });
            const data = await res.json();
            if (data.audio_url) {
                rimeAudioPlayer.src = data.audio_url;
                rimeAudioPlayer.play();
            }
        } catch (e) {
            appendLog(`[ERROR] Slow-mo playback error: ${e.message}`);
        }
    };

    interruptBtn.addEventListener('click', async () => {
        rimeAudioPlayer.pause();
        const t1 = performance.now();
        setTutorState('interrupted', '⚡', 'INTERRUPTED', 'Barge-in triggered! Audio stopped.');
        const t2 = performance.now();
        const latency = (t2 - t1).toFixed(1);
        
        appendLog(`[INTERRUPT] User barged in! Audio killed at t2. Latency: ${latency}ms`);

        setTimeout(() => {
            submitUtterance("I didn't get that, can you repeat?");
        }, 600);
    });

    function appendChatBubble(sender, text, isAdapted = false, speed = 1.0, lang = '') {
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${sender} ${isAdapted ? 'adapted' : ''}`;

        const meta = document.createElement('div');
        meta.className = 'message-meta';

        if (sender === 'user') {
            meta.innerHTML = '<span>You</span>';
        } else {
            const label = document.createElement('span');
            label.innerHTML = `Cadence Tutor ${isAdapted ? '<span class="tag-adapted">[0.75x Slower]</span>' : '[1.0x Normal]'}`;

            // Safe slow-mo button — no inline JS, uses data attribute
            const slowBtn = document.createElement('button');
            slowBtn.className = 'btn-slowmo';
            slowBtn.title = 'Replay at 0.5x speed';
            slowBtn.textContent = '🐢 0.5x Slow';
            slowBtn.dataset.replayText = text; // safe storage
            slowBtn.addEventListener('click', () => playSlowMo(slowBtn.dataset.replayText));

            meta.appendChild(label);
            meta.appendChild(slowBtn);
        }

        const content = document.createElement('div');
        content.className = 'msg-content';
        content.textContent = text;

        bubble.appendChild(meta);
        bubble.appendChild(content);
        chatStream.appendChild(bubble);
        chatStream.scrollTop = chatStream.scrollHeight;
    }

    function appendLog(msg) {
        const time = new Date().toLocaleTimeString();
        const lines = logTerminal.textContent.split('\n');
        if (lines.length > 100) lines.splice(0, lines.length - 100); // keep last 100 lines
        logTerminal.textContent = lines.join('\n') + `\n[${time}] ${msg}`;
        logTerminal.scrollTop = logTerminal.scrollHeight;
    }
});
