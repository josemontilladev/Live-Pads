// Grabador de tomas para practicar: graba el micrófono (o la interfaz) mientras
// suena el proyecto. Devuelve el audio crudo con su marca de tiempo; quien lo
// usa (workspace.js) lo coloca en el timeline, también partido en pasadas si se
// grabó en loop A-B.
//
//   const rec = await startTake(ctx, { deviceId, monitor });
//   rec.level()                → nivel de entrada 0..1 (para el vúmetro)
//   const { buffer, firstT, latency } = await rec.stop();
//   rec.cancel();
//   await calibrateLatency(ctx, { deviceId })  → segundos (ida y vuelta medida)
//   playClicks(ctx, times, { accentFirst })   → cuenta de entrada
//
// Sincronía: el worklet marca cada bloque con el currentTime del contexto. Lo
// que se oye sale `outputLatency` después de programarse y lo que se toca entra
// `inputLatency` después de sonar: una nota tocada "a tiempo" llega tarde por la
// suma de las dos. Si se calibró este equipo, se usa la medida real; si no, la
// estimación del navegador.

const WORKLET_URL = new URL('./takeRecorderWorklet.js', import.meta.url).href;
const loadedCtx = new WeakSet();
const CALIB_KEY = 'stems-take-latency';   // { [deviceId|'']: segundos }

