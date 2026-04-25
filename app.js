const VF = Vex.Flow;

// --- State Variables ---
let midiAccess = null;
let isRecording = false;
let recordedNotes = [];
let activeNotes = {};

// We will render 3 octaves starting from C3 (MIDI 48) to B5 (MIDI 83)
const START_NOTE = 48; 
const END_NOTE = 83;   

// --- DOM Elements ---
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('status');
const outputDiv = document.getElementById('sheet-music-output');
const pianoContainer = document.getElementById('piano');

// --- Initialization ---
setupVirtualPiano();

navigator.requestMIDIAccess()
    .then(onMIDISuccess)
    .catch(onMIDIFailure);

// --- Virtual Piano Logic ---
function isBlackKey(midiNote) {
    const noteInOctave = midiNote % 12;
    // MIDI numbers corresponding to black keys in any octave
    return [1, 3, 6, 8, 10].includes(noteInOctave);
}

function setupVirtualPiano() {
    pianoContainer.innerHTML = ""; // Clear if re-rendering

    for (let i = START_NOTE; i <= END_NOTE; i++) {
        const keyElement = document.createElement('div');
        keyElement.classList.add('key');
        keyElement.classList.add(isBlackKey(i) ? 'black-key' : 'white-key');
        keyElement.id = `key-${i}`;
        
        // Allow mouse clicks to simulate MIDI events
        keyElement.addEventListener('mousedown', () => triggerNoteOn(i));
        keyElement.addEventListener('mouseup', () => triggerNoteOff(i));
        keyElement.addEventListener('mouseleave', () => triggerNoteOff(i));

        pianoContainer.appendChild(keyElement);
    }
}

// --- Unified Note Handling (MIDI + Mouse) ---
function triggerNoteOn(note) {
    // Only process if the note is within our virtual keyboard range
    if (note < START_NOTE || note > END_NOTE) return;

    if (!activeNotes[note]) {
        activeNotes[note] = performance.now();
        
        // Light up the key
        const keyEl = document.getElementById(`key-${note}`);
        if (keyEl) keyEl.classList.add('active');
    }
}

function triggerNoteOff(note) {
    if (note < START_NOTE || note > END_NOTE) return;

    if (activeNotes[note]) {
        const duration = performance.now() - activeNotes[note];
        
        // Only save to sheet music if we are currently recording
        if (isRecording) {
            recordedNotes.push({ pitch: note, duration: duration });
        }
        
        delete activeNotes[note];
        
        // Turn off the light
        const keyEl = document.getElementById(`key-${note}`);
        if (keyEl) keyEl.classList.remove('active');
    }
}

// --- MIDI Connection Handling ---
function onMIDISuccess(access) {
    midiAccess = access;
    
    // Listen for devices plugging in/out
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

    if (hasInput) {
        statusText.innerText = "Status: MIDI Connected. Ready to record.";
    } else {
        statusText.innerText = "Status: Waiting for a MIDI connection (Keyboard visually functional).";
    }
}

function onMIDIFailure() {
    statusText.innerText = "Status: MIDI failed. You can still use your mouse to play the virtual piano.";
}

function onMIDIMessage(message) {
    const command = message.data[0];
    const note = message.data[1];
    const velocity = (message.data.length > 2) ? message.data[2] : 0; 

    // Note On (144) or Note Off (128 / 144 with 0 velocity)
    if (command === 144 && velocity > 0) {
        triggerNoteOn(note);
    } else if (command === 128 || (command === 144 && velocity === 0)) {
        triggerNoteOff(note);
    }
}

// --- Recording Controls ---
startBtn.addEventListener('click', () => {
    isRecording = true;
    recordedNotes = [];
    activeNotes = {};
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    outputDiv.innerHTML = ""; 
    statusText.innerText = "Status: Recording... Play the virtual or physical keyboard!";
});

stopBtn.addEventListener('click', () => {
    if (!isRecording) return;
    isRecording = false;
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.innerText = "Status: Processing and Rendering Sheet Music...";
    
    renderSheetMusic(recordedNotes);
});

// --- Translation & Quantization ---
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

// --- SVG Rendering ---
function renderSheetMusic(notesData) {
    if (notesData.length === 0) {
        statusText.innerText = "Status: No notes were recorded.";
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

    statusText.innerText = `Status: Generated sheet music for ${notesData.length} notes.`;
}
