// Letra con IA de principio a fin + secciones del espectro desde la letra sincronizada.
//   1. Letra → Sincronizar con IA sobre el ORIGINAL (separa la voz y Whisper small, en local).
//   2. Las líneas salen en orden, dentro de la pista, y casi todas con confianza.
//   3. Guardar; la canción se abre sin secciones y el espectro las marca solo, ahora
//      «con la letra sincronizada»: cada sección cantada empieza donde entra su 1.ª línea.
// La 1.ª vez baja los modelos (Whisper small y la voz) a la caché: puede tardar.
//   node tests/e2e/lyricsAi.e2e.mjs
import { launch, findSong, reporter, assert } from './harness.mjs';

export const SONG = '¡Grita!';

export async function run(h, r) {
  let sync = null;
  await r.check('Letra con IA de principio a fin (original con voz)', async () => {
    await h.evaluate(`(async () => {
      const S = await import('./js/state/store.js'), E = await import('./js/live/lyricSyncEditor.js');
      window.__lpLyricSync = null;
      const song = S.getSongs().find((s) => s.title === ${JSON.stringify(SONG)});
      E.openLyricSync(song, { type: 'original' });
      for (let i = 0; i < 100 && !document.querySelector('#lsy-box [data-act="ai"]'); i++) await new Promise((r) => setTimeout(r, 100));
      document.querySelector('#lsy-box [data-act="ai"]').click();
    })()`);
    const t0 = Date.now();
    await h.waitFor(`window.__lpLyricSync || /cancel|No se reconoci|Error|no puede/i.test(document.querySelector('#lsy-box [data-ref="step"]')?.textContent || '')`, 25 * 60000, 2000);
    const secs = (Date.now() - t0) / 1000;
    const step = await h.evaluate(`document.querySelector('#lsy-box [data-ref="step"]')?.textContent || ''`);
    assert(await h.evaluate('!!window.__lpLyricSync'), `la IA no terminó: «${step}»`);
    await h.evaluate(`document.querySelector('#lsy-box [data-act="save"]').click()`);
    await new Promise((res) => setTimeout(res, 500));
    sync = await h.evaluate(`(async () => {
      const S = await import('./js/state/store.js'), L = await import('./js/live/lyricSyncStore.js');
      const song = S.getSongs().find((s) => s.title === ${JSON.stringify(SONG)});
      const sy = L.getLyricSync(song, 'original'), lines = L.lyricLines(song.lyrics);
      const arr = await window.electronAPI.readAudioFile(song.audio.original);
      const dur = (await new OfflineAudioContext(1, 1, 44100).decodeAudioData(arr)).duration;
      return { ev: sy && sy.ev, nLines: lines.length, lines: lines.map((l) => (l && typeof l.text === "string" ? l.text : "")), dur, stats: window.__lpLyricSync };
    })()`);
    const ev = (sync.ev || []).map((e) => ({ t: e[0], i: e[1], check: e.length > 2 }));
    const singable = sync.lines.map((t, i) => [t, i]).filter(([t]) => /[a-záéíóúñ]{2}/i.test(t));
    const placed = new Set(ev.map((e) => e.i));
    const missing = singable.filter(([, i]) => !placed.has(i)).map(([t, i]) => i + ':' + t);
    // El puente de la ficha («Yo tome, Yo tome… / Lo que me robó») no es lo que se canta
    // (Whisper oye «Rescate… / Rastate lo que me robó»): esas líneas no se exigen.
    const BRIDGE = /^(yo tome|lo que me rob)/i;
    const core = singable.filter(([t]) => !BRIDGE.test(t));
    const coreOk = core.filter(([, i]) => placed.has(i)).length;
    assert(coreOk >= core.length * 0.75, `${coreOk} de ${core.length} líneas (sin el puente) colocadas; faltan: ${missing.join(' | ')}`);
    // El último coro va a SUS líneas (no a las del primero, que dicen lo mismo).
    const lastChorus = singable.filter(([t]) => /^grita y las murallas/i.test(t)).pop();
    assert(lastChorus && ev.some((e) => e.i >= lastChorus[1] - 1), `el último coro (línea ${lastChorus && lastChorus[1]}) no tiene ninguna línea suya`);
    const backwards = ev.filter((e, k) => k && e.t < ev[k - 1].t).length;
    assert(backwards === 0, `${backwards} líneas van hacia atrás en el tiempo`);
    assert(ev.every((e) => e.t >= 0 && e.t < sync.dur), 'hay líneas fuera de la pista');
    assert(ev[0].t > 5, `la 1.ª línea entra en ${ev[0].t.toFixed(1)} s (la canción tiene intro)`);
    const checks = ev.filter((e) => e.check).length;
    // Cuántas quedan «por revisar» depende de la canción (en ¡Grita!, gritada y con mezcla densa, ~70 %, igual que en 1.0.311): se informa.
    return `${ev.length} de ${singable.length} líneas (${coreOk}/${core.length} sin el puente), ${checks} por revisar, ${secs.toFixed(0)} s`;
  });

  await r.check('Secciones del espectro con la letra sincronizada', async () => {
    assert(sync && sync.ev, 'sin letra sincronizada (falló la prueba anterior)');
    const res = await h.evaluate(`(async () => {
      const S = await import('./js/state/store.js'), T = await import('./js/audio/trackPlayer.js');
      const song = S.getSongs().find((s) => s.title === ${JSON.stringify(SONG)});
      const stash = song.markers || [];
      song.markers = [];
      const toasts = [];
      const orig = window.showToast;
      window.showToast = (msg, ...rest) => { toasts.push(String(msg)); return orig && orig(msg, ...rest); };
      T.loadAndPlayTrack(song, 'original');
      const t0 = performance.now();
      while (performance.now() - t0 < 240000) {
        await new Promise((r) => setTimeout(r, 500));
        if (toasts.some((m) => /secciones marcadas|No se encontraron/.test(m))) break;
      }
      window.showToast = orig;
      const found = (song.markers || []).map((m) => ({ t: m.t, label: m.label }));
      // Las de antes (las de la secuencia) vuelven: el mapa y el medley las usan después.
      song.markers = [...stash.filter((m) => !m.src || m.src === 'sequence'), ...(song.markers || [])];
      return { ms: performance.now() - t0, toasts, markers: found };
    })()`);
    const msg = res.toasts.find((m) => /secciones marcadas|No se encontraron/.test(m)) || '';
    assert(/con la letra sincronizada/.test(msg), `no usó la letra sincronizada: «${msg || res.toasts.join(' | ')}»`);
    const ev = sync.ev.map((e) => e[0]);
    const sung = res.markers.filter((m) => !/intro|final|interludio|instrumental|outro/i.test(m.label));
    const off = sung.filter((m) => !ev.some((t) => Math.abs(t - m.t) < 2.5));
    assert(sung.length >= 3, `secciones: ${res.markers.map((m) => m.label + '@' + m.t.toFixed(1)).join(' ')}`);
    assert(off.length <= 1, `secciones que no empiezan en una línea cantada: ${off.map((m) => m.label + '@' + m.t.toFixed(1)).join(' ')}`);
    return `${res.markers.map((m) => m.label + '@' + m.t.toFixed(1)).join(' ')} (${(res.ms / 1000).toFixed(0)} s)`;
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const h = await launch({ songs: [findSong(SONG)], timeoutMs: 40 * 60000 });
  const r = reporter();
  try { await run(h, r); } finally { await h.close(); }
  process.exit(r.summary() ? 1 : 0);
}
