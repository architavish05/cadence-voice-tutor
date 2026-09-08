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
    const voicePersonaSelect = document.getElementById('voicePersonaSelect');

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

    // Session Tracking
    let sessionStartTime = null;
    let sessionTurnsCount = 0;
    let sessionFluencies = [];
    let sessionWordsExtracted = [];

    function startSession() {
        isSessionActive = true;
        sessionStartTime = Date.now();
        sessionTurnsCount = 0;
        sessionFluencies = [];
        sessionWordsExtracted = [];

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

        // Show session summary modal if at least 1 turn was practiced
        if (sessionTurnsCount > 0) {
            showSessionSummary();
        }
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
                const targetLang = targetLangSelect ? targetLangSelect.value : 'English';
                recognition.lang = langMap[targetLang] || 'en-US';
                appendLog(`[STT] Recognition listening for: ${targetLang} (${recognition.lang})`);
            }
            updateRecognitionLang();
            if (targetLangSelect) targetLangSelect.addEventListener('change', updateRecognitionLang);
            if (nativeLangSelect) nativeLangSelect.addEventListener('change', updateRecognitionLang);

            let speechBuffer = '';
            let silenceTimer = null;

            recognition.onspeechstart = () => {
                appendLog('[STT] 🎙️ Speech detected!');
                setTutorState('listening', '🎙️', 'HEARING', 'Speech detected...');
            };
            recognition.onspeechend = () => {
                appendLog('[STT] Silence detected.');
                // Instant trigger on speech end if text buffered
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    const finalText = (speechBuffer).trim() || manualTextInput.value.trim();
                    if (finalText) {
                        speechBuffer = '';
                        manualTextInput.value = '';
                        appendLog(`[STT Captured] "${finalText}"`);
                        submitUtterance(finalText);
                    }
                }
            };

            recognition.onresult = (event) => {
                let interim = '';
                let hasFinal = false;
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        speechBuffer += event.results[i][0].transcript + ' ';
                        hasFinal = true;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }
                const currentText = (speechBuffer + interim).trim();
                if (currentText) {
                    manualTextInput.value = currentText;
                    clearTimeout(silenceTimer);
                    // Fast trigger: 300ms for final results, 450ms for interim
                    const waitMs = hasFinal ? 250 : 400;
                    silenceTimer = setTimeout(() => {
                        const finalText = (speechBuffer + interim).trim();
                        if (finalText) {
                            speechBuffer = '';
                            manualTextInput.value = '';
                            appendLog(`[STT Captured] "${finalText}"`);
                            submitUtterance(finalText);
                        }
                    }, waitMs);
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

        // Check quest progress on this turn
        if (window._checkQuestOnTurn) window._checkQuestOnTurn(text);

        const targetLang = targetLangSelect ? targetLangSelect.value : 'English';
        const nativeLang = nativeLangSelect ? nativeLangSelect.value : 'Hindi';
        const scenario = scenarioSelect ? scenarioSelect.value : 'General';
        const speaker = voicePersonaSelect ? voicePersonaSelect.value : 'astra';
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
                    speaker: speaker,
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
            appendChatBubble('tutor', `⚠️ ${err.message || 'I had trouble processing that turn. Please try saying it again!'}`);
            setTutorState('listening', '🎙️', 'LISTENING', 'Ready for your next message');
        }
    }

    function handleTurnResponse(data) {
        const isStruggling = data.hesitation ? data.hesitation.struggle : false;
        const speed = data.speed || 1.0;
        
        speedVal.textContent = `${speed}x`;
        speedVal.className = `metric-value ${isStruggling ? 'amber' : 'green'}`;
        
        scoreVal.textContent = `${data.hesitation ? data.hesitation.score : 0} / 5`;
        struggleBadge.textContent = isStruggling ? 'STRUGGLE DETECTED' : 'Normal Fluency';
        struggleBadge.style.color = isStruggling ? 'var(--accent-amber)' : 'var(--text-muted)';
        
        reasonVal.textContent = data.hesitation ? data.hesitation.reason : 'none';

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

        // Track session stats
        sessionTurnsCount++;
        sessionFluencies.push(data.fluency_score || 100);
        if (data.vocab_word) {
            const alreadyInSession = sessionWordsExtracted.some(w => w.word.toLowerCase() === data.vocab_word.toLowerCase());
            if (!alreadyInSession) {
                sessionWordsExtracted.push({ word: data.vocab_word, translation: data.vocab_translation || '' });
            }
        }

        appendChatBubble('tutor', data.reply_text, isStruggling, speed, data.target_language, data.correction);

        setTutorState(stateName, emoji, badge, text);

        if (data.audio_url) {
            lastReplyText = data.reply_text;
            lastReplyAudioUrl = data.audio_url;
            rimeAudioPlayer.src = data.audio_url;
            const playPromise = rimeAudioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    appendLog('[AUDIO] Playback notice: ' + err.message);
                    setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
                });
            }
            rimeAudioPlayer.onended = () => {
                setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
            };
            rimeAudioPlayer.onerror = () => {
                setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
            };
        } else {
            // Text-only fallback (no audio)
            setTimeout(() => {
                setTutorState('listening', '🎙️', 'LISTENING', 'Listening for your speech...');
            }, 1500);
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

            // Safe Practice button — for Pronunciation Coach
            const practiceBtn = document.createElement('button');
            practiceBtn.className = 'btn-practice';
            practiceBtn.title = 'Practice pronouncing this word';
            practiceBtn.textContent = '🎙️ Practice';
            practiceBtn.addEventListener('click', () => openPronounceModal(card.word));

            const textDiv = document.createElement('div');
            textDiv.innerHTML = `
                <span class="flashcard-word">${card.word}</span>
                ${card.phonetic ? `<small style="color:var(--text-muted);"> (${card.phonetic})</small>` : ''}
            `;

            const transSpan = document.createElement('span');
            transSpan.className = 'flashcard-trans';
            transSpan.textContent = `➔ ${card.translation}`;

            item.appendChild(textDiv);
            item.appendChild(transSpan);
            item.appendChild(practiceBtn);
            flashcardsPanel.appendChild(item);
        });
    }

    // Slow-Mo Replay Trigger (0.5x)
    window.playSlowMo = async function(text) {
        const targetLang = targetLangSelect ? targetLangSelect.value : 'English';
        const speaker = voicePersonaSelect ? voicePersonaSelect.value : 'astra';
        appendLog(`[SLOW-MO] Synthesizing 0.5x ultra-slow audio for: "${text}"...`);
        try {
            const res = await fetch('/api/slowmo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, target_language: targetLang, speaker: speaker })
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

    function appendChatBubble(sender, text, isAdapted = false, speed = 1.0, lang = '', correction = '') {
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

        // Render gentle grammar/phrasing correction tip if provided
        if (correction && correction.trim()) {
            const corrDiv = document.createElement('div');
            corrDiv.className = 'msg-correction';
            corrDiv.innerHTML = `<span class="msg-correction-icon">💡</span> <span>${correction}</span>`;
            bubble.appendChild(corrDiv);
        }

        chatStream.appendChild(bubble);
        chatStream.scrollTop = chatStream.scrollHeight;
    }

    // ── Session Summary Modal Logic ──
    const sessionSummaryModal = document.getElementById('sessionSummaryModal');
    const closeSummaryBtn = document.getElementById('closeSummaryBtn');
    const continuePracticeBtn = document.getElementById('continuePracticeBtn');

    function showSessionSummary() {
        if (!sessionSummaryModal) return;
        const durationSec = Math.max(1, Math.round((Date.now() - (sessionStartTime || Date.now())) / 1000));
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        document.getElementById('summaryDuration').textContent = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
        document.getElementById('summaryTurns').textContent = sessionTurnsCount;

        const avgFluency = sessionFluencies.length > 0
            ? Math.round(sessionFluencies.reduce((a, b) => a + b, 0) / sessionFluencies.length)
            : 100;
        document.getElementById('summaryAvgFluency').textContent = `${avgFluency}%`;
        document.getElementById('summaryWordsCount').textContent = sessionWordsExtracted.length;

        const feedbackEl = document.getElementById('summaryFeedback');
        const greetingEl = document.getElementById('summaryGreeting');
        if (avgFluency >= 85) {
            greetingEl.textContent = 'Outstanding Fluency! 🌟';
            feedbackEl.textContent = 'You spoke with natural confidence, great pronunciation, and minimal hesitation.';
        } else if (avgFluency >= 65) {
            greetingEl.textContent = 'Great Practice Session! 👍';
            feedbackEl.textContent = 'Good communication rhythm! Keep practicing to build confidence and speed.';
        } else {
            greetingEl.textContent = 'Good Effort Today! 🌱';
            feedbackEl.textContent = 'Cadence adapted its speed to support your learning. Every turn counts!';
        }

        const wordsListEl = document.getElementById('summaryWordsList');
        wordsListEl.innerHTML = '';
        if (sessionWordsExtracted.length > 0) {
            sessionWordsExtracted.forEach(item => {
                const chip = document.createElement('div');
                chip.className = 'summary-word-chip';
                chip.innerHTML = `<strong>${item.word}</strong>: ${item.translation}`;
                wordsListEl.appendChild(chip);
            });
            document.getElementById('summaryWordsSection').style.display = 'block';
        } else {
            document.getElementById('summaryWordsSection').style.display = 'none';
        }

        sessionSummaryModal.style.display = 'flex';
        appendLog(`[SESSION] Summary generated: ${sessionTurnsCount} turns, ${avgFluency}% avg fluency.`);
    }

    if (closeSummaryBtn) {
        closeSummaryBtn.addEventListener('click', () => {
            sessionSummaryModal.style.display = 'none';
        });
    }
    if (continuePracticeBtn) {
        continuePracticeBtn.addEventListener('click', () => {
            sessionSummaryModal.style.display = 'none';
            startSession();
        });
    }

    function appendLog(msg) {
        const time = new Date().toLocaleTimeString();
        const lines = logTerminal.textContent.split('\n');
        if (lines.length > 100) lines.splice(0, lines.length - 100); // keep last 100 lines
        logTerminal.textContent = lines.join('\n') + `\n[${time}] ${msg}`;
        logTerminal.scrollTop = logTerminal.scrollHeight;
    }

    // ═══════════════════════════════════════════════════
    // 🏆 FEATURE 4 — Scenario Quests / Missions
    // ═══════════════════════════════════════════════════
    const SCENARIO_QUESTS = {
        'General':    { icon: '💬', desc: 'Introduce yourself and have a natural conversation in your target language.' },
        'Cafe':       { icon: '☕', desc: 'Order a drink, ask for the price, and request the bill — all in your target language!' },
        'Travel':     { icon: '✈️', desc: 'Ask about flight gate, check-in time, and find the baggage claim area.' },
        'Interview':  { icon: '💼', desc: 'Tell the interviewer about yourself and answer "What is your biggest strength?"' },
        'Directions': { icon: '🚕', desc: 'Ask a stranger how to get to the nearest train station or hospital.' },
    };

    let questComplete = false;

    function updateQuestBanner(scenario) {
        const questBanner = document.getElementById('questBanner');
        const questIcon = document.getElementById('questIcon');
        const questDesc = document.getElementById('questDescription');
        const questBadge = document.getElementById('questStatusBadge');
        if (!questBanner) return;

        const q = SCENARIO_QUESTS[scenario] || SCENARIO_QUESTS['General'];
        questIcon.textContent = q.icon;
        questDesc.textContent = q.desc;
        questBadge.textContent = 'IN PROGRESS';
        questBadge.className = 'quest-badge quest-active';
        questBanner.style.display = 'flex';
        questComplete = false;
    }

    function markQuestComplete(scenario) {
        if (questComplete) return; // Already celebrated
        questComplete = true;

        const questBadge = document.getElementById('questStatusBadge');
        if (questBadge) {
            questBadge.textContent = 'COMPLETE ✓';
            questBadge.className = 'quest-badge quest-complete';
        }

        // Show toast
        const toast = document.getElementById('questCompleteToast');
        const toastMsg = document.getElementById('questToastMsg');
        if (toast) {
            toastMsg.textContent = SCENARIO_QUESTS[scenario]?.desc?.split(' ').slice(0,5).join(' ') + '... accomplished!';
            toast.style.display = 'flex';
            toast.style.animation = 'none';
            toast.offsetHeight; // reflow
            toast.style.animation = 'toastSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
            setTimeout(() => { toast.style.display = 'none'; }, 4000);
        }

        appendLog(`[QUEST] 🏆 Quest Complete! Scenario: ${scenario}`);
    }

    // Quest detection: keyword + turn count heuristic (no LLM needed for speed)
    const QUEST_KEYWORDS = {
        'Cafe':       ['bill', 'receipt', 'price', 'cost', 'how much', 'order', 'coffee', 'tea', 'drink', 'menu'],
        'Travel':     ['gate', 'check-in', 'baggage', 'flight', 'ticket', 'passport', 'boarding', 'terminal'],
        'Interview':  ['strength', 'weakness', 'experience', 'work', 'skill', 'team', 'goal', 'challenge'],
        'Directions': ['station', 'hospital', 'turn', 'straight', 'left', 'right', 'km', 'bus', 'metro', 'walk'],
    };

    function checkQuestProgress(userText, scenario) {
        if (questComplete) return;
        const keywords = QUEST_KEYWORDS[scenario] || [];
        const lower = userText.toLowerCase();
        const matched = keywords.filter(k => lower.includes(k));
        if (matched.length >= 2 || (scenario === 'General' && sessionTurnsCount >= 5)) {
            markQuestComplete(scenario);
        }
    }

    // Trigger quest banner on scenario change and on session start
    if (scenarioSelect) {
        // Update quest banner when scenario changes (in addition to clearing history)
        scenarioSelect.addEventListener('change', () => {
            if (isSessionActive) updateQuestBanner(scenarioSelect.value);
        });
    }

    // Hook into submitUtterance to check quest progress after each user turn
    window._checkQuestOnTurn = function(text) {
        const scenario = scenarioSelect ? scenarioSelect.value : 'General';
        checkQuestProgress(text, scenario);
    };

    // ═══════════════════════════════════════════════════
    // 📥 FEATURE 3 — 1-Click Flashcard CSV Export
    // ═══════════════════════════════════════════════════
    const exportFlashcardsBtn = document.getElementById('exportFlashcardsBtn');
    if (exportFlashcardsBtn) {
        exportFlashcardsBtn.addEventListener('click', () => {
            if (flashcardStore.length === 0 && sessionWordsExtracted.length === 0) {
                alert('No vocabulary words collected yet! Keep practicing and words will appear here.');
                return;
            }

            // Merge flashcardStore (recent 5) with all session words
            const allWords = {};
            flashcardStore.forEach(c => { allWords[c.word] = c; });
            sessionWordsExtracted.forEach(s => {
                if (!allWords[s.word]) allWords[s.word] = { word: s.word, translation: s.translation, phonetic: '' };
            });

            const rows = [['Word', 'Translation', 'Phonetic']];
            Object.values(allWords).forEach(c => {
                rows.push([
                    `"${(c.word||'').replace(/"/g,'""')}"`,
                    `"${(c.translation||'').replace(/"/g,'""')}"`,
                    `"${(c.phonetic||'').replace(/"/g,'""')}"`
                ]);
            });

            const csv = rows.map(r => r.join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const lang = targetLangSelect ? targetLangSelect.value.toLowerCase() : 'lang';
            a.download = `cadence_vocab_${lang}_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            appendLog(`[EXPORT] Downloaded ${Object.keys(allWords).length} vocab words as CSV.`);
        });
    }

    // ═══════════════════════════════════════════════════
    // 🎯 FEATURE 1 — Pronunciation Coach (Shadowing Mode)
    // ═══════════════════════════════════════════════════
    const pronounceModal = document.getElementById('pronounceModal');
    const pronounceTargetText = document.getElementById('pronounceTargetText');
    const pronounceListenBtn = document.getElementById('pronounceListenBtn');
    const pronounceTryBtn = document.getElementById('pronounceTryBtn');
    const pronounceStatus = document.getElementById('pronounceStatus');
    const pronounceResultBox = document.getElementById('pronounceResultBox');
    const pronounceScore = document.getElementById('pronounceScore');
    const pronounceFeedback = document.getElementById('pronounceFeedback');
    const pronounceYouSaid = document.getElementById('pronounceYouSaid');
    const pronounceTryAgainBtn = document.getElementById('pronounceTryAgainBtn');
    const closePronounceBtn = document.getElementById('closePronounceBtn');

    let currentPronounceTarget = '';
    let pronounceAudio = null;

    window.openPronounceModal = function(phrase) {
        currentPronounceTarget = phrase;
        pronounceTargetText.textContent = phrase;
        pronounceStatus.innerHTML = 'Press <strong>Listen</strong> to hear the correct pronunciation.';
        pronounceResultBox.style.display = 'none';
        pronounceTryBtn.disabled = true;
        if (pronounceModal) pronounceModal.style.display = 'flex';
    };

    if (closePronounceBtn) {
        closePronounceBtn.addEventListener('click', () => {
            pronounceModal.style.display = 'none';
            if (pronounceAudio) { pronounceAudio.pause(); pronounceAudio = null; }
        });
    }

    if (pronounceListenBtn) {
        pronounceListenBtn.addEventListener('click', async () => {
            if (!currentPronounceTarget) return;
            pronounceListenBtn.disabled = true;
            pronounceStatus.textContent = '⏳ Loading Cadence pronunciation...';

            try {
                const targetLang = targetLangSelect ? targetLangSelect.value : 'English';
                const speaker = voicePersonaSelect ? voicePersonaSelect.value : 'astra';

                const res = await fetch('/api/pronounce', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: currentPronounceTarget, target_language: targetLang, speaker: speaker })
                });
                const data = await res.json();

                if (data.audio_url) {
                    pronounceAudio = new Audio(data.audio_url);
                    pronounceAudio.play();
                    pronounceStatus.textContent = '🔊 Listen carefully to Cadence...';
                    pronounceAudio.onended = () => {
                        pronounceStatus.innerHTML = 'Now press <strong>Say It</strong> and repeat what you heard!';
                        pronounceTryBtn.disabled = false;
                        pronounceListenBtn.disabled = false;
                    };
                }
            } catch (e) {
                pronounceStatus.textContent = `⚠️ Error: ${e.message}`;
                pronounceListenBtn.disabled = false;
            }
        });
    }

    if (pronounceTryBtn) {
        pronounceTryBtn.addEventListener('click', () => {
            pronounceTryBtn.disabled = true;
            pronounceStatus.textContent = '🎙️ Listening... say it now!';
            pronounceResultBox.style.display = 'none';

            // Use Web Speech API for one-shot recognition
            const lang = (targetLangSelect ? targetLangSelect.value : 'English');
            const STT_LANG_MAP = {
                'Hindi':'hi-IN','English':'en-US','Spanish':'es-ES','French':'fr-FR',
                'German':'de-DE','Italian':'it-IT','Korean':'ko-KR','Japanese':'ja-JP','Chinese':'zh-CN'
            };
            const sttLang = STT_LANG_MAP[lang] || 'en-US';

            const rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            rec.lang = sttLang;
            rec.maxAlternatives = 1;
            rec.interimResults = false;

            rec.onresult = (e) => {
                const heard = e.results[0][0].transcript.trim();
                const score = calcPronunciationScore(currentPronounceTarget, heard);
                showPronounceResult(heard, score);
            };

            rec.onerror = (e) => {
                pronounceStatus.textContent = `⚠️ Mic error: ${e.error}. Try again.`;
                pronounceTryBtn.disabled = false;
            };

            rec.onend = () => { pronounceTryBtn.disabled = false; };

            rec.start();
            setTimeout(() => { try { rec.stop(); } catch(e) {} }, 5000);
        });
    }

    if (pronounceTryAgainBtn) {
        pronounceTryAgainBtn.addEventListener('click', () => {
            pronounceResultBox.style.display = 'none';
            pronounceStatus.innerHTML = 'Press <strong>Listen</strong> first, then try again!';
            pronounceTryBtn.disabled = true;
        });
    }

    function calcPronunciationScore(target, heard) {
        // Normalize both strings
        const normalize = s => s.toLowerCase().replace(/[^a-z\u00C0-\u024F\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af ]/g, '').trim();
        const t = normalize(target).split(' ').filter(Boolean);
        const h = normalize(heard).split(' ').filter(Boolean);

        if (t.length === 0) return 0;

        // Word-level overlap match
        let matched = 0;
        const hSet = [...h];
        t.forEach(tw => {
            const idx = hSet.findIndex(hw => hw === tw || levenshtein(tw, hw) <= Math.max(1, Math.floor(tw.length * 0.3)));
            if (idx !== -1) { matched++; hSet.splice(idx, 1); }
        });
        return Math.round((matched / t.length) * 100);
    }

    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        return dp[m][n];
    }

    function showPronounceResult(heard, score) {
        pronounceYouSaid.textContent = heard || '(nothing detected)';
        pronounceScore.textContent = `${score}%`;

        // Color code the score
        pronounceScore.className = 'result-score';
        if (score >= 80) {
            pronounceScore.classList.add('green');
            pronounceFeedback.textContent = score >= 95 ? '🌟 Perfect match! Excellent pronunciation!' : '🎉 Great pronunciation! Almost perfect!';
        } else if (score >= 55) {
            pronounceScore.classList.add('amber');
            pronounceFeedback.textContent = '👍 Good attempt! Keep practicing the sounds.';
        } else {
            pronounceScore.classList.add('red');
            pronounceFeedback.textContent = '🔄 Not quite — listen again and try once more!';
        }

        pronounceResultBox.style.display = 'flex';
        pronounceStatus.textContent = 'Tap "Try Again" to retry or close to continue.';
        appendLog(`[PRONOUNCE] Target: "${currentPronounceTarget}" | Heard: "${heard}" | Score: ${score}%`);
    }

    // ── Hook quest banner into session start via toggleSessionBtn ──
    // Remove old session listener and replace with one that also shows quest
    const _origToggleListener = toggleSessionBtn.onclick;
    toggleSessionBtn.addEventListener('click', () => {
        // Quest banner shows when session starts (isSessionActive was false, now true after startSession runs)
        setTimeout(() => {
            if (isSessionActive) {
                const scenario = scenarioSelect ? scenarioSelect.value : 'General';
                updateQuestBanner(scenario);
            }
        }, 50);
    });

    // Quest Complete Toast click to dismiss
    const questToast = document.getElementById('questCompleteToast');
    if (questToast) questToast.addEventListener('click', () => { questToast.style.display = 'none'; });

});