export async function listInputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Entrada ${i + 1}` }));
  } catch (_) { return []; }
}

function readCalib() { try { return JSON.parse(localStorage.getItem(CALIB_KEY) || '{}') || {}; } catch (_) { return {}; } }
export function getCalibratedLatency(deviceId = '') {
  const v = readCalib()[deviceId || ''];
  return typeof v === 'number' && v >= 0 && v < 1 ? v : null;
}
export function setCalibratedLatency(deviceId = '', sec) {
  const all = readCalib();
  if (sec == null) delete all[deviceId || '']; else all[deviceId || ''] = sec;
  try { localStorage.setItem(CALIB_KEY, JSON.stringify(all)); } catch (_) {}
}

// Captura cruda: micrófono → worklet. Devuelve controles y, al parar, el
// buffer + el instante (reloj del contexto) de su primera muestra.
async function openCapture(ctx, { deviceId = '', monitor = false } = {}) {
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
  // Escucharse mientras se graba (con audífonos: con altavoces se acopla).
  let monitorGain = null;
  if (monitor) {
    monitorGain = ctx.createGain();
    monitorGain.gain.value = 1;
    source.connect(monitorGain).connect(ctx.destination);
  }

  // Cada bloque trae su marca de tiempo; el inicio se estima con la MEDIANA de
  // (marca − muestras previas): el primer bloque tras cargar el worklet puede
  // llegar con un currentTime de 0 y descolocaba la toma entera.
  const chunks = [];
  const starts = [];
  let frames = 0;
  node.port.onmessage = (e) => {
    starts.push(e.data.t - frames / ctx.sampleRate);
    frames += e.data.ch[0].length;
    chunks.push(e.data.ch);
  };

  const meter = new Float32Array(analyser.fftSize);
  let finished = false;
  function release() {
    finished = true;
    for (const n of [source, node, mute, monitorGain]) { try { n?.disconnect(); } catch (_) {} }
    stream.getTracks().forEach((t) => t.stop());
  }

  return {
    inputLatency,
    level() {
      if (finished) return 0;
      analyser.getFloatTimeDomainData(meter);
      let peak = 0;
      for (let i = 0; i < meter.length; i++) { const a = Math.abs(meter[i]); if (a > peak) peak = a; }
      return Math.min(1, peak);
    },
    cancel() { if (!finished) { node.port.postMessage('stop'); release(); } },
    async stop() {
      node.port.postMessage('stop');
      // Deja llegar el último bloque (flush) antes de soltar el micrófono.
      await new Promise((r) => setTimeout(r, 120));
      release();
      if (!chunks.length) return null;
      const s = starts.slice().sort((a, b) => a - b);
      const firstT = s[Math.floor(s.length / 2)];
      const channels = Math.max(...chunks.map((c) => c.length));
      const buffer = ctx.createBuffer(Math.min(2, channels), frames, ctx.sampleRate);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const out = buffer.getChannelData(c);
        let at = 0;
        for (const ch of chunks) { out.set(ch[Math.min(c, ch.length - 1)], at); at += ch[0].length; }
      }
      return { buffer, firstT };
    },
  };
}

export async function startTake(ctx, { deviceId = '', monitor = false } = {}) {
  const cap = await openCapture(ctx, { deviceId, monitor });
  const calibrated = getCalibratedLatency(deviceId);
  const outputLatency = Number(ctx.outputLatency) || Number(ctx.baseLatency) || 0;
  const latency = calibrated != null ? calibrated : cap.inputLatency + outputLatency;
  return {
    latency,
    calibrated: calibrated != null,
    level: cap.level,
    cancel: cap.cancel,
    async stop() {
      const r = await cap.stop();
      return r ? { ...r, latency } : null;
    },
  };
}

/** Clicks cortos en los instantes `times` (reloj del contexto). El primero, acentuado. */
export function playClicks(ctx, times, { accentFirst = true } = {}) {
  const nodes = [];
  times.forEach((t, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accentFirst && i === 0 ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.06);
    nodes.push(o);
  });
  return () => nodes.forEach((o) => { try { o.stop(); } catch (_) {} });
}

/**
 * Mide la latencia real de ida y vuelta: suenan 6 clicks por la salida, el
 * micrófono los capta y se mide cuánto tardan en llegar. Hace falta que el
 * micrófono "oiga" los altavoces (o un cable de la salida a la entrada).
 * Devuelve segundos; lanza un Error legible si no se detectan los clicks.
 */
export async function calibrateLatency(ctx, { deviceId = '' } = {}) {
  if (ctx.state === 'suspended') await ctx.resume();
  const cap = await openCapture(ctx, { deviceId });
  await new Promise((r) => setTimeout(r, 400));          // deja asentar la entrada
  const t0 = ctx.currentTime + 0.3;
  const times = Array.from({ length: 6 }, (_, i) => t0 + i * 0.5);
  playClicks(ctx, times, { accentFirst: false });
  await new Promise((r) => setTimeout(r, (times[times.length - 1] - ctx.currentTime + 0.7) * 1000));
  const r = await cap.stop();
  if (!r) throw new Error('No llegó audio del micrófono.');
  const data = r.buffer.getChannelData(0);
  const sr = r.buffer.sampleRate;
  // Ruido de fondo: antes del primer click.
  const preEnd = Math.max(0, Math.floor((t0 - r.firstT) * sr) - 1);
  let noise = 0;
  for (let i = 0; i < preEnd; i++) noise = Math.max(noise, Math.abs(data[i]));
  const threshold = Math.max(0.02, noise * 4);
  const delays = [];
  for (const t of times) {
    const from = Math.max(0, Math.floor((t - r.firstT) * sr));
    const to = Math.min(data.length, from + Math.floor(0.4 * sr));
    for (let i = from; i < to; i++) {
      if (Math.abs(data[i]) > threshold) { delays.push(i / sr + r.firstT - t); break; }
    }
  }
  if (delays.length < 3) throw new Error('No se oyeron los clicks: sube el volumen, acerca el micrófono a los altavoces o revisa la entrada elegida.');
  delays.sort((a, b) => a - b);
  const median = delays[Math.floor(delays.length / 2)];
  // Si las medidas no coinciden entre sí, el resultado no es fiable.
  if (delays[delays.length - 1] - delays[0] > 0.03 && delays.length < 5) throw new Error('La medida salió inestable. Prueba en un lugar más silencioso.');
  return Math.max(0, median);
}
