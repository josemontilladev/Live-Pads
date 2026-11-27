import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || new EventTarget();
const { whilePlaying, _clockDebug } = await import('../src/js/audio/playClock.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera a que se cumpla (máx. 1 s): con el equipo ocupado los temporizadores se retrasan.
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await wait(10); return fn(); };

class FakeAudio extends EventTarget {
  constructor() { super(); this.paused = true; }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}

const subs = [];
const track = (off) => { subs.push(off); return off; };
test.afterEach(() => { while (subs.length) subs.pop()(); window.dispatchEvent(new CustomEvent('livepads:track-cleared')); });

test('sin sonar no hay temporizadores; sonando sí; al pausar se llama una vez y se paran', async () => {
  let n = 0;
  const off = track(whilePlaying(() => { n++; }, 10));
  assert.equal(_clockDebug().timers, 0);
  const a = new FakeAudio();
  window.dispatchEvent(new CustomEvent('livepads:track-loaded', { detail: { audio: a } }));
  assert.ok(await until(() => n >= 1), 'se pone al día al cargar');
  const afterLoad = n;
  a.play();
  assert.ok(await until(() => n - afterLoad >= 4), 'sonando, cada 10 ms');
  assert.equal(_clockDebug().timers, 1);
  a.pause();
  const atPause = n;
  await wait(60);
  assert.ok(n - atPause <= 1, 'parado, nada (salvo la llamada al pausar)');
  assert.equal(_clockDebug().timers, 0);
  const before = n;
  a.dispatchEvent(new Event('seeked'));
  assert.equal(n, before + 1, 'al saltar se llama');
  off();
});

test('`when` en falso: mientras suena solo se mira despacio', async () => {
  let n = 0, on = false;
  const off = track(whilePlaying(() => { n++; }, 5, { when: () => on }));
  const a = new FakeAudio();
  window.dispatchEvent(new CustomEvent('livepads:track-loaded', { detail: { audio: a } }));
  a.play();
  await wait(100);
  assert.equal(n, 0, 'sin mapa activo no se llama');
  on = true;
  // Tarda como mucho 250 ms en notarlo; luego va rápido (Windows redondea los 5 ms a ~15 ms).
  assert.ok(await until(() => n >= 8), 'en cuanto hace falta, a su ritmo (' + n + ')');
  a.pause(); off();
  window.dispatchEvent(new CustomEvent('livepads:track-cleared'));
});
