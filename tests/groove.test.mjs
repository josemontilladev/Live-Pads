import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const core = await import('../src/js/live/grooveCore.js');
const { KIT_BANKS } = await import('../src/js/data/banks.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('todos los ritmos incluidos están bien formados, con verso, coro, redoble y final', () => {
  assert.ok(core.GROOVES.length >= 12);
  const ids = new Set();
  for (const g0 of core.GROOVES) {
    const g = core.withTracks(g0);
    assert.ok(core.validGroove(g), g.id);
    assert.ok(!ids.has(g.id), 'id repetido ' + g.id); ids.add(g.id);
    for (const p of ['A', 'B', 'fill', 'end']) assert.ok(core.isWritten(g, p), `${g.id}.${p}`);
    for (const t of g.tracks) assert.ok(t.file, `${g.id}: pista ${t.id} sin sonido`);
  }
});

test('los kits solo usan muestras del drum pad, y existen', () => {
  const pad = new Set(KIT_BANKS.flatMap((k) => k.pads.map((p) => p.sample)).filter(Boolean));
  for (const k of core.GROOVE_KITS) for (const v of core.VOICE_IDS) {
    const f = k.files[v];
    assert.ok(f, `${k.id}.${v}`);
    assert.ok(pad.has(f), `${k.id}.${v}: ${f} no está en los kits del drum pad`);
    assert.ok(existsSync(join(ROOT, f)), f);
  }
});

test('golpes por paso con pistas, silencio y volumen', () => {
  const pop = core.withTracks(core.GROOVES.find((g) => g.id === 'pop'));
  assert.deepEqual(core.hitsAt(pop, 'B', 0).map((h) => h.track.id).sort(), ['kick', 'ride']);
  const muted = { ...pop, tracks: pop.tracks.map((t) => (t.id === 'ride' ? { ...t, mute: true } : t)) };
  assert.deepEqual(core.hitsAt(muted, 'B', 0).map((h) => h.track.id), ['kick']);
  assert.equal(core.stepDur(120, pop), 0.125);
  assert.equal(core.nextCell('-'), 'x'); assert.equal(core.nextCell('x'), 'X'); assert.equal(core.nextCell('X'), 'o'); assert.equal(core.nextCell('o'), '-');
});

test('cambiar de kit cambia el sonido de cada instrumento', () => {
  const g = core.withTracks(core.GROOVES[0], 'acoustic');
  const m = core.applyKit(g, 'modern');
  assert.notEqual(g.tracks.find((t) => t.voice === 'kick').file, m.tracks.find((t) => t.voice === 'kick').file);
});

test('pistas: añadir y quitar (sus pasos se van con ella)', () => {
  let g = core.emptyGroove();
  assert.deepEqual(g.tracks.map((t) => t.voice), ['kick', 'snare', 'hhc']);
  g = core.addTrack(g, { file: 'x.wav', label: 'Shaker' });
  const id = g.tracks.at(-1).id;
  g.parts.A[id] = 'x-x-x-x-x-x-x-x-';
  assert.ok(core.validGroove(g));
  g = core.removeTrack(g, id);
  assert.equal(g.parts.A[id], undefined);
  assert.ok(core.validGroove(g));
});

test('secciones sin escribir: intro con los platos del verso, puente = coro, final con bombo y crash', () => {
  const g = core.withTracks({ beats: 4, spb: 4, parts: { A: { kick: 'X'.padEnd(16, '-'), hhc: 'x-x-x-x-x-x-x-x-' }, B: { snare: '----X-------X---' } } });
  g.tracks.push({ id: 'crash', voice: 'crash', file: 'c.wav' });
  assert.deepEqual(Object.keys(core.partOf(g, 'intro')), ['hhc']);
  assert.deepEqual(Object.keys(core.partOf(g, 'C')), ['snare']);
  assert.deepEqual(Object.keys(core.partOf(g, 'end')).sort(), ['crash', 'kick']);
});

test('swing: solo los pasos impares, tresillo al 100 %', () => {
  assert.equal(core.swingOffset(0, { spb: 4 }, 1, 0.3), 0);
  assert.ok(Math.abs(core.swingOffset(1, { spb: 4 }, 1, 0.3) - 0.1) < 1e-9);
  assert.equal(core.swingOffset(1, { spb: 3 }, 1, 0.3), 0);
});

test('cambios de sección: al final del compás, redoble que vuelve y final que para', () => {
  let s = core.startState('A');
  s = core.queuePart(s, 'B');
  assert.equal(s.part, 'A');
  let r = core.barEnd(s); assert.equal(r.st.part, 'B'); assert.ok(r.crash);
  s = core.queuePart(r.st, 'fill');
  r = core.barEnd(s); assert.equal(r.st.part, 'fill');
  r = core.barEnd(r.st); assert.equal(r.st.part, 'B'); assert.ok(r.crash);
  s = core.queuePart(r.st, 'fill'); s = core.queuePart(s, 'C');
  r = core.barEnd(s); r = core.barEnd(r.st); assert.equal(r.st.part, 'C');
  s = core.queuePart(r.st, 'end');
  r = core.barEnd(s); assert.equal(r.st.part, 'end'); assert.equal(r.stop, false);
  r = core.barEnd(r.st); assert.equal(r.stop, true);
});

test('cambiar el compás de un ritmo propio conserva los pulsos', () => {
  const g = core.emptyGroove();
  const t = core.resizeGroove(g, 3, 4);
  assert.ok(core.validGroove(t));
  assert.equal(t.parts.A.kick, 'X-----------');
  const tri = core.resizeGroove({ beats: 2, spb: 4, parts: { A: { kick: 'X---X---' } } }, 2, 3);
  assert.equal(tri.parts.A.kick, 'X--X--');
  assert.equal(core.sigOf({ beats: 4, spb: 3 }), '4/4t');
});

test('kits propios del drum pad: se reconocen los pads por su nombre', () => {
  const mine = { id: 'k1', name: 'Worship Drums', pads: [
    { label: 'Crash', sample: 'a/crash.wav' }, { label: 'Hihat', sample: 'a/hh.wav' }, { label: 'Hihat Open', sample: 'a/hho.wav' },
    { label: 'Kick', sample: 'a/k.wav' }, { label: 'Snare', sample: 'a/s.wav' }, { label: 'Tom 1', sample: 'a/t1.wav' }, { label: 'Tom 3', sample: 'a/t3.wav' } ] };
  const k = core.kitFromPads(mine);
  assert.equal(k.files.kick, 'a/k.wav'); assert.equal(k.files.hhc, 'a/hh.wav'); assert.equal(k.files.hho, 'a/hho.wav');
  assert.equal(k.files.tomH, 'a/t1.wav'); assert.equal(k.files.tomL, 'a/t3.wav'); assert.equal(k.files.crash, 'a/crash.wav');
  assert.ok(k.files.shaker, 'lo que falta viene del kit acústico');
  assert.equal(core.kitFromPads({ id: 'fx', name: 'EFX', pads: [{ label: 'Boom', sample: 'b.wav' }] }), null);
  const g = core.applyKit(core.withTracks(core.GROOVES[0]), k);
  assert.equal(g.tracks.find((t) => t.voice === 'kick').file, 'a/k.wav');
});
