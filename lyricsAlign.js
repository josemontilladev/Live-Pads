// ─────────────────────────────────────────────────────────────────────────
// Letra sincronizada: en qué segundo empieza cada línea de la letra que YA tiene la
// canción, escuchando la voz (en este equipo, con Whisper).
//   1. Whisper transcribe la voz con marcas de tiempo (whisperGuide.transcribeLong).
//   2. Lo transcrito se casa con la letra (Viterbi): cada frase oída → la línea o líneas
//      que más se le parecen, siguiendo el orden de la letra y permitiendo repeticiones
//      (el coro que se canta otra vez, una línea repetida). Lo que no se parece a nada
//      (improvisaciones, «oh oh») se ignora.
//   3. Ajuste fino: a Whisper se le da el TEXTO EXACTO de las líneas de cada tramo y él
//      dice dónde empieza cada una (marcas de tiempo forzadas, 20 ms). Su confianza
//      descarta las líneas que no se oyen bien (se quedan con el tiempo del paso 2).
// Las partes puras (texto, parecido, casado) se prueban en tests/lyricsAlign.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

// ── Texto ────────────────────────────────────────────────────────────────
// Forma «fonética» para comparar lo oído con lo escrito: sin tildes ni signos, y las
// letras que suenan igual en español unificadas (v/b, z/c/s, ll/y, h muda, qu/k…).
function phon(s) {
  let t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9ñ ]+/g, ' ');
  t = t.replace(/ch/g, '§').replace(/h/g, '').replace(/§/g, 'ch')
    .replace(/qu([ei])/g, 'k$1').replace(/c([ei])/g, 's$1').replace(/c/g, 'k').replace(/z/g, 's').replace(/x/g, 'ks')
    .replace(/v/g, 'b').replace(/ll/g, 'y').replace(/w/g, 'u').replace(/gu([ei])/g, 'g$1')
    .replace(/(.)\1+/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}
const compact = (s) => s.replace(/ /g, '');

/** Distancia de edición; con `semi` los extremos de b son gratis (a dentro de b). */
function editDist(a, b, semi = false) {
  const n = a.length, m = b.length;
  if (!n) return 0;
  if (!m) return n;
  let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = semi ? 0 : j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const c = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = Math.min(c, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  if (!semi) return prev[m];
  let best = Infinity;
  for (let j = 0; j <= m; j++) best = Math.min(best, prev[j]);
  return best;
}

/** Parecido 0..1 entre lo oído (heard) y una línea escrita (ref), ya en forma fonética. */
function similarity(heard, ref) {
  const a = compact(heard), b = compact(ref);
  if (!a || !b) return 0;
  const full = 1 - editDist(a, b) / Math.max(a.length, b.length);
  // Lo oído puede ser solo un trozo de la línea (Whisper partió la frase).
  const part = a.length >= 8 && a.length < b.length ? (1 - editDist(a, b, true) / a.length) * Math.min(1, 0.55 + a.length / b.length) : 0;
  return Math.max(full, part);
}

// ── Casado de lo oído con la letra (Viterbi) ─────────────────────────────
// lines: [{ text, sec, secStart }] (la primera línea de cada sección es un punto al que se
// puede «volver»: repetir el coro). segs: [{ t0, t1, text }].
// Una frase oída cubre 1-5 líneas seguidas: puede EMPEZAR a mitad de la primera (sigue la
// línea que ya sonaba: Whisper la partió) y TERMINAR a mitad de la última. O no ser nada
// (improvisaciones, «oh oh»).

/**
 * Alineado de lo oído (a) dentro de la referencia (b = líneas unidas), con el comienzo libre
 * dentro de la primera línea [0, freeStart] y el final libre desde freeEnd.
 * → { cost, start, end } (posiciones en b).
 */
function spanAlign(a, b, freeStart, freeEnd) {
  const n = a.length, m = b.length;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  let pOrg = new Int32Array(m + 1), cOrg = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) { prev[j] = j <= freeStart ? 0 : j - freeStart; pOrg[j] = j <= freeStart ? j : freeStart; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; cOrg[0] = 0;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      let v = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1), o = pOrg[j - 1];
      if (prev[j] + 1 < v) { v = prev[j] + 1; o = pOrg[j]; }
      if (cur[j - 1] + 1 < v) { v = cur[j - 1] + 1; o = cOrg[j - 1]; }
      cur[j] = v; cOrg[j] = o;
    }
    [prev, cur] = [cur, prev]; [pOrg, cOrg] = [cOrg, pOrg];
  }
  let best = Infinity, end = m, start = 0;
  for (let j = Math.min(freeEnd, m); j <= m; j++) {
    const v = prev[j] + (m - j > 0 && j < freeEnd ? m - j : 0);
    if (v < best) { best = v; end = j; start = pOrg[j]; }
  }
  return { cost: best, start, end };
}

