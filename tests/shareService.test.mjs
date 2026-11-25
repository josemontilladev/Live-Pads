import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceMessage, whatsappUrl, cleanLink } from '../src/js/ui/shareService.js';

test('mensaje del servicio: bloques limpios con artista, tono, BPM y enlace corto', () => {
  const t = buildServiceMessage([
    { title: '¡Grita!', artist: 'Lakewood', key: 'Dm', bpm: 185, youtubeUrl: 'https://youtu.be/mMrdziQaETU?si=4kqe8CpW3xA7O_Ug' },
    { title: 'Agradecido Estoy', key: 'C' },
  ], { name: 'Culto dominical', date: 'Dom 29/11' });
  assert.equal(t, [
    '*Culto dominical* · Dom 29/11',
    '',
    '1. *¡Grita!*',
    '    Lakewood · Tono Dm · 185 BPM',
    '    https://youtu.be/mMrdziQaETU',
    '',
    '2. *Agradecido Estoy*',
    '    Tono C',
    '',
    '_Enviado desde LivePads_',
  ].join('\n'));
  assert.ok(!/[^\x00-ɏ·—*_]/.test(t.replace(/¡/g, '')), 'sin emojis ni símbolos raros');
});

test('enlaces de YouTube cortos y sin seguimiento', () => {
  assert.equal(cleanLink('https://www.youtube.com/watch?v=654Dn_9LWy4&list=RD654Dn_9LWy4&start_radio=1&pp=ygUTaGF'), 'https://youtu.be/654Dn_9LWy4');
  assert.equal(cleanLink('https://youtu.be/gpB0Jtm9kn4?si=wfy6nL7vpncXSsZN'), 'https://youtu.be/gpB0Jtm9kn4');
  assert.equal(cleanLink('https://music.youtube.com/watch?v=Sc2FbBvQP2w&feature=share'), 'https://youtu.be/Sc2FbBvQP2w');
  assert.equal(cleanLink('https://open.spotify.com/track/abc'), 'https://open.spotify.com/track/abc');
});

test('enlace de WhatsApp con el texto codificado', () => {
  assert.equal(whatsappUrl('Hola *Dm* & más'), 'https://wa.me/?text=Hola%20*Dm*%20%26%20m%C3%A1s');
});
