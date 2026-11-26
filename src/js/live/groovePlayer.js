// ─────────────────────────────────────────────────────────────────────────
// Reproductor de la Caja de ritmos. Programa las muestras con el reloj de
// audio (mira 0,15 s por delante), así el tempo es exacto.
//  · Tempo: el del metrónomo de LivePads (sigue sus cambios). Si está sonando,
//    el ritmo arranca en su siguiente compás y se realinea con sus pulsos.
//  · Sale por el canal «Batería» del mezclador (más su propio volumen).
//  · Hi-hat abierto se corta con el cerrado; crash al entrar al coro/puente o tras el redoble.
//  · position(): sección y paso que suenan AHORA (para dibujar el cursor).
// ─────────────────────────────────────────────────────────────────────────

import { hitsAt, steps, stepDur, swingOffset, startState, queuePart, barEnd } from './grooveCore.js';
import { bassMidi, bassSample, bassHit } from './bassCore.js';
import { arrangementPart, arrangementEntry } from './drumTranscribeCore.js';

const LOOKAHEAD = 0.15, TICK = 25;
const cache = new Map(); // archivo → Promise<AudioBuffer>

export class GroovePlayer {
  constructor({ getEngine, getMetro, onState }) {
    this.getEngine = getEngine; this.getMetro = getMetro; this.onState = onState || (() => {});
    this.groove = null; this.volume = 0.8; this.humanize = true;
    // Crash automático al cambiar de sección: apagado por defecto (sonaba donde no tocaba);
    // se activa en la caja («Crash al cambiar de sección»).
    this.crashOnChange = false;
    // Reloj externo opcional: { beatAt(t), nextDownbeat(t) } en tiempo del motor (lo pone grooveFollow).
    this.clock = null; this._beatDur = 0;
    // Bajo automático: { on, vol, chordAt(t) → clase de altura | null } (lo configura grooveUI).
    this.bass = { on: false, vol: 0.8, chordAt: null }; this._bassPc = null; this._bassVoice = null;
    this.out = null; this.timer = null; this.st = null; this.step = 0; this.nextTime = 0; this.openHat = null;
    this.pending = []; this.timeline = []; this.buffers = new Map();
    // Arreglo (ritmo sacado de una grabación): el orden de secciones de la grabación, compás a
    // compás. Con followArrangement, la caja lo sigue sola de principio a fin.
    this.followArrangement = false; this.arrBar = 0;
  }
  get arrangement() { return this.followArrangement && this.groove && Array.isArray(this.groove.arrangement) && this.groove.arrangement.length ? this.groove.arrangement : null; }

  get playing() { return !!this.timer; }
  get part() { return this.st ? this.st.part : null; }
  get queued() { return this.st ? (this.st.queued || (this.st.part === 'fill' ? this.st.afterFill : null)) : null; }

  ctx() { const e = this.getEngine(); return e && e.ctx; }
  _out() {
    const e = this.getEngine(), ctx = this.ctx();
    if (!this.out) { this.out = ctx.createGain(); this.out.connect((e && e.drumGain) || ctx.destination); }
    this.out.gain.value = this.volume;
    return this.out;
  }
  setVolume(v) { this.volume = Math.max(0, Math.min(1.2, v)); if (this.out) this.out.gain.value = this.volume; }

  async load(file) {
    const ctx = this.ctx();
    if (!ctx || !file) return null;
    if (this.buffers.has(file)) return this.buffers.get(file);
    let p = cache.get(file);
    if (!p) {
      p = (async () => {
        let src = file;
        const resolver = window.__cloudResolveFile || window.__cloudResolve;
        if (src.startsWith('livepads://') && resolver) { try { src = await resolver(src); } catch (_) {} }
        const r = await fetch(src.startsWith('livepads://') || src.startsWith('blob:') || src.startsWith('file:') ? src : encodeURI(src));
        if (!r.ok) throw new Error(r.status);
        return ctx.decodeAudioData(await r.arrayBuffer());
      })();
      cache.set(file, p);
    }
    try { const b = await p; this.buffers.set(file, b); return b; } catch (_) { cache.delete(file); return null; }
  }
  /** Carga los sonidos de todas las pistas del ritmo. */
  async setGroove(g) {
    this.groove = g;
    await Promise.all((g.tracks || []).map((t) => this.load(t.file)));
  }

