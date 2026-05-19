// Web Audio API lookahead metronome — drift-free, sample-accurate timing
// even under main-thread load (heavy DOM renders, GC pauses, etc.).
//
// Pattern (Chris Wilson, https://www.html5rocks.com/en/tutorials/audio/scheduling/):
//   - A coarse JS timer (setInterval ~25ms) wakes up the scheduler.
//   - On each wake-up we look LOOKAHEAD_SEC ahead in AudioContext time and
//     pre-schedule any beats due before that horizon, with their exact
//     `when` time. The audio engine fires the note sample-accurately.
//   - Visual `onBeat` callbacks are queued via setTimeout so the UI flashes
//     ~at the right wall-clock instant (good enough for beat dots).
//
// The old setTimeout-chain scheduler drifted because setTimeout jitter
// accumulated. With lookahead, even a delayed scheduler tick still produces
// musically perfect timing — we just schedule more notes when we wake up.

const LOOKAHEAD_SEC = 0.1;   // schedule this far ahead of currentTime
const TICK_MS       = 25;    // how often the scheduler wakes

export class Metronome {
  constructor(engine) {
    this.engine  = engine;
    this.bpm     = 120;
    this.beats   = 4;
    this.running = false;
    this.currentBeat = 0;
    this._tapTimes = [];
    this.onBeat  = null;
    this.multiplier = 1;
    this.volume  = 0.8;
    this.sound   = 'logic';
    this.accents = [0];
    this.pan     = 0;

    // Scheduler state
    this._schedulerTimer = null;     // setInterval handle
    this._nextNoteTime   = 0;        // ctx.currentTime when next beat fires
    this._scheduledBeats = [];       // [{ timeoutId, when }] pending UI callbacks
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.currentBeat = 0;

    if (this.engine && this.engine.ctx) {
      // Tiny lead so the first beat isn't behind currentTime.
      this._nextNoteTime = this.engine.ctx.currentTime + 0.05;
    } else {
      this._nextNoteTime = 0;
    }

    this._scheduler();
    this._schedulerTimer = setInterval(() => this._scheduler(), TICK_MS);
  }

  stop() {
    this.running = false;
    if (this._schedulerTimer) {
      clearInterval(this._schedulerTimer);
      this._schedulerTimer = null;
    }
    // Cancel any pending visual callbacks so a stopped metronome doesn't
    // strobe its beat dot after the user hit stop.
    for (const s of this._scheduledBeats) clearTimeout(s.timeoutId);
    this._scheduledBeats = [];
    this.currentBeat = 0;
  }

  toggle() {
    if (this.running) this.stop(); else this.start();
    return this.running;
  }

  setBPM(v) {
    this.bpm = Math.max(30, Math.min(300, Math.round(v)));
    // With lookahead, we don't need to stop/start on tempo change — the
    // next note time stays valid and subsequent beats space out at the new
    // interval. But if we're not running yet, there's nothing to do.
  }

  setBeats(n) {
    this.beats = n;
    this.accents = this.accents.filter(a => a < n);
    if (this.accents.length === 0) this.accents = [0];
  }

  toggleAccent(idx) {
    const pos = this.accents.indexOf(idx);
    if (pos > -1) this.accents.splice(pos, 1);
    else this.accents.push(idx);
  }

  tap() {
    const now = Date.now();
    this._tapTimes = this._tapTimes.filter(t => now - t < 3000);
    this._tapTimes.push(now);
    if (this._tapTimes.length >= 2) {
      const gaps = [];
      for (let i = 1; i < this._tapTimes.length; i++) {
        gaps.push(this._tapTimes[i] - this._tapTimes[i - 1]);
      }
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      this.setBPM(Math.round(60000 / avg));
    }
    return this.bpm;
  }

  // Scheduler core: any beats due before now + LOOKAHEAD_SEC get scheduled.
  _scheduler() {
    if (!this.running || !this.engine || !this.engine.ctx) return;

    const ctxTime = this.engine.ctx.currentTime;
    while (this._nextNoteTime < ctxTime + LOOKAHEAD_SEC) {
      this._scheduleBeat(this._nextNoteTime, this.currentBeat);
      this._advanceBeat();
    }

    // Garbage-collect already-fired visual callbacks
    const cutoff = Date.now();
    this._scheduledBeats = this._scheduledBeats.filter(s => s.when > cutoff);
  }

  _scheduleBeat(time, beatIndex) {
    const isAccent = this.accents.includes(beatIndex);
    // Schedule the audio sample-accurately
    this.engine.playClick(isAccent, this.sound, this.volume, this.pan, time);

    // Schedule the visual callback (beat dot animation) at the wall-clock
    // moment that corresponds to `time`. Using performance.now would be
    // perfect but Date.now is good enough at human visual resolution.
    if (this.onBeat) {
      const ctxNow = this.engine.ctx.currentTime;
      const delayMs = Math.max(0, (time - ctxNow) * 1000);
      const fireAt = Date.now() + delayMs;
      const timeoutId = setTimeout(() => {
        if (this.running && this.onBeat) this.onBeat(beatIndex);
      }, delayMs);
      this._scheduledBeats.push({ timeoutId, when: fireAt });
    }
  }

  _advanceBeat() {
    const interval = 60 / (this.bpm * this.multiplier); // seconds
    this._nextNoteTime += interval;
    this.currentBeat = (this.currentBeat + 1) % this.beats;
  }
}
