// Mapa de la canción en vivo: con un arreglo activo que salta del 1.er coro al
// ÚLTIMO, la pista debe saltar justo en el límite (sin adelantarse ni llegar
// tarde) y seguir sonando desde el inicio del último coro.
//   node tests/e2e/songMap.e2e.mjs
import { launch, findSong, reporter, assert, sleep } from './harness.mjs';

export async function run(h, r, { title = '¡Grita!' } = {}) {
  // En la secuencia y en el original (más corto que sus marcas: el último coro es el que tiene ESA pista).
  for (const type of ['sequence', 'original']) await r.check(`Mapa de la canción: salta en vivo al último coro a tiempo (${type === 'sequence' ? 'secuencia' : 'original'})`, async () => {
    const res = await h.evaluate(`(async () => {
      const S = await import('./js/state/store.js'), T = await import('./js/audio/trackPlayer.js'), M = await import('./js/live/songMap.js');
      const song = S.getSongs().find((s) => s.title === ${JSON.stringify(title)});
      T.loadAndPlayTrack(song, ${JSON.stringify(type)});
      for (let i = 0; i < 100 && !(T.getTrackAudio()?.duration > 0); i++) await new Promise((r) => setTimeout(r, 100));
      const a = T.getTrackAudio();
      const secs = M._mapDebug().sections;
      const coros = secs.filter((x) => x.startsWith('Coro#'));
      const head = secs.slice(0, secs.indexOf(coros[0]) + 1).map((x) => { const [l, n] = x.split('@')[0].split('#'); return { label: l, n: +n }; });
      song.arrangements = { active: 'e2e', list: [{ id: 'e2e', name: 'Al último coro', order: [...head, { label: 'Coro', n: coros.length }] }] };
      window.dispatchEvent(new CustomEvent('livepads:song-map'));
      const at = parseFloat(coros[0].split('-')[1]);                 // fin del 1.er coro
      const to = parseFloat(coros[coros.length - 1].split('@')[1]);  // inicio del último
      // Espía: quién y cuándo cambia la posición.
      const proto = Object.getPrototypeOf(a);
      const d = Object.getOwnPropertyDescriptor(proto, 'currentTime') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'currentTime');
      const seeks = [];
      Object.defineProperty(a, 'currentTime', { configurable: true, get() { return d.get.call(this); },
        set(v) { seeks.push({ from: d.get.call(this), to: v, wall: performance.now() }); d.set.call(this, v); } });
      a.currentTime = at - 4;
      seeks.length = 0;
      if (a.paused) T.clickPlayPause();
      const t0 = performance.now();
      while (performance.now() - t0 < 9000 && !seeks.length) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 1500));
      const after = a.currentTime, playing = !a.paused;
      T.clickPlayPause();
      delete a.currentTime;
      return { at, to, seeks, after, playing, coros };
    })()`);
    assert(res.seeks.length === 1, `saltos: ${JSON.stringify(res.seeks)} (coros ${res.coros.join(' ')})`);
    const s = res.seeks[0];
    const early = res.at - s.from, late = s.from - res.at;
    assert(early < 0.01, `saltó ${(early * 1000).toFixed(0)} ms ANTES del final del coro`);
    assert(late < 0.03, `saltó ${(late * 1000).toFixed(0)} ms TARDE`);
    assert(Math.abs(s.to - res.to) < 0.2, `fue a ${s.to.toFixed(2)} s, el último coro empieza en ${res.to}`);
    assert(res.playing && res.after > res.to + 1 && res.after < res.to + 2.5, `después del salto: ${res.after.toFixed(2)} s, sonando=${res.playing}`);
    return `límite ${res.at} s → ${res.to} s; saltó en ${s.from.toFixed(3)} s (${((s.from - res.at) * 1000).toFixed(1)} ms)`;
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const h = await launch({ songs: [findSong('¡Grita!')] });
  const r = reporter();
  try { await run(h, r); } finally { await h.close(); }
  process.exit(r.summary() ? 1 : 0);
}
