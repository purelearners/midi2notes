document.addEventListener('DOMContentLoaded', () => {

    if (typeof Vex === 'undefined') {
        document.getElementById('status').innerText = "Error: VexFlow library failed to load.";
        return; 
    }
    const VF = Vex.Flow;

    // --- State Variables ---
    let midiAccess = null;
    let isRecording = false;
    let recordedNotes = [];
    let activeNotes = {};

    const START_NOTE = 36; // Expanded range to C2 (Bass)
    const END_NOTE = 84;   // Up to C6 (Treble)

    // --- DOM Elements ---
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusText = document.getElementById('status');
    const outputDiv = document.getElementById('sheet-music-output');
    const pianoContainer = document.getElementById('piano');
    const showNamesCheck = document.getElementById('showNamesCheck');

    // --- Initialization ---
    buildPianoUI();

    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then(onMIDISuccess).catch(onMIDIFailure);
    } else {
        statusText.innerText = "Status: Web MIDI not supported. Use mouse.";
    }

    // --- Piano UI Builder ---
    function isBlackKey(midiNote) {
        return [1, 3, 6, 8, 10].includes(midiNote % 12);
    }

    function buildPianoUI() {
        pianoContainer.innerHTML = ""; 
        const whiteKeyWidth = 40, whiteKeyHeight = 150, blackKeyWidth = 24, blackKeyHeight = 95;
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

            keyEl.addEventListener('mousedown', () => triggerNoteOn(i));
            keyEl.addEventListener('mouseup', () => triggerNoteOff(i));
            keyEl.addEventListener('mouseleave', () => triggerNoteOff(i));

            pianoContainer.appendChild(keyEl);
        }
    }

    // --- Note Handling (MIDI & Mouse) ---
    function triggerNoteOn(note) {
        if (note < START_NOTE || note > END_NOTE) return;
        if (!activeNotes[note]) {
            // Track exact start time for chord grouping
            activeNotes[note] = performance.now(); 
            const keyEl = document.getElementById(`key-${note}`);
            if (keyEl) keyEl.classList.add('active');
        }
    }

    function triggerNoteOff(note) {
        if (note < START_NOTE || note > END_NOTE) return;
        if (activeNotes[note]) {
            const startTime = activeNotes[note];
            const duration = performance.now() - startTime;
            
            if (isRecording) {
                // Save the start time so we know if multiple notes were pressed at once
                recordedNotes.push({ pitch: note, duration: duration, startTime: startTime });
            }
            
            delete activeNotes[note];
            const keyEl = document.getElementById(`key-${note}`);
            if (keyEl) keyEl.classList.remove('active');
        }
    }

    // --- MIDI Connection ---
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
        statusText.innerText = hasInput ? "Status: MIDI Connected." : "Status: Waiting for MIDI... (Mouse active)";
    }

    function onMIDIFailure() {
        statusText.innerText = "Status: MIDI denied. (Mouse active)";
    }

    function onMIDIMessage(message) {
        const command = message.data[0];
        const note = message.data[1];
        const velocity = message.data.length > 2 ? message.data[2] : 0; 
        if (command === 144 && velocity > 0) triggerNoteOn(note);
        else if (command === 128 || (command === 144 && velocity === 0)) triggerNoteOff(note);
    }

    // --- Controls ---
    startBtn.addEventListener('click', () => {
        isRecording = true;
        recordedNotes = [];
        activeNotes = {};
        startBtn.disabled = true; stopBtn.disabled = false;
        outputDiv.innerHTML = ""; 
        statusText.innerText = "Status: 🔴 RECORDING... Play chords or melodies!";
    });

    stopBtn.addEventListener('click', () => {
        if (!isRecording) return;
        isRecording = false;
        startBtn.disabled = false; stopBtn.disabled = true;
        statusText.innerText = "Status: Generating Grand Staff...";
        renderSheetMusic(recordedNotes);
    });

    // --- VexFlow Logic ---
    function getVexFlowPitch(midiNote) {
        const noteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
        const name = noteNames[midiNote % 12];
        const octave = Math.floor(midiNote / 12) - 1;
        return `${name}/${octave}`;
    }

    function getPitchNameOnly(midiNote) {
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        return noteNames[midiNote % 12];
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

    // Algorithm to group overlapping notes into Chords
    function groupNotesIntoChords(notesArray) {
        if (notesArray.length === 0) return [];
        
        // Sort by time played
        notesArray.sort((a, b) => a.startTime - b.startTime);
        
        let chords = [];
        let currentChord = [notesArray[0]];

        for (let i = 1; i < notesArray.length; i++) {
            const note = notesArray[i];
            // If the note was played within 60ms of the first note in the group, it's a chord!
            if (Math.abs(note.startTime - currentChord[0].startTime) < 60) {
                currentChord.push(note);
            } else {
                chords.push(currentChord);
                currentChord = [note];
            }
        }
        if (currentChord.length > 0) chords.push(currentChord);
        return chords;
    }

    // --- The Grand Staff Renderer ---
    function renderSheetMusic(notesData) {
        if (notesData.length === 0) {
            statusText.innerText = "Status: No notes played.";
            return;
        }

        outputDiv.innerHTML = ""; 
        const chords = groupNotesIntoChords(notesData);

        const renderer = new VF.Renderer(outputDiv, VF.Renderer.Backends.SVG);
        const staveWidth = Math.max(500, chords.length * 100); // More space per chord
        renderer.resize(staveWidth + 50, 350); // Taller for Grand Staff
        const context = renderer.getContext();

        // Top Staff (Treble)
        const topStave = new VF.Stave(10, 40, staveWidth);
        topStave.addClef("treble").setContext(context).draw();

        // Bottom Staff (Bass)
        const bottomStave = new VF.Stave(10, 160, staveWidth);
        bottomStave.addClef("bass").setContext(context).draw();

        // Connect them with a brace
        const brace = new VF.StaveConnector(topStave, bottomStave).setType(3);
        const lineLeft = new VF.StaveConnector(topStave, bottomStave).setType(1);
        brace.setContext(context).draw();
        lineLeft.setContext(context).draw();

        let totalBeats = 0;
        let trebleNotes = [];
        let bassNotes = [];
        const showNames = showNamesCheck.checked;

        // Process each chord
        chords.forEach(chordGroup => {
            let tPitches = [];
            let bPitches = [];
            let maxDuration = 0;

            // Separate notes by staff (Middle C is MIDI 60)
            chordGroup.forEach(n => {
                if (n.duration > maxDuration) maxDuration = n.duration;
                if (n.pitch >= 60) tPitches.push(n.pitch);
                else bPitches.push(n.pitch);
            });

            const timing = getVexFlowDurationInfo(maxDuration);
            totalBeats += timing.beats;

            // Helper to build a StaveNote or a Rest
            function buildNote(pitches, clef) {
                if (pitches.length === 0) {
                    // Create an invisible rest so alignment holds
                    return new VF.StaveNote({ 
                        clef: clef, 
                        keys: [clef === 'treble' ? "b/4" : "d/3"], 
                        duration: timing.durationStr + "r" 
                    });
                }

                let keysStr = pitches.map(p => getVexFlowPitch(p));
                let note = new VF.StaveNote({ clef: clef, keys: keysStr, duration: timing.durationStr });

                // Add Accidentals and Names
                let namesForAnnotation = [];
                pitches.forEach((p, index) => {
                    if (getVexFlowPitch(p).includes("#")) {
                        note.addModifier(new VF.Accidental("#"), index);
                    }
                    namesForAnnotation.push(getPitchNameOnly(p));
                });

                // Add text annotation if checkbox is checked
                if (showNames) {
                    const textStr = namesForAnnotation.join(", ");
                    const justify = clef === 'treble' ? VF.Annotation.VerticalJustify.TOP : VF.Annotation.VerticalJustify.BOTTOM;
                    note.addModifier(new VF.Annotation(textStr).setVerticalJustification(justify));
                }
                return note;
            }

            trebleNotes.push(buildNote(tPitches, 'treble'));
            bassNotes.push(buildNote(bPitches, 'bass'));
        });

        // Add to voices
        const trebleVoice = new VF.Voice({ num_beats: totalBeats, beat_value: 4 }).setStrict(false);
        trebleVoice.addTickables(trebleNotes);
        
        const bassVoice = new VF.Voice({ num_beats: totalBeats, beat_value: 4 }).setStrict(false);
        bassVoice.addTickables(bassNotes);

        // Format both voices together so they align perfectly vertically
        new VF.Formatter().joinVoices([trebleVoice, bassVoice]).format([trebleVoice, bassVoice], staveWidth - 50);

        trebleVoice.draw(context, topStave);
        bassVoice.draw(context, bottomStave);

        statusText.innerText = `Status: Rendered Grand Staff with ${chords.length} chords/notes.`;
    }
});
