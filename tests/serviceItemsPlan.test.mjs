import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planServiceItems } from '../src/js/cloud/serviceItemsPlan.js';

const title = (id) => `Canción ${id}`;
const items = () => [
  { id: 'w', position: 0, kind: 'welcome', song_id: null },
  { id: 'a', position: 1, kind: 'song', song_id: 'A', key: null },
  { id: 'b', position: 2, kind: 'song', song_id: 'B', key: null },
  { id: 'p', position: 3, kind: 'prayer', song_id: null },
  { id: 'c', position: 4, kind: 'song', song_id: 'C', key: 'G' },
];

test('sin cambios: no escribe nada', () => {
  const r = planServiceItems(items(), ['A', 'B', 'C'], { C: 'G' }, title);
  assert.equal(r.changed, false);
});

test('reordenar canciones: lo que no es canción se queda en su sitio', () => {
  const r = planServiceItems(items(), ['C', 'A', 'B'], { C: 'G' }, title);
  assert.deepEqual(r.deletes, []);
  assert.deepEqual(r.creates, []);
  // c pasa al hueco 1, a al 2, b al 4; bienvenida (0) y oración (3) no se mueven.
  assert.deepEqual(r.updates.sort((x, y) => x.id.localeCompare(y.id)), [
    { id: 'a', position: 2 }, { id: 'b', position: 4 }, { id: 'c', position: 1 },
  ]);
});

test('quitar y añadir canciones, con su tono del servicio', () => {
  const r = planServiceItems(items(), ['A', 'D', 'C'], { C: 'G', D: 'E' }, title);
  assert.deepEqual(r.deletes, ['b']);
  assert.deepEqual(r.creates, [{ kind: 'song', song_id: 'D', title: 'Canción D', key: 'E', position: 2 }]);
  assert.deepEqual(r.updates, []);
});

test('más canciones que huecos: van al final', () => {
  const r = planServiceItems(items(), ['A', 'B', 'C', 'E'], { C: 'G' }, title);
  assert.deepEqual(r.creates, [{ kind: 'song', song_id: 'E', title: 'Canción E', key: null, position: 5 }]);
});

test('cambio de tono de una canción del servicio', () => {
  const r = planServiceItems(items(), ['A', 'B', 'C'], { C: 'A' }, title);
  assert.deepEqual(r.updates, [{ id: 'c', key: 'A' }]);
});

test('servicio nuevo sin programa: todas las canciones en orden', () => {
  const r = planServiceItems([], ['A', 'B'], {}, title);
  assert.deepEqual(r.creates.map((x) => [x.song_id, x.position]), [['A', 0], ['B', 1]]);
});
