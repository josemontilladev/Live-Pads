import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedKeyChange, linkedPitchStep, recordingSemitone, shiftKey } from '../src/js/utils/keyLink.js';

const LETRA = '[Verso]\n[E]Puedo ver tu [B]hermosura\n[C#m]nada se [A]compara';

test('tarjeta E → D ligado: letra a D y audio −2 (la grabación sigue en E)', () => {
  const song = { key: 'E', lyrics: LETRA, audio: { pitch: 0 } };
  const r = linkedKeyChange(song, 'E', 'D');
  assert.equal(r.delta, -2);
  assert.equal(r.lyrics, '[Verso]\n[D]Puedo ver tu [A]hermosura\n[Bm]nada se [G]compara');
  assert.equal(r.pitch, -2);
  assert.equal(r.keyPitch, -2);
  // La grabación (tarjeta − keyPitch) sigue siendo E.
  assert.equal(recordingSemitone({ key: 'D', audio: { keyPitch: -2 } }), 4);
});

test('mismo sonido escrito distinto (D# → Cm, relativos): no hay transporte de altura… salvo que se pida', () => {
  // keyDelta compara raíces: D# → C es −3. Por eso la app PREGUNTA (transportar o solo corregir).
  const r = linkedKeyChange({ key: 'D#', lyrics: '', audio: {} }, 'D#', 'Cm');
  assert.equal(r.delta, -3);
  assert.equal(linkedKeyChange({ key: 'G', audio: {} }, 'G', 'G'), null);
});

test('▼ ligado: tarjeta, letra y keyPitch bajan un semitono con el audio', () => {
  const song = { key: 'E', lyrics: LETRA, audio: { pitch: -1, keyPitch: 0 } };
  const r = linkedPitchStep(song, -1);
  assert.equal(r.key, 'Eb');            // nombre habitual
  assert.equal(r.keyPitch, -1);
  assert.match(r.lyrics, /\[Eb\]Puedo ver tu \[Bb\]hermosura/);
  assert.match(r.lyrics, /\[Cm\]nada se \[Ab\]compara/);
});

test('ligar/desligar a mitad no descuadra el pad: grabación = tarjeta − keyPitch', () => {
  // Grabada en E, tarjeta en D (ligado, keyPitch −2), luego desligado y ▲ manual (+1): audio −1.
  const song = { key: 'D', audio: { pitch: -1, keyPitch: -2 } };
  const rec = recordingSemitone(song);          // E = 4
  assert.equal(rec, 4);
  // El pad = grabación + transporte del audio = E − 1 = Eb (3).
  assert.equal((rec + song.audio.pitch + 12) % 12, 3);
});

test('nombres de tono al mover', () => {
  assert.equal(shiftKey('F', 1), 'F#');
  assert.equal(shiftKey('G', -1), 'F#');
  assert.equal(shiftKey('Am', 1), 'Bbm');
  assert.equal(shiftKey('C', 3), 'Eb');
});

import { reconcileLinkedPitch } from '../src/js/utils/keyLink.js';
test('canción con semitonos de una versión antigua: se descartan (suena en el tono de la tarjeta)', () => {
  assert.deepEqual(reconcileLinkedPitch({ pitch: -2 }), { pitch: 0, keyPitch: 0, changed: true });
  assert.deepEqual(reconcileLinkedPitch({}), { pitch: 0, keyPitch: 0, changed: true });
});
test('con tono ligado: un ajuste suelto (▼ ▲ con el 🔗 apagado) se descarta', () => {
  assert.deepEqual(reconcileLinkedPitch({ pitch: 3, keyPitch: -2 }), { pitch: -2, keyPitch: -2, changed: true });
  assert.deepEqual(reconcileLinkedPitch({ pitch: -2, keyPitch: -2 }), { pitch: -2, keyPitch: -2, changed: false });
});

import { resetStrayPitches } from '../src/js/utils/keyLink.js';
test('limpieza del repertorio: solo lo que no viene del tono ligado', () => {
  const songs = [
    { title: 'Antigua', audio: { pitch: -2 } },
    { title: 'Incorporada sin marca', audio: { pitch: -3, keyPitch: -3 } },
    { title: 'Transportada con tono ligado', audio: { pitch: -2, keyPitch: -2, keyPitchSet: true } },
    { title: 'Limpia', audio: { pitch: 0, keyPitch: 0 } },
    { title: 'Sin audio' },
  ];
  assert.equal(resetStrayPitches(songs), 2);
  assert.deepEqual(songs.map((s) => s.audio && [s.audio.pitch, s.audio.keyPitch]), [[0, 0], [0, 0], [-2, -2], [0, 0], undefined]);
});
