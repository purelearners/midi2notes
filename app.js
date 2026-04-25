const VF = Vex.Flow;

// --- State Variables ---
let midiAccess = null;
let isRecording = false;
let recordedNotes = [];
let activeNotes = {};
let recordingStartTime = 0;

// --- DOM Elements ---
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('status');
const outputDiv = document.getElementById('sheet-music-output');

// --- Initialization ---
navigator.requestMIDIAccess()
    .then(onMIDISuccess)
    .catch(onMIDIFailure);

function onMIDISuccess(access) {
    midiAccess = access;
    const inputs = midiAccess.inputs.values();
    let hasInput = false;

    for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
        input.value.onmidimessage = onMIDIMessage;
        hasInput = true;
    }

    if (hasInput) {
        statusText.innerText = "Status: MIDI Connected. Ready to record.";
    } else {
        statusText.innerText = "Status: MIDI Access granted, but no keyboard detected.";
    }
}

function onMIDIFailure() {
    statusText.innerText = "Status: Could not access MIDI devices. Check browser permissions.";
}

// --- Event Listeners ---
startBtn.addEventListener('click', () => {
    isRecording = true;
    recordedNotes = [];
    activeNotes = {};
    recordingStartTime = performance.now();
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    outputDiv.innerHTML = ""; // Clear previous render
    statusText.innerText = "Status: Recording... Play your melody!";
});

stopBtn.addEventListener('click', () => {
    if (!isRecording) return;
    isRecording = false;
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.innerText = "Status: Processing and Rendering...";
    
    renderSheetMusic(recordedNotes);
});

// --- MIDI Handling ---
function onMIDIMessage(message) {
    if (!isRecording) return;

    const command = message.data[0];
    const note = message.data[1];
    const velocity = (message.data.length > 2) ? message.data[2] : 0; 

    // Note On
    if (command === 144 && velocity > 0) {
        activeNotes[note] = performance.now();
    } 
    // Note Off
    else if (command === 128 || (command === 144 && velocity === 0)) {
        if (activeNotes[note]) {
            const duration = performance.now() - activeNotes[note];
            recordedNotes.push({ pitch: note, duration: duration });
            delete activeNotes[note];
        }
    }
}

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

    // 1. Setup Renderer
    const renderer = new VF.Renderer(outputDiv, VF.Renderer.Backends.SVG);
    
    // Dynamically size width based on how many notes were played
    const staveWidth = Math.max(500, notesData.length * 80); 
    renderer.resize(staveWidth + 50, 200);
    
    const context = renderer.getContext();
    const stave = new VF.Stave(10, 40, staveWidth);
    stave.addClef("treble").setContext(context).draw();

    // 2. Map Data to VexFlow Notes
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

        // Add accidentals if the note is sharp
        if (pitchStr.includes("#")) {
            staveNote.addModifier(new VF.Accidental("#"));
        }

        return staveNote;
    });

    // 3. Create Voice and Draw
    const voice = new VF.Voice({ 
        num_beats: totalBeats, 
        beat_value: 4, 
        resolution: VF.RESOLUTION 
    });
    
    // strict mode is false so we don't have to perfectly match 4/4 measure counts
    voice.setStrict(false); 
    voice.addTickables(vexFlowNotes);

    new VF.Formatter().joinVoices([voice]).format([voice], staveWidth - 50);
    voice.draw(context, stave);

    statusText.innerText = `Status: Generated sheet music for ${notesData.length} notes.`;
}
