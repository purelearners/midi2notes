// Wait for the HTML to fully load before running our script
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Safety Check for VexFlow ---
    const statusText = document.getElementById('status');
    if (typeof Vex === 'undefined') {
        statusText.innerText = "Error: VexFlow library failed to load. Check your internet connection or adblocker.";
        return; // Stop execution here so we don't crash
    }
    
    const VF = Vex.Flow;

    // --- State Variables ---
    let midiAccess = null;
    let isRecording = false;
    let recordedNotes = [];
    let activeNotes = {};

    // 3 Octaves: C3 to C6
    const START_NOTE = 48; 
    const END_NOTE = 84;   

    // --- DOM Elements ---
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const outputDiv = document.getElementById('sheet-music-output');
    const pianoContainer = document.getElementById('piano');

    // --- Initialization ---
    try {
        buildPianoUI();
    } catch (error) {
        statusText.innerText = "Error building piano interface. Check console.";
        console.error(error);
    }

    // --- 2. Safety Check for Web MIDI API ---
    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess()
            .then(onMIDISuccess)
            .catch(onMIDIFailure);
    } else {
        statusText.innerText = "Status: Web MIDI is not supported in your browser. (Mouse piano is active!)";
    }

    // --- Piano UI Builder ---
    function isBlackKey(midiNote) {
        const noteInOctave = midiNote % 12;
        return [1, 3, 6, 8, 10].includes(noteInOctave);
    }

    function buildPianoUI() {
        pianoContainer.innerHTML = ""; 
        
        const whiteKeyWidth = 40;
        const whiteKeyHeight = 150;
        const blackKeyWidth = 24;
        const blackKeyHeight = 95;
        
        let whiteKeyCount = 0;

        for (let i = START_NOTE; i <= END_NOTE; i++) {
            if (!isBlackKey(i)) whiteKeyCount++;
        }
        pianoContainer.style.width = `${whiteKeyCount * whiteKeyWidth}px`;

        let currentWhiteKeyIndex = 0;

        for (let i = START_NOTE; i <= END_NOTE; i++) {
            const keyEl = document.createElement('div');
            keyEl.classList.add('key');
            keyEl.id = `key-${i}`;

            if (isBlackKey(i)) {
                keyEl.classList.add('black-key');
                keyEl.style.width = `${blackKeyWidth}px`;
                keyEl.style.height = `${blackKeyHeight}px`;
                keyEl.style.left = `${(currentWhiteKeyIndex * whiteKeyWidth) - (blackKeyWidth / 2)}px`;
            } else {
                keyEl.classList.add('white-key');
                keyEl.style.width = `${whiteKeyWidth}px`;
                keyEl.style.height = `${whiteKeyHeight}px`;
                keyEl.style.left = `${currentWhiteKeyIndex * whiteKeyWidth}px`;
                currentWhiteKeyIndex++; 
            }

            // Mouse interactions
            keyEl.addEventListener('mousedown', () => triggerNoteOn(i));
            keyEl.addEventListener('mouseup', () => triggerNoteOff(i));
            keyEl.addEventListener('mouseleave', () => triggerNoteOff(i));

            pianoContainer.appendChild(keyEl);
        }
    }

    // --- Note Handling ---
    function triggerNoteOn(note) {
        if (note < START_NOTE || note > END_NOTE) return;

        if (!activeNotes[note]) {
            activeNotes[note] = performance.now();
            const keyEl = document.getElementById(`key-${note}`);
            if (keyEl) keyEl.classList.add('active');
        }
    }

    function triggerNoteOff(note) {
        if (note < START_NOTE || note > END_NOTE) return;

        if (activeNotes[note]) {
            const duration = performance.now() - activeNotes[note];
            
            if (isRecording) {
                recordedNotes.push({ pitch: note, duration: duration });
            }
            
            delete activeNotes[note];
            
            const keyEl = document.getElementById(`key-${note}`);
            if (keyEl) keyEl.classList.remove('active');
        }
    }

    // --- MIDI Setup ---
    function onMIDISuccess(access) {
        midiAccess = access;
        midiAccess.onstatechange = updateDeviceStatus;
        updateDeviceStatus();
    }

    function updateDeviceStatus() {
        const inputs = midiAccess.inputs.values();
        let hasInput = false;

        for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
            input.value.onmidimessage = onMIDIMessage;
            hasInput = true;
        }

        statusText.innerText = hasInput 
            ? "Status: MIDI Connected. Ready to record." 
            : "Status: Waiting for MIDI keyboard... (Mouse piano is active!)";
    }

    function onMIDIFailure(error) {
        console.error("MIDI Failure:", error);
        statusText.innerText = "Status: MIDI access denied. Are you running this via a local file? (Mouse piano is active!)";
    }

    function onMIDIMessage(message) {
        const command = message.data[0];
        const note = message.data[1];
        const velocity = (message.data.length > 2) ? message.data[2] : 0; 

        if (command === 144 && velocity > 0) {
            triggerNoteOn(note);
        } else if (command === 128 || (command === 144 && velocity === 0)) {
            triggerNoteOff(note);
        }
    }

    // --- Recording & Rendering ---
    startBtn.addEventListener('click', () => {
        isRecording = true;
        recordedNotes = [];
        activeNotes = {};
        
        startBtn.disabled = true;
        stopBtn.disabled = false;
        outputDiv.innerHTML = ""; 
        statusText.innerText = "Status: 🔴 RECORDING... Play some notes!";
    });

    stopBtn.addEventListener('click', () => {
        if (!isRecording) return;
        isRecording = false;
        
        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusText.innerText = "Status: Generating sheet music...";
        
        renderSheetMusic(recordedNotes);
    });

    // --- VexFlow Logic ---
    function getVexFlowPitch(midiNote) {
        const noteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
        const name = noteNames[midiNote % 12];
        const octave = Math.floor(midiNote / 12) - 1;
        return `${name}/${octave}`;
    }

    function getVexFlowDurationInfo(durationMs, bpm = 120) {
        const quarterNoteMs = 60000 / bpm; 
        const ratio = durationMs / quarterNoteMs;

        if (ratio >= 3.0) return { durationStr: "w", beats: 4 };
        if (ratio >= 1.5) return { durationStr: "h", beats: 2 };
        if (ratio >= 0.75) return { durationStr: "q", beats: 1 };
        if (ratio >= 0.35) return { durationStr: "8", beats: 0.5 };
        return { durationStr: "16", beats: 0.25 };
    }

    function renderSheetMusic(notesData) {
        if (notesData.length === 0) {
            statusText.innerText = "Status: No notes played. Recording empty.";
            return;
        }

        const renderer = new VF.Renderer(outputDiv, VF.Renderer.Backends.SVG);
        const staveWidth = Math.max(500, notesData.length * 80); 
        renderer.resize(staveWidth + 50, 200);
        
        const context = renderer.getContext();
        const stave = new VF.Stave(10, 40, staveWidth);
        stave.addClef("treble").setContext(context).draw();

        let totalBeats = 0;
        const vexFlowNotes = notesData.map(note => {
            const pitchStr = getVexFlowPitch(note.pitch);
            const timingInfo = getVexFlowDurationInfo(note.duration);
            
            totalBeats += timingInfo.beats;

            let staveNote = new VF.StaveNote({ 
                clef: "treble", 
                keys: [pitchStr], 
                duration: timingInfo.durationStr 
            });

            if (pitchStr.includes("#")) {
                staveNote.addModifier(new VF.Accidental("#"));
            }
            return staveNote;
        });

        const voice = new VF.Voice({ 
            num_beats: totalBeats, 
            beat_value: 4, 
            resolution: VF.RESOLUTION 
        });
        
        voice.setStrict(false); 
        voice.addTickables(vexFlowNotes);

        new VF.Formatter().joinVoices([voice]).format([voice], staveWidth - 50);
        voice.draw(context, stave);

        statusText.innerText = `Status: Sheet music generated (${notesData.length} notes).`;
    }

}); // End of DOMContentLoaded
