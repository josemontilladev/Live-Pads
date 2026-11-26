import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normKey, keysAgree, bpmsAgree, packMeta, pickProbeTracks, resolveItem, reviewIssues, estimateCloudBytes } from '../src/js/stems/batchCore.js';

test('tonos: normaliza a los de la biblioteca', () => {
  assert.equal(normKey('A#'), 'Bb');
  assert.equal(normKey('D#m'), 'Ebm');
  assert.equal(normKey('Dbm'), 'C#m');
  assert.equal(normKey('e'), 'E');
  assert.equal(normKey('Fmin'), 'Fm');
  assert.equal(normKey('H'), '');
});

test('tonos iguales, enarmónicos o relativos cuadran', () => {
  assert.ok(keysAgree('C#', 'Db'));
  assert.ok(keysAgree('C', 'Am'));
  assert.ok(keysAgree('F#m', 'A'));
  assert.ok(!keysAgree('E', 'C'));
});

test('BPM: igual, doble o mitad cuadran', () => {
  assert.ok(bpmsAgree(72, 72.8));
  assert.ok(bpmsAgree(70, 140));
  assert.ok(bpmsAgree(140, 70));
  assert.ok(!bpmsAgree(72, 80));
});

test('nombre del ZIP: título, artista, BPM y tono; artista dudoso se quita', () => {
  const a = packMeta('Way Maker - Leeland - 68 BPM - E');
  assert.deepEqual([a.title, a.artist, a.bpm, a.key], ['Way Maker', 'Leeland', 68, 'E']);
  const b = packMeta('Agnus dei - Secuencia');
  assert.equal(b.artist, '');
  assert.equal(b.artistDoubt, 'Secuencia');
  const c = packMeta('Algo Nuevo Viene - Algo Nuevo Viene');
  assert.equal(c.artist, '');
});

test('pistas para comprobar: click para BPM, armónica para el tono', () => {
  assert.deepEqual(pickProbeTracks(['guide', 'click', 'drums', 'bass', 'keys']), { bpm: 1, key: 4 });
  assert.deepEqual(pickProbeTracks(['drums', 'vocals']), { bpm: 0, key: 1 });
});

test('valores finales: corrección > nombre > detectado', () => {
  const it = { meta: { title: 'X', artist: '', bpm: null, key: '' }, detected: { bpm: 71.6, key: 'A#' } };
  assert.deepEqual(resolveItem(it), { title: 'X', artist: '', bpm: 72, key: 'Bb', tier: 'pro' });
  it.edit = { bpm: '70', key: 'C', tier: 'free', artist: 'Yo' };
  assert.deepEqual(resolveItem(it), { title: 'X', artist: 'Yo', bpm: 70, key: 'C', tier: 'free' });
});

test('avisos: falta BPM bloquea; desacuerdos y dudas avisan', () => {
  const none = reviewIssues({ meta: { title: 'X', artist: 'A', bpm: null, key: 'E' }, detected: {} });
  assert.ok(none.some((i) => i.level === 'bad' && /BPM/.test(i.text)));
  const diff = reviewIssues({ meta: { title: 'X', artist: 'A', bpm: 72, key: 'E' }, detected: { bpm: 80, key: 'C' } });
  assert.ok(diff.some((i) => i.level === 'warn' && /BPM: el nombre dice 72/.test(i.text)));
  assert.ok(diff.some((i) => /Tono: el nombre dice E/.test(i.text)));
  const ok = reviewIssues({ meta: { title: 'X', artist: 'A', bpm: 72, key: 'E' }, detected: { bpm: 144, key: 'C#m' } });
  assert.deepEqual(ok, []);
  const dup = reviewIssues({ meta: { title: 'Baila', artist: 'A', bpm: 130, key: 'E' } }, new Set(['baila']));
  assert.ok(dup.some((i) => /Ya hay un pack/.test(i.text)));
});

test('peso estimado en la nube', () => {
  assert.equal(Math.round(estimateCloudBytes([{ name: 'a.wav', size: 100 }, { name: 'b.mp3', size: 10 }])), 24);
});

import { pickCover } from '../src/js/stems/batchCore.js';
test('portada del ZIP: por nombre o la más grande; nada si no hay', () => {
  assert.equal(pickCover([{ name: 'photo.jpg', size: 900000 }, { name: 'Artwork/Cover.png', size: 300000 }]).name, 'Artwork/Cover.png');
  assert.equal(pickCover([{ name: 'a.jpg', size: 20000 }, { name: 'b.jpg', size: 90000 }]).name, 'b.jpg');
  assert.equal(pickCover([{ name: 'back cover.jpg', size: 900000 }, { name: 'x.jpg', size: 50000 }]).name, 'x.jpg');
  assert.equal(pickCover([{ name: 'icon.png', size: 2000 }]), null);
});
