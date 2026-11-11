import test from 'node:test';
import assert from 'node:assert/strict';
import { wavSeconds, estimateSeconds, estimateDecodedBytes, memoryRisk } from '../src/js/stems/memoryEstimate.js';

function wavHeader(byteRate) {
  const dv = new DataView(new ArrayBuffer(44));
  dv.setUint32(0, 0x52494646, false); dv.setUint32(8, 0x57415645, false); dv.setUint32(28, byteRate, true);
  return dv;
}

test('WAV: duración exacta desde la cabecera', () => {
  const byteRate = 44100 * 2 * 2;                       // 16 bits estéreo
  assert.equal(Math.round(wavSeconds(wavHeader(byteRate), 44 + byteRate * 240)), 240);
  assert.equal(wavSeconds(new DataView(new ArrayBuffer(44)), 1000), null);   // no es WAV
});

test('MP3: se estima por tamaño; 4 min ≈ 92 MB en memoria', () => {
  const size = (160000 / 8) * 240;                      // 4 min a 160 kbps = 4,8 MB
  assert.equal(Math.round(estimateSeconds('bajo.mp3', size)), 240);
  const mb = estimateDecodedBytes('bajo.mp3', size) / 1048576;
  assert.ok(mb > 85 && mb < 95, `≈ ${mb.toFixed(0)} MB`);
});

test('riesgo: 12 pistas de 4 min avisan en 2 GB, no en 8 GB', () => {
  const total = 12 * estimateDecodedBytes('x.mp3', (160000 / 8) * 240);   // ≈ 1,03 GB
  assert.equal(memoryRisk(total, 2).risky, true);
  assert.equal(memoryRisk(total, 8).risky, false);
  assert.equal(memoryRisk(3 * 1024 ** 3, 8).risky, true);
});
