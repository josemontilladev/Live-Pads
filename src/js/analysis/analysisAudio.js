// ─────────────────────────────────────────────────────────────────────────
// Audio para los análisis del proceso principal (pulsos, acordes).
//
// Antes cada análisis rehacía la pista en mono a 22 050 Hz y la mandaba entera
// por IPC (unos 26 MB de una vez): copiarla congelaba la interfaz 60–100 ms, y
// en ese rato los golpes MIDI esperaban. Ahora:
//  · la versión mono se calcula UNA vez por pista (la comparten los análisis);
//  · se envía en trozos de ~256 KB cediendo el hilo entre trozos (tal cual, en
//    Float32: convertir a 16 bits era un bucle en JS que en portátiles costaba más
//    que la propia copia);
//  · el proceso principal la guarda con un identificador y cada análisis la pide
//    por ese identificador.
// ─────────────────────────────────────────────────────────────────────────

const SR = 22050;
const CHUNK = 65536;    // muestras por trozo (256 KB en Float32)
const monoCache = new WeakMap();    // AudioBuffer → Promise<Float32Array>
const tokenCache = new WeakMap();   // AudioBuffer → Promise<string>
let seq = 0;

/** La pista en mono a 22 050 Hz (el remuestreo lo hace el motor de audio, fuera de este hilo). */
export function mono22050(buffer) {
  if (!monoCache.has(buffer)) {
    monoCache.set(buffer, (async () => {
      const len = Math.max(1, Math.ceil(buffer.duration * SR));
      const off = new OfflineAudioContext(1, len, SR);
      const src = off.createBufferSource();
      src.buffer = buffer; src.connect(off.destination); src.start();
      return (await off.startRendering()).getChannelData(0);
    })());
  }
  return monoCache.get(buffer);
}

const yieldNow = () => new Promise((r) => setTimeout(r, 0));

/** Sube la pista (mono 22 050 Hz) al proceso principal; devuelve su identificador. */
export function uploadForAnalysis(buffer) {
  const api = window.electronAPI;
  if (!api || !api.analysisAudioChunk) return Promise.reject(new Error('sin IPC de análisis'));
  if (!tokenCache.has(buffer)) {
    const job = (async () => {
      const mono = await mono22050(buffer);
      const token = `a${Date.now().toString(36)}${(++seq).toString(36)}`;
      for (let off = 0; off < mono.length; off += CHUNK) {
        const n = Math.min(CHUNK, mono.length - off);
        // slice (copia solo el trozo): un subarray arrastraría al IPC el búfer entero de 26 MB.
        await api.analysisAudioChunk({ token, offset: off, total: mono.length, data: mono.slice(off, off + n) });
        await yieldNow();
      }
      return token;
    })();
    job.catch(() => tokenCache.delete(buffer));
    tokenCache.set(buffer, job);
  }
  return tokenCache.get(buffer);
}

/** Si el proceso principal ya olvidó la pista (caducó), se vuelve a subir. */
export function forgetUpload(buffer) { tokenCache.delete(buffer); }
