// ─────────────────────────────────────────────────────────────────────────
// PitchAudio — fuente de audio Web Audio con desplazamiento de tono real
// (sin alterar el tempo).
//
// Imita la API esencial de HTMLAudioElement (`src`, `play()`, `pause()`,
// `currentTime`, `duration`, `volume`, `loop`, `paused`, `ontimeupdate`,
// `onended`, `onerror`) para que el track player no necesite cambiar mucho.
// Añade `pitchSemitones` para subir/bajar tono sin cambiar la velocidad.
//
// Arquitectura:
//   - La fuente es SIEMPRE un AudioBufferSourceNode nativo, que lleva la
//     posición/seek/loop/fin (bit-perfect, loop sin costuras, poca CPU).
//   - Con tono = 0 (caso normal): source → gain → output. Sin procesamiento.
//   - Con tono ≠ 0: se inserta un SoundTouchNode (AudioWorklet) entre medio:
//     source → SoundTouchNode → gain. El pitch-shift corre en el HILO DE AUDIO
//     (no en el main thread), así que un render pesado de UI no lo glitchea.
//
// Conecta su salida vía `node.output` a la siguiente etapa del grafo
// (típicamente un panner). No reemplaza el grafo: lo extiende.
// ─────────────────────────────────────────────────────────────────────────

import { SoundTouchNode } from '../../vendor/soundtouch-worklet/SoundTouchNode.js';

// ── Cambio de tono de alta calidad (Signalsmith Stretch, WASM) ──────────────
// Suena mucho más natural que SoundTouch al subir o bajar 3-4 semitonos y conserva
// el timbre de las voces (formantes). Se usa en modo «entrada en vivo»: ocupa el
// mismo sitio que el procesador de siempre (source → procesador → volumen), así la
// posición, los bucles y el final no cambian. Si no carga, se usa SoundTouch.
// Ajustes → Audio → «Cambio de tono de alta calidad» (activado por defecto).
// Lectura + decodificación de un archivo de audio (lo más lento de abrir una pista).
async function readAndDecode(ctx, url) {
  const isLocal = /^(livepads:|file:)/i.test(url) || /^[a-zA-Z]:\\/.test(url);
  let arr;
  // En Electron, fetch contra esquemas privilegiados (livepads://) suele
  // fallar cross-origin. El proceso principal lee el archivo y nos devuelve
  // el ArrayBuffer crudo (rápido y confiable). Para http(s)/blob seguimos
  // con fetch normal.
  if (isLocal && window.electronAPI && typeof window.electronAPI.readAudioFile === 'function') {
    arr = await window.electronAPI.readAudioFile(url);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    arr = await res.arrayBuffer();
  }
  return ctx.decodeAudioData(arr);
}

// Pista decodificada POR ADELANTADO (la siguiente de un medley): al abrirla no hay
// que esperar a leer y decodificar, suena al instante. Solo UNA a la vez (una pista
// de 5 min ocupa ~100 MB decodificada) y se suelta en cuanto se usa.
let _pre = null;   // { ctx, url, promise }
export function preloadAudio(ctx, url) {
  if (!ctx || !url) return;
  if (_pre && _pre.ctx === ctx && _pre.url === url) return;
  const promise = readAndDecode(ctx, url);
  promise.catch(() => { if (_pre && _pre.promise === promise) _pre = null; });
  _pre = { ctx, url, promise };
}
function takePreloaded(ctx, url) {
  if (!_pre || _pre.ctx !== ctx || _pre.url !== url) return null;
  const p = _pre.promise; _pre = null;
  return p;
}

export const PITCH_HQ_KEY = 'livepads.pitchHQ';
export const pitchHQOn = () => { try { return localStorage.getItem(PITCH_HQ_KEY) !== '0'; } catch (_) { return true; } };
let _hqFactory = null;
function hqFactory() {
  if (!_hqFactory) _hqFactory = import('../../vendor/signalsmith-stretch/SignalsmithStretch.mjs').then((m) => m.default).catch(() => null);
  return _hqFactory;
}
/** Nodo Signalsmith listo para un contexto, o null (se crea en segundo plano). */
export async function createHQNode(ctx) {
  const f = await hqFactory();
  if (!f) return null;
  try { return await f(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); } catch (_) { return null; }
}

// Registro del processor del worklet, una vez por AudioContext. Carga el código
// del processor (leído por IPC) como Blob URL — robusto en dev y en asar.
const _workletReg = new WeakMap(); // ctx -> { ready:boolean, promise:Promise }
function ensureWorklet(ctx) {
  let reg = _workletReg.get(ctx);
  if (reg) return reg;
  reg = { ready: false, promise: null };
  reg.promise = (async () => {
    let url = null;
    try {
      const code = await window.electronAPI?.getSoundtouchWorklet?.();
      if (code) url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    } catch (_) {}
    // Fallback (dev): ruta relativa a index.html.
    if (!url) url = 'vendor/soundtouch-worklet/soundtouch-processor.js';
    await SoundTouchNode.register(ctx, url);
    reg.ready = true;
  })();
  reg.promise.catch((e) => { console.warn('AudioWorklet SoundTouch no disponible:', e && e.message || e); });
  _workletReg.set(ctx, reg);
  return reg;
}