const BASE = 0.45;        // parecido neutro: por debajo, mejor «nada»
const MAX_SPAN = 5;
// Una línea «débil» es un trozo (la letra partida por los acordes: «do lugar», «tré»,
// «hora vivo en») o muy corta: no suele tener un comienzo propio que se pueda oír, así
// que saltársela cuesta poco.
function isWeak(lines, i) {
  const t = lines[i].text.trim();
  if (t.replace(/[^\p{L}]/gu, '').length < 7) return true;
  const prev = i > 0 ? lines[i - 1].text.trim() : '';
  return /^\p{Ll}/u.test(t) && prev && /\p{L}$/u.test(prev) && !lines[i].secStart;
}
function transition(lines, from, to) {
  if (from < 0) {
    let c = 0;
    for (let k = 0; k < to; k++) c += isWeak(lines, k) ? 0.1 : 0.4;
    return -Math.min(lines[to].secStart ? 0.3 : 1.5, c);
  }
  if (to === from + 1) return 0;
  if (to === from) return -0.5;                        // la misma línea otra vez (repetida)
  if (to > from) {
    // Líneas saltadas: cada una cuesta (poco si es un trozo).
    let c = 0;
    for (let k = from + 1; k < to; k++) c += isWeak(lines, k) ? 0.1 : 0.55;
    // Saltar ADELANTE a una sección cuesta un poco menos que volver a otra ya cantada: con
    // el mismo texto (el último coro igual que el primero) gana la que viene en la letra.
    return -Math.min(lines[to].secStart ? 0.5 : 2.2, c);
  }
  if (lines[to].secStart) return -0.55;                // vuelta a una sección (coro de nuevo)
  return -2.2;
}

/** Opciones de una frase: [{ s, k, cont, score, cuts: [pos en lo oído 0..1 donde empieza cada línea nueva] }] */
function segmentOptions(lineTxt, heard) {
  const a = compact(heard);
  const opts = [];
  if (a.length < 3) return opts;
  const L = lineTxt.length;
  for (let s = 0; s < L; s++) {
    let ref = '', bounds = [];
    for (let k = 1; k <= MAX_SPAN && s + k <= L; k++) {
      bounds.push(ref.length);
      ref += lineTxt[s + k - 1];
      if (ref.length > a.length * 2.2 + 12) break;          // mucho más larga que lo oído
      const first = lineTxt[s].length, last = lineTxt[s + k - 1].length;
      const r = spanAlign(a, ref, Math.floor(first * 0.85), ref.length - Math.floor(last * 0.85));
      const used = Math.max(1, r.end - r.start);
      const sim = 1 - r.cost / Math.max(a.length, used);
      if (sim <= BASE) continue;
      // La última línea tiene que oírse de verdad (no 3 letras para «enganchar» la siguiente).
      if (k > 1 && r.end - bounds[k - 1] < Math.min(last, Math.max(6, last * 0.4))) continue;
      const cont = r.start > Math.max(3, first * 0.25);
      // Líneas que EMPIEZAN dentro de lo oído (la primera solo si no es continuación).
      const cuts = [];
      bounds.forEach((p, j) => { if (j === 0 ? !cont : p >= r.start) cuts.push({ line: s + j, at: Math.max(0, Math.min(1, (p - r.start) / used)) }); });
      if (!cuts.length && !cont) continue;
      const w = Math.min(1.6, 0.5 + a.length / 25);
      opts.push({ s, k, cont, cuts, score: (sim - BASE) * 4 * w, last: s + k - 1 });
    }
  }
  return opts;
}

