export class Metronome {
  constructor(engine) {
    this.engine  = engine;
    this.bpm     = 120;
    this.beats   = 4;
    this.running = false;
    this.currentBeat = 0;
    this._timer  = null;
    this._tapTimes = [];
    this.onBeat  = null;
    this.multiplier = 1;
    this.volume  = 0.8;
    this.sound   = 'logic';  // default to real files
    this.accent  = true;
    this.pan     = 0;        // -1 left … 0 center … 1 right
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.currentBeat = 0;
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.currentBeat = 0;
  }

  toggle() {
    if (this.running) this.stop(); else this.start();
    return this.running;
  }

  setBPM(v) {
    this.bpm = Math.max(30, Math.min(300, Math.round(v)));
    if (this.running) { this.stop(); this.start(); }
  }

  setBeats(n) { this.beats = n; }

  tap() {
    const now = Date.now();
    this._tapTimes = this._tapTimes.filter(t => now - t < 3000);
    this._tapTimes.push(now);
    if (this._tapTimes.length >= 2) {
      const gaps = [];
      for (let i = 1; i < this._tapTimes.length; i++) gaps.push(this._tapTimes[i] - this._tapTimes[i-1]);
      const avg = gaps.reduce((a,b) => a+b, 0) / gaps.length;
      this.setBPM(Math.round(60000 / avg));
    }
    return this.bpm;
  }

  _schedule() {
    if (!this.running) return;
    const isAccent = this.accent && this.currentBeat === 0;
    this.engine.playClick(isAccent, this.sound, this.volume, this.pan);
    if (this.onBeat) this.onBeat(this.currentBeat);
    this.currentBeat = (this.currentBeat + 1) % this.beats;
    const interval = 60000 / (this.bpm * this.multiplier);
    this._timer = setTimeout(() => this._schedule(), interval);
  }
}
