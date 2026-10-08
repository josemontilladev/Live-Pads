// ─────────────────────────────────────────────────────────────────────────
// Detector de acordes, tonalidad y BPM (JS puro, sin DOM). Es el mismo motor
// que usa GI App (lib/audio/chord_engine.dart), portado línea a línea:
//  1. Espectro (FFT) del audio en mono a 11 025 Hz.
//  2. Afinación de la grabación + «cromagrama» (energía de las 12 notas) y un
//     cromagrama aparte de los graves (bajo de los acordes con barra).
//  3. Pulso: flujo espectral → autocorrelación → BPM; seguimiento de pulsos
//     por programación dinámica (Ellis).
//  4. Tonalidad: perfiles de Krumhansl, revisada luego con los acordes.
//  5. Acordes por pulso: plantillas + Viterbi.
//
// Todo vive dentro de chordEngineFactory() SIN referencias externas: así el
// mismo código se puede convertir en texto y arrancar en un Web Worker creado
// desde un Blob (ver chordWorker.js) — el análisis nunca toca el hilo de la
// interfaz ni el audio en vivo — y también importarse en los tests de Node.
// ─────────────────────────────────────────────────────────────────────────

export function chordEngineFactory() {
  const SR = 11025;
  const LETTERS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const SOLFEGE = ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
  // [sufijo, intervalos, penalización para preferir tríadas]
  const QUALITIES = [
    ['', [0, 4, 7], 0],
    ['m', [0, 3, 7], 0],
    ['7', [0, 4, 7, 10], 0.07],
    ['maj7', [0, 4, 7, 11], 0.08],
    ['m7', [0, 3, 7, 10], 0.07],
    ['sus4', [0, 5, 7], 0.07],
    ['sus2', [0, 2, 7], 0.08],
  ];

  const mod = (a, n) => ((a % n) + n) % n;
  // Redondeo como Dart (mitades lejos de cero) para que los resultados coincidan con GI App.
  const rnd = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

  /** Nombre de un acorde {r, q, b}. latin = Do/Re…; basic = solo mayor/menor; shift = semitonos. */
  function chordName(c, { latin = false, basic = false, shift = 0 } = {}) {
    if (!c || c.r < 0) return 'N';
    const names = latin ? SOLFEGE : LETTERS;
    let q = QUALITIES[c.q][0];
    if (basic) q = (q.startsWith('m') && q !== 'maj7') ? 'm' : '';
    const b = c.b >= 0 && c.b !== c.r && !basic ? '/' + names[mod(c.b + shift, 12)] : '';
    return names[mod(c.r + shift, 12)] + q + b;
  }
  function keyName(a, { latin = false, shift = 0 } = {}) {
    return (latin ? SOLFEGE : LETTERS)[mod(a.k + shift, 12)] + (a.m ? 'm' : '');
  }
  function pitchClasses(c) {
    return !c || c.r < 0 ? [] : QUALITIES[c.q][1].map(i => (c.r + i) % 12);
  }
  const sameChord = (a, b) => a.r === b.r && a.q === b.q && a.b === b.b;

  // ── FFT ──
  function makeFft(n) {
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    const rev = new Int32Array(n), win = new Float64Array(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos(2 * Math.PI * i / n);
      sin[i] = -Math.sin(2 * Math.PI * i / n);
    }
    const bits = Math.round(Math.log2(n));
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    // Magnitudes (n/2 bins) de la ventana de x que empieza en off (ceros fuera del rango).
    return function mags(x, off, out) {
      for (let i = 0; i < n; i++) {
        const j = off + i;
        re[rev[i]] = (j >= 0 && j < x.length) ? x[j] * win[i] : 0;
        im[rev[i]] = 0;
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let k = 0; k < half; k++) {
            const c = cos[k * step], s = sin[k * step];
            const a = i + k, b = a + half;
            const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
      for (let k = 0; k < n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    };
  }

  /**
   * Analiza x (Float32Array mono a 11 025 Hz; se normaliza EN SITIO).
   * onProgress(p 0..1, etiqueta). Devuelve un objeto JSON-serializable:
   *   { v, d, bpm, k, m, t, db, beats[], seg[{s,e,r,q,b}], w[0..100] }
   */
  function analyzeChords(x, onProgress) {
    const sr = SR;
    const duration = x.length / sr;
    let lastP = 0;
    const progress = (p, label) => {
      const now = Date.now();
      if (onProgress && now - lastP > 60) { lastP = now; onProgress(p, label); }
    };

    // Normalización de volumen
    let peak = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
    if (peak > 0) { const g = 0.9 / peak; for (let i = 0; i < x.length; i++) x[i] *= g; }

    // Envolvente para dibujar (20 por segundo)
    const wHop = Math.floor(sr / 20);
    const wave = [];
    let wMax = 1e-9;
    for (let i = 0; i < x.length; i += wHop) {
      let s = 0;
      const end = Math.min(x.length, i + wHop);
      for (let j = i; j < end; j++) s += x[j] * x[j];
      const r = Math.sqrt(s / Math.max(1, end - i));
      wave.push(r);
      if (r > wMax) wMax = r;
    }
    for (let i = 0; i < wave.length; i++) wave[i] = Math.min(1, Math.max(0, wave[i] / wMax));

    // ── 1) Pulso: flujo espectral con ventanas cortas ──
    const oN = 1024, oHop = 256;
    const oFft = makeFft(oN);
    const nOn = Math.ceil(x.length / oHop);
    const onset = new Float64Array(nOn);
    const mag = new Float64Array(oN / 2), prev = new Float64Array(oN / 2);
    const maxBin = Math.floor(5000 * oN / sr);
    for (let t = 0; t < nOn; t++) {
      oFft(x, t * oHop - oN / 2, mag);
      let flux = 0;
      for (let k = 1; k < maxBin; k++) {
        const l = Math.log(1 + 1000 * mag[k]);
        const d = l - prev[k];
        if (d > 0) flux += d;
        prev[k] = l;
      }
      onset[t] = flux;
      if (t % 256 === 0) progress(0.25 * t / nOn, 'Buscando el pulso…');
    }
    const fps = sr / oHop;
    // Quitar la media local (≈1 s) y dejar solo lo positivo
    const win = rnd(fps);
    const env = new Float64Array(nOn);
    let acc = 0;
    for (let t = 0; t < nOn; t++) {
      acc += onset[t];
      if (t >= win) acc -= onset[t - win];
      const mean = acc / Math.min(t + 1, win);
      env[t] = Math.max(0, onset[t] - mean);
    }
    let sd = 0;
    for (let t = 0; t < nOn; t++) sd += env[t] * env[t];
    sd = Math.sqrt(sd / Math.max(1, nOn));
    if (sd > 0) for (let t = 0; t < nOn; t++) env[t] /= sd;

    // Tempo por autocorrelación con preferencia por ~105 BPM
    const ac = (lag) => {
      let s = 0;
      for (let t = lag; t < nOn; t++) s += env[t] * env[t - lag];
      return s / (nOn - lag);
    };
    const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 55);
    const acv = new Float64Array(maxLag * 2 + 2);
    for (let l = 1; l < acv.length && l < nOn; l++) acv[l] = ac(l);
    let bestLag = minLag, bestScore = -1;
    for (let l = minLag; l <= maxLag && l < acv.length; l++) {
      const bpmL = 60 * fps / l;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpmL / 105) / 0.75, 2));
      const s = (acv[l] + 0.2 * (2 * l < acv.length ? acv[2 * l] : 0) + 0.35 * acv[rnd(l / 2)]) * prior;
      if (s > bestScore) { bestScore = s; bestLag = l; }
    }
    // Interpolación parabólica del pico
    let lagF = bestLag;
    if (bestLag > 1 && bestLag + 1 < acv.length) {
      const a = acv[bestLag - 1], b = acv[bestLag], c = acv[bestLag + 1];
      const den = a - 2 * b + c;
      if (Math.abs(den) > 1e-12) lagF = bestLag + 0.5 * (a - c) / den;
    }
    let bpm = 60 * fps / lagF;
    progress(0.28, 'Buscando el pulso…');

    // Seguimiento de pulsos (Ellis 2007)
    const period = fps * 60 / bpm;
    const score = new Float64Array(nOn), back = new Int32Array(nOn);
    const tight = 100;
    for (let t = 0; t < nOn; t++) {
      let best = 0, bi = -1;
      const lo = rnd(t - 2 * period), hi = rnd(t - period / 2);
      for (let p = Math.max(0, lo); p <= hi && p < t; p++) {
        const d = Math.log((t - p) / period);
        const v = score[p] - tight * d * d;
        if (bi < 0 || v > best) { best = v; bi = p; }
      }
      score[t] = env[t] + (bi >= 0 ? best : 0);
      back[t] = bi;
    }
    let tEnd = nOn - 1;
    for (let t = Math.max(0, nOn - rnd(period * 1.5)); t < nOn; t++) if (score[t] > score[tEnd]) tEnd = t;
    const beatFrames = [];
    for (let t = tEnd; t >= 0; t = back[t]) {
      beatFrames.push(t);
      if (back[t] < 0) break;
    }
    const beats = beatFrames.reverse().map(f => f / fps);
    if (beats.length >= 8) {
      // BPM final: recta que mejor ajusta los pulsos (índice → tiempo), sin los intervalos raros
      const ivs = [];
      for (let i = 1; i < beats.length; i++) ivs.push(beats[i] - beats[i - 1]);
      ivs.sort((a, b) => a - b);
      const med = ivs[Math.floor(ivs.length / 2)];
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0, idx = 0;
      for (let i = 0; i < beats.length; i++) {
        if (i > 0) idx += Math.min(4, Math.max(1, rnd((beats[i] - beats[i - 1]) / med)));
        sx += idx; sy += beats[i]; sxx += idx * idx; sxy += idx * beats[i]; n++;
      }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      bpm = slope > 0 ? 60 / slope : 60 / med;
    }
    progress(0.32, 'Escuchando la armonía…');

    // ── 2) Cromagrama con ventanas largas ──
    const cN = 4096, cHop = 1024;
    const cFft = makeFft(cN);
    const nC = Math.ceil(x.length / cHop);
    const cmag = new Float64Array(cN / 2);
    const binHz = sr / cN;
    let tuneRe = 0, tuneIm = 0;
    const loBin = Math.floor(60 / binHz), hiBin = Math.ceil(2100 / binHz);
    const nBins = hiBin - loBin;
    const frames = new Array(nC);
    for (let t = 0; t < nC; t++) {
      cFft(x, t * cHop - cN / 2, cmag);
      frames[t] = cmag.slice(loBin, hiBin);
      if (t % 4 === 0) {
        for (let k = loBin + 1; k < hiBin - 1; k++) {
          const a = cmag[k - 1], b = cmag[k], c = cmag[k + 1];
          if (b > a && b > c && b > 0.02) {
            const den = a - 2 * b + c;
            const dk = Math.abs(den) > 1e-12 ? 0.5 * (a - c) / den : 0;
            const hz = (k + dk) * binHz;
            const p = 12 * Math.log2(hz / 440);
            const dev = p - rnd(p);
            tuneRe += b * Math.cos(2 * Math.PI * dev);
            tuneIm += b * Math.sin(2 * Math.PI * dev);
          }
        }
      }
      if (t % 64 === 0) progress(0.32 + 0.38 * t / nC, 'Escuchando la armonía…');
    }
    const tune = Math.atan2(tuneIm, tuneRe) / (2 * Math.PI); // semitonos (−0,5..0,5)

    // Tabla bin → (clase de altura, peso), con la afinación corregida
    const binPc = new Int32Array(nBins), binIsBass = new Uint8Array(nBins), binW = new Float64Array(nBins);
    for (let k = loBin; k < hiBin; k++) {
      const hz = k * binHz;
      const p = 12 * Math.log2(hz / 440) + 69 - tune;
      const n = rnd(p);
      const d = p - n;
      binPc[k - loBin] = mod(n, 12);
      binW[k - loBin] = Math.exp(-d * d / (2 * 0.18 * 0.18));
      binIsBass[k - loBin] = hz < 150 ? 1 : 0;
    }
    const chroma = new Array(nC), bassC = new Array(nC);
    const energy = new Float64Array(nC);
    for (let t = 0; t < nC; t++) {
      const c = new Float64Array(12), b = new Float64Array(12);
      const f = frames[t];
      let e = 0;
      for (let i = 0; i < f.length; i++) {
        const v = Math.sqrt(f[i]) * binW[i];
        e += f[i];
        if (binIsBass[i]) { b[binPc[i]] += v; c[binPc[i]] += v * 0.6; }
        else c[binPc[i]] += v;
      }
      chroma[t] = c; bassC[t] = b; energy[t] = e;
      frames[t] = null;
    }
    progress(0.72, 'Encontrando el tono…');

    // ── 3) Tonalidad (Krumhansl-Kessler) ──
    const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const total = new Float64Array(12);
    for (let t = 0; t < nC; t++) {
      const c = chroma[t];
      let m = 1e-9;
      for (let i = 0; i < 12; i++) if (c[i] > m) m = c[i];
      for (let i = 0; i < 12; i++) total[i] += c[i] / m + bassC[t][i] / (m + 1e-9) * 0.5;
    }
    const corr = (prof, key) => {
      let mx = 0, my = 0;
      for (let i = 0; i < 12; i++) { mx += total[(i + key) % 12]; my += prof[i]; }
      mx /= 12; my /= 12;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < 12; i++) {
        const a = total[(i + key) % 12] - mx, b = prof[i] - my;
        sxy += a * b; sxx += a * a; syy += b * b;
      }
      return sxy / Math.sqrt(sxx * syy + 1e-12);
    };
    let keyPc = 0, isMinor = false, kBest = -2;
    for (let k = 0; k < 12; k++) {
      const a = corr(MAJOR, k), b = corr(MINOR, k);
      if (a > kBest) { kBest = a; keyPc = k; isMinor = false; }
      if (b > kBest) { kBest = b; keyPc = k; isMinor = true; }
    }

    // ── 4) Acordes por pulso ──
    let grid;
    if (beats.length >= 8) grid = beats.slice();
    else { grid = []; for (let t = 0; t < duration; t += 0.5) grid.push(t); }
    if (!grid.length || grid[0] > 0.05) grid.unshift(0);
    if (grid[grid.length - 1] < duration - 0.05) grid.push(duration);
    const frameTime = (t) => (t * cHop) / sr;
    const nB = grid.length - 1;
    const bc = [], bb = [];
    const be = new Float64Array(Math.max(0, nB));
    let eMax = 1e-9;
    for (let i = 0; i < nB; i++) {
      const c = new Float64Array(12), b = new Float64Array(12);
      let cnt = 0, e = 0;
      const t0 = Math.floor(grid[i] * sr / cHop), t1 = Math.max(t0 + 1, Math.ceil(grid[i + 1] * sr / cHop));
      for (let t = t0; t < t1 && t < nC; t++) {
        if (frameTime(t) < grid[i] - 0.05) continue;
        for (let j = 0; j < 12; j++) { c[j] += chroma[t][j]; b[j] += bassC[t][j]; }
        e += energy[t];
        cnt++;
      }
      if (cnt > 0) {
        for (let j = 0; j < 12; j++) { c[j] /= cnt; b[j] /= cnt; }
        e /= cnt;
      }
      bc.push(c); bb.push(b); be[i] = e;
      if (e > eMax) eMax = e;
    }

    // Quitar el «fondo» constante (pads, drones): percentil 15 de cada nota.
    for (const m of [bc, bb]) {
      for (let j = 0; j < 12; j++) {
        const col = [];
        for (let i = 0; i < nB; i++) col.push(m[i][j]);
        col.sort((a, b) => a - b);
        const floor = col.length ? col[Math.floor(col.length * 0.15)] : 0;
        for (let i = 0; i < nB; i++) m[i][j] = Math.max(0, m[i][j] - 0.6 * floor);
      }
    }

    // Plantillas (raíz con algo más de peso)
    const templates = [];
    for (let r = 0; r < 12; r++) {
      for (let q = 0; q < QUALITIES.length; q++) {
        const v = new Float64Array(12);
        const ints = QUALITIES[q][1];
        for (let i = 0; i < ints.length; i++) v[(r + ints[i]) % 12] = i === 0 ? 1.1 : (i === 3 ? 0.8 : 1.0);
        let mean = 0;
        for (let j = 0; j < 12; j++) mean += v[j];
        mean /= 12;
        let n = 0;
        for (let j = 0; j < 12; j++) { v[j] -= mean; n += v[j] * v[j]; }
        n = Math.sqrt(n);
        for (let j = 0; j < 12; j++) v[j] /= n;
        templates.push([r, q, v]);
      }
    }

    // Dos pasadas: acordes con el tono de los perfiles → tono a partir de los acordes → acordes otra vez.
    function decode(keyPc, isMinor) {
      const scale = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
      const keyWeight = (r, q) => {
        const ints = QUALITIES[q][1];
        if (ints.every(i => scale.includes(mod(r + i - keyPc, 12)))) return 1.0;
        const rel = mod(r - keyPc, 12);
        const triadMajor = q === 0, triadMinor = q === 1;
        if (!isMinor && ((rel === 10 && triadMajor) || (rel === 5 && triadMinor) || (rel === 2 && triadMajor) || (rel === 4 && triadMajor) || (rel === 8 && triadMajor))) return 0.7;
        if (isMinor && ((rel === 7 && triadMajor) || (rel === 5 && triadMajor))) return 0.75;
        return 0.42;
      };
      const kw = templates.map(([r, q]) => Math.log(keyWeight(r, q)) * 3.0);

      const nS = templates.length + 1; // + «sin acorde»
      const emit = new Array(nB);
      for (let i = 0; i < nB; i++) {
        const raw = bc[i];
        let mean = 0;
        for (let j = 0; j < 12; j++) mean += raw[j];
        mean /= 12;
        const c = new Float64Array(12);
        let n = 0;
        for (let j = 0; j < 12; j++) { c[j] = raw[j] - mean; n += c[j] * c[j]; }
        n = Math.sqrt(n) + 1e-9;
        const silent = be[i] < eMax * 0.04;
        const bq = bb[i];
        let bmax = 1e-9;
        for (let j = 0; j < 12; j++) if (bq[j] > bmax) bmax = bq[j];
        const bnorm = new Float64Array(12);
        for (let j = 0; j < 12; j++) bnorm[j] = Math.pow(bq[j] / bmax, 2);
        const row = new Float64Array(nS);
        for (let s = 0; s < templates.length; s++) {
          const [r, q, v] = templates[s];
          let dot = 0;
          for (let j = 0; j < 12; j++) dot += c[j] * v[j];
          const cs = dot / n - QUALITIES[q][2];
          const ints = QUALITIES[q][1];
          const bassRoot = bnorm[r], bassTone = Math.max(bnorm[(r + ints[1]) % 12], bnorm[(r + ints[2]) % 12]);
          row[s] = 40 * cs + 10 * bassRoot + 2.5 * bassTone + kw[s] + (silent ? -8 : 0);
        }
        row[templates.length] = silent ? 10 : 40 * 0.3 + 3;
        emit[i] = row;
      }

      // Viterbi: quedarse es mucho más probable que cambiar
      const stay = 0, change = -4.5;
      let dp = nB ? Float64Array.from(emit[0]) : new Float64Array(nS);
      const bp = new Array(nB);
      for (let i = 1; i < nB; i++) {
        let bestPrev = 0;
        for (let s = 1; s < nS; s++) if (dp[s] > dp[bestPrev]) bestPrev = s;
        const nd = new Float64Array(nS), bpi = new Int32Array(nS);
        for (let s = 0; s < nS; s++) {
          const viaStay = dp[s] + stay, viaChange = dp[bestPrev] + change;
          if (viaStay >= viaChange || bestPrev === s) { nd[s] = viaStay + emit[i][s]; bpi[s] = s; }
          else { nd[s] = viaChange + emit[i][s]; bpi[s] = bestPrev; }
        }
        bp[i] = bpi;
        dp = nd;
      }
      const path = new Int32Array(Math.max(0, nB));
      if (nB > 0) {
        let s = 0;
        for (let k = 1; k < nS; k++) if (dp[k] > dp[s]) s = k;
        for (let i = nB - 1; i >= 0; i--) {
          path[i] = s;
          if (i > 0) s = bp[i][s];
        }
      }
      return path;
    }

    let path = decode(keyPc, isMinor);
    progress(0.88, 'Revisando el tono…');
    {
      const dur = new Float64Array(24); // duración de cada acorde mayor (0–11) y menor (12–23)
      let lastChord = -1, firstChord = -1;
      for (let i = 0; i < nB; i++) {
        const st = path[i];
        if (st >= templates.length) continue;
        const [r, q] = templates[st];
        const minorQ = QUALITIES[q][1][1] === 3;
        dur[r + (minorQ ? 12 : 0)] += grid[i + 1] - grid[i];
        lastChord = r + (minorQ ? 12 : 0);
        if (firstChord < 0) firstChord = lastChord;
      }
      let bestK = keyPc, bestM = isMinor, bestS = -1e9;
      const DEG_MIN = [[0, true], [3, false], [5, true], [7, true], [8, false], [10, false]];
      const DEG_MAJ = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]];
      for (let k = 0; k < 12; k++) {
        for (const m of [false, true]) {
          let sc = 0;
          for (const [d, mi] of (m ? DEG_MIN : DEG_MAJ)) sc += dur[(k + d) % 12 + (mi ? 12 : 0)];
          const tonic = (k % 12) + (m ? 12 : 0);
          sc += 0.6 * dur[tonic] + (lastChord === tonic ? 0.12 * duration : 0) + (firstChord === tonic ? 0.12 * duration : 0);
          if (m) sc -= 0.12 * duration;                       // en alabanza casi todo es mayor
          if (k === keyPc && m === isMinor) sc += 0.1 * duration; // se respeta el tono de los perfiles
          if (sc > bestS) { bestS = sc; bestK = k; bestM = m; }
        }
      }
      if (bestK !== keyPc || bestM !== isMinor) {
        keyPc = bestK; isMinor = bestM;
        path = decode(keyPc, isMinor);
      }
    }
    progress(0.93, 'Ordenando los acordes…');

    // Segmentos + bajo (acordes con barra)
    const segments = [];
    let i0 = 0;
    for (let i = 1; i <= nB; i++) {
      if (i < nB && path[i] === path[i0]) continue;
      const s = path[i0];
      let chord;
      if (s >= templates.length) chord = { r: -1, q: 0, b: -1 };
      else {
        const [r, q] = templates[s];
        const bass = new Float64Array(12);
        for (let k = i0; k < i; k++) for (let j = 0; j < 12; j++) bass[j] += bb[k][j];
        let bp2 = 0;
        for (let j = 1; j < 12; j++) if (bass[j] > bass[bp2]) bp2 = j;
        const tones = QUALITIES[q][1].map(it => (r + it) % 12);
        const isSlash = bp2 !== r && tones.includes(bp2) && bass[bp2] > bass[r] * 1.15;
        chord = { r, q, b: isSlash ? bp2 : -1 };
      }
      segments.push({ s: grid[i0], e: grid[i], ...chord });
      i0 = i;
    }
    // Une segmentos vecinos iguales
    const merged = [];
    for (const s of segments) {
      const last = merged[merged.length - 1];
      if (last && sameChord(last, s)) last.e = s.e;
      else merged.push({ ...s });
    }
    // Acordes de menos de pulso y medio casi siempre son ruido: se funden con el anterior
    const minDur = 1.5 * 60 / bpm;
    let changed = true;
    while (changed && merged.length > 2) {
      changed = false;
      for (let k = 1; k < merged.length; k++) {
        const sg = merged[k];
        if (sg.e - sg.s < minDur && sg.r >= 0) {
          merged[k - 1].e = sg.e;
          merged.splice(k, 1);
          if (k < merged.length && sameChord(merged[k], merged[k - 1])) {
            merged[k - 1].e = merged[k].e;
            merged.splice(k, 1);
          }
          changed = true;
          break;
        }
      }
    }

    // Pulso fuerte: la fase (0–3) donde más cambian los acordes
    const changeCount = [0, 0, 0, 0];
    for (const s of merged.slice(1)) {
      let bi = 0, bd = 1e9;
      for (let k = 0; k < beats.length; k++) {
        const d = Math.abs(beats[k] - s.s);
        if (d < bd) { bd = d; bi = k; }
      }
      if (bd < 0.15) changeCount[bi % 4]++;
    }
    let downbeat = 0;
    for (let k = 1; k < 4; k++) if (changeCount[k] > changeCount[downbeat]) downbeat = k;

    if (onProgress) onProgress(1, 'Listo');
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      v: 1, d: duration, bpm, k: keyPc, m: isMinor, t: tune * 100, db: downbeat,
      beats: beats.map(r3),
      seg: merged.map(s => ({ s: r3(s.s), e: r3(s.e), r: s.r, q: s.q, b: s.b })),
      w: wave.map(v => Math.round(v * 100)),
    };
  }

  /**
   * Reduce audio a mono SR Hz promediando (filtra los agudos que sobran). Sirve
   * para el micrófono en vivo (48 kHz típicos → 11 025 Hz).
   */
  function makeResampler(inRate) {
    const ratio = inRate / SR;
    let next = ratio, acc = 0, cnt = 0, frame = 0;
    return function push(input, out) {
      for (let i = 0; i < input.length; i++) {
        acc += input[i]; cnt++; frame++;
        if (frame >= next) { out.push(acc / cnt); acc = 0; cnt = 0; next += ratio; }
      }
    };
  }

  return { SR, QUALITIES, LETTERS, SOLFEGE, analyzeChords, chordName, keyName, pitchClasses, makeResampler };
}

const E = chordEngineFactory();
export const CHORD_SR = E.SR;
export const CHORD_QUALITIES = E.QUALITIES;
export const analyzeChords = E.analyzeChords;
export const chordName = E.chordName;
export const keyName = E.keyName;
export const pitchClasses = E.pitchClasses;
export const makeResampler = E.makeResampler;
