// AudioWorklet del grabador de tomas: copia la entrada (micrófono/interfaz) en
// bloques de ~2048 muestras y los manda al hilo principal junto con el
// `currentTime` del contexto en que empezó cada bloque. Esa marca es la que
// permite colocar la toma exactamente en el timeline.
class TakeRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = null;      // [Float32Array por canal]
    this.fill = 0;
    this.t0 = 0;
    this.size = 2048;
    this.active = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.active = false; } };
  }

  flush() {
    if (!this.chunk || !this.fill) return;
    const ch = this.chunk.map((c) => c.slice(0, this.fill));
    this.port.postMessage({ t: this.t0, ch }, ch.map((c) => c.buffer));
    this.chunk = null;
    this.fill = 0;
  }

  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0];
    if (!input || !input.length) return true;
    const n = input[0].length;
    if (!this.chunk) {
      this.chunk = input.map(() => new Float32Array(this.size));
      this.fill = 0;
      this.t0 = currentTime;
    }
    for (let c = 0; c < input.length && c < this.chunk.length; c++) this.chunk[c].set(input[c], this.fill);
    this.fill += n;
    if (this.fill + n > this.size) this.flush();
    return true;
  }
}

registerProcessor('take-recorder', TakeRecorderProcessor);