function matchSegments(lines, segs) {
  const L = lines.length, S = segs.length;
  if (!L || !S) return [];
  const lineTxt = lines.map((l) => compact(phon(l.text)));
  const NEG = -1e9;
  let prev = new Float64Array(L + 1).fill(NEG);   // índice 0 = «aún ninguna» (última = -1)
  prev[0] = 0;
  const backs = [];
  for (let i = 0; i < S; i++) {
    const opts = segmentOptions(lineTxt, phon(segs[i].text));
    const cur = new Float64Array(L + 1).fill(NEG);
    const back = new Array(L + 1);
    for (let st = 0; st <= L; st++) if (prev[st] > NEG) { cur[st] = prev[st]; back[st] = { from: st, opt: null }; }
    for (const o of opts) {
      const to = o.last + 1;
      if (o.cont) {
        // Sigue la línea que ya sonaba: solo desde ella.
        const st = o.s + 1;
        if (prev[st] <= NEG) continue;
        const v = prev[st] + o.score;
        if (v > cur[to]) { cur[to] = v; back[to] = { from: st, opt: o }; }
        continue;
      }
      for (let st = 0; st <= L; st++) {
        if (prev[st] <= NEG) continue;
        const v = prev[st] + o.score + transition(lines, st - 1, o.s);
        if (v > cur[to]) { cur[to] = v; back[to] = { from: st, opt: o }; }
      }
    }
    backs.push(back);
    prev = cur;
  }
  let st = 0;
  for (let j = 1; j <= L; j++) if (prev[j] > prev[st]) st = j;
  const out = new Array(S);
  for (let i = S - 1; i >= 0; i--) { const b = backs[i][st]; out[i] = b && b.opt ? b.opt : null; st = b ? b.from : st; }
  return out;
}

/**
 * Tiempos aproximados (paso 2): [{ line, t, end, conf }] en orden de canción.
 * Dentro de una frase, cada línea empieza en proporción a dónde cae su texto. Si entre dos
 * líneas casadas falta una sola de la letra, se intercala (el ajuste fino la encontrará).
 */
function coarseAlign(lines, segs) {
  const asg = matchSegments(lines, segs);
  const ev = [];
  segs.forEach((sg, i) => {
    const o = asg[i];
    if (!o) return;
    const dur = sg.t1 - sg.t0;
    if (o.cont && ev.length) ev[ev.length - 1].end = sg.t0 + dur * (o.cuts.length ? o.cuts[0].at : 1);
    o.cuts.forEach((c, j) => {
      const t = sg.t0 + dur * c.at;
      if (ev.length && ev[ev.length - 1].end > t) ev[ev.length - 1].end = t;
      const end = j + 1 < o.cuts.length ? sg.t0 + dur * o.cuts[j + 1].at : sg.t1;
      ev.push({ line: c.line, t, end, conf: 'coarse' });
    });
  });
  // Huecos: «línea 3 … línea 6» → la 4 y la 5 entre medias (hasta 3 seguidas, si caben).
  for (let i = ev.length - 1; i > 0; i--) {
    const p = ev[i - 1], n = ev[i];
    const miss = n.line - p.line - 1;
    if (miss < 1 || miss > 3 || n.t - p.t < 1.2 * (miss + 1)) continue;
    const add = [];
    for (let k = 1; k <= miss; k++) add.push({ line: p.line + k, t: p.t + ((n.t - p.t) * k) / (miss + 1), end: p.t + ((n.t - p.t) * (k + 0.9)) / (miss + 1), conf: 'gap' });
    ev.splice(i, 0, ...add);
  }
  return ev;
}

// ── Tokens de Whisper (BPE por bytes; el rango de cada fusión es su id, como tiktoken) ──
const PAT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
function makeTokenizer(vocab, byteDecoder) {
  const enc = new Map();
  for (const [ch, b] of byteDecoder) enc.set(b, ch);
  const memo = new Map();
  const bpe = (word) => {
    if (memo.has(word)) return memo.get(word);
    const parts = [...Buffer.from(word, 'utf8')].map((b) => enc.get(b));
    for (;;) {
      let best = -1, rank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) { const r = vocab[parts[i] + parts[i + 1]]; if (r != null && r < rank) { rank = r; best = i; } }
      if (best < 0) break;
      parts.splice(best, 2, parts[best] + parts[best + 1]);
    }
    const ids = parts.map((p) => vocab[p]).filter((x) => x != null);
    memo.set(word, ids);
    return ids;
  };
  return (text) => (String(text).match(PAT) || []).flatMap(bpe);
}

