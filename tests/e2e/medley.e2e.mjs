// Medley: dos canciones del servicio enlazadas. Al llegar a la salida (inicio
// del 2.º coro de la 1.ª, con 2 s de fundido) la 2.ª debe sonar ya, sin silencio.
//   node tests/e2e/medley.e2e.mjs
import { launch, findSong, reporter, assert } from './harness.mjs';

export const SONGS = ['¡Grita!', 'Adios al Ayer'];

const VARIANTS = [
  ['', ''],
  // Lo que deja encendido una sesión larga: cuenta de entrada activa (antes metía un compás de silencio en el medley).
  [' (con cuenta de entrada activa)', "localStorage.setItem('livepads-countin', '1');"],
];

export async function run(h, r, { maxGapMs = 120 } = {}) {
  for (const [suffix, pre] of VARIANTS) await r.check('Medley: la 2.ª canción empieza a sonar a tiempo' + suffix, async () => {
    const res = await h.evaluate(`(async () => {
      ${pre}
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const S = await import('./js/state/store.js'), T = await import('./js/audio/trackPlayer.js');
      const SV = await import('./js/data/service.js'), MD = await import('./js/live/medley.js'), MK = await import('./js/data/markers.js');
      const songs = ${JSON.stringify(SONGS)}.map((t) => S.getSongs().find((s) => s.title === t));
      SV.replaceService(songs);
      const sv = SV.getServiceSongs();
      SV.setActiveServiceIndex(0);
      T.loadAndPlayTrack(sv[0], 'sequence');
      for (let i = 0; i < 100 && !(T.getTrackAudio()?.duration > 0); i++) await wait(100);
      const a = T.getTrackAudio();
      const coros = MK.markersFor(sv[0], 'sequence').filter((m) => /coro/i.test(m.label)).sort((x, y) => x.t - y.t);
      const exit = coros[1].t, fade = 2;
      MD.setMedley(sv[0].serviceId, { out: exit, in: 0, fade });
      a.currentTime = exit - fade - 3;
      if (a.paused) T.clickPlayPause();
      // Muestreo: cuándo la 1.ª llega a la salida y cuándo la 2.ª suena de verdad.
      let tExit = 0, tNext = 0, nextAudio = null;
      // Cuándo arranca de verdad cada fuente de audio (el reloj de posición avanza a saltos).
      const starts = [], N = AudioBufferSourceNode.prototype, orig = N.start;
      N.start = function (...args) { starts.push({ wall: performance.now(), dur: this.buffer && this.buffer.duration }); return orig.apply(this, args); };
      const t0 = performance.now();
      while (performance.now() - t0 < 25000) {
        await wait(5);
        const cur = T.getTrackAudio();
        // Momento (reloj) en que la 1.ª llega a la salida, según su última posición sonando.
        if (cur === a && !a.paused) tExit = performance.now() + (exit - a.currentTime) * 1000;
        if (cur && cur !== a) {
          if (!nextAudio) { nextAudio = cur; window.__mdT = { audio: performance.now() - t0 }; }
          if (cur.buffer && !window.__mdT.buf) window.__mdT.buf = performance.now() - t0;
          const st = starts.find((x) => cur.buffer && Math.abs(x.dur - cur.buffer.duration) < 0.01 && x.wall > t0);
          if (!cur.paused && st && !tNext) { tNext = st.wall; window.__mdT.play = st.wall - t0; break; }
        }
      }
      N.start = orig;
      localStorage.removeItem('livepads-countin');
      const out = { dbg: window.__mdT, exit, tExit: tExit - t0, tNext: tNext ? tNext - t0 : null, nextTitle: T.getCurrentSong()?.title, nextPos: nextAudio && nextAudio.currentTime, vol: nextAudio && nextAudio.volume };
      if (nextAudio && !nextAudio.paused) T.clickPlayPause();
      return out;
    })()`);
    assert(res.tNext != null, `la 2.ª no empezó a sonar en 25 s: ${JSON.stringify(res)}`);
    assert(res.nextTitle === SONGS[1], `suena «${res.nextTitle}»`);
    const gap = res.tNext - res.tExit;
    assert(gap < maxGapMs, `la 2.ª empezó ${Math.round(gap)} ms después de la salida (máx. ${maxGapMs}) · ${JSON.stringify({ ...res.dbg, tExit: Math.round(res.tExit), tNext: Math.round(res.tNext) })}`);
    assert(gap > -150, `la 2.ª empezó ${Math.round(-gap)} ms ANTES de la salida (se pisan)`);
    assert(res.vol > 0.5, `la 2.ª suena con volumen ${res.vol}`);
    return `salida ${res.exit} s; la 2.ª sonó ${Math.round(gap)} ms después · ${JSON.stringify({ ...res.dbg, tExit: Math.round(res.tExit), tNext: Math.round(res.tNext) })}`;
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const h = await launch({ songs: SONGS.map(findSong) });
  const r = reporter();
  try { await run(h, r); } finally { await h.close(); }
  process.exit(r.summary() ? 1 : 0);
}
