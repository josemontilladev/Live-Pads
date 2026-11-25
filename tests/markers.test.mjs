import { test } from 'node:test';
import assert from 'node:assert/strict';
const { markersFor, withMarkersFor } = await import('../src/js/data/markers.js');

test('secciones por pista: cada pista las suyas; las antiguas mientras no tenga', () => {
  const song = { markers: [{ id: 'a', label: 'Verso', t: 10 }, { id: 'b', label: 'Coro', t: 40 }] };
  assert.equal(markersFor(song, 'sequence').length, 2);   // antiguas
  song.markers = withMarkersFor(song, 'sequence', [{ id: 'c', label: 'Intro', t: 0 }, { id: 'd', label: 'Verso', t: 12.4 }]);
  assert.deepEqual(markersFor(song, 'sequence').map((m) => m.t), [0, 12.4]);
  assert.deepEqual(markersFor(song, 'original').map((m) => m.t), [10, 40]);  // el original sigue con las antiguas
  song.markers = withMarkersFor(song, 'original', [{ id: 'e', label: 'Verso', t: 8 }]);
  assert.deepEqual(markersFor(song, 'original').map((m) => m.t), [8]);
  assert.deepEqual(markersFor(song, 'sequence').map((m) => m.t), [0, 12.4]);
  assert.ok(song.markers.every((m) => !m.src || ['sequence', 'original'].includes(m.src)));
});
