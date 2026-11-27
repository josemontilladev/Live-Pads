// Diagnóstico de la letra con IA: qué oye Whisper en la voz separada y qué devuelve la alineación.
//   node tests/e2e/lyricsDiag.mjs "Título"
import { launch, findSong } from './harness.mjs';
const title = process.argv[2] || '¡Grita!';
const h = await launch({ songs: [findSong(title)], timeoutMs: 40 * 60000 });
try {
  const r = await h.evaluate(`(async () => {
    const S = await import('./js/state/store.js'), A = await import('./js/live/autoLyrics.js'), L = await import('./js/live/lyricSyncStore.js');
    const song = S.getSongs().find((s) => s.title === ${JSON.stringify(title)});
    const lines = L.lyricLines(song.lyrics);
    const vocal = await A.vocalOf(song, () => {}, 'original');
    const pcm = await A.to16kMono(vocal);
    let rms = 0; for (let i = 0; i < pcm.length; i += 16) rms += pcm[i] * pcm[i]; rms = Math.sqrt(rms / (pcm.length / 16));
    const tr = null;
    const idx = lines.map((l, i) => i).filter((i) => /[a-záéíóúñü]{2}/i.test(lines[i].text));
    const al = await window.electronAPI.lyricsAlign({ pcm, lines: idx.map((i) => lines[i]), size: 'small' });
    // Las líneas como se le pasan a la IA (índices de la lista filtrada, como en al.events).
    const sent = idx.map((i, k) => k + (lines[i].secStart ? '*' : ' ') + lines[i].sec + ' ' + lines[i].text);
    return { dur: pcm.length / 16000, rms, nLines: lines.length, lines: sent.join(' | '), al: (al.lang + ' ' + al.events.map((e) => e.line + '@' + e.t.toFixed(1) + (e.conf === 'exact' ? '' : '?')).join(' ')) };
  })()`);
  console.log(JSON.stringify(r, null, 1));
} finally { await h.close(); }
