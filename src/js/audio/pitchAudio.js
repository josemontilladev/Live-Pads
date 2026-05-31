// ─────────────────────────────────────────────────────────────────────────
// PitchAudio — fuente de audio Web Audio con desplazamiento de tono real
// (sin alterar el tempo) mediante SoundTouchJS PitchShifter.
//
// Imita la API esencial de HTMLAudioElement (`src`, `play()`, `pause()`,
// `currentTime`, `duration`, `volume`, `loop`, `paused`, `ontimeupdate`,
// `onended`, `onerror`) para que el track player no necesite cambiar mucho.
// Añade `pitchSemitones` para subir/bajar tono sin cambiar la velocidad.
//
// Conecta su salida vía `node.output` a la siguiente etapa del grafo
// (típicamente un panner). No reemplaza el grafo: lo extiende.
// ─────────────────────────────────────────────────────────────────────────

import { PitchShifter } from '../../vendor/soundtouchjs.js';

export class PitchAudio extends EventTarget {
  constructor(audioCtx) {
    super();
    this._ctx = audioCtx;
    this._buffer = null;            // AudioBuffer decodificado
    this._shifter = null;            // PitchShifter activo (durante play)
    this._gain = audioCtx.createGain(); // volumen
    this._gain.gain.value = 1;
    this._currentTime = 0;           // segundos
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
  }

  // Punto de conexión hacia el siguiente nodo (panner, destino, etc.)
  get output() { return this._gain; }

  // ── HTMLAudioElement-compatible API ──────────────────────────────────────
  get src() { return this._src; }
  set src(url) {
    if (url === this._src) return;
    this._teardownShifter();
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
      // Si el src cambió mientras decodificábamos, no apliques.
      if (this._src !== url) return;
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
    this._currentTime = Number.isFinite(d)
      ? Math.max(0, Math.min(t, d))
      : Math.max(0, t);
    if (this._playing) {
      // Reposicionar = reconstruir el shifter en el punto nuevo
      this._teardownShifter();
      this._startShifter();
    }
  }

  get volume() { return this._volume; }
  set volume(v) {
    const vv = Math.max(0, Math.min(1, Number(v) || 0));
    this._volume = vv;
    try { this._gain.gain.value = vv; } catch (_) {}
  }

  get loop() { return this._loop; }
  set loop(v) { this._loop = !!v; }

  get paused() { return !this._playing; }

  // ── Pitch shifting ────────────────────────────────────────────────────────
  get pitchSemitones() { return this._pitchSemitones; }
  set pitchSemitones(n) {
    const s = Number(n) || 0;
    this._pitchSemitones = s;
    if (this._shifter) {
      try { this._shifter.pitchSemitones = s; } catch (_) {}
    }
  }

  async play() {
    if (!this._buffer) {
      if (this._loadPromise) {
        try { await this._loadPromise; } catch (_) {}
      }
      if (!this._buffer) throw (this._loadError || new Error('Audio no cargado'));
    }
    if (this._playing) return;
    this._playing = true;
    this._startShifter();
    this.dispatchEvent(new Event('play'));
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    this._teardownShifter();
  }

  _startShifter() {
    if (!this._buffer) return;
    const shifter = new PitchShifter(this._ctx, this._buffer, 4096);
    try { shifter.tempo = 1; } catch (_) {}
    try { shifter.pitchSemitones = this._pitchSemitones; } catch (_) {}
    // Posición inicial
    const d = this._buffer.duration || 0;
    if (d > 0 && this._currentTime > 0) {
      try { shifter.percentagePlayed = (this._currentTime / d) * 100; } catch (_) {}
    }
    shifter.connect(this._gain);
    try {
      shifter.on('play', (data) => {
        if (!this._playing) return;
        if (data && typeof data.timePlayed === 'number') {
          this._currentTime = data.timePlayed;
        }
        if (typeof this.ontimeupdate === 'function') {
          try { this.ontimeupdate(); } catch (_) {}
        }
        this.dispatchEvent(new Event('timeupdate'));
      });
      shifter.on('end', () => {
        if (this._loop && this._buffer) {
          this._teardownShifter();
          this._currentTime = 0;
          if (this._playing) this._startShifter();
        } else {
          this._playing = false;
          this._currentTime = this._buffer ? this._buffer.duration : 0;
          this._teardownShifter();
          if (typeof this.onended === 'function') {
            try { this.onended(); } catch (_) {}
          }
          this.dispatchEvent(new Event('ended'));
        }
      });
    } catch (_) {}
    this._shifter = shifter;
  }

  _teardownShifter() {
    if (this._shifter) {
      try { this._shifter.disconnect(); } catch (_) {}
      this._shifter = null;
    }
  }
}
