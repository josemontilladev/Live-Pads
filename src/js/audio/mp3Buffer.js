// AudioBuffer → MP3 (lamejs). Vive aparte de mp3Encode.js para que el codificador
// (269 KB) solo se cargue cuando de verdad se comprime algo, no al arrancar la app.
import { encodePcmToMp3 } from './mp3Core.js';

export function audioBufferToMp3(buffer, kbps = 192) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  return encodePcmToMp3(left, right, buffer.sampleRate, kbps);
}
