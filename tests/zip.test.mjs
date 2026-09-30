import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, crc32 } from '../src/js/utils/zip.js';

test('crc32 estándar', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip: estructura, nombres únicos y tamaño', () => {
  const z = createZip();
  z.add('Cancion/Pistas/01 - Voces.mp3', new Uint8Array([1, 2, 3]));
  z.add('Cancion/Pistas/01 - Voces.mp3', new Uint8Array([4]));   // duplicado → "(2)"
  const out = z.finish();
  assert.equal(z.count, 2);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);                 // cabecera local
  assert.equal(dv.getUint32(out.length - 22, true), 0x06054b50);   // fin de directorio central
  assert.equal(dv.getUint16(out.length - 22 + 10, true), 2);       // 2 entradas
  const text = new TextDecoder().decode(out);
  assert.ok(text.includes('01 - Voces (2).mp3'));
});
