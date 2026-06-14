/* SynthEngine — Web Audio API */
export class SynthEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.padGain = null; this.padPanNode = null;
    this.drumGain = null; this.drumPanNode = null;
    this.lpfNode = null; this.hpfNode = null;
    this.reverbNode = null;
    this.activePadNodes = [];
    this.customPads = {};
    this.customDrums = {};
    this.customDrumOffsets = {};   // padId → segundos de silencio inicial a saltar
    this.drumVolumes = {};
    this.currentBankSynth = null;
    this.currentDrumPack = null;
    this.currentPadBank = null; // active PAD_BANKS entry
    this._clickBuffers = {};
    this._padAmbBuffers = {};    // bankId_note -> AudioBuffer
  }

  async init() {
    // latencyHint: 'interactive' minimizes audio buffer size for live triggering.
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.masterGain = this.ctx.createGain(); this.masterGain.gain.value = 1;
    this.padGain    = this.ctx.createGain(); this.padGain.gain.value = 0.75;
    this.padPanNode = this.ctx.createStereoPanner();
    this.lpfNode    = this.ctx.createBiquadFilter(); this.lpfNode.type = 'lowpass';  this.lpfNode.frequency.value = 18000;
    this.hpfNode    = this.ctx.createBiquadFilter(); this.hpfNode.type = 'highpass'; this.hpfNode.frequency.value = 20;
    this.drumGain   = this.ctx.createGain(); this.drumGain.gain.value = 0.8;
    this.drumPanNode= this.ctx.createStereoPanner();
    // Reverb DIFERIDO: el IR (buffer de 2.5s, ~220k iteraciones sample-a-sample)
    // bloqueaba el boot, y solo se necesita al primer pad sintético. Se genera
    // en idle tras el arranque (_scheduleReverbBuild, al final de init) y, como
    // red de seguridad, al primer pad si aún no estuviera listo (ensureReverb).
    this.reverbNode = null;
    this.limiterNode = this.ctx.createDynamicsCompressor();
    this.limiterNode.threshold.value = -1.5;
    this.limiterNode.knee.value = 0;
    this.limiterNode.ratio.value = 20;
    this.limiterNode.attack.value = 0.003;
    this.limiterNode.release.value = 0.1;
    this.padGain.connect(this.lpfNode);
    this.lpfNode.connect(this.hpfNode);
    this.hpfNode.connect(this.padPanNode);
    this.padPanNode.connect(this.masterGain);
    this.drumGain.connect(this.drumPanNode);
    this.drumPanNode.connect(this.masterGain);
    this.masterGain.connect(this.limiterNode);
    this.limiterNode.connect(this.ctx.destination);

    // Keep-alive: a silent constant source keeps the AudioContext from idling
    // so the FIRST pad/drum hit after a quiet stretch has zero warm-up latency
    // (a suspended/idle context adds tens of ms on the first scheduled sound).
    try {
      const ka = this.ctx.createConstantSource();
      const kaGain = this.ctx.createGain();
      kaGain.gain.value = 0;
      ka.connect(kaGain).connect(this.masterGain);
      ka.start();
      this._keepAlive = ka;
    } catch (e) {}

    // Genera el reverb fuera del camino crítico del boot (en idle).
    this._scheduleReverbBuild();
  }

  // Construye el IR del reverb si aún no existe y devuelve el convolver. Sync
  // (el bucle siempre lo fue); idempotente.
  ensureReverb() {
    if (this.reverbNode) return this.reverbNode;
    const dur = 2.5, sr = this.ctx.sampleRate, len = sr * dur;
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 2.2);
    }
    const conv = this.ctx.createConvolver(); conv.buffer = buf;
    this.reverbNode = conv;
    return conv;
  }

  _scheduleReverbBuild() {
    const build = () => { try { this.ensureReverb(); } catch (_) {} };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(build, { timeout: 2500 });
    else setTimeout(build, 800);
  }

  setMasterVolume(v) { if(this.masterGain) this.masterGain.gain.setTargetAtTime(v,this.ctx.currentTime,.05); }
  setPadVolume(v) { if(this.padGain) this.padGain.gain.setTargetAtTime(v,this.ctx.currentTime,.05); }
  setPadPan(v)    { if(this.padPanNode) this.padPanNode.pan.value = v; }
  setLPF(hz, on)  { this.lpfNode.frequency.setTargetAtTime(on?hz:18000, this.ctx.currentTime, .05); }
  setHPF(hz, on)  { this.hpfNode.frequency.setTargetAtTime(on?hz:20, this.ctx.currentTime, .05); }
  setDrumVolume(v){ if(this.drumGain) this.drumGain.gain.setTargetAtTime(v,this.ctx.currentTime,.05); }
  setDrumPan(v)   { if(this.drumPanNode) this.drumPanNode.pan.value = v; }
  setDrumPadVolume(id, v) { if(this.drumVolumes[id]) this.drumVolumes[id].gain.setTargetAtTime(v,this.ctx.currentTime,.05); }
  setCrossfade(s)  { this._crossfadeDur = s; }
  setPadBank(bank) {
    this.currentPadBank = bank;
    // Free decoded pad buffers from OTHER banks to keep RAM low on weak
    // laptops (pad-amb buffers are large). A pad that's currently playing keeps
    // its own buffer reference alive, so dropping our cache entry is safe even
    // mid-crossfade — the buffer is GC'd only once that pad finishes.
    const prefix = `${bank.id}_`;
    for (const k of Object.keys(this._padAmbBuffers)) {
      if (!k.startsWith(prefix)) delete this._padAmbBuffers[k];
    }
    this._preloadBank(bank);
  }

  async _preloadBank(bank) {
    // Two-phase preload optimized for worship key distribution:
    //   1) PRIORITY notes (C, G, D, A, F — the most common keys in worship)
    //      are decoded in parallel, so the first 5 likely-pressed keys are
    //      ready ASAP after the bank loads.
    //   2) The remaining 7 notes load sequentially with a tiny breather so
    //      the main thread stays responsive for UI work happening alongside.
    const PRIORITY = ['C', 'G', 'D', 'A', 'F'];
    const REST     = ['E', 'B', 'Bb', 'Eb', 'Db', 'Gb', 'Ab'];

    // Phase 1: parallel decode of the priority notes.
    await Promise.all(PRIORITY.map(n => {
      if (this.currentPadBank !== bank) return Promise.resolve();
      return this._ensurePadAmb(n);
    }));
    if (this.currentPadBank !== bank) return;

    // Phase 2: sequential decode of the rest, breathing between each.
    for (const n of REST) {
      if (this.currentPadBank !== bank) break;
      await this._ensurePadAmb(n);
      await new Promise(r => setTimeout(r, 50));
    }
  }

  /* ── Click track manifests ── */
  // Per-sound accent + normal mp3 paths. Loaded lazily so boot only pays
  // for the default sound; the rest decode on first use of each sound.
  static get CLICK_FILE_MAP() {
    const base = 'assets/Click Tracks/New Click -  '; // double space is intentional
    return {
      classic:    { accent: `${base}Classic-accents.mp3`,    normal: `${base}Classic-quarter.mp3` },
      blip:       { accent: `${base}Blip-accents.mp3`,       normal: `${base}Blip-quarter.mp3` },
      cowbell:    { accent: `${base}Cowbell-accents.mp3`,    normal: `${base}Cowbell-quarter.mp3` },
      digital:    { accent: `${base}Digital-accents.mp3`,    normal: `${base}Digital-sixteenth.mp3` },
      gentle:     { accent: `${base}Gentle-accents.mp3`,     normal: `${base}Gentle-quarter.mp3` },
      percussive: { accent: `${base}Percussive-accents.mp3`, normal: `${base}Percussive-quarter.mp3` },
      woodblock:  { accent: `${base}Woodblock-accents.mp3`,  normal: `${base}Woodblock-quarter.mp3` },
    };
  }

  // Decode one sound's accent+normal pair. Idempotent + dedupes concurrent
  // calls so playClick + UI sound-change both arrive at the same promise.
  ensureClickSound(soundName) {
    if (!this._clickLoading) this._clickLoading = {};
    const accentKey = `${soundName}_accent`;
    const normalKey = `${soundName}_normal`;
    if (this._clickBuffers[accentKey] && this._clickBuffers[normalKey]) return Promise.resolve();
    if (this._clickLoading[soundName]) return this._clickLoading[soundName];

    const map = SynthEngine.CLICK_FILE_MAP[soundName];
    if (!map) return Promise.resolve();

    const decode = async (key, path) => {
      try {
        const resp = await fetch(path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ab = await resp.arrayBuffer();
        this._clickBuffers[key] = await this.ctx.decodeAudioData(ab);
      } catch (e) {
        console.warn('Click file not loaded:', path, e.message);
      }
    };

    const p = Promise.all([
      decode(accentKey, map.accent),
      decode(normalKey, map.normal)
    ]).finally(() => { delete this._clickLoading[soundName]; });

    this._clickLoading[soundName] = p;
    return p;
  }

  // Default click sound only — others load on demand when the user picks them.
  async loadClickBuffers(defaultSound = 'cowbell') {
    await this.ensureClickSound(defaultSound);
  }

  /* ── Lazy-load ambient pad file — deduped, abort-safe ── */
  async _ensurePadAmb(key) {
    if (!this.currentPadBank) return;
    const bank = this.currentPadBank;
    const cacheKey = `${bank.id}_${key}`;

    // Already resolved (buffer or null)
    if (this._padAmbBuffers[cacheKey] !== undefined) return;

    const noteToId = {
      'A': '01 A', 'A#': '02 Bb', 'Bb': '02 Bb', 'B': '03 B', 'C': '04 C',
      'C#': '05 Db', 'Db': '05 Db', 'D': '06 D', 'D#': '07 Eb', 'Eb': '07 Eb',
      'E': '08 E', 'F': '09 F', 'F#': '10 Gb', 'Gb': '10 Gb', 'G': '11 G',
      'G#': '12 Ab', 'Ab': '12 Ab'
    };

    const noteToSimple = {
      'A': 'A', 'A#': 'Bb', 'Bb': 'Bb', 'B': 'B', 'C': 'C',
      'C#': 'Db', 'Db': 'Db', 'D': 'D', 'D#': 'Eb', 'Eb': 'Eb',
      'E': 'E', 'F': 'F', 'F#': 'Gb', 'Gb': 'Gb', 'G': 'G',
      'G#': 'Ab', 'Ab': 'Ab'
    };

    const id = noteToId[key];
    const simple = noteToSimple[key];
    if (!id) { this._padAmbBuffers[cacheKey] = null; return; }

    // Deduplicate concurrent loads
    if (!this._loadingPads) this._loadingPads = {};
    const loadingKey = `${bank.id}_${id}`;
    if (this._loadingPads[loadingKey]) {
      await this._loadingPads[loadingKey];
      return;
    }

    const fileName = bank.pattern ? `${bank.pattern}${id}` : simple;
    const path = `${bank.folder}${fileName}.mp3`;

    const loadPromise = (async () => {
      try {
        const resp = await fetch(path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ab  = await resp.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(ab);

        // Store for this bank + key
        this._padAmbBuffers[cacheKey] = buf;
        // Also store for enharmonic neighbor if same bank
        for (const [k, v] of Object.entries(noteToId)) {
          if (v === id) this._padAmbBuffers[`${bank.id}_${k}`] = buf;
        }

        console.log('Pad Amb loaded:', path);
      } catch(e) {
        console.warn('Pad Amb not loaded:', path, e.message);
        this._padAmbBuffers[cacheKey] = null;
      } finally {
        delete this._loadingPads[loadingKey];
      }
    })();
    this._loadingPads[loadingKey] = loadPromise;
    await loadPromise;
  }

  async playPad(key, bankSynth) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._pendingKey = key;

    const oldNodes = this.activePadNodes;
    this.activePadNodes = [];

    this.currentBankSynth = bankSynth || this.currentBankSynth || { wave: 'sine', attack: 3, release: 4 };
    const cfg  = this.currentBankSynth;
    const freq = this._noteToHz(key);
    if (!freq) { this._fadeOutNodes(oldNodes, 0.4); return; }

    if (this.customPads[key]) {
      this._playBufferPad(this.customPads[key]);
      this._fadeOutNodes(oldNodes, 1.5);
      return;
    }

    const bank = this.currentPadBank;
    const cacheKey = bank ? `${bank.id}_${key}` : key;

    // SMART ATTACK:
    // If nothing is playing, start fast (0.5s).
    // If something is already playing, crossfade smoothly (2.0s).
    const isSilent = (oldNodes.length === 0);
    const attackTime = isSilent ? 0.5 : 2.0;

    if (this._padAmbBuffers[cacheKey]) {
      this._playBufferPad(this._padAmbBuffers[cacheKey], attackTime);
      this._fadeOutNodes(oldNodes, attackTime + 0.5);
    } else {
      // 0 latencia: el synth suena YA; el MP3 del pad se decodifica en segundo
      // plano y, cuando llega, crossfade al buffer real si este pad sigue activo.
      // (Antes se esperaba la decodificación con await → el pad "tardaba".)
      this._playSynthPad(freq, cfg, attackTime);
      this._fadeOutNodes(oldNodes, attackTime + 0.3);
      this._ensurePadAmb(key).then(() => {
        if (this._pendingKey !== key) return;
        const buf = this._padAmbBuffers[cacheKey];
        if (!buf) return;
        const synthNodes = this.activePadNodes;
        this.activePadNodes = [];
        this._playBufferPad(buf, 2.0);
        this._fadeOutNodes(synthNodes, 2.5);
      }).catch(() => {});
    }
  }

  /* ── Fade out a set of nodes over `duration` seconds ── */
  _fadeOutNodes(nodes, duration = 0.4) {
    if (!nodes || !nodes.length) return;
    const now = this.ctx.currentTime;
    for (const n of nodes) {
      if (n.gain) {
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.setValueAtTime(n.gain.gain.value, now);
        n.gain.gain.linearRampToValueAtTime(0, now + duration);
      }
      const stopAt = now + duration + 0.05;
      if (n.osc) { try { n.osc.stop(stopAt); } catch{} }
      if (n.lfo) { try { n.lfo.stop(stopAt); } catch{} }
      if (n.src) { try { n.src.stop(stopAt); } catch{} }
    }
  }

  _playSynthPad(freq, cfg = {}, attack = 2.0) {
    const now = this.ctx.currentTime;
    const nodes = [];
    const atk = attack, rel = cfg.release || 3.5;
    const reverbWet = cfg.reverbWet || 0.55;
    const detune = cfg.detune || 4;
    const lfoRate = cfg.lfoRate || 0.22, lfoDepth = cfg.lfoDepth || 8;
    const filterFreq = cfg.filterFreq || 900, filterType = cfg.filterType || 'lowpass';
    const waveform = cfg.wave || 'sine';
    const detuneArr = [0, detune, -detune];
    for (let d of detuneArr) {
      const osc = this.ctx.createOscillator();
      osc.type = waveform; osc.frequency.value = freq; osc.detune.value = d;
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType; filter.frequency.value = filterFreq; filter.Q.value = 1.2;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = lfoDepth;
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
      const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.28, now + atk);
      const dryGain = this.ctx.createGain(); dryGain.gain.value = 1 - reverbWet;
      const wetGain = this.ctx.createGain(); wetGain.gain.value = reverbWet;
      osc.connect(filter); filter.connect(gain);
      gain.connect(dryGain); dryGain.connect(this.padGain);
      const reverb = this.ensureReverb(); // ya construido en idle; lo crea aquí solo si un pad suena antes
      gain.connect(wetGain); wetGain.connect(reverb); reverb.connect(this.padGain);
      osc.start(now); lfo.start(now);
      nodes.push({ osc, lfo, gain, rel });
    }
    this.activePadNodes = nodes;
  }

  _playBufferPad(buffer, attack = 0.6) {
    const now = this.ctx.currentTime;
    const src  = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop   = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + attack);
    src.connect(gain);
    gain.connect(this.padGain);
    src.start(now);
    this.activePadNodes = [{ src, gain, isBuf: true }];
  }

  async _stopPad(fadeTime = 0.4) {
    const nodes = this.activePadNodes;
    this.activePadNodes = [];
    this._fadeOutNodes(nodes, fadeTime);
  }

  stopPad(fadeTime = 0.4) { this._stopPad(fadeTime); }

  playDrum(type, padId) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const dest = this._getDrumDest(padId);
    // Use pack timbre if available
    const timbre = this.currentDrumPack?.timbres?.[type];
    if (timbre) { this._playPackDrum(type, dest, timbre); return; }
    // Legacy fallback
    switch(type) {
      case 'kick':    this._synthKick(dest); break;
      case 'subkick': this._synthSubKick(dest); break;
      case 'snare':   this._synthSnare(dest); break;
      case 'clap':    this._synthClap(dest); break;
      case 'hihatC':  this._synthHihat(dest, false); break;
      case 'hihatO':  this._synthHihat(dest, true); break;
      case 'tomH':    this._synthTom(dest, 200); break;
      case 'tomM':    this._synthTom(dest, 150); break;
      case 'tomL':    this._synthTom(dest, 110); break;
      case 'tumba':   this._synthTom(dest, 90); break;
      case 'wood':    this._synthWood(dest); break;
      case 'crash':   this._synthCrash(dest); break;
      case 'ride':    this._synthRide(dest); break;
      case 'shaker':  this._synthShaker(dest); break;
      case 'tamb':    this._synthTamb(dest); break;
      case 'congaH':  this._synthTom(dest, 250); break;
      case 'congaL':  this._synthTom(dest, 180); break;
      case 'cowbell': this._synthCowbell(dest); break;
      default: this._synthClap(dest);
    }
  }

  /* ── Route pack hit to correct synth style ── */
  _playPackDrum(type, dest, t) {
    const s = t.style;
    if (s === 'acoustic_kick' || s === 'modern_kick' || s === 'cinematic_kick') {
      this._packKick(dest, t);
    } else if (s === 'sub_kick') {
      this._packSubKick(dest, t);
    } else if (s === 'acoustic_snare' || s === 'modern_snare' || s === 'gospel_snare') {
      this._packSnare(dest, t);
    } else if (s === 'orchestral_snare') {
      this._packOrchestraSnare(dest, t);
    } else if (s === 'room_clap' || s === 'tight_clap' || s === 'gospel_clap') {
      this._packClap(dest, t);
    } else if (s === 'acoustic_hh' || s === 'tight_hh') {
      this._packHihat(dest, t);
    } else if (s === 'acoustic_tom' || s === 'gated_tom') {
      this._packTom(dest, t);
    } else if (s === 'timpani') {
      this._packTimpani(dest, t);
    } else if (s === 'acoustic_crash' || s === 'bright_crash' || s === 'orchestral_crash') {
      this._packCrash(dest, t);
    } else if (s === 'acoustic_ride') {
      this._packRide(dest, t);
    } else if (s === 'shaker') {
      this._packShaker(dest, t);
    } else if (s === 'tambourine') {
      this._packTamb(dest, t);
    } else if (s === 'woodblock') {
      this._packWood(dest, t);
    } else if (s === 'cowbell') {
      this._packCowbell(dest, t);
    } else {
      this._synthClap(dest);
    }
  }

  /* ── WORSHIP KICK: sub sine + click transient + body noise ── */
  _packKick(dest, t) {
    const now = this.ctx.currentTime;
    const decay = t.decay ?? 0.45;
    const punch = t.punch ?? 0.8;
    const sub   = t.sub   ?? 0.6;
    const startF = t.style === 'cinematic_kick' ? 80 : 160;
    const endF   = t.style === 'cinematic_kick' ? 28 : 38;
    // Sub layer
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(endF, now + decay * 0.9);
    const gSub = this.ctx.createGain();
    gSub.gain.setValueAtTime(0, now);
    gSub.gain.linearRampToValueAtTime(sub, now + 0.002);
    gSub.gain.exponentialRampToValueAtTime(0.001, now + decay + 0.05);
    gSub.connect(dest); osc.connect(gSub); osc.start(now); osc.stop(now + decay + 0.1);
    // Click transient (noise burst)
    const n = this._noise(0.02);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    const gClick = this.ctx.createGain();
    gClick.gain.setValueAtTime(punch, now);
    gClick.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    gClick.connect(dest); n.connect(hp); hp.connect(gClick); n.start(now); n.stop(now + 0.025);
    // Body thump
    const osc2 = this.ctx.createOscillator(); osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(startF * 1.4, now);
    osc2.frequency.exponentialRampToValueAtTime(startF * 0.5, now + 0.06);
    const gBody = this.ctx.createGain();
    gBody.gain.setValueAtTime(t.body ?? 0.7, now);
    gBody.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    gBody.connect(dest); osc2.connect(gBody); osc2.start(now); osc2.stop(now + 0.1);
  }

  /* ── SUB KICK: deep 808-style ── */
  _packSubKick(dest, t) {
    const now = this.ctx.currentTime;
    const decay = t.decay ?? 0.7;
    const sub   = t.sub   ?? 0.9;
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(65, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(sub, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay + 0.1);
    g.connect(dest); osc.connect(g); osc.start(now); osc.stop(now + decay + 0.15);
  }

  /* ── WORSHIP SNARE: noise layer + body + crack ── */
  _packSnare(dest, t) {
    const now = this.ctx.currentTime;
    const snap  = t.snap  ?? 0.8;
    const body  = t.body  ?? 0.65;
    const crack = t.crack ?? 0.7;
    const decay = t.decay ?? 0.18;
    const isModern = t.style === 'modern_snare' || t.style === 'gospel_snare';
    // Noise (snare wires)
    const n = this._noise(decay + 0.1);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = isModern ? 3000 : 2200; bp.Q.value = 0.7;
    const gN = this.ctx.createGain();
    gN.gain.setValueAtTime(snap, now);
    gN.gain.exponentialRampToValueAtTime(0.001, now + decay);
    gN.connect(dest); n.connect(bp); bp.connect(gN); n.start(now); n.stop(now + decay + 0.05);
    // Body tone
    const osc = this.ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(isModern ? 130 : 100, now + 0.07);
    const gB = this.ctx.createGain();
    gB.gain.setValueAtTime(body, now);
    gB.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    gB.connect(dest); osc.connect(gB); osc.start(now); osc.stop(now + 0.1);
    // Crack (high transient)
    const n2 = this._noise(0.008);
    const hp2 = this.ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 4000;
    const gC = this.ctx.createGain();
    gC.gain.setValueAtTime(crack, now);
    gC.gain.exponentialRampToValueAtTime(0.001, now + 0.007);
    gC.connect(dest); n2.connect(hp2); hp2.connect(gC); n2.start(now); n2.stop(now + 0.01);
  }

  /* ── ORCHESTRAL SNARE ── */
  _packOrchestraSnare(dest, t) {
    const now = this.ctx.currentTime;
    const decay = t.decay ?? 0.5;
    const n = this._noise(decay + 0.1);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1500; hp.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(t.snap ?? 0.6, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay);
    g.connect(dest); n.connect(hp); hp.connect(g); n.start(now); n.stop(now + decay + 0.05);
    // Deep body
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now); osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
    const gB = this.ctx.createGain();
    gB.gain.setValueAtTime(t.body ?? 0.9, now);
    gB.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    gB.connect(dest); osc.connect(gB); osc.start(now); osc.stop(now + 0.18);
  }

  /* ── WORSHIP CLAP: multi-layer with room ── */
  _packClap(dest, t) {
    const now = this.ctx.currentTime;
    const spread  = t.spread ?? 4;
    const body    = t.body   ?? 0.7;
    const decay   = t.decay  ?? 0.18;
    const room    = t.room   ?? 0.5;
    const freqBase = t.style === 'tight_clap' ? 2200 : 1800;
    const count = Math.min(spread, 8);
    for (let i = 0; i < count; i++) {
      const delay = i * (t.style === 'tight_clap' ? 0.008 : 0.013);
      const n = this._noise(0.05);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = freqBase + (Math.random() - 0.5) * 400; f.Q.value = 1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(body, now + delay + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + decay);
      g.connect(dest); n.connect(f); f.connect(g);
      n.start(now + delay); n.stop(now + delay + decay + 0.01);
    }
    // Room tail
    if (room > 0) {
      const nR = this._noise(decay * 2);
      const lpR = this.ctx.createBiquadFilter(); lpR.type = 'lowpass'; lpR.frequency.value = 2000;
      const gR = this.ctx.createGain();
      gR.gain.setValueAtTime(room * 0.25, now + 0.02);
      gR.gain.exponentialRampToValueAtTime(0.001, now + decay * 2.5);
      gR.connect(dest); nR.connect(lpR); lpR.connect(gR);
      nR.start(now + 0.02); nR.stop(now + decay * 2.5 + 0.01);
    }
  }

  /* ── HI-HAT: acoustic or tight ── */
  _packHihat(dest, t) {
    const now = this.ctx.currentTime;
    const open   = t.open   ?? false;
    const bright = t.bright ?? 0.6;
    const decay  = t.decay  ?? (open ? 0.3 : 0.05);
    const hpFreq = t.style === 'tight_hh' ? 9000 : 7500;
    const n = this._noise(decay + 0.05);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpFreq;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hpFreq * 1.3; bp.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(bright, now);
    if (open) { g.gain.setTargetAtTime(0.001, now + decay * 0.4, decay * 0.3); }
    else { g.gain.exponentialRampToValueAtTime(0.001, now + decay); }
    g.connect(dest); n.connect(hp); hp.connect(bp); bp.connect(g);
    n.start(now); n.stop(now + decay + 0.06);
  }

  /* ── ACOUSTIC / GATED TOM ── */
  _packTom(dest, t) {
    const now  = this.ctx.currentTime;
    const freq = t.tune ?? 160;
    const body = t.body ?? 0.8;
    const decay = t.decay ?? 0.3;
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(body, now + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay);
    g.connect(dest); osc.connect(g); osc.start(now); osc.stop(now + decay + 0.05);
    // Thud transient
    const n = this._noise(0.025);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const gN = this.ctx.createGain();
    gN.gain.setValueAtTime(0.3, now);
    gN.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    gN.connect(dest); n.connect(lp); lp.connect(gN); n.start(now); n.stop(now + 0.03);
  }

  /* ── TIMPANI / CINEMATIC TOM ── */
  _packTimpani(dest, t) {
    const now  = this.ctx.currentTime;
    const freq = t.tune ?? 120;
    const body = t.body ?? 0.9;
    const decay = t.decay ?? 0.9;
    // Fundamental + harmonics
    [1, 1.5, 2].forEach((mult, idx) => {
      const osc = this.ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * mult * 1.4, now);
      osc.frequency.exponentialRampToValueAtTime(freq * mult, now + 0.08);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(body / (idx + 1), now + 0.001);
      g.gain.exponentialRampToValueAtTime(0.001, now + decay / (idx + 1) * 1.5);
      g.connect(dest); osc.connect(g); osc.start(now); osc.stop(now + decay + 0.1);
    });
    // Mallet thud
    const n = this._noise(0.03);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const gN = this.ctx.createGain();
    gN.gain.setValueAtTime(0.5, now);
    gN.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    gN.connect(dest); n.connect(lp); lp.connect(gN); n.start(now); n.stop(now + 0.04);
  }

  /* ── CRASH CYMBAL ── */
  _packCrash(dest, t) {
    const now   = this.ctx.currentTime;
    const bright = t.bright ?? 0.5;
    const decay  = t.decay  ?? 1.4;
    const hpF = t.style === 'orchestral_crash' ? 3500 : 5000;
    const n = this._noise(decay + 0.2);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpF;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hpF * 1.5; bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(bright, now + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay);
    g.connect(dest); n.connect(hp); hp.connect(bp); bp.connect(g);
    n.start(now); n.stop(now + decay + 0.1);
  }

  /* ── RIDE ── */
  _packRide(dest, t) {
    const now   = this.ctx.currentTime;
    const bright = t.bright ?? 0.6;
    const decay  = t.decay  ?? 0.6;
    const n = this._noise(decay + 0.1);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 2.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(bright * 0.6, now + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay);
    g.connect(dest); n.connect(bp); bp.connect(g); n.start(now); n.stop(now + decay + 0.05);
    // Bell ping
    const osc = this.ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 4200;
    const gP = this.ctx.createGain();
    gP.gain.setValueAtTime(bright * 0.35, now);
    gP.gain.exponentialRampToValueAtTime(0.001, now + decay * 0.5);
    gP.connect(dest); osc.connect(gP); osc.start(now); osc.stop(now + decay * 0.5 + 0.02);
  }

  /* ── SHAKER ── */
  _packShaker(dest, t) {
    const now   = this.ctx.currentTime;
    const bright = t.bright ?? 0.7;
    const decay  = t.decay  ?? 0.09;
    const n = this._noise(decay + 0.02);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5000 + bright * 2000; hp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(bright * 0.8, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay);
    g.connect(dest); n.connect(hp); hp.connect(g); n.start(now); n.stop(now + decay + 0.01);
  }

  /* ── TAMBOURINE: multi-jingle ── */
  _packTamb(dest, t) {
    const now    = this.ctx.currentTime;
    const jingles = Math.min(t.jingles ?? 4, 8);
    const decay   = t.decay ?? 0.08;
    for (let i = 0; i < jingles; i++) {
      const d = i * 0.011;
      const n = this._noise(0.04);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = 3800 + i * 700 + Math.random() * 300; f.Q.value = 1.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.55, now + d);
      g.gain.exponentialRampToValueAtTime(0.001, now + d + decay);
      g.connect(dest); n.connect(f); f.connect(g);
      n.start(now + d); n.stop(now + d + decay + 0.01);
    }
  }

  /* ── WOOD BLOCK ── */
  _packWood(dest, t) {
    const now  = this.ctx.currentTime;
    const freq = t.tune  ?? 700;
    const decay = t.decay ?? 0.09;
    const osc = this.ctx.createOscillator(); osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + decay * 0.5);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay);
    g.connect(dest); osc.connect(bp); bp.connect(g); osc.start(now); osc.stop(now + decay + 0.01);
  }

  /* ── COWBELL ── */
  _packCowbell(dest, t) {
    const now  = this.ctx.currentTime;
    const freq = t.tune  ?? 562;
    const decay = t.decay ?? 0.35;
    [freq, freq * 1.5].forEach(fr => {
      const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = fr;
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + decay);
      g.connect(dest); osc.connect(hp); hp.connect(g); osc.start(now); osc.stop(now + decay + 0.01);
    });
  }

  _getDrumDest(padId) {
    if (padId && this.drumVolumes[padId]) return this.drumVolumes[padId];
    return this.drumGain;
  }

  _env(dest, atk, dec, sus, rel, now) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + atk);
    g.gain.linearRampToValueAtTime(sus, now + atk + dec);
    g.gain.linearRampToValueAtTime(0, now + atk + dec + rel);
    g.connect(dest); return g;
  }

  _noise(/* dur */) {
    // White noise is identical regardless of length, so bake one buffer once
    // and reuse it for every hit (callers gate the real length via stop()).
    // Avoids allocating + filling sr*dur samples on every drum trigger.
    if (!this._noiseBuf) {
      const sr = this.ctx.sampleRate, len = Math.ceil(sr * 3);
      this._noiseBuf = this.ctx.createBuffer(1, len, sr);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    return s;
  }

  _synthKick(dest) {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(40, now+0.35);
    const g = this._env(dest, 0.001, 0.05, 0, 0.35, now);
    osc.connect(g); osc.start(now); osc.stop(now+0.45);
  }

  _synthSubKick(dest) {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(25, now+0.5);
    const g = this._env(dest, 0.001, 0.08, 0, 0.5, now);
    osc.connect(g); osc.start(now); osc.stop(now+0.65);
  }

  _synthSnare(dest) {
    const now = this.ctx.currentTime;
    const n = this._noise(0.3);
    const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=2000; f.Q.value=0.8;
    const g = this._env(dest, 0.001, 0.02, 0.1, 0.2, now);
    n.connect(f); f.connect(g); n.start(now); n.stop(now+0.3);
    const osc = this.ctx.createOscillator(); osc.type='triangle';
    osc.frequency.setValueAtTime(190, now); osc.frequency.exponentialRampToValueAtTime(100, now+0.1);
    const g2 = this._env(dest, 0.001, 0.03, 0, 0.1, now);
    osc.connect(g2); osc.start(now); osc.stop(now+0.15);
  }

  _synthClap(dest) {
    const now = this.ctx.currentTime;
    for (let i=0;i<3;i++) {
      const n = this._noise(0.05);
      const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1800; f.Q.value=1;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0,now+i*0.012);
      g.gain.linearRampToValueAtTime(0.9,now+i*0.012+0.005);
      g.gain.exponentialRampToValueAtTime(0.001,now+i*0.012+0.05);
      n.connect(f); f.connect(g); g.connect(dest);
      n.start(now+i*0.012); n.stop(now+i*0.012+0.06);
    }
  }

  _synthHihat(dest, open) {
    const now = this.ctx.currentTime;
    const n = this._noise(open?0.4:0.08);
    const f = this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=8000;
    const rel = open?0.3:0.04;
    const g = this._env(dest, 0.001, 0.01, open?0.3:0, rel, now);
    n.connect(f); f.connect(g); n.start(now); n.stop(now+(open?0.45:0.1));
  }

  _synthTom(dest, freq) {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(freq*1.5, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now+0.12);
    const g = this._env(dest, 0.001, 0.04, 0, 0.3, now);
    osc.connect(g); osc.start(now); osc.stop(now+0.45);
  }

  _synthWood(dest) {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type='square';
    osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(500, now+0.05);
    const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=700; f.Q.value=3;
    const g = this._env(dest, 0.001, 0.01, 0, 0.08, now);
    osc.connect(f); f.connect(g); osc.start(now); osc.stop(now+0.12);
  }

  _synthCrash(dest) {
    const now = this.ctx.currentTime;
    const n = this._noise(1.5);
    const f = this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=5000;
    const g = this._env(dest, 0.001, 0.05, 0.2, 1.2, now);
    n.connect(f); f.connect(g); n.start(now); n.stop(now+1.6);
  }

  _synthRide(dest) {
    const now = this.ctx.currentTime;
    const n = this._noise(0.8);
    const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=6000; f.Q.value=2;
    const g = this._env(dest, 0.001, 0.03, 0.15, 0.5, now);
    n.connect(f); f.connect(g); n.start(now); n.stop(now+0.85);
  }

  _synthShaker(dest) {
    const now = this.ctx.currentTime;
    const n = this._noise(0.1);
    const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=5000; f.Q.value=2;
    const g = this._env(dest, 0.001, 0.02, 0, 0.08, now);
    n.connect(f); f.connect(g); n.start(now); n.stop(now+0.12);
  }

  _synthTamb(dest) {
    const now = this.ctx.currentTime;
    for (let i=0;i<4;i++) {
      const n = this._noise(0.04);
      const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=4000+i*800; f.Q.value=1.5;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.6,now+i*0.015);
      g.gain.exponentialRampToValueAtTime(0.001,now+i*0.015+0.05);
      n.connect(f); f.connect(g); g.connect(dest);
      n.start(now+i*0.015); n.stop(now+i*0.015+0.06);
    }
  }

  _synthCowbell(dest) {
    const now = this.ctx.currentTime;
    const freqs = [562, 845];
    for (const fr of freqs) {
      const osc = this.ctx.createOscillator(); osc.type='square'; osc.frequency.value=fr;
      const g = this._env(dest, 0.001, 0.02, 0.1, 0.25, now);
      osc.connect(g); osc.start(now); osc.stop(now+0.4);
    }
  }

  async loadCustomPad(key, arrayBuffer) {
    try { this.customPads[key] = await this.ctx.decodeAudioData(arrayBuffer); } catch(e) { console.error(e); }
  }

  // Detecta el silencio inicial de un sample (primer pico por encima de un
  // umbral relativo al pico) para reproducir DESDE ahí y eliminar la latencia
  // entre el pad y el golpe. No destructivo: solo calcula un offset.
  _detectOnset(buffer) {
    try {
      const data = buffer.getChannelData(0);
      const sr = buffer.sampleRate;
      const maxScan = Math.min(data.length, Math.floor(sr * 0.5)); // hasta 500 ms
      let peak = 0;
      for (let i = 0; i < maxScan; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
      if (peak < 0.0008) return 0;                  // sample en silencio
      const thresh = Math.max(0.01, peak * 0.04);
      let onset = 0;
      for (let i = 0; i < maxScan; i++) { if (Math.abs(data[i]) > thresh) { onset = i; break; } }
      const preRoll = Math.floor(sr * 0.003);        // 3 ms de respiro antes del transitorio
      return Math.max(0, onset - preRoll) / sr;
    } catch (_) { return 0; }
  }

  // Guarda el buffer + su offset de onset.
  _setDrumBuffer(id, buffer) {
    this.customDrums[id] = buffer;
    this.customDrumOffsets[id] = this._detectOnset(buffer);
  }

  async loadCustomDrum(id, arrayBuffer) {
    try { this._setDrumBuffer(id, await this.ctx.decodeAudioData(arrayBuffer)); } catch(e) { console.error(e); }
  }

  async loadSingleDrum(id, url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok && resp.status !== 0) throw new Error(`HTTP ${resp.status}`);
      const ab = await resp.arrayBuffer();
      this._setDrumBuffer(id, await this.ctx.decodeAudioData(ab));
      console.log('Single drum sample loaded:', id, url);
      return true;
    } catch(e) {
      console.warn('Single drum sample not loaded:', url, e.message);
      return false;
    }
  }

  playCustomDrum(id, padId) {
    if (!this.customDrums[id]) return false;
    // Resume a suspended context BEFORE scheduling — a suspended ctx delays
    // (or swallows) the hit, which is unacceptable for live drum triggering.
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.customDrums[id];
    const dest = this._getDrumDest(padId);
    // Arranca desde el onset detectado para que el golpe suene al instante.
    src.connect(dest); src.start(now, this.customDrumOffsets[id] || 0);
    return true;
  }

  initDrumVolumes(pads) {
    Object.values(this.drumVolumes).forEach(g => { try { g.disconnect(); } catch{} });
    this.drumVolumes = {};
    for (const pad of pads) {
      const g = this.ctx.createGain(); g.gain.value = 0.8;
      g.connect(this.drumGain);
      this.drumVolumes[pad.id] = g;
    }
  }

  /* ── Load real WAV samples for a kit — returns list of loaded IDs ── */
  async loadKitSamples(pads) {
    this.customDrums = {};
    this.customDrumOffsets = {};
    const successfulIds = [];
    const loads = pads
      .filter(p => p.sample)
      .map(async p => {
        try {
          const resp = await fetch(p.sample);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const ab  = await resp.arrayBuffer();
          this._setDrumBuffer(p.id, await this.ctx.decodeAudioData(ab));
          successfulIds.push(p.id);
          console.log('Drum sample loaded:', p.id, p.sample);
        } catch(e) {
          console.warn('Drum sample not loaded (will use synth):', p.sample, e.message);
        }
      });
    await Promise.all(loads);
    return successfulIds;
  }

  /* ── Realistic metronome clicks ──
     `when` lets a lookahead scheduler request sample-accurate playback at a
     future AudioContext time. Omit (or pass <= currentTime) for "play now". */
  playClick(accent, soundType, volume, pan = 0, when = 0) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = (when && when > this.ctx.currentTime) ? when : this.ctx.currentTime;

    // Try real audio file first
    const fileKey = `${soundType}_${accent ? 'accent' : 'normal'}`;
    if (this._clickBuffers[fileKey]) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._clickBuffers[fileKey];
      const gainNode = this.ctx.createGain(); gainNode.gain.value = volume;
      const panNode  = this.ctx.createStereoPanner(); panNode.pan.value = pan;
      src.connect(gainNode); gainNode.connect(panNode); panNode.connect(this.ctx.destination);
      src.start(now);
      return;
    }

    // Fallback: synthesis
    const out = this.ctx.createGain(); out.gain.value = volume;
    const panNode = this.ctx.createStereoPanner(); panNode.pan.value = pan;
    out.connect(panNode); panNode.connect(this.ctx.destination);

    switch(soundType) {
      case 'classic':
      case 'logic': {
        // Logic-style studio click: sharp transient + quick decay
        const freq = accent ? 2200 : 1400;
        const osc1 = this.ctx.createOscillator(); osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, now);
        osc1.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.025);
        const g1 = this.ctx.createGain();
        g1.gain.setValueAtTime(accent ? 0.9 : 0.6, now);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        osc1.connect(g1); g1.connect(out); osc1.start(now); osc1.stop(now + 0.04);
        const n = this._noise(0.006);
        const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 0.8; nf.Q.value = 5;
        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(accent ? 1.2 : 0.75, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.006);
        n.connect(nf); nf.connect(ng); ng.connect(out); n.start(now); n.stop(now + 0.008);
        const osc2 = this.ctx.createOscillator(); osc2.type = 'sine';
        osc2.frequency.value = freq * 1.5;
        const g2 = this.ctx.createGain();
        g2.gain.setValueAtTime(accent ? 0.25 : 0.15, now);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
        osc2.connect(g2); g2.connect(out); osc2.start(now); osc2.stop(now + 0.025);
        break;
      }
      case 'blip': {
        // Clean sine blip — pure digital feel, two pitches
        const osc = this.ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(accent ? 1760 : 1100, now);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(accent ? 0.9 : 0.6, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.07);
        break;
      }
      case 'woodblock': {
        // Hollow wood block: bandpassed square wave, short resonance
        const freq = accent ? 1100 : 820;
        const osc = this.ctx.createOscillator(); osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + 0.04);
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 9;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(accent ? 1.0 : 0.65, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        const n = this._noise(0.015);
        const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 1.6; nf.Q.value = 3;
        const ng = this.ctx.createGain(); ng.gain.setValueAtTime(accent ? 0.5 : 0.32, now); ng.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
        n.connect(nf); nf.connect(ng); ng.connect(out); n.start(now); n.stop(now + 0.02);
        osc.connect(bp); bp.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.11);
        break;
      }
      case 'gentle': {
        // Soft muted click — low-pitched, slow attack, gentle decay
        const osc = this.ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(accent ? 660 : 440, now);
        osc.frequency.exponentialRampToValueAtTime(accent ? 400 : 280, now + 0.06);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(accent ? 0.7 : 0.4, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(lp); lp.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.13);
        break;
      }
      case 'percussive': {
        // Sharp percussive hit: noise burst + pitched body thump
        const n = this._noise(0.03);
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = accent ? 4000 : 2800; bp.Q.value = 1.2;
        const gn = this.ctx.createGain();
        gn.gain.setValueAtTime(accent ? 1.0 : 0.65, now);
        gn.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        n.connect(hp); hp.connect(bp); bp.connect(gn); gn.connect(out); n.start(now); n.stop(now + 0.035);
        const osc = this.ctx.createOscillator(); osc.type = 'triangle';
        osc.frequency.setValueAtTime(accent ? 320 : 200, now);
        osc.frequency.exponentialRampToValueAtTime(accent ? 120 : 80, now + 0.04);
        const g2 = this.ctx.createGain();
        g2.gain.setValueAtTime(accent ? 0.8 : 0.5, now);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(g2); g2.connect(out); osc.start(now); osc.stop(now + 0.05);
        break;
      }
      case 'digital': {
        // Electronic square-wave blip — buzzy, high-tech
        const osc = this.ctx.createOscillator(); osc.type = 'square';
        osc.frequency.setValueAtTime(accent ? 2200 : 1320, now);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = accent ? 3500 : 2500;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(accent ? 0.5 : 0.32, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(lp); lp.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.045);
        break;
      }
      case 'cowbell': {
        // Two-oscillator metallic cowbell
        const freqs = accent ? [562, 845] : [440, 660];
        for (const fr of freqs) {
          const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = fr;
          const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(accent ? 0.35 : 0.22, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + (accent ? 0.45 : 0.28));
          osc.connect(hp); hp.connect(g); g.connect(out); osc.start(now); osc.stop(now + (accent ? 0.5 : 0.3));
        }
        break;
      }
      default: {
        // Fallback: generic blip
        const osc = this.ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(accent ? 1760 : 1100, now);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(accent ? 0.9 : 0.6, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.07);
      }
    }
  }

  /* ── Click pan helper ── */
  setClickPan(v) { this._clickPan = v; }

  async initMIDI(onMidiMessage, onDevicesChanged) {
    if (!navigator.requestMIDIAccess) return;
    try {
      // requestMIDIAccess puede fallar al arrancar (driver MIDI todavía no listo,
      // permiso que tarda, USB reconectándose). Antes, si fallaba UNA vez, el MIDI
      // quedaba muerto hasta reiniciar la app. Reintentamos con backoff hasta
      // engancharlo. Como initMIDI se llama sin await, esto NO bloquea el boot.
      let midiAccess = null;
      for (let attempt = 0; attempt < 6 && !midiAccess; attempt++) {
        try { midiAccess = await navigator.requestMIDIAccess(); }
        catch (err) {
          if (attempt === 5) { console.warn('MIDI Access failed (sin más reintentos):', err); return; }
          await new Promise(r => setTimeout(r, Math.min(8000, 1500 * (attempt + 1))));
        }
      }
      if (!midiAccess) return;
      this._midiAccess = midiAccess;
      const inputs = () => [...midiAccess.inputs.values()];
      const namesOf = () => inputs().map(i => i.name || 'MIDI input');
      const idsOf = () => inputs().map(i => i.id).sort();
      // Re-liga TODAS las entradas y además abre el puerto explícitamente: en
      // Windows un puerto puede quedar 'connected' pero no 'open', y entonces no
      // llegan mensajes. open() es idempotente (no pasa nada si ya está abierto).
      const bindAll = () => {
        for (const i of midiAccess.inputs.values()) {
          i.onmidimessage = onMidiMessage;
          try { i.open(); } catch (_) {}
        }
      };
      let lastIds = [];

      // Re-liga las entradas y avisa SOLO si el set de dispositivos cambió.
      // initial=true fija la línea base sin lanzar el toast de "conectado" por
      // los controladores que ya estaban enchufados al abrir la app.
      const sync = (evt, initial = false) => {
        bindAll();
        const ids = idsOf();
        const changed = ids.length !== lastIds.length || ids.some((x, k) => x !== lastIds[k]);
        let useEvt = evt;
        if (!useEvt && changed && !initial) {
          // El poll detectó el cambio (statechange no disparó): inferir conexión
          // o desconexión comparando con el set anterior, para mostrar el aviso.
          const added = ids.find(id => !lastIds.includes(id));
          const removed = lastIds.find(id => !ids.includes(id));
          if (added) {
            const name = inputs().find(i => i.id === added)?.name || 'controlador';
            useEvt = { port: { type: 'input', state: 'connected', name } };
          } else if (removed) {
            useEvt = { port: { type: 'input', state: 'disconnected', name: 'controlador' } };
          }
        }
        lastIds = ids;
        if (typeof onDevicesChanged === 'function') onDevicesChanged(namesOf(), useEvt);
      };

      sync(null, true); // línea base, sin toast
      // Inmediato: conexión/desconexión vía el evento del navegador.
      midiAccess.onstatechange = (e) => sync(e);
      // Respaldo de hot-plug: en Windows el statechange a veces NO dispara al
      // enchufar el controlador con la app abierta. Re-escaneamos cada 1 s para
      // detectarlo rápido (y re-abrir/re-ligar el puerto) sin reiniciar la app.
      // Costo ínfimo: iterar un puñado de entradas una vez por segundo.
      if (this._midiPollTimer) clearInterval(this._midiPollTimer);
      this._midiPollTimer = setInterval(() => sync(null), 1000);
    } catch (err) { console.warn('MIDI Access failed:', err); }
  }

  _noteToHz(key) {
    const map = {
      'C':261.63,'C#':277.18,'Db':277.18,'D':293.66,'D#':311.13,'Eb':311.13,
      'E':329.63,'F':349.23,'F#':369.99,'Gb':369.99,'G':392.00,
      'G#':415.30,'Ab':415.30,'A':440.00,'A#':466.16,'Bb':466.16,'B':493.88
    };
    return map[key] || null;
  }
}