// ── Ajuste fino (paso 3): Whisper + el arranque de la voz ────────────────
// Para cada línea casada se miran los ARRANQUES de la voz cercanos (subidas de energía en
// la pista de voz separada, con precisión de 10 ms). Whisper dice desde cuáles «se oye la
// línea desde el principio»: se le da la ventana que empieza en el arranque y el texto
// exacto, y se mide lo probable que son sus primeras palabras. Antes del comienzo real esa
// probabilidad se mantiene (Whisper ignora lo de antes); poco después cae (falta el
// principio). El comienzo es el ÚLTIMO arranque que aún «se oye entero» (o uno anterior
// claramente más marcado: la respiración antes de la línea).
// Si no hay arranques claros (línea ligada a la anterior) se busca dónde cae la
// probabilidad en una rejilla, y la línea queda marcada «revisar».
const NEAR = 0.8;        // s alrededor del tiempo aproximado: cualquier arranque
const FAR = 3.0;         // s: comienzos de frase claros
const PHRASE = 20;       // dB de subida: comienzo de frase (tras respirar)
const VALID = 0.45;      // «se oye entero»: hasta esto por debajo de la mejor
const LEAD_IN = 0.04;    // la ventana empieza 40 ms antes del arranque (la consonante)
const MIN_OK = -2.6;     // por debajo, Whisper no reconoce la línea ahí: revisar

async function refine(pcm, events, lines, m, W, tokenize, langTok, { onProgress, shouldCancel } = {}) {
  const out = events.map((e) => ({ ...e }));
  const full = W.melFull(pcm);
  const env = envelope(pcm, W.SR);
  const sorted = Float32Array.from(env).sort();
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const cache = new Map();
  const scoreAt = async (t, toks) => {
    const f0 = Math.max(0, Math.round(t * 100));
    const key = f0 + '|' + toks.join(',');
    if (cache.has(key)) return cache.get(key);
    const feats = new m.ort.Tensor('float32', W.melWindow(full, f0), [1, W.N_MELS, W.N_FRAMES]);
    const h = (await m.enc.run({ input_features: feats })).last_hidden_state;
    const ids = [W.T.SOT, langTok, W.T.TRANSCRIBE, W.T.NO_TS, ...toks];
    const lg = await W.runDecoder(m, ids, h);
    const lps = toks.map((tk, j) => W.logProbsAt(lg, 3 + j)(tk));
    const n3 = Math.min(3, lps.length);
    const s3 = lps.slice(0, n3).reduce((x, y) => x + y, 0) / n3;
    const sAll = lps.reduce((x, y) => x + y, 0) / lps.length;
    const v = 0.65 * s3 + 0.35 * sAll;
    cache.set(key, v);
    return v;
  };
  let prevT = -1;
  for (let q = 0; q < out.length; q++) {
    if (shouldCancel && shouldCancel()) break;
    const ev = out[q];
    const toks = tokenize(' ' + lines[ev.line].text.trim()).slice(0, 24);
    if (!toks.length) continue;
    const lo = Math.max(prevT + 0.35, ev.t - FAR), hi = ev.t + FAR;
    // Comienzos de frase (tras respirar: subida fuerte) hasta ±3 s — Whisper a veces se
    // equivoca de segundos en el tiempo aproximado —; y cualquier arranque a ±0,8 s.
    let cands = onsetsIn(env, Math.floor(lo / HOP_S), Math.ceil(hi / HOP_S), loud)
      .map((c) => ({ t: c.f * HOP_S, depth: c.depth }))
      .filter((c) => c.depth >= PHRASE || Math.abs(c.t - ev.t) <= NEAR);
    // Como mucho 6: los más marcados y cercanos.
    if (cands.length > 6) cands = cands.sort((x, y) => (y.depth - 6 * Math.abs(y.t - ev.t)) - (x.depth - 6 * Math.abs(x.t - ev.t))).slice(0, 6).sort((x, y) => x.t - y.t);
    if (cands.length) {
      for (const c of cands) c.s = await scoreAt(c.t - LEAD_IN, toks);
      const best = Math.max(...cands.map((c) => c.s));
      const valid = cands.filter((c) => c.s >= best - VALID);
      let pick = valid[valid.length - 1];
      for (const c of valid) if (c !== pick && pick.t - c.t <= 0.4 && c.depth >= pick.depth + 8) { pick = c; break; }
      ev.whisperT = ev.t;
      ev.score = Math.round(best * 100) / 100;
      if (best >= MIN_OK) { ev.t = Math.round(pick.t * 100) / 100; ev.conf = 'exact'; }
      else ev.conf = 'interp';   // no se reconoce el comienzo (p. ej. trozo de palabra): se interpola
    } else if (ev.conf === 'gap' || q === 0 || q === out.length - 1) {
      // Sin arranques: dónde deja de «oírse entera» (rejilla de 0,15 s).
      const grid = [];
      for (let t = Math.max(lo, ev.t - 0.9); t <= ev.t + 0.9; t += 0.15) grid.push({ t, s: await scoreAt(t, toks) });
      if (grid.length) {
        const best = Math.max(...grid.map((g) => g.s));
        const last = grid.filter((g) => g.s >= best - VALID).pop();
        ev.whisperT = ev.t;
        ev.t = Math.round(Math.max(lo, last.t - 0.15) * 100) / 100;
        ev.score = Math.round(best * 100) / 100;
      }
      ev.conf = 'check';
    } else ev.conf = 'interp';
    if (ev.conf !== 'interp') prevT = ev.t;
    if (onProgress) onProgress((q + 1) / out.length);
  }
  // Interpolación: cada línea sin comienzo propio se coloca entre sus vecinas fiables, en la
  // misma proporción que tenía en el tiempo aproximado.
  for (let q = 0; q < out.length; q++) {
    if (out[q].conf !== 'interp') continue;
    let a = q - 1; while (a >= 0 && out[a].conf === 'interp') a--;
    let b = q + 1; while (b < out.length && out[b].conf === 'interp') b++;
    const A0 = a >= 0 ? out[a] : null, B0 = b < out.length ? out[b] : null;
    const ca = A0 ? (A0.whisperT ?? A0.t) : null, cb = B0 ? (B0.whisperT ?? B0.t) : null, c = out[q].whisperT ?? out[q].t;
    if (A0 && B0 && cb > ca) out[q].t = A0.t + ((B0.t - A0.t) * (c - ca)) / (cb - ca);
    else if (A0) out[q].t = A0.t + (c - ca);
    else if (B0) out[q].t = B0.t - (cb - c);
    out[q].t = Math.round(out[q].t * 100) / 100;
    out[q].conf = 'check';
  }
  for (let q = 1; q < out.length; q++) if (out[q].t < out[q - 1].t + 0.12) out[q].t = Math.round((out[q - 1].t + 0.12) * 100) / 100;
  return out;
}

