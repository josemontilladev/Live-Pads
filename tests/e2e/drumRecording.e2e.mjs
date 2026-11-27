// Caja de ritmos «Desde una grabación» con batería REAL: la batería de ¡Grita!
// (separada con la propia app, 4 pistas; se guarda en la caché de modelos para no
// repetir la separación) pasa por el mismo análisis que la ventana y el ritmo que
// sale tiene que tener sentido: tempo, compases, bombo/caja/hi-hat y secciones.
//   node tests/e2e/drumRecording.e2e.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, findSong, reporter, assert, MODELS_CACHE } from './harness.mjs';

export const SONG = '¡Grita!';
const FROM = 46.3, LEN = 60;
// Tempo real de la pista: 123,5 BPM (Beat This! sobre el original y sobre la secuencia con click).
// La ficha de la biblioteca dice 185, que está mal.
const REF_BPM = 123.5;   // del 1.er coro en adelante: coro, verso, pre-coro, coro
const CACHE = join(MODELS_CACHE, 'e2e-drums-grita.pcm16');

export async function run(h, r) {
  await r.check('Caja de ritmos desde una grabación (batería real)', async () => {
    // 1) La batería aislada (de la caché o separándola ahora).
    let b64 = existsSync(CACHE) ? readFileSync(CACHE).toString('base64') : null;
    if (!b64) {
      b64 = await h.evaluate(`(async () => {
        const S = await import('./js/state/store.js'), T = await import('./js/audio/trackPlayer.js');
        const song = S.getSongs().find((s) => s.title === ${JSON.stringify(SONG)});
        const arr = await window.electronAPI.readAudioFile(song.audio.original);
        const ctx = new AudioContext({ sampleRate: 44100 });
        const full = await ctx.decodeAudioData(arr);
        const a = Math.round(${FROM} * 44100), n = Math.round(${LEN} * 44100);
        const channels = [0, 1].map((c) => full.getChannelData(Math.min(c, full.numberOfChannels - 1)).slice(a, a + n));
        const res = await window.electronAPI.stemsSeparate({ channels, sampleRate: 44100, mode: '4stem' });
        const stems = res.stems || res;
        const drums = stems.find((s) => s.kind === 'drums' || /bater/i.test(s.name));
        if (!drums) throw new Error('la separación no devolvió batería: ' + JSON.stringify(stems.map((s) => s.name || s.kind)));
        const L = drums.channels[0], R = drums.channels[1] || L, out = new Int16Array(L.length);
        for (let i = 0; i < L.length; i++) out[i] = Math.max(-32768, Math.min(32767, ((L[i] + R[i]) / 2) * 32767));
        let s = ''; const u8 = new Uint8Array(out.buffer);
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        ctx.close();
        return btoa(s);
      })()`);
      writeFileSync(CACHE, Buffer.from(b64, 'base64'));
    }
    // 2) El análisis de la ventana «Desde una grabación».
    const res = await h.evaluate(`(async () => {
      const bin = atob(${JSON.stringify(b64)}), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const pcm = new Int16Array(u8.buffer), ctx = new OfflineAudioContext(1, pcm.length, 44100);
      const buf = ctx.createBuffer(1, pcm.length, 44100), ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const D = await import('./js/live/drumFromRecording.js'), C = await import('./js/live/drumTranscribeCore.js');
      const t0 = performance.now();
      const r = await D.analyzeDrumAudio(buf);
      const ms = performance.now() - t0;
      const g = C.buildGroove(r.bars, r.sections, { steps: r.steps });
      const count = (k) => r.bars.reduce((n, b) => n + (b.hits[k] || []).filter((x) => x > 0).length, 0);
      return { ms, bpm: r.bpm, bars: r.bars.length, steps: r.steps, beatsPerBar: r.beatsPerBar, sections: r.sections.map((s) => s.part + ':' + s.from + '-' + s.to),
        kick: count('kick'), snare: count('snare'), hat: count('hat') + count('hhc') + count('hho'), parts: Object.keys(g.parts || {}), arrangement: (g.arrangement || []).length, keys: Object.keys(r.bars[0]?.hits || {}) };
    })()`);
    const bpm = res.bpm, ok = (x) => Math.abs(x - REF_BPM) / REF_BPM < 0.03;
    assert(ok(bpm), `tempo ${bpm} (la pista va a ${REF_BPM})`);
    const expBars = LEN * (bpm / 60) / (res.beatsPerBar || 4);
    assert(Math.abs(res.bars - expBars) <= Math.max(3, expBars * 0.15), `${res.bars} compases (se esperaban ~${Math.round(expBars)})`);
    assert(res.kick >= res.bars && res.snare >= res.bars, `golpes: bombo ${res.kick}, caja ${res.snare} en ${res.bars} compases (claves ${res.keys})`);
    assert(res.sections.length >= 2, `secciones: ${res.sections.join(' ')}`);
    assert(res.parts.length >= 2 && res.arrangement >= 2, `ritmo: partes ${res.parts} · arreglo ${res.arrangement}`);
    assert(res.ms < 20000, `el análisis tardó ${(res.ms / 1000).toFixed(1)} s`);
    return `${bpm} BPM, ${res.bars} compases, bombo ${res.kick} · caja ${res.snare} · hi-hat ${res.hat}, secciones ${res.sections.join(' ')}, análisis ${(res.ms / 1000).toFixed(1)} s`;
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const h = await launch({ songs: [findSong(SONG)] });
  const r = reporter();
  try { await run(h, r); } finally { await h.close(); }
  process.exit(r.summary() ? 1 : 0);
}
