// Worker que comprime a MP3 fuera del hilo de la ventana. Varios a la vez
// (uno por núcleo) para que un pack de muchas pistas tarde mucho menos.
import { encodePcmToMp3 } from './mp3Core.js';

self.onmessage = (e) => {
  const { id, left, right, sampleRate, kbps } = e.data;
  try {
    const mp3 = encodePcmToMp3(left, right || null, sampleRate, kbps);
    self.postMessage({ id, mp3 }, [mp3]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