  // Un golpe como lo daría un baterista:
  //  · cada golpe de un tambor apaga (rápido, sin clic) el anterior del MISMO tambor: antes se
  //    apilaban colas largas (la caja de 2 s × 8 golpes de un redoble = «ametralladora»);
  //    los platillos (crash, ride) sí se dejan sonar;
  //  · nunca dos golpes idénticos: fuerza ±8 % y afinación ±1 % (como golpear en otro punto);
  //  · los golpes suaves suenan además algo más apagados (menos agudos), como en una batería real.
  _hit(track, vel, when) {
    const buf = this.buffers.get(track.file), ctx = this.ctx();
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const cymbal = track.voice === 'crash' || track.voice === 'ride';
    if (this.humanize && !cymbal) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.02;
    const g = ctx.createGain();
    const h = this.humanize ? 1 + (Math.random() - 0.5) * 0.16 : 1;
    g.gain.value = (track.vol ?? 0.8) * vel * h;
    let head = src;
    if (vel < 0.6) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2500 + 9000 * vel; lp.Q.value = 0.5;
      src.connect(lp); head = lp;
    }
    head.connect(g); g.connect(this._out());
    src.start(when);
    this.pending.push({ src, when });
    this.lastHit ||= new Map();
    const prev = this.lastHit.get(track.id);
    if (prev && prev.when < when && track.voice !== 'crash') {
      try { prev.g.gain.setTargetAtTime(0, when, cymbal ? 0.25 : 0.03); } catch (_) {}
    }
    this.lastHit.set(track.id, { g, when });
    if (track.voice === 'hho') this.openHat = { g, when };
    if (track.voice === 'hhc' && this.openHat && this.openHat.when < when) {
      try { this.openHat.g.gain.setTargetAtTime(0, when, 0.015); } catch (_) {}
      this.openHat = null;
    }
  }

  play(part = 'A') {
    const ctx = this.ctx();
    if (!ctx || !this.groove) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (this.playing) { this.queue(part); return; }
    this.arrBar = 0; this._forceCrash = false;
    if (this.arrangement) { const e0 = arrangementEntry(this.arrangement, 0); if (e0) { part = e0.part; this._forceCrash = e0.crash; this._crash = e0.crash; } }
    this.st = startState(part);
    if (part === 'fill') this.st.afterFill = 'A';
    this.step = 0; this.timeline = [];
    this.nextTime = this._alignedStart(ctx.currentTime + 0.06);
    this.timer = setInterval(() => this._tick(), TICK);
    this._tick();
    this.onState();
  }

  queue(part) {
    if (!this.playing) { this.play(part); return; }
    this.st = queuePart(this.st, part);
    this.onState();
  }

  stop(now = true) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const ctx = this.ctx(), t = ctx ? ctx.currentTime : 0;
    if (now) for (const p of this.pending) if (p.when > t) { try { p.src.stop(); } catch (_) {} }
    this.pending = []; this.st = null; this.openHat = null; this.timeline = []; this.lastHit = new Map(); this._bassPc = null; this._bassVoice = null;
    this.onState();
  }

  /** { part, step } que suena ahora, o null. */
  position() {
    const ctx = this.ctx();
    if (!ctx || !this.timeline.length) return null;
    const t = ctx.currentTime;
    let cur = null;
    for (const e of this.timeline) { if (e.t <= t) cur = e; else break; }
    return cur;
  }

  _alignedStart(t) {
    // Siguiendo una pista: empieza en su próximo primer tiempo.
    if (this.clock) { const d = this.clock.nextDownbeat(t); if (d != null) return d; }
    const m = this.getMetro && this.getMetro();
    if (!m || !m.running || !m._nextNoteTime) return t;
    const iv = 60 / (m.bpm * (m.multiplier || 1) * (m.tempoScale || 1));
    let at = m._nextNoteTime + (((m.beats - m.currentBeat) % m.beats) * iv);
    while (at - iv * m.beats > t) at -= iv * m.beats;
    while (at < t) at += iv * m.beats;
    return at;
  }
  _snap(t) {
    const m = this.getMetro && this.getMetro();
    if (!m || !m.running || !m._nextNoteTime) return t;
    const iv = 60 / (m.bpm * (m.multiplier || 1) * (m.tempoScale || 1));
    const beat = m._nextNoteTime + Math.round((t - m._nextNoteTime) / iv) * iv;
    return Math.abs(beat - t) < 0.04 ? beat : t;
  }
  _bpm() { const m = this.getMetro && this.getMetro(); return (m && m.bpm) || 100; }

  _tick() {
    const ctx = this.ctx(), g = this.groove;
    if (!ctx || !g || !this.st) return;
    const n = steps(g);
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      // Reloj externo (los pulsos reales de la pista, live/grooveFollow.js): cada pulso del
      // ritmo se pega al pulso de la pista y dura lo que dura ese pulso. Si no, el metrónomo.
      if (this.clock && this.step % g.spb === 0) {
        const b = this.clock.beatAt(this.nextTime);
        if (b) { this.nextTime = b.t; this._beatDur = b.dur; }
      } else if (this.step === 0) this.nextTime = this._snap(this.nextTime);
      const dur = this.clock && this._beatDur ? this._beatDur / g.spb : stepDur(this._bpm(), g);
      const at = Math.max(ctx.currentTime, this.nextTime + swingOffset(this.step, g, g.swing || 0, dur));
      if (this.step === 0 && (this._crash || this._forceCrash)) {
        // _forceCrash: el arreglo de la grabación tenía crash al empezar este tramo.
        const crash = (this.crashOnChange || this._forceCrash) && !hitsAt(g, this.st.part, 0).some((h) => h.track.voice === 'crash')
          ? (g.tracks || []).find((t) => t.voice === 'crash' && !t.mute) : null;
        if (crash) this._hit(crash, 0.8, at);
        this._crash = false; this._forceCrash = false;
      }
      // Tiempo humano: el bombo muy preciso (±1 ms), lo demás algo más suelto (±3 ms).
      for (const h of hitsAt(g, this.st.part, this.step)) {
        const j = this.humanize ? (Math.random() - 0.5) * (h.track.voice === 'kick' ? 0.002 : 0.006) : 0;
        this._hit(h.track, h.vel, Math.max(ctx.currentTime, at + j));
      }
      if (this.bass.on && this.bass.chordAt) {
        const pc = this.bass.chordAt(at);
        if (pc != null) {
          const h = bassHit(g, this.st.part, this.step, pc !== this._bassPc);
          if (h) { this._bassNote(pc, at, h.len * dur * 0.96); this._bassPc = pc; }
        }
      }
      this.timeline.push({ t: at, part: this.st.part, step: this.step });
      this.nextTime += dur;
      this.step++;
      if (this.step >= n) {
        this.step = 0;
        let r = barEnd(this.st);
        // Siguiendo el arreglo de la grabación: el compás siguiente es el que toca ahí
        // (redobles incluidos); al terminar, el final (si lo hay) y se para.
        if (this.arrangement && !this.st.ending) {
          this.arrBar++;
          const e = arrangementEntry(this.arrangement, this.arrBar);
          const ns = { ...this.st, queued: null, afterFill: null };
          if (!e) r = { st: ns, stop: true, crash: false };
          else { ns.part = e.part; ns.ending = e.part === 'end'; r = { st: ns, stop: false, crash: false }; this._forceCrash = e.first && e.crash; }
        }
        if (r.stop) { const endAt = this.nextTime; setTimeout(() => this.stop(false), Math.max(0, (endAt - ctx.currentTime) * 1000)); clearInterval(this.timer); this.timer = -1; return; }
        const changed = r.st.part !== this.st.part;
        this.st = r.st; this._crash = r.crash;
        if (changed) setTimeout(() => this.onState(), Math.max(0, (this.nextTime - ctx.currentTime) * 1000));
      }
    }
    const t = ctx.currentTime;
    if (this.timeline.length > 96) this.timeline = this.timeline.filter((e) => e.t > t - 1);
    if (this.pending.length > 96) this.pending = this.pending.filter((p) => p.when > t - 0.05);
  }

  /** Una nota del bajo: ataque corto, cae al soltar, y apaga la anterior (un bajo toca de una en una). */
  _bassNote(pc, when, durSec) {
    const ctx = this.ctx();
    if (!ctx) return;
    const s = bassSample(bassMidi(pc));
    const buf = this.buffers.get(s.file);
    if (!buf) { this.load(s.file); return; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = s.rate;
    const g = ctx.createGain();
    const v = this.bass.vol * (this.humanize ? 1 + (Math.random() - 0.5) * 0.08 : 1);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(v, when + 0.006);
    const off = when + Math.max(0.12, durSec);
    g.gain.setValueAtTime(v, off);
    g.gain.setTargetAtTime(0, off, 0.05);
    src.connect(g); g.connect(this._out());
    src.start(when); src.stop(off + 0.4);
    if (this._bassVoice && this._bassVoice.when < when) { try { this._bassVoice.g.gain.cancelScheduledValues(when); this._bassVoice.g.gain.setTargetAtTime(0, when, 0.012); } catch (_) {} }
    this._bassVoice = { g, when };
    this.pending.push({ src, when });
  }
  /** Deja listas las muestras del bajo. */
  loadBass() { const files = new Set(); for (let pc = 0; pc < 12; pc++) files.add(bassSample(bassMidi(pc)).file); return Promise.all([...files].map((f) => this.load(f))); }

  /** Suena una pista ya (para el editor y el selector de sonidos). */
  async preview(track) {
    const ctx = this.ctx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    await this.load(track.file);
    this._hit(track, 0.9, ctx.currentTime);
  }
}
