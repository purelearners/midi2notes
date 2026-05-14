// --- File Export Logic ---
    const downloadBtn = document.getElementById('downloadBtn');

    downloadBtn.addEventListener('click', () => {
        if (recordedNotes.length === 0) return alert("No notes to export!");

        const format = document.querySelector('input[name="exportFormat"]:checked').value;
        
        if (format === 'svg') downloadSVG();
        else if (format === 'midi') downloadMIDI();
        else if (format === 'xml') downloadMusicXML();
    });

    // 1. Download SVG (Printable Vector Image)
    function downloadSVG() {
        const svgElement = outputDiv.querySelector('svg');
        if (!svgElement) return alert("Sheet music not generated yet.");
        
        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(svgElement);
        
        // Add XML namespace if missing
        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
            source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        const blob = new Blob([source], {type: "image/svg+xml;charset=utf-8"});
        triggerDownload(blob, "my-sheet-music.svg");
    }

    // 2. Download MIDI Audio via midi-writer-js
    function downloadMIDI() {
        if (typeof MidiWriter === 'undefined') return alert("MIDI Writer library missing.");

        const track = new MidiWriter.Track();
        track.addEvent(new MidiWriter.ProgramChangeEvent({instrument: 1})); // Acoustic Grand Piano

        const chords = groupNotesIntoChords(recordedNotes);
        
        chords.forEach(chordGroup => {
            const pitches = chordGroup.map(n => getVexFlowPitch(n.pitch).replace('/', '')); // converts c/4 to c4
            let maxDur = Math.max(...chordGroup.map(n => n.duration));
            let vDur = getVexFlowDurationInfo(maxDur).durationStr;
            
            // Map VexFlow durations to MidiWriter durations (T = ticks, simplified mapping)
            let midiDur = '4'; // default quarter
            if (vDur === 'w') midiDur = '1';
            else if (vDur === 'h') midiDur = '2';
            else if (vDur === '8') midiDur = '8';
            else if (vDur === '16') midiDur = '16';

            const noteEvent = new MidiWriter.NoteEvent({pitch: pitches, duration: midiDur});
            track.addEvent(noteEvent);
        });

        const write = new MidiWriter.Writer(track);
        const uint8Array = write.buildData();
        const blob = new Blob([uint8Array], {type: "audio/midi"});
        triggerDownload(blob, "my-melody.mid");
    }

    // 3. Download MusicXML (Simplified format for import into MuseScore/Finale)
    function downloadMusicXML() {
        const chords = groupNotesIntoChords(recordedNotes);
        let xmlStr = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

        chords.forEach(chordGroup => {
            chordGroup.forEach((note, index) => {
                const isChord = index > 0;
                const step = getPitchNameOnly(note.pitch).replace('#', '');
                const alter = getPitchNameOnly(note.pitch).includes('#') ? `<alter>1</alter>` : '';
                const octave = Math.floor(note.pitch / 12) - 1;
                
                xmlStr += `
      <note>
        ${isChord ? '<chord/>' : ''}
        <pitch>
          <step>${step}</step>
          ${alter}
          <octave>${octave}</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>`;
            });
        });

        xmlStr += `
    </measure>
  </part>
</score-partwise>`;

        const blob = new Blob([xmlStr], {type: "application/vnd.recordare.musicxml+xml"});
        triggerDownload(blob, "my-composition.xml");
    }

    // Helper function to force browser download
    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
