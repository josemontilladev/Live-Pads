import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../lyricsAlign.js');

const L = (texts) => {
  let sec = -1;
  return texts.map((t) => {
    if (t.startsWith('#')) { sec++; return null; }
    return { text: t, sec: Math.max(0, sec), secStart: false };
  }).map((x, i, arr) => x && { ...x, secStart: i === 0 || arr[i - 1] === null }).filter(Boolean);
};

test('fonética: lo que suena igual se escribe igual', () => {
  assert.equal(A.phon('Vida a los muertos da'), A.phon('bida a los muertos da'));
  assert.equal(A.phon('¿Quién soy yo?'), A.phon('kien soy yo'));
  assert.equal(A.phon('Hosanna, llévame'), A.phon('osana yebame'));
  assert.ok(A.similarity(A.phon('tu luz está brillando en las tiniebras'), A.phon('Tu luz está brillando en las tinieblas')) > 0.9);
});

const LYR = L([
  '# Verso',
  'Un camino abriste en el mar',
  'Te doy gracias aleluya',
  'Aunque no lo merecia lo hiciste',
  '# Coro',
  'Quien soy yo que escuchas mi clamor',
  'Agradecido estoy agradecido estoy',
]);

test('casado: frases partidas, varias líneas en una frase y el coro repetido', () => {
  const segs = [
    { t0: 10, t1: 12, text: 'Un camino abriste' },             // partida…
    { t0: 12, t1: 14, text: 'en el mar' },                     // …sigue la misma línea
    { t0: 15, t1: 22, text: 'Te doy gracias aleluya aunque no lo merecía lo hiciste' },   // dos líneas
    { t0: 24, t1: 27, text: 'oh oh oh' },                      // improvisación: nada
    { t0: 28, t1: 31, text: 'quién soy yo que escuchas mi clamor' },
    { t0: 31, t1: 34, text: 'agradecido estoy agradecido estoy' },
    { t0: 40, t1: 43, text: 'quién soy yo que escuchas mi clamor' },   // el coro otra vez
    { t0: 43, t1: 46, text: 'agradecido estoy, agradecido estoy' },
  ];
  const ev = A.coarseAlign(LYR, segs);
  assert.deepEqual(ev.map((e) => e.line), [0, 1, 2, 3, 4, 3, 4]);
  assert.equal(ev[0].t, 10);
  assert.equal(ev[1].t, 15);
  assert.ok(ev[2].t > 17 && ev[2].t < 19, `la 2.ª línea de la frase empieza hacia la mitad (${ev[2].t})`);
  assert.equal(ev[5].t, 40);
});

test('casado: una línea que Whisper no entendió se intercala entre sus vecinas', () => {
  const segs = [
    { t0: 10, t1: 13, text: 'un camino abriste en el mar' },
    { t0: 14, t1: 16, text: 'mmm' },
    { t0: 18, t1: 21, text: 'aunque no lo merecía lo hiciste' },
  ];
  const ev = A.coarseAlign(LYR, segs);
  assert.deepEqual(ev.map((e) => e.line), [0, 1, 2]);
  assert.equal(ev[1].conf, 'gap');
  assert.ok(ev[1].t > 13 && ev[1].t < 18);
});

test('tokenizador de Whisper: BPE por bytes con el rango de cada ficha', () => {
  const vocab = { 'Ġ': 220, 'a': 64, 'b': 65, 'Ġa': 257, 'ab': 300, 'Ġab': 400 };
  const bytes = new Map([['Ġ', 32], ['a', 97], ['b', 98]]);
  const tok = A.makeTokenizer(vocab, bytes);
  assert.deepEqual(tok(' ab'), [400]);
  assert.deepEqual(tok('ab'), [300]);
});

test('arranques de la voz: la subida tras un silencio, a 10 ms', () => {
  const sr = 16000, pcm = new Float32Array(sr * 3);
  for (let i = Math.round(1.23 * sr); i < 2.5 * sr; i++) pcm[i] = 0.3 * Math.sin(i * 0.07);
  const env = A.envelope(pcm, sr);
  const sorted = Float32Array.from(env).sort();
  const ons = A.onsetsIn(env, 50, 280, sorted[Math.floor(sorted.length * 0.95)]);
  assert.equal(ons.length, 1);
  assert.ok(Math.abs(ons[0].f * 0.01 - 1.23) <= 0.02, `arranque en ${ons[0].f * 0.01}`);
});

test('idioma de la letra por su texto (para no dejárselo a Whisper)', () => {
  const es = ['Me encuentro en frente a Jericó', 'Tierra que mi Padre me entregó', 'Grita y las murallas caerán', 'Grita y todas caerán'];
  const en = ['Shout and the walls will fall', 'You are the Lord of all', 'I will not be afraid', 'Your love is all I need'];
  assert.equal(A.guessLang(es.map((text) => ({ text }))), 'es');
  assert.equal(A.guessLang(en.map((text) => ({ text }))), 'en');
  assert.equal(A.guessLang([{ text: 'Aleluya' }, { text: 'Hosanna' }]), null);   // no se sabe: lo decide Whisper
});

test('el último coro (igual que el primero) tras un puente que no se entiende va a SUS líneas', () => {
  const lyr = L(['# Coro', 'Grita y las murallas caerán', 'Grita y todas caerán',
    '# Puente', 'Yo tome yo tome yo tome', 'Lo que me robó', 'Yo tome yo tome yo tome', 'Lo que me robó',
    '# Coro', 'Grita y las murallas caerán', 'Grita y todas caerán']);
  const segs = [
    { t0: 10, t1: 14, text: 'Grita y las muras caerán' }, { t0: 14, t1: 18, text: 'Grita y todas caerán' },
    { t0: 20, t1: 24, text: 'Rescate, rescate' }, { t0: 24, t1: 28, text: 'Rastate, no, no, no' },
    { t0: 40, t1: 44, text: 'Grita y las muras caerán' }, { t0: 44, t1: 48, text: 'Grita y todas caerán' },
  ];
  const ev = A.coarseAlign(lyr, segs).filter((e) => e.conf === 'coarse');
  assert.deepEqual(ev.map((e) => e.line), [0, 1, 6, 7]);
});