// ── Precisión final: el arranque de la voz ───────────────────────────────
// Whisper dice qué línea es y más o menos cuándo (sus marcas van casi a segundos), pero
// en la pista de VOZ separada el comienzo de cada línea es la subida de energía tras el
// respiro anterior. Se busca la subida más clara cerca del tiempo de Whisper (10 ms).
const HOP_S = 0.01;
function envelope(pcm, sr) {
  const hop = Math.round(HOP_S * sr), n = Math.floor(pcm.length / hop);
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) e += pcm[i] * pcm[i];
    db[f] = 10 * Math.log10(e / hop + 1e-10);
  }
  // Suavizado corto (30 ms) para que una consonante no parta la subida.
  const sm = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0, c = 0; for (let k = -1; k <= 1; k++) { const g = f + k; if (g >= 0 && g < n) { s += db[g]; c++; } } sm[f] = s / c; }
  return sm;
}
/** Subidas de la voz: { f, depth } con f = primer bloque por encima del valle anterior + 6 dB. */
function onsetsIn(env, f0, f1, loud) {
  const out = [];
  const W = 18;       // 180 ms de «antes»
  const AHEAD = 15;   // la voz puede tardar 150 ms en llegar a su volumen (consonante → vocal)
  for (let f = Math.max(W, f0); f < Math.min(env.length - AHEAD, f1); f++) {
    let lo = Infinity;
    for (let k = f - W; k < f; k++) if (env[k] < lo) lo = env[k];
    let after = -Infinity;
    for (let k = f; k < f + AHEAD; k++) if (env[k] > after) after = env[k];
    if (after < loud - 24) continue;                      // demasiado flojo: no es la voz cantando
    const depth = after - lo;
    if (depth < 9) continue;
    if (env[f] - lo < 6 || env[f - 1] - lo >= 6) continue;   // el primer bloque que sube
    out.push({ f, depth });
  }
  return out;
}
// ── Paso 3 (versión por comienzos de frase) ──────────────────────────────
// 1. Comienzos de frase de toda la canción: subidas fuertes de la voz tras respirar (10 ms).
// 2. En cada uno, Whisper puntúa qué línea de la letra EMPIEZA ahí (ventana que empieza en
//    ese instante + texto exacto): solo las líneas plausibles (las que la transcripción
//    pone cerca, sus siguientes y los comienzos de sección).
// 3. Viterbi sobre los comienzos: la secuencia más coherente con la letra (siguiente línea,
//    coro que vuelve, línea repetida…). Un comienzo puede no ser de ninguna línea (mitad de
//    frase). Así no depende de que la transcripción haya entendido la frase: los coros
//    repetitivos o los tramos que Whisper oye como «la la la» también se encuentran.
// 4. Las líneas de la letra sin comienzo propio (ligadas a la anterior, trozos de palabra)
//    se colocan entre sus vecinas con la proporción de la transcripción y quedan «revisar».
const PH_MIN = 18;       // dB de subida para contar como comienzo de frase (menos ventanas: 40 % más rápido, igual de preciso)
const PH_MERGE = 0.22;   // dos subidas más juntas: la más marcada
// Parámetros del casado por comienzos (ajustados con canciones reales y sus LRC).
const PH = {
  thr: -1.9,       // puntuación de Whisper a partir de la que «esta línea empieza aquí»
  prior: 3.5,      // s: la transcripción oyó esa línea cerca → más creíble
  bonus: 1.0,      //   … premio
  away: 1.2,       //   … castigo si la transcripción la oyó en otro sitio (lejos)
  quant: 0.25,     // umbral según la grabación: lo que puntúa el mejor cuarto de comienzos…
  floor: -3.3,     //   … sin bajar de aquí (grabaciones en vivo)
  repGap: 3.0,     // s mínimos para repetir la misma línea
};
const NEARBY = 12;       // s: líneas candidatas (las que la transcripción pone a esta distancia)

