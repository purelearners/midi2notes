document.addEventListener('DOMContentLoaded', () => {

    if (typeof Vex === 'undefined') {
        document.getElementById('status').innerText = "Error: VexFlow library failed to load.";
        return; 
    }
    const VF = Vex.Flow;

    // State Variables
    let midiAccess = null;
    let isRecording = false;
    let recordedNotes = [];
    let activeNotes = {};
    const START_NOTE = 36; // C2
    const END_NOTE = 84;   // C6

    // DOM Elements
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusText = document.getElementById('status');
    const outputDiv = document.getElementById('sheet-music-output');
    const pianoContainer = document.getElementById('piano');
    const showNamesCheck = document.getElementById('showNamesCheck');
    const exportPanel = document.getElementById('exportPanel');
    const downloadBtn = document.getElementById('downloadBtn');
    
    // NEW: User Inputs
    const timeSigSelect = document.getElementById('timeSigSelect');
    const tempoInput = document.getElementById('tempoInput');

    buildPianoUI();

    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then(onMIDISuccess).catch(onMIDIFailure);
    }

    // --- Piano UI & MIDI Handlers (Unchanged) ---
    function isBlackKey(midiNote) { return [1, 3, 6, 8, 10].includes(midiNote % 12); }

    function buildPianoUI() {
        pianoContainer.innerHTML = ""; 
        const whiteKeyWidth = 40, whiteKeyHeight = 150, blackKeyWidth = 24, blackKeyHeight = 95;
        let whiteKeyCount = 0;
        for (let i = START_NOTE; i <= END_NOTE; i++) { if (!isBlackKey(i)) whiteKeyCount++; }
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
            const startTime = activeNotes[note];
            const duration = performance.now() - startTime;
            if (isRecording) {
                recordedNotes.push({ pitch: note, duration: duration, startTime: startTime });
            }
            delete activeNotes[note];
            const keyEl = document.getElementById(`key-${note}`);
            if (keyEl) keyEl.classList.remove('active');
        }
    }

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
        statusText.innerText = hasInput ? "Status: MIDI Connected." : "Status: Waiting for MIDI...";
    }
    function onMIDIFailure() { statusText.innerText = "Status: MIDI denied. (Mouse active)"; }
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
        exportPanel.style.display = 'none'; 
        outputDiv.innerHTML = ""; 
        statusText.innerText = "Status: 🔴 RECORDING... Play notes!";
    });

    stopBtn.addEventListener('click', () => {
        if (!isRecording) return;
        isRecording = false;
        startBtn.disabled = false; stopBtn.disabled = true;
        statusText.innerText = "Status: Generating A4 Sheet Music...";
        renderSheetMusic(recordedNotes);
        if (recordedNotes.length > 0) exportPanel.style.display = 'flex';
    });

    // --- VexFlow Data Translation Logic ---
    function getVexFlowPitch(midiNote) {
        const noteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
        return `${noteNames[midiNote % 12]}/${Math.floor(midiNote / 12) - 1}`;
    }

    function getPitchNameOnly(midiNote) {
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        return noteNames[midiNote % 12];
    }

    // NEW: Uses dynamic BPM from user input
    function getVexFlowDurationInfo(durationMs, bpm) {
        const quarterNoteMs = 60000 / bpm; 
        const ratio = durationMs / quarterNoteMs;
        if (ratio >= 3.0) return { durationStr: "w", beats: 4 };
        if (ratio >= 1.5) return { durationStr: "h", beats: 2 };
        if (ratio >= 0.75) return { durationStr: "q", beats: 1 };
        if (ratio >= 0.35) return { durationStr: "8", beats: 0.5 };
        return { durationStr: "16", beats: 0.25 };
    }

    function groupNotesIntoChords(notesArray) {
        if (notesArray.length === 0) return [];
        notesArray.sort((a, b) => a.startTime - b.startTime);
        let chords = [], currentChord = [notesArray[0]];
        for (let i = 1; i < notesArray.length; i++) {
            const note = notesArray[i];
            if (Math.abs(note.startTime - currentChord[0].startTime) < 60) currentChord.push(note);
            else { chords.push(currentChord); currentChord = [note]; }
        }
        if (currentChord.length > 0) chords.push(currentChord);
        return chords;
    }

    // --- NEW: Multi-Line A4 Renderer ---
    function renderSheetMusic(notesData) {
        if (notesData.length === 0) { statusText.innerText = "Status: No notes played."; return; }

        outputDiv.innerHTML = ""; 
        const chords = groupNotesIntoChords(notesData);
        
        // 1. Get User Settings
        const bpm = parseInt(tempoInput.value) || 120;
        const timeSig = timeSigSelect.value;
        const [beatsPerMeasure, beatValue] = timeSig.split('/').map(Number);
        
        // 2. Algorithm: Split chords into lines (4 measures per line)
        const targetBeatsPerLine = beatsPerMeasure * 4; 
        let lines = [];
        let currentLineChords = [];
        let currentLineBeats = 0;

        chords.forEach(chordGroup => {
            let maxDuration = Math.max(...chordGroup.map(n => n.duration));
            let timing = getVexFlowDurationInfo(maxDuration, bpm);
            
            // If adding this chord exceeds our line capacity, wrap to a new line
            if (currentLineBeats + timing.beats > targetBeatsPerLine && currentLineChords.length > 0) {
                lines.push({ chords: currentLineChords, totalBeats: currentLineBeats });
                currentLineChords = [];
                currentLineBeats = 0;
            }
            
            currentLineChords.push(chordGroup);
            currentLineBeats += timing.beats;
        });
        // Push the final incomplete line
        if (currentLineChords.length > 0) lines.push({ chords: currentLineChords, totalBeats: currentLineBeats });

        // 3. Setup VexFlow Renderer for Multi-Line (A4 Width)
        const SVG_WIDTH = 800; // Standard on-screen A4 width
        const STAVE_WIDTH = 750;
        const SYSTEM_HEIGHT = 220; // Height of one Treble/Bass pair
        
        const renderer = new VF.Renderer(outputDiv, VF.Renderer.Backends.SVG);
        renderer.resize(SVG_WIDTH, lines.length * SYSTEM_HEIGHT + 50); 
        const context = renderer.getContext();

        const showNames = showNamesCheck.checked;

        // 4. Draw each line vertically
        lines.forEach((lineData, lineIndex) => {
            const yOffset = lineIndex * SYSTEM_HEIGHT;
            
            // Create Treble & Bass Staves for this line
            const topStave = new VF.Stave(10, yOffset + 40, STAVE_WIDTH);
            const bottomStave = new VF.Stave(10, yOffset + 140, STAVE_WIDTH);
            
            // Only add Clef and Time Signature at the start of the line
            topStave.addClef("treble").addTimeSignature(timeSig).setContext(context).draw();
            bottomStave.addClef("bass").addTimeSignature(timeSig).setContext(context).draw();

            // Connect them with a bracket
            new VF.StaveConnector(topStave, bottomStave).setType(3).setContext(context).draw();
            new VF.StaveConnector(topStave, bottomStave).setType(1).setContext(context).draw();

            let trebleNotes = [];
            let bassNotes = [];

            // Build Notes for this specific line
            lineData.chords.forEach(chordGroup => {
                let tPitches = [], bPitches = [], maxDur = 0;

                chordGroup.forEach(n => {
                    if (n.duration > maxDur) maxDur = n.duration;
                    if (n.pitch >= 60) tPitches.push(n.pitch);
                    else bPitches.push(n.pitch);
                });

                const timing = getVexFlowDurationInfo(maxDur, bpm);

                function buildNote(pitches, clef) {
                    if (pitches.length === 0) {
                        return new VF.StaveNote({ clef: clef, keys: [clef === 'treble' ? "b/4" : "d/3"], duration: timing.durationStr + "r" });
                    }
                    let keysStr = pitches.map(p => getVexFlowPitch(p));
                    let note = new VF.StaveNote({ clef: clef, keys: keysStr, duration: timing.durationStr });

                    let namesForAnnotation = [];
                    pitches.forEach((p, index) => {
                        if (getVexFlowPitch(p).includes("#")) note.addModifier(new VF.Accidental("#"), index);
                        namesForAnnotation.push(getPitchNameOnly(p));
                    });

                    if (showNames) {
                        const justify = clef === 'treble' ? VF.Annotation.VerticalJustify.TOP : VF.Annotation.VerticalJustify.BOTTOM;
                        note.addModifier(new VF.Annotation(namesForAnnotation.join(", ")).setVerticalJustification(justify));
                    }
                    return note;
                }

                trebleNotes.push(buildNote(tPitches, 'treble'));
                bassNotes.push(buildNote(bPitches, 'bass'));
            });

            // Format and draw this line's voices
            const trebleVoice = new VF.Voice({ num_beats: lineData.totalBeats, beat_value: 4 }).setStrict(false);
            trebleVoice.addTickables(trebleNotes);
            const bassVoice = new VF.Voice({ num_beats: lineData.totalBeats, beat_value: 4 }).setStrict(false);
            bassVoice.addTickables(bassNotes);

            new VF.Formatter().joinVoices([trebleVoice, bassVoice]).format([trebleVoice, bassVoice], STAVE_WIDTH - 50);
            
            trebleVoice.draw(context, topStave);
            bassVoice.draw(context, bottomStave);
        });

        statusText.innerText = `Status: Generated ${lines.length} lines of A4 Sheet Music.`;
    }

    // --- Exporters ---
    downloadBtn.addEventListener('click', () => {
        if (recordedNotes.length === 0) return alert("No notes to export!");
        const format = document.querySelector('input[name="exportFormat"]:checked').value;
        if (format === 'svg') downloadSVG();
        else if (format === 'midi') downloadMIDI();
        else if (format === 'xml') downloadMusicXML();
    });

    function downloadSVG() {
        const svgElement = outputDiv.querySelector('svg');
        if (!svgElement) return alert("Sheet music not generated yet.");
        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(svgElement);
        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
            source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        // Force a white background for printing
        source = source.replace('<svg ', '<svg style="background-color: white;" ');
        triggerDownload(new Blob([source], {type: "image/svg+xml;charset=utf-8"}), "my-sheet-music.svg");
    }

    function downloadMIDI() {
        if (typeof MidiWriter === 'undefined') return alert("MIDI Writer library missing.");
        
        const bpm = parseInt(tempoInput.value) || 120;
        const timeSigParts = timeSigSelect.value.split('/');

        const track = new MidiWriter.Track();
        track.setTempo(bpm);
        track.setTimeSignature(timeSigParts[0], timeSigParts[1]);
        track.addEvent(new MidiWriter.ProgramChangeEvent({instrument: 1}));

        const chords = groupNotesIntoChords(recordedNotes);
        chords.forEach(chordGroup => {
            const pitches = chordGroup.map(n => getVexFlowPitch(n.pitch).replace('/', '')); 
            let maxDur = Math.max(...chordGroup.map(n => n.duration));
            let vDur = getVexFlowDurationInfo(maxDur, bpm).durationStr;
            let midiDur = '4'; 
            if (vDur === 'w') midiDur = '1'; else if (vDur === 'h') midiDur = '2'; else if (vDur === '8') midiDur = '8'; else if (vDur === '16') midiDur = '16';
            track.addEvent(new MidiWriter.NoteEvent({pitch: pitches, duration: midiDur}));
        });

        const write = new MidiWriter.Writer(track);
        triggerDownload(new Blob([write.buildData()], {type: "audio/midi"}), "my-melody.mid");
    }

    function downloadMusicXML() {
        const chords = groupNotesIntoChords(recordedNotes);
        const timeSigParts = timeSigSelect.value.split('/');
        
        let xmlStr = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${timeSigParts[0]}</beats><beat-type>${timeSigParts[1]}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

        chords.forEach(chordGroup => {
            chordGroup.forEach((note, index) => {
                const step = getPitchNameOnly(note.pitch).replace('#', '');
                const alter = getPitchNameOnly(note.pitch).includes('#') ? `<alter>1</alter>` : '';
                const octave = Math.floor(note.pitch / 12) - 1;
                xmlStr += `<note>${index > 0 ? '<chord/>' : ''}<pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`;
            });
        });

        xmlStr += `</measure></part></score-partwise>`;
        triggerDownload(new Blob([xmlStr], {type: "application/vnd.recordare.musicxml+xml"}), "my-composition.xml");
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }
});
