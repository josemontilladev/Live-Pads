import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planFromItems, plansList, serviceTypes, chartToLyrics, cleanKey, matchSongs } from '../src/js/cloud/planningCenterCore.js';

const require = createRequire(import.meta.url);
const { createPco } = require('../planningCenter.js');

// Respuesta con la forma real de /service_types/:id/plans/:id/items?include=song,arrangement,key
const ITEMS = {
  data: [
    { type: 'Item', id: '10', attributes: { title: 'Bienvenida', item_type: 'item', sequence: 1 } },
    { type: 'Item', id: '12', attributes: { title: 'Grande es tu fidelidad', item_type: 'song', sequence: 3, key_name: 'D' },
      relationships: { song: { data: { type: 'Song', id: 's2' } }, arrangement: { data: { type: 'Arrangement', id: 'a2' } }, key: { data: null } } },
    { type: 'Item', id: '11', attributes: { title: 'Way Maker', item_type: 'song', sequence: 2, key_name: 'G - A' },
      relationships: { song: { data: { type: 'Song', id: 's1' } }, arrangement: { data: { type: 'Arrangement', id: 'a1' } }, key: { data: { type: 'Key', id: 'k1' } } } },
    { type: 'Item', id: '13', attributes: { title: 'Ofrenda', item_type: 'header', sequence: 4 } },
  ],
  included: [
    { type: 'Song', id: 's1', attributes: { title: 'Way Maker', author: 'Sinach', ccli_number: 7115744 } },
    { type: 'Song', id: 's2', attributes: { title: 'Grande es tu fidelidad', author: '' } },
    { type: 'Arrangement', id: 'a1', attributes: { name: 'Default', bpm: 68.0, chord_chart: 'VERSE 1\n[G]You are here, [D]moving in our midst\n\nCHORUS\n[C]Way maker\nCOLUMN_BREAK\n{c: Puente}\n{title: x}', sequence: ['V1', 'C'] } },
    { type: 'Arrangement', id: 'a2', attributes: { name: 'Default', bpm: null, chord_chart: '', lyrics: 'Oh Dios eterno' } },
    { type: 'Key', id: 'k1', attributes: { name: 'G', starting_key: 'G' } },
  ],
};

test('del plan solo salen las canciones, en su orden, con tono, BPM y letra', () => {
  const s = planFromItems(ITEMS);
  assert.deepEqual(s.map((x) => x.title), ['Way Maker', 'Grande es tu fidelidad']);
  assert.equal(s[0].artist, 'Sinach');
  assert.equal(s[0].ccli, '7115744');
  assert.equal(s[0].key, 'G');          // «G - A» (modula): el tono de salida
  assert.equal(s[0].bpm, 68);
  assert.match(s[0].lyrics, /\[VERSO 1\]/);
  assert.match(s[0].lyrics, /\[CORO\]/);
  assert.match(s[0].lyrics, /\[G\]You are here/);
  assert.doesNotMatch(s[0].lyrics, /COLUMN_BREAK|title:/);
  assert.equal(s[1].key, 'D');
  assert.equal(s[1].bpm, null);
  assert.equal(s[1].lyrics, 'Oh Dios eterno');   // sin hoja de acordes: la letra sola
});

test('tonos y hojas de acordes raros', () => {
  assert.equal(cleanKey('Bb'), 'Bb');
  assert.equal(cleanKey('F#m'), 'F#m');
  assert.equal(cleanKey(''), '');
  assert.equal(cleanKey('xyz'), '');
  assert.equal(chartToLyrics(''), '');
  assert.match(chartToLyrics('{comment: Coro}\nAleluya'), /\[CORO\]\nAleluya/);
});

test('lista de planes y tipos de servicio', () => {
  const p = plansList({ data: [{ id: '5', attributes: { title: 'Santa Cena', sort_date: '2026-12-06T10:00:00Z', dates: '6 diciembre 2026' } }, { id: '6', attributes: {} }] });
  assert.deepEqual(p[0], { id: '5', title: 'Santa Cena', date: '2026-12-06', label: '6 diciembre 2026 · Santa Cena' });
  assert.equal(p[1].label, 'Servicio');
  assert.deepEqual(serviceTypes({ data: [{ id: '1', attributes: { name: 'Domingo' } }] }), [{ id: '1', name: 'Domingo' }]);
});

test('casa las canciones con la librería (id de Planning Center, CCLI, título) y crea las que faltan', () => {
  const lib = [
    { id: 'a', title: 'Way Maker', artist: 'Sinach' },
    { id: 'b', title: 'Grande Es Tu Fidelidad', artist: 'Himno' },
    { id: 'c', title: 'Otra', ccli: '999' },
  ];
  const pco = planFromItems(ITEMS).concat([{ title: 'Nueva', artist: '', ccli: '999', key: 'E', bpm: 70, lyrics: 'x' }, { title: 'Sin casar', artist: 'Yo', key: 'A', bpm: null, lyrics: '', pcoSongId: '77' }]);
  const m = matchSongs(lib, pco, 1000);
  assert.equal(m[0].song.id, 'a');
  assert.equal(m[1].song.id, 'b');            // sin autor en Planning Center: casa por título
  assert.equal(m[2].song.id, 'c');            // por CCLI aunque el título sea otro
  assert.equal(m[3].isNew, true);
  assert.equal(m[3].song.title, 'Sin casar');
  assert.equal(m[3].song.pcoSongId, '77');
  assert.equal(m[3].song.key, 'A');
  assert.deepEqual(m[3].song.audio, { sequence: null, original: null });
  // Repetida en el mismo plan: no se crea dos veces.
  const twice = matchSongs([], [{ title: 'X', artist: '' }, { title: 'X', artist: '' }], 1);
  assert.equal(twice[0].song, twice[1].song);
  assert.equal(twice.filter((x) => x.isNew).length, 1);
});

test('el cliente solo lee /services/v2, manda la clave y da errores claros', async () => {
  const calls = [];
  let saved = null;
  const fetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.endsWith('/services/v2')) return { ok: true, status: 200, json: async () => ({ data: { attributes: { name: 'Iglesia' } } }) };
    if (url.includes('page=2')) return { ok: true, status: 200, json: async () => ({ data: [{ id: '2' }] }) };
    if (url.includes('/service_types')) return { ok: true, status: 200, json: async () => ({ data: [{ id: '1' }], links: { next: 'https://api.planningcenteronline.com/services/v2/service_types?page=2' } }) };
    return { ok: false, status: 401, json: async () => ({}) };
  };
  const pco = createPco({ fetch, readCreds: () => saved, writeCreds: (c) => { saved = c; } });
  assert.equal(pco.status().connected, false);
  await assert.rejects(pco.get('/services/v2/service_types'), /no está conectado/);
  await assert.rejects(pco.connect('', 'x'), /Falta/);
  const r = await pco.connect('app123', 'sec');
  assert.equal(r.org, 'Iglesia');
  assert.deepEqual(saved, { appId: 'app123', secret: 'sec' });
  assert.equal(calls[0].auth, 'Basic ' + Buffer.from('app123:sec').toString('base64'));
  await assert.rejects(pco.get('/people/v2/people'), /no permitida/);
  await assert.rejects(pco.get('/services/v2/../people'), /no permitida/);
  const all = await pco.getAll('/services/v2/service_types');
  assert.deepEqual(all.data.map((x) => x.id), ['1', '2']);
  await assert.rejects(pco.get('/services/v2/otra'), /rechazó el acceso/);
  pco.disconnect();
  assert.equal(saved, null);
  assert.equal(pco.status().connected, false);
});