function phraseStarts(env, loud) {
  const raw = onsetsIn(env, 20, env.length - 20, loud).filter((o) => o.depth >= PH_MIN);
  const out = [];
  for (const o of raw) {
    const p = out[out.length - 1];
    if (p && (o.f - p.f) * HOP_S < PH_MERGE) { if (o.depth > p.depth) { p.f = o.f; p.depth = o.depth; } continue; }
    out.push({ f: o.f, depth: o.depth });
  }
  return out.map((o) => ({ t: o.f * HOP_S, depth: o.depth }));
}

/** Comienzos de frase con la puntuación de Whisper de cada línea candidata: [{ t, depth, score: Map }] */
async function scorePhrases(pcm, lines, coarse, m, W, tokenize, langTok, { onProgress, shouldCancel } = {}) {
  const L = lines.length;
  const env = envelope(pcm, W.SR);
  const sorted = Float32Array.from(env).sort();
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const P = phraseStarts(env, loud);
  const full = W.melFull(pcm);
  const toks = lines.map((l) => tokenize(' ' + l.text.trim()).slice(0, 10));
  const secStarts = lines.map((l, i) => (l.secStart ? i : -1)).filter((i) => i >= 0);
  const heard = new Set(coarse.filter((e) => e.conf !== 'gap').map((e) => e.line));
  const unheard = lines.map((_, i) => i).filter((i) => !heard.has(i)).slice(0, 16);
  for (const p of P) {
    const set = new Set();
    for (const e of coarse) if (Math.abs(e.t - p.t) <= NEARBY) { set.add(e.line); if (e.line + 1 < L) set.add(e.line + 1); if (e.line + 2 < L) set.add(e.line + 2); }
    // Tramo con voz donde la transcripción no entendió nada (un puente, un coro nuevo…):
    // candidatas = las líneas que no oyó en ninguna parte y los comienzos de sección.
    if (!coarse.some((e) => Math.abs(e.t - p.t) <= 6)) {
      unheard.forEach((i) => set.add(i));
      secStarts.forEach((i) => set.add(i));
    }
    p.cands = [...set].filter((i) => toks[i].length);
  }
  for (let k = 0; k < P.length; k++) {
    if (shouldCancel && shouldCancel()) break;
    const p = P[k];
    p.score = new Map();
    if (!p.cands.length) continue;
    const f0 = Math.max(0, Math.round((p.t - 0.04) * 100));
    const feats = new m.ort.Tensor('float32', W.melWindow(full, f0), [1, W.N_MELS, W.N_FRAMES]);
    const h = (await m.enc.run({ input_features: feats })).last_hidden_state;
    for (const i of p.cands) {
      const ids = [W.T.SOT, langTok, W.T.TRANSCRIBE, W.T.NO_TS, ...toks[i]];
      const lg = await W.runDecoder(m, ids, h);
      const lps = toks[i].map((tk, j) => W.logProbsAt(lg, 3 + j)(tk));
      const n3 = Math.min(3, lps.length);
      p.score.set(i, 0.65 * (lps.slice(0, n3).reduce((x, y) => x + y, 0) / n3) + 0.35 * (lps.reduce((x, y) => x + y, 0) / lps.length));
    }
    if (onProgress) onProgress((k + 1) / P.length);
  }
  return P;
}

