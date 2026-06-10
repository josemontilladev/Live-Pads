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

  async _load(url) {
    try {
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
      const buf = await this._ctx.decodeAudioData(arr);
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
    if (this._source) { try { this._source.loop = this._loop; } catch (_) {} }
  }

  get paused() { return !this._playing; }

  // ── Pitch ─────────────────────────────────────────────────────────────────
  get pitchSemitones() { return this._pitchSemitones; }
  set pitchSemitones(n) {
    const s = Number(n) || 0;
    const was = this._pitchSemitones;
    this._pitchSemitones = s;
    if (!this._playing) return;
    const crossing = (was === 0) !== (s === 0);
    if (!crossing && s !== 0 && this._stNode) {
      // Sigue transponiendo (≠0 → ≠0): solo actualizar el param, sin re-rutear
      // (evita un click por desconectar/reconectar).
      try { this._stNode.pitchSemitones.value = s; } catch (_) {}
      return;
    }
    // Cruza el 0 (inserta/quita el SoundTouchNode) → re-rutear. El cambio de
    // topología en seco metía un click audible: micro-fade del gain (~12ms)
    // a ambos lados del re-ruteo — inaudible como fade, mata el pop.
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
  }

  // ── Motor de reproducción (source nativo + SoundTouchNode opcional) ────────
  _start() {
    if (!this._buffer) return;
    const src = this._ctx.createBufferSource();
    src.buffer = this._buffer;
    src.loop = this._loop;
    this._source = src;
    this._startCtx = this._ctx.currentTime;
    this._startOffset = this._currentTime || 0;
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
    if (this._pitchSemitones !== 0) {
      const st = this._ensureStNode();
      if (st) {
        try { st.disconnect(); } catch (_) {}
        this._source.connect(st);
        st.connect(this._gain);
        try { st.pitchSemitones.value = this._pitchSemitones; } catch (_) {}
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
    const reg = _workletReg.get(this._ctx);
    if (reg && reg.ready) {
      try { this._stNode = new SoundTouchNode({ context: this._ctx }); } catch (_) { this._stNode = null; }
    }
    return this._stNode;
  }

  _dropStNode() {
    if (this._stNode) {
      try { this._stNode.disconnect(); } catch (_) {}
      this._stNode = null;
    }
  }

  _scheduleReroute() {
    if (this._rerouteScheduled) return;
    this._rerouteScheduled = true;
    const reg = _workletReg.get(this._ctx) || ensureWorklet(this._ctx);
    reg.promise.then(() => {
      this._rerouteScheduled = false;
      if (this._playing && this._pitchSemitones !== 0) this._routeOutput();
    }).catch(() => { this._rerouteScheduled = false; });
  }

  // Dirige ontimeupdate desde ctx.currentTime (el source nativo no emite tiempo).
  // Calcula la posición cada frame pero emite ~10/seg para no recargar el scrubber.
  _startTimer() {
    let lastEmit = 0;
    const tick = () => {
      if (!this._source) return;
      let t = this._startOffset + (this._ctx.currentTime - this._startCtx);
      const dur = this._buffer ? this._buffer.duration : 0;
      if (this._loop && dur > 0) t = t % dur;
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
