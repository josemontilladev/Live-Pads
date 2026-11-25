import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const server = require('../companion/server.js');

const open = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); ws.once('open', () => res(ws)); ws.once('error', rej); });
const next = (ws, type) => new Promise((res) => ws.on('message', function h(raw) { const m = JSON.parse(String(raw)); if (!type || m.type === type) { ws.off('message', h); res(m); } }));

test('control remoto con PIN e indicaciones a todos los móviles', async () => {
  const got = [];
  server.setCommandHandler((c) => got.push(c));
  const st = await server.start();
  try {
    const url = `ws://127.0.0.1:${st.port}`;
    const a = await open(url), b = await open(url);
    // PIN incorrecto: se rechaza y no llega nada a la app
    const bad = next(a, 'auth');
    a.send(JSON.stringify({ type: 'cmd', cmd: 'next', pin: '0000' === st.pin ? '1111' : '0000' }));
    assert.equal((await bad).ok, false);
    // PIN correcto: la orden llega a la app
    const ok = next(a, 'auth');
    a.send(JSON.stringify({ type: 'auth', pin: st.pin }));
    assert.equal((await ok).ok, true);
    a.send(JSON.stringify({ type: 'cmd', cmd: 'next', pin: st.pin, name: 'José' }));
    a.send(JSON.stringify({ type: 'cmd', cmd: 'rm -rf', pin: st.pin }));   // orden desconocida: se ignora
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(got, [{ cmd: 'next', arg: null, from: 'José' }]);
    // Una indicación llega a todos los móviles
    const cueB = next(b, 'cue');
    server.broadcastCue({ id: 'chorus', text: 'Coro', from: 'Líder' });
    const c = await cueB;
    assert.equal(c.text, 'Coro');
    a.close(); b.close();
  } finally {
    await server.stop();
  }
});
