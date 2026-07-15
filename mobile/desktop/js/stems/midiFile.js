// Escritor mínimo de Standard MIDI File (SMF type 0) para exportar una pista
// del piano roll. notes: [{ midi, velocity, startSec, durationSec }].

const PPQ = 480;   // ticks por negra

function writeVarLen(arr, value) {
  let buffer = value & 0x7f;
  while ((value = Math.floor(value / 128))) { buffer = (buffer << 8) | ((value & 0x7f) | 0x80); }
  while (true) { arr.push(buffer & 0xff); if (buffer & 0x80) buffer = buffer >> 8; else break; }
}

export function notesToMidi(notes, bpm = 120) {
  const tpb = PPQ;
  const secToTick = (s) => Math.max(0, Math.round(s * (bpm / 60) * tpb));
  const evs = [];
  for (const n of notes) {
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity || 100)));
    evs.push({ tick: secToTick(n.startSec), on: true, midi: n.midi & 0x7f, vel });
    evs.push({ tick: secToTick(n.startSec + n.durationSec), on: false, midi: n.midi & 0x7f, vel: 0 });
  }
  // Orden por tick; los note-off antes que los note-on en el mismo tick.
  evs.sort((a, b) => a.tick - b.tick || (a.on ? 1 : 0) - (b.on ? 1 : 0));

  const track = [];
  const mpq = Math.round(60000000 / bpm);
  writeVarLen(track, 0);
  track.push(0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff); // tempo
  let last = 0;
  for (const e of evs) {
    writeVarLen(track, e.tick - last); last = e.tick;
    track.push(e.on ? 0x90 : 0x80, e.midi, e.vel);
  }
  writeVarLen(track, 0); track.push(0xff, 0x2f, 0x00); // fin de pista

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpb >> 8) & 0xff, tpb & 0xff];
  const len = track.length;
  const trkHead = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trkHead, ...track]);
}

// Descarga las notas como archivo .mid en el navegador (Electron).
export function downloadMidi(notes, bpm, filename = 'piano.mid') {
  const bytes = notesToMidi(notes, bpm);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