/** Viterbi sobre los comienzos puntuados → eventos [{ line, t, conf, score }]. */
function decodePhrases(lines, coarse, P, prm = PH) {
  const L = lines.length;
  const heardAt = lines.map(() => []);
  for (const e of coarse) if (e.conf !== 'gap') heardAt[e.line].push(e.t);
  const prior = (i, t) => {
    if (!heardAt[i].length) return 0;
    return heardAt[i].some((x) => Math.abs(x - t) <= prm.prior) ? prm.bonus : -prm.away;
  };
  // Umbral según la grabación: en vivo (público, reverberación) Whisper está menos seguro
  // en toda la canción; se toma lo que puntúan sus mejores comienzos (percentil 60 de la
  // mejor candidata de cada uno), entre el umbral normal y -3,3.
  const bests = P.map((p) => (p.score && p.score.size ? Math.max(...p.score.values()) : null)).filter((v) => v != null).sort((a, b) => b - a);
  const q = bests.length ? bests[Math.floor(bests.length * (prm.quant ?? 0.4))] : prm.thr;
  const thr = Math.max(prm.floor ?? -3.3, Math.min(prm.thr, q));
  const NEG = -1e9;
  let val = new Float64Array(L + 1).fill(NEG), lastT = new Float64Array(L + 1).fill(-1e9);
  val[0] = 0;
  const backs = [];
  for (let k = 0; k < P.length; k++) {
    const p = P[k];
    const nv = Float64Array.from(val), nt = Float64Array.from(lastT);
    const back = new Int32Array(L + 1).fill(-2);
    if (p.score) for (const [i, sc] of p.score) {
      const em = (sc - thr) + Math.min(1, p.depth / 30) * 0.3 + prior(i, p.t);
      if (em <= 0) continue;
      for (let st = 0; st <= L; st++) {
        if (val[st] <= NEG) continue;
        const gap = p.t - lastT[st];
        if (st > 0 && gap < 0.45) continue;
        if (st - 1 === i && gap < prm.repGap) continue;
        const v = val[st] + em + transition(lines, st - 1, i);
        if (v > nv[i + 1]) { nv[i + 1] = v; nt[i + 1] = p.t; back[i + 1] = st; }
      }
    }
    backs.push(back);
    val = nv; lastT = nt;
  }
  let st = 0;
  for (let j = 1; j <= L; j++) if (val[j] > val[st]) st = j;
  const picked = [];
  for (let k = P.length - 1; k >= 0; k--) {
    const b = backs[k][st];
    if (b === -2) continue;
    picked.push({ line: st - 1, t: Math.round(P[k].t * 100) / 100, score: Math.round(P[k].score.get(st - 1) * 100) / 100, conf: 'exact', depth: P[k].depth });
    st = b;
  }
  picked.reverse();
  const out = [];
  for (let q = 0; q < picked.length; q++) {
    out.push(picked[q]);
    const a = picked[q], b = picked[q + 1];
    if (!b) break;
    const miss = b.line - a.line - 1;
    if (miss < 1 || miss > 8) continue;
    // Solo líneas de la sección de una de las dos: si en medio hay una sección entera
    // (un verso que no se cantó ahí), no se inventa.
    let ok = true;
    for (let j = a.line + 1; j < b.line; j++) if (lines[j].sec !== lines[a.line].sec && lines[j].sec !== lines[b.line].sec) ok = false;
    if (!ok) continue;
    const ca = coarse.find((e) => e.line === a.line && Math.abs(e.t - a.t) < 8);
    const cb = coarse.find((e) => e.line === b.line && Math.abs(e.t - b.t) < 8);
    for (let j = 1; j <= miss; j++) {
      const ln = a.line + j;
      const cm = coarse.find((e) => e.line === ln && e.t > a.t - 3 && e.t < b.t + 3);
      let t;
      if (cm && ca && cb && cb.t > ca.t) t = a.t + ((b.t - a.t) * (cm.t - ca.t)) / (cb.t - ca.t);
      else t = a.t + ((b.t - a.t) * j) / (miss + 1);
      out.push({ line: ln, t: Math.round(Math.min(b.t - 0.15, Math.max(a.t + 0.15, t)) * 100) / 100, conf: 'check' });
    }
  }
  // Las líneas que la transcripción sí oyó y aquí no se encontraron: con su tiempo
  // aproximado, marcadas «revisar» (mejor una línea a ±0,5 s que una que no cambia).
  if (prm.merge !== false) {
    for (const c of coarse) {
      if (out.some((e) => e.line === c.line && Math.abs(e.t - c.t) < 3.5)) continue;
      if (out.some((e) => Math.abs(e.t - c.t) < 0.4)) continue;
      out.push({ line: c.line, t: Math.round(c.t * 100) / 100, conf: 'check' });
    }
  }
  out.sort((x, y) => x.t - y.t);
  return out;
}

