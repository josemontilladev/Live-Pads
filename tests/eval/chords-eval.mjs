// Ventana oculta del banco de pruebas de acordes (ver chords-main.cjs).
import { analyzeChords, chordName } from '../../src/js/chords/chordEngine.js';
import { parseLyricStructure, parseChord, keyOffset } from '../../src/js/ui/songStructure.js';

const { ipcRenderer } = window.require('electron');
const fs = window.require('fs');
const path = window.require('path');
const log = (m) => ipcRenderer.send('log', m);
const params = new URLSearchParams(location.search);
const MAX = +params.get('max') || 40, TYPE = params.get('type') || 'original', ONLY = params.get('only') || '';
const ROOT = path.join(process.env.APPDATA, 'livepads');
const mod12 = (v) => ((v % 12) + 12) % 12;

function fileOf(uri) {
  const m = String(uri || '').match(/^livepads:\/\/app\/(.+)$/);
  return m ? path.join(ROOT, decodeURIComponent(m[1])) : null;
}
async function decode(file, sr) {
  const bytes = fs.readFileSync(file);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const buf = await new OfflineAudioContext(1, 1, sr).decodeAudioData(ab);
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i]; }
  for (let i = 0; i < n; i++) out[i] /= buf.numberOfChannels;
  return out;
}

// Acordes de la letra → {clave: peso} (clave = raíz + 12 si es menor). Peso = veces que aparece.
function sheetVocab(lyrics) {
  const secs = parseLyricStructure(lyrics);
  const w = new Map();
  for (const s of secs) for (const c of (s.chords || [])) {
    const p = c && c.n ? parseChord(c.n) : null;
    if (!p) continue;
    const k = p.r + ((p.q === 1 || p.q === 4) ? 12 : 0);
    w.set(k, (w.get(k) || 0) + 1);
  }
  return { secs, w };
}
const isMinorQ = (q) => q === 1 || q === 4;

// Medida: tiempo (sin «N») con un acorde que está en la letra, con la mejor transposición.
function score(seg, vocab, fixedK = null) {
  let best = { pct: 0, k: 0 };
  const total = seg.reduce((a, x) => a + (x.r >= 0 ? x.e - x.s : 0), 0) || 1e-9;
  const dur = seg.reduce((a, x) => a + (x.e - x.s), 0) || 1e-9;
  for (let k = 0; k < 12; k++) {
    if (fixedK != null && k !== fixedK) continue;
    let ok = 0;
    for (const x of seg) if (x.r >= 0 && vocab.has(mod12(x.r + k) + (isMinorQ(x.q) ? 12 : 0))) ok += x.e - x.s;
    if (ok / total > best.pct) best = { pct: ok / total, k };
  }
  const nPct = seg.reduce((a, x) => a + (x.r < 0 ? x.e - x.s : 0), 0) / dur;
  // ¿Salen los acordes de la letra? (los que pesan ≥ 2 veces y duran ≥ 3 s en total)
  const found = new Map();
  for (const x of seg) if (x.r >= 0) { const key = mod12(x.r + best.k) + (isMinorQ(x.q) ? 12 : 0); found.set(key, (found.get(key) || 0) + x.e - x.s); }
  return { pct: best.pct, k: best.k, n: nPct, changes: seg.length, found };
}

const songs = JSON.parse(fs.readFileSync(path.join(ROOT, 'Datos', 'canciones_app.json'), 'utf8')).data.songs;
const pool = songs
  .filter((s) => (!ONLY || s.title.toLowerCase().includes(ONLY.toLowerCase())))
  .map((s) => ({ s, file: fileOf(s.audio && s.audio[TYPE]) }))
  .filter(({ s, file }) => file && fs.existsSync(file) && s.lyrics)
  .map((o) => ({ ...o, sv: sheetVocab(o.s.lyrics) }))
  .filter((o) => o.sv.w.size >= 3)
  .sort((a, b) => a.s.title.localeCompare(b.s.title))
  .slice(0, MAX);
log(`${pool.length} canciones (${TYPE})`);

const res = [];
const methods = {};
const add = (name, sc) => { (methods[name] ||= []).push(sc.pct); };
for (const [i, { s, file, sv }] of pool.entries()) {
  try {
    const vocab = new Set(sv.w.keys());
    const x11 = await decode(file, 11025);
    const quick = analyzeChords(x11);
    const x22 = await decode(file, 22050);
    const id = s.id + TYPE;
    await ipcRenderer.invoke('btc-logits', { id, mono: x22 });
    const row = { title: s.title, key: s.key, vocab: [...vocab].map((k) => chordName({ r: k % 12, q: k >= 12 ? 1 : 0, b: -1 })) };
    const qs = score(quick.seg, vocab); add('rapido', qs);
    row.rapido = Math.round(qs.pct * 100);
    for (const pen of [10, 20, 35]) {
      const seg = await ipcRenderer.invoke('btc-decode', { id, pen });
      const sc = score(seg, vocab); add(`btc${pen}`, sc);
      row[`btc${pen}`] = Math.round(sc.pct * 100);
    }
    // Como la app: vocabulario de la letra si cuadra con lo detectado; si no, tonalidad.
    const off = keyOffset(sv.secs, quick.seg);
    let ctx;
    if (off && off.score >= 0.45) ctx = { vocab: [...vocab].map((k) => ({ r: mod12((k % 12) - off.k), m: k >= 12 })) };
    else ctx = { key: { k: quick.k, m: !!quick.m } };
    const segApp = await ipcRenderer.invoke('btc-decode', { id, pen: 20, ...ctx });
    const sa = score(segApp, vocab); add('app', sa);
    row.app = Math.round(sa.pct * 100); row.guia = ctx.vocab ? 'letra' : 'tono'; row.off = off ? Math.round(off.score * 100) : 0;
    res.push(row);
    log(`${String(i + 1).padStart(2)} ${s.title.slice(0, 32).padEnd(32)} rápido ${String(row.rapido).padStart(3)}  btc ${String(row.btc20).padStart(3)}  app ${String(row.app).padStart(3)} (${row.guia} ${row.off})`);
  } catch (e) { log(`✖ ${s.title}: ${e.message}`); }
}
const avg = (a) => Math.round(100 * a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
log('MEDIA (% del tiempo con un acorde de la letra): ' + Object.entries(methods).map(([k, v]) => `${k} ${avg(v)}`).join(' · '));
ipcRenderer.send('done', { type: TYPE, methods: Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, avg(v)])), rows: res });