export class PitchAudio extends EventTarget {
  constructor(audioCtx) {
    super();
    this._ctx = audioCtx;
    this._buffer = null;            // AudioBuffer decodificado
    this._gain = audioCtx.createGain(); // volumen / salida
    this._gain.gain.value = 1;

    this._source = null;            // AudioBufferSourceNode (durante play)
    this._stNode = null;            // SoundTouchNode insertado solo si pitch≠0
    this._startCtx = 0;             // ctx.currentTime al arrancar la fuente
    this._startOffset = 0;          // offset (seg) desde donde arrancó
    this._raf = null;               // rAF que dirige ontimeupdate
    this._rerouteScheduled = false;

    this._currentTime = 0;
    this._playing = false;
    this._loop = false;
    this._pitchSemitones = 0;
    this._rate = 1;                 // velocidad (modo práctica), tono intacto
    this._loopA = null;             // tramo A–B (segundos) para repetir
    this._loopB = null;
    this._volume = 1;
    this._src = '';
    this._loadPromise = null;
    this._loadError = null;
    // Compat con la API de HTMLAudioElement
    this.ontimeupdate = null;
    this.onended = null;
    this.onerror = null;

    // Registrar el worklet de antemano para que esté listo en cuanto se
    // transponga (la registración es asíncrona).
    ensureWorklet(audioCtx);
  }

  // Punto de conexión hacia el siguiente nodo (panner, destino, etc.)
  get output() { return this._gain; }

  /** AudioBuffer decodificado (para dibujar la onda); null hasta que cargue. */
  get buffer() { return this._buffer; }

  // ── HTMLAudioElement-compatible API ──────────────────────────────────────
  get src() { return this._src; }
  set src(url) {
    if (url === this._src) return;
    this._stop();
    this._playing = false;
    this._currentTime = 0;
    this._buffer = null;
    this._loadError = null;
    this._src = url || '';
    if (!url) { this._loadPromise = null; return; }
    this._loadPromise = this._load(url);
  }
  load() { /* compat: el setter de src ya dispara la carga */ }

  /** Usa un AudioBuffer ya en memoria (p. ej. una voz generada) en lugar de una URL. */
  setBuffer(buf, id = 'memoria') {
    this._stop();
    this._playing = false;
    this._currentTime = 0;
    this._src = `buffer:${id}`;
    this._buffer = buf || null;
    this._loadError = null;
    this._loadPromise = Promise.resolve();
  }

  async _load(url) {
    try {
      let buf = null;
      const pre = takePreloaded(this._ctx, url);
      if (pre) { try { buf = await pre; } catch (_) { buf = null; } }
      if (!buf) buf = await readAndDecode(this._ctx, url);
      if (this._src !== url) return; // el src cambió mientras decodificábamos
      this._buffer = buf;
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplay'));
    } catch (e) {
      this._loadError = e;
      if (typeof this.onerror === 'function') { try { this.onerror(e); } catch (_) {} }
      this.dispatchEvent(new Event('error'));
    }
  }

  get duration() { return this._buffer ? this._buffer.duration : NaN; }
  get currentTime() { return this._currentTime; }
  set currentTime(t) {
    const d = this.duration;
    this._currentTime = Number.isFinite(d) ? Math.max(0, Math.min(t, d)) : Math.max(0, t);
    if (this._playing) {
      // Reposicionar = reiniciar la fuente en el punto nuevo.
      this._stop();
      this._start();
    }
    this.dispatchEvent(new Event('seeked'));   // como un <audio>: lo que sigue a la pista se pone al día
  }

  get volume() { return this._volume; }
  set volume(v) {
    const vv = Math.max(0, Math.min(1, Number(v) || 0));
    this._volume = vv;
    try { this._gain.gain.value = vv; } catch (_) {}
  }

  get loop() { return this._loop; }
  set loop(v) {
    this._loop = !!v;
    if (this._source) this._applyLoopToSource(this._source);
  }

  // ── Práctica: velocidad sin cambiar el tono + tramo A–B en bucle ──────────
  get playbackRate() { return this._rate; }
  set playbackRate(r) {
    const v = Math.max(0.25, Math.min(2, Number(r) || 1));
    if (v === this._rate) return;
    const wasNeed = this._needsST();
    if (this._playing && this._source) {
      // Reanclar el reloj en la posición actual para que el tiempo no salte.
      this._startOffset = this._currentTime || 0;
      this._startCtx = this._ctx.currentTime;
      try { this._source.playbackRate.value = v; } catch (_) {}
    }
    this._rate = v;
    if (!this._playing) return;
    if (this._needsST() === wasNeed && this._stNode) { this._pushStParams(); return; }
    this._rerouteSmooth();
  }