async function phraseAlign(pcm, lines, coarse, m, W, tokenize, langTok, opts = {}) {
  const P = await scorePhrases(pcm, lines, coarse, m, W, tokenize, langTok, opts);
  return decodePhrases(lines, coarse, P);
}

/**
 * pcm: voz a 16 kHz mono. lines: [{ text, sec, secStart }] (las líneas de la letra, en orden).
 * → { lang, events: [{ line, t, end, conf: 'exact'|'check'|'coarse'|'gap', score }] }
 * La transcripción usa `size` (small: entiende mejor la voz cantada); el ajuste fino usa
 * base (muchas ventanas: es 3 veces más rápido y distingue igual de bien el comienzo).
 */
// Idioma de la letra por sus palabras más comunes → 'es' | 'en' | null (no se sabe).
// Se alinea una letra QUE YA TENEMOS: su idioma lo dice el texto. Dejar que Whisper lo
// adivine por el audio falla en canciones con coros gritados o mezcla densa (¡Grita!
// salía «en» y solo se colocaban 3 de 46 líneas).
const ES_W = new Set('el la los las de del que y en un una es no me mi tu te se lo le por para con su sus yo tú él al como más pero ya nos mis tus eres soy está estoy hay todo toda todos todas'.split(' '));
const EN_W = new Set('the and you your i me my is are to of in on for with it that this be we our he his she all will can not no so love lord oh'.split(' '));
function guessLang(lines) {
  let es = 0, en = 0;
  for (const l of lines || []) {
    const text = String((l && l.text) || l || '').toLowerCase();
    if (/[ñáéíóú¿¡]/.test(text)) es += 2;
    for (const w of text.split(/[^a-záéíóúüñ']+/)) { if (ES_W.has(w)) es++; if (EN_W.has(w)) en++; }
  }
  if (es + en < 4) return null;
  return es >= en * 1.5 ? 'es' : en >= es * 1.5 ? 'en' : null;
}

async function alignLyrics(pcm, dir, lines, { size = 'small', lang = null, onProgress = null, shouldCancel = null, segments = null, noRefine = false, refineSize = 'base', method = 'phrase' } = {}) {
  if (!lang) lang = guessLang(lines);
  const W = require('./whisperGuide');
  const vocab = JSON.parse(fs.readFileSync(path.join(dir, 'whisper_vocab.json'), 'utf8'));
  const tokenize = makeTokenizer(vocab, W.byteDecoder());
  let tr = segments;
  if (!tr) tr = await W.transcribeLong(pcm, dir, { size, lang, onProgress: (f) => onProgress && onProgress(0.45 * f, 'Escuchando la letra…'), shouldCancel });
  const langTok = W.LANGS[tr.lang] || W.T.ES;
  const coarse = coarseAlign(lines, tr.segments);
  if (noRefine) return { lang: tr.lang, events: coarse, transcript: tr };
  const m = await W.load(dir, refineSize);
  const events = method === 'refine'
    ? await refine(pcm, coarse, lines, m, W, tokenize, langTok, { onProgress: (f) => onProgress && onProgress(0.45 + 0.55 * f, 'Ajustando cada línea a su momento exacto…'), shouldCancel })
    : await phraseAlign(pcm, lines, coarse, m, W, tokenize, langTok, { onProgress: (f) => onProgress && onProgress(0.45 + 0.55 * f, 'Buscando dónde empieza cada línea…'), shouldCancel });
  return { lang: tr.lang, events, transcript: tr };
}

module.exports = { phon, editDist, similarity, matchSegments, coarseAlign, makeTokenizer, envelope, onsetsIn, alignLyrics, scorePhrases, decodePhrases, guessLang, PH };
