// ─────────────────────────────────────────────────────────────────────────
// Exportar la melodía (y la 2.ª y 3.ª voz) del Estudio de voces. Puro; tests/melodyExport.test.mjs.
//   partsToMidi(parts, bpm)          → .mid (formato 1: una pista por voz)
//   partsToMusicXML(parts, opts)     → partitura MusicXML (MuseScore, Sibelius, Finale…)
// Notas: { s, e, m } (inicio y fin en segundos, nota MIDI).
// ─────────────────────────────────────────────────────────────────────────

const PPQ = 480;

function varLen(out, v) {
  const bytes = [v & 0x7f];
  while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
  out.push(...bytes);
}
const chunk = (id, data) => [...id.split('').map((c) => c.charCodeAt(0)), (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...data];
const text = (s) => [...new TextEncoder().encode(String(s).slice(0, 60))];

/** Una voz no puede tener dos notas a la vez: si se pisan, la anterior se corta. */
export function monophonic(notes) {
  const ns = (notes || []).filter((n) => n && Number.isFinite(n.s) && Number.isFinite(n.e) && n.e > n.s && Number.isFinite(n.m)).slice().sort((a, b) => a.s - b.s);
  const out = [];
  for (const n of ns) {
    const p = out[out.length - 1];
    if (p && p.e > n.s) p.e = n.s;
    if (p && p.e - p.s < 0.02) out.pop();
    out.push({ s: n.s, e: n.e, m: Math.round(n.m) });
  }
  return out;
}

export function partsToMidi(parts, bpm = 120) {
  const tick = (sec) => Math.max(0, Math.round(sec * (bpm / 60) * PPQ));
  const tempo = [];
  const mpq = Math.round(60000000 / bpm);
  varLen(tempo, 0); tempo.push(0xff, 0x51, 0x03, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255);
  varLen(tempo, 0); tempo.push(0xff, 0x2f, 0x00);
  const tracks = [chunk('MTrk', tempo)];
  parts.forEach((p, ch) => {
    const evs = [];
    for (const n of monophonic(p.notes)) { evs.push({ t: tick(n.s), on: 1, m: n.m }); evs.push({ t: tick(n.e), on: 0, m: n.m }); }
    evs.sort((a, b) => a.t - b.t || a.on - b.on);
    const d = [];
    const name = text(p.name || `Voz ${ch + 1}`);
    varLen(d, 0); d.push(0xff, 0x03, name.length, ...name);
    let last = 0;
    for (const e of evs) { varLen(d, e.t - last); last = e.t; d.push((e.on ? 0x90 : 0x80) | (ch & 15), e.m & 127, e.on ? 96 : 0); }
    varLen(d, 0); d.push(0xff, 0x2f, 0x00);
    tracks.push(chunk('MTrk', d));
  });
  const head = chunk('MThd', [0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...head, ...tracks.flat()]);
}

// ── Partitura ───────────────────────────────────────────────────────────────
const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
/** Tono { k, m } (k = tónica 0-11) → número de alteraciones de la armadura (−6…6). */
export function keyFifths(key) {
  if (!key || !Number.isFinite(key.k)) return 0;
  const major = key.m ? (key.k + 3) % 12 : ((key.k % 12) + 12) % 12;
  return MAJOR_FIFTHS[major] ?? 0;
}
const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
function pitchOf(m, flats) {
  const [step, alter] = (flats ? FLAT : SHARP)[((m % 12) + 12) % 12];
  return { step, alter, octave: Math.floor(m / 12) - 1 };
}
// Figuras en semicorcheas (división 4 por negra) → tipo y puntillo.
const FIG = [[16, 'whole', 0], [12, 'half', 1], [8, 'half', 0], [6, 'quarter', 1], [4, 'quarter', 0], [3, 'eighth', 1], [2, 'eighth', 0], [1, '16th', 0]];
/** Reparte una duración (semicorcheas) en figuras escribibles, de mayor a menor. */
export function splitDuration(n) {
  const out = [];
  while (n > 0) { const f = FIG.find(([d]) => d <= n); out.push(f); n -= f[0]; }
  return out;
}

/**
 * Notas de una voz → compases de eventos { dur (semicorcheas), m | null (silencio), tieStart, tieStop }.
 * bar = semicorcheas por compás.
 */
export function measuresOf(notes, { bpm, offsetSec = 0, bar = 16 }) {
  const q = (sec) => Math.max(0, Math.round(((sec - offsetSec) * bpm) / 60 * 4));
  const ns = monophonic(notes).map((n) => ({ a: q(n.s), b: Math.max(q(n.s) + 1, q(n.e)), m: n.m }));
  // Sin solaparse tras cuantizar.
  for (let i = 1; i < ns.length; i++) if (ns[i].a < ns[i - 1].b) ns[i - 1].b = Math.max(ns[i - 1].a + 1, ns[i].a), ns[i].a = Math.max(ns[i].a, ns[i - 1].b);
  const end = ns.length ? ns[ns.length - 1].b : bar;
  const total = Math.max(bar, Math.ceil(end / bar) * bar);
  // Línea continua de tramos (nota o silencio).
  const spans = [];
  let t = 0;
  for (const n of ns) { if (n.b <= n.a) continue; if (n.a > t) spans.push({ a: t, b: n.a, m: null }); spans.push({ a: n.a, b: n.b, m: n.m }); t = n.b; }
  if (t < total) spans.push({ a: t, b: total, m: null });
  // Cortar en las barras de compás y en figuras escribibles (ligando las notas).
  const measures = Array.from({ length: total / bar }, () => []);
  for (const sp of spans) {
    let a = sp.a;
    while (a < sp.b) {
      const mi = Math.floor(a / bar), barEnd = (mi + 1) * bar, b = Math.min(sp.b, barEnd);
      const figs = splitDuration(b - a);
      figs.forEach(([d], k) => {
        const first = a === sp.a && k === 0, last = b === sp.b && k === figs.length - 1;
        measures[mi].push({ dur: d, m: sp.m, tieStop: sp.m != null && !first, tieStart: sp.m != null && !last });
      });
      a = b;
    }
  }
  return measures;
}

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Partitura MusicXML con una pauta por voz. opts = { bpm, beatsPerBar, key: { k, m }, offsetSec, title } */
export function partsToMusicXML(parts, { bpm = 120, beatsPerBar = 4, key = null, offsetSec = 0, title = 'Melodía' } = {}) {
  const fifths = keyFifths(key);
  const flats = fifths < 0;
  const bar = beatsPerBar * 4;
  const list = parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${xmlEsc(p.name || `Voz ${i + 1}`)}</part-name></score-part>`).join('');
  const body = parts.map((p, i) => {
    const ms = measuresOf(p.notes, { bpm, offsetSec, bar });
    const low = monophonic(p.notes).reduce((mn, n) => Math.min(mn, n.m), 127);
    const clef = low < 55 ? '<clef><sign>F</sign><line>4</line></clef>' : '<clef><sign>G</sign><line>2</line></clef>';
    return `<part id="P${i + 1}">${ms.map((evs, k) => {
      const attrs = k === 0 ? `<attributes><divisions>4</divisions><key><fifths>${fifths}</fifths>${key && key.m ? '<mode>minor</mode>' : ''}</key><time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>${clef}</attributes>${i === 0 ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>` : ''}` : '';
      return `<measure number="${k + 1}">${attrs}${evs.map((e) => {
        const [, type, dot] = FIG.find(([d]) => d === e.dur);
        if (e.m == null) return `<note><rest/><duration>${e.dur}</duration><type>${type}</type>${dot ? '<dot/>' : ''}</note>`;
        const p2 = pitchOf(e.m, flats);
        const ties = `${e.tieStop ? '<tie type="stop"/>' : ''}${e.tieStart ? '<tie type="start"/>' : ''}`;
        const tied = e.tieStop || e.tieStart ? `<notations>${e.tieStop ? '<tied type="stop"/>' : ''}${e.tieStart ? '<tied type="start"/>' : ''}</notations>` : '';
        return `<note><pitch><step>${p2.step}</step>${p2.alter ? `<alter>${p2.alter}</alter>` : ''}<octave>${p2.octave}</octave></pitch><duration>${e.dur}</duration>${ties}<type>${type}</type>${dot ? '<dot/>' : ''}${tied}</note>`;
      }).join('')}</measure>`;
    }).join('')}</part>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>${xmlEsc(title)}</work-title></work><identification><encoding><software>LivePads</software></encoding></identification><part-list>${list}</part-list>${body}</score-partwise>\n`;
}