  get loopRegion() { return this._loopA == null ? null : { a: this._loopA, b: this._loopB }; }
  /** Repite el tramo [a,b] (segundos) sin cortes. null/clear para quitarlo. */
  setLoopRegion(a, b) {
    const d = this.duration;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 0.2) { this.clearLoopRegion(); return; }
    this._loopA = Math.max(0, a);
    this._loopB = Number.isFinite(d) ? Math.min(d, b) : b;
    if (this._source) {
      // Reanclar para que el cálculo de posición use el tramo desde ya.
      if (this._playing) { this._startOffset = this._currentTime || 0; this._startCtx = this._ctx.currentTime; }
      this._applyLoopToSource(this._source);
    }
  }
  clearLoopRegion() {
    const had = this._loopA != null;
    this._loopA = this._loopB = null;
    if (this._source) {
      if (had && this._playing) { this._startOffset = this._currentTime || 0; this._startCtx = this._ctx.currentTime; }
      this._applyLoopToSource(this._source);
    }
  }
  _applyLoopToSource(src) {
    try {
      if (this._loopA != null) {
        src.loopStart = this._loopA;
        src.loopEnd = this._loopB;
        src.loop = true;
      } else {
        src.loopStart = 0;
        src.loopEnd = 0;
        src.loop = this._loop;
      }
    } catch (_) {}
  }
  _needsST() { return this._pitchSemitones !== 0 || this._rate !== 1; }
  _pushStParams() {
    const st = this._stNode;
    if (!st) return;
    if (st._hq) {
      // La velocidad la lleva el source (y sube/baja el tono): aquí se compensa y se suma el tono pedido.
      const semis = this._pitchSemitones - 12 * Math.log2(this._rate || 1);
      try { st.schedule({ active: true, semitones: semis, formantCompensation: Math.abs(semis) >= 0.5, formantBaseHz: 0 }); } catch (_) {}
      return;
    }
    try { st.pitchSemitones.value = this._pitchSemitones; } catch (_) {}
    try { const p = st.parameters.get('playbackRate'); if (p) p.value = this._rate; } catch (_) {}
  }

  get paused() { return !this._playing; }

  // ── Pitch ─────────────────────────────────────────────────────────────────
  get pitchSemitones() { return this._pitchSemitones; }
  set pitchSemitones(n) {
    const s = Number(n) || 0;
    const wasNeed = this._needsST();
    this._pitchSemitones = s;
    if (!this._playing) return;
    if (this._needsST() === wasNeed && this._stNode) {
      // Sigue necesitando el procesador: solo actualizar los parámetros, sin re-rutear
      // (evita un click por desconectar/reconectar).
      this._pushStParams();
      return;
    }
    this._rerouteSmooth();
  }

  // Cambia la topología (inserta/quita el SoundTouchNode) con un micro-fade de ~12 ms
  // a ambos lados: inaudible como fade, mata el pop del re-ruteo en seco.
  _rerouteSmooth() {
    const g = this._gain && this._gain.gain;
    if (g && this._ctx) {
      const now = this._ctx.currentTime;
      const v = g.value;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(v, now);
        g.linearRampToValueAtTime(0.0001, now + 0.012);
      } catch (_) {}
      setTimeout(() => {
        this._routeOutput();
        try {
          const t = this._ctx.currentTime;
          g.cancelScheduledValues(t);
          g.setValueAtTime(0.0001, t);
          g.linearRampToValueAtTime(v, t + 0.012);
        } catch (_) {}
      }, 15);
    } else {
      this._routeOutput();
    }
  }

  async play() {
    if (!this._buffer) {
      if (this._loadPromise) { try { await this._loadPromise; } catch (_) {} }
      if (!this._buffer) throw (this._loadError || new Error('Audio no cargado'));
    }
    if (this._playing) return;
    this._playing = true;
    this._start();
    this.dispatchEvent(new Event('play'));
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    this._stop();
    // Emitir 'pause' como un <audio> real: la UI (icono play/pause) escucha este
    // evento. Sin esto el botón quedaba "pillado" en el icono de pausa.
    this.dispatchEvent(new Event('pause'));
  }

  // ── Motor de reproducción (source nativo + SoundTouchNode opcional) ────────
  _start() {
    if (!this._buffer) return;
    const src = this._ctx.createBufferSource();
    src.buffer = this._buffer;
    try { src.playbackRate.value = this._rate; } catch (_) {}
    this._applyLoopToSource(src);
    this._source = src;
    this._startCtx = this._ctx.currentTime;
    this._startOffset = this._currentTime || 0;
    // Con un tramo A–B activo, si se arranca pasado B se entra por A.
    if (this._loopA != null && this._startOffset >= this._loopB) this._startOffset = this._loopA;
    src.onended = () => {
      if (src !== this._source) return;        // quedó obsoleto (seek/stop)
      // Con loop nativo el source no dispara 'ended'; esto solo corre al final real.
      this._playing = false;
      this._currentTime = this._buffer ? this._buffer.duration : 0;
      this._stopTimer();
      this._dropStNode();
      this._source = null;
      if (typeof this.onended === 'function') { try { this.onended(); } catch (_) {} }
      this.dispatchEvent(new Event('ended'));
    };
    this._routeOutput();
    try { src.start(0, this._startOffset); } catch (_) { try { src.start(0); } catch (_) {} }
    this._startTimer();
  }

  _stop() {
    this._stopTimer();
    if (this._source) {
      try { this._source.onended = null; } catch (_) {}
      try { this._source.stop(); } catch (_) {}
      try { this._source.disconnect(); } catch (_) {}
      this._source = null;
    }
    this._dropStNode();
  }

  // Conecta source → [SoundTouchNode si pitch≠0] → gain. Si el worklet aún no
  // está listo, rutea directo (sin pitch) y reprograma el ruteo al estar listo.
  _routeOutput() {
    if (!this._source) return;
    try { this._source.disconnect(); } catch (_) {}
    if (this._needsST()) {
      const st = this._ensureStNode();
      if (st) {
        try { st.disconnect(); } catch (_) {}
        this._source.connect(st);
        st.connect(this._gain);
        this._pushStParams();
        return;
      }
      this._scheduleReroute(); // worklet no listo aún → re-rutear cuando lo esté
    }
    // bypass (tono 0, o worklet no disponible todavía)
    this._dropStNode();
    this._source.connect(this._gain);
  }

  _ensureStNode() {
    if (this._stNode) return this._stNode;
    // Alta calidad: si el nodo Signalsmith ya está creado, se usa; si no, se pide (y mientras, SoundTouch).
    if (pitchHQOn()) {
      if (this._hqNode) { this._stNode = this._hqNode; return this._stNode; }
      if (!this._hqPending && !this._hqFailed) {
        this._hqPending = true;
        createHQNode(this._ctx).then((n) => {
          this._hqPending = false;
          if (!n) { this._hqFailed = true; return; }
          n._hq = true;
          this._hqNode = n;
          // Si ya sonaba con SoundTouch, se pasa al de alta calidad sin corte.
          if (this._playing && this._needsST() && this._stNode && !this._stNode._hq) { this._dropStNode(); this._rerouteSmooth(); }
        });
      }
    }
    const reg = _workletReg.get(this._ctx);
    if (reg && reg.ready) {
      try { this._stNode = new SoundTouchNode({ context: this._ctx }); } catch (_) { this._stNode = null; }
    }
    return this._stNode;
  }

  _dropStNode() {
    if (this._stNode) {
      try { this._stNode.disconnect(); } catch (_) {}
      // El de alta calidad se guarda (crearlo cuesta): solo se pausa.
      if (this._stNode._hq) { try { this._stNode.schedule({ active: false }); } catch (_) {} }
      this._stNode = null;
    }
  }

  _scheduleReroute() {
    if (this._rerouteScheduled) return;
    this._rerouteScheduled = true;
    const reg = _workletReg.get(this._ctx) || ensureWorklet(this._ctx);
    reg.promise.then(() => {
      this._rerouteScheduled = false;
      if (this._playing && this._needsST()) this._routeOutput();
    }).catch(() => { this._rerouteScheduled = false; });
  }

  // Dirige ontimeupdate desde ctx.currentTime (el source nativo no emite tiempo).
  // Calcula la posición cada frame pero emite ~10/seg para no recargar el scrubber.
  _startTimer() {
    let lastEmit = 0;
    const tick = () => {
      if (!this._source) return;
      let t = this._startOffset + (this._ctx.currentTime - this._startCtx) * this._rate;
      const dur = this._buffer ? this._buffer.duration : 0;
      if (this._loopA != null && t >= this._loopA) {
        const len = Math.max(0.05, this._loopB - this._loopA);
        t = this._loopA + ((t - this._loopA) % len);
      } else if (this._loop && dur > 0) t = t % dur;
      else if (dur > 0 && t > dur) t = dur;
      this._currentTime = t;
      const now = this._ctx.currentTime;
      if (now - lastEmit >= 0.1) {
        lastEmit = now;
        if (typeof this.ontimeupdate === 'function') { try { this.ontimeupdate(); } catch (_) {} }
        this.dispatchEvent(new Event('timeupdate'));
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopTimer() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }
}
