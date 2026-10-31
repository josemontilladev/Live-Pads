// Grabador de tomas para practicar: graba el micrófono (o la interfaz) mientras
// suena el proyecto y devuelve la toma ya colocada en el timeline.
//
//   const rec = await startTake(ctx, { toTimeline: (ctxTime) => sec });
//   rec.level()                → nivel de entrada 0..1 (para el vúmetro)
//   const { buffer, startSec } = await rec.stop();
//   rec.cancel();
//
// Sincronía: el worklet marca cada bloque con el currentTime del contexto. Lo
// que se oye sale `outputLatency` después de programarse y lo que se toca entra
// `inputLatency` después de sonar, así que una nota tocada "a tiempo" llega
// tarde por la suma de las dos: se resta para que la toma caiga en su compás.

const WORKLET_URL = new URL('./takeRecorderWorklet.js', import.meta.url).href;
const loadedCtx = new WeakSet();

export async function listInputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Entrada ${i + 1}` }));
  } catch (_) { return []; }
}

export async function startTake(ctx, { deviceId = '', toTimeline }) {
  // Sin procesado de voz: para grabar música, la señal tal cual.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: { ideal: 2 },
    },
  });
  if (!loadedCtx.has(ctx)) { await ctx.audioWorklet.addModule(WORKLET_URL); loadedCtx.add(ctx); }

  const track = stream.getAudioTracks()[0];
  const inputLatency = Number(track?.getSettings?.().latency) || 0;
  const outputLatency = Number(ctx.outputLatency) || Number(ctx.baseLatency) || 0;
  const latency = inputLatency + outputLatency;

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'take-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'explicit', channelCount: 2 });
  // Salida muda hacia el destino: así el contexto procesa el nodo siempre (sin
  // conexión de salida algunos navegadores lo dejan de llamar).
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(node);
  node.connect(mute).connect(ctx.destination);
  source.connect(analyser);

  // Cada bloque trae su marca de tiempo; el inicio de la toma se estima con la
  // MEDIANA de (marca − muestras previas): el primer bloque tras cargar el
  // worklet puede llegar con un currentTime de 0 y descolocaba la toma entera.
  const chunks = [];
  const starts = [];
  let frames = 0;
  node.port.onmessage = (e) => {
    starts.push(e.data.t - frames / ctx.sampleRate);
    frames += e.data.ch[0].length;
    chunks.push(e.data.ch);
  };
  const startTime = () => {
    const s = starts.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };

  const meter = new Float32Array(analyser.fftSize);
  let finished = false;
  function release() {
    finished = true;
    try { source.disconnect(); } catch (_) {}
    try { node.disconnect(); mute.disconnect(); } catch (_) {}
    stream.getTracks().forEach((t) => t.stop());
  }

  return {
    latency,
    level() {
      if (finished) return 0;
      analyser.getFloatTimeDomainData(meter);
      let peak = 0;
      for (let i = 0; i < meter.length; i++) { const a = Math.abs(meter[i]); if (a > peak) peak = a; }
      return Math.min(1, peak);
    },
    cancel() { if (!finished) { node.port.postMessage('stop'); release(); } },
    // Para y devuelve { buffer, startSec } (startSec = dónde empieza en el timeline).
    async stop() {
      node.port.postMessage('stop');
      // Deja llegar el último bloque (flush) antes de soltar el micrófono.
      await new Promise((r) => setTimeout(r, 120));
      release();
      const firstT = startTime();
      if (!chunks.length || firstT == null) return null;
      const channels = Math.max(...chunks.map((c) => c.length));
      const length = chunks.reduce((n, c) => n + c[0].length, 0);
      const buffer = ctx.createBuffer(Math.min(2, channels), length, ctx.sampleRate);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const out = buffer.getChannelData(c);
        let at = 0;
        for (const ch of chunks) { out.set(ch[Math.min(c, ch.length - 1)], at); at += ch[0].length; }
      }
      return { buffer, startSec: toTimeline(firstT - latency) };
    },
  };
}
