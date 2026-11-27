import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRedundancy } = require('../redundancy.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { for (let t = 0; t < ms; t += 25) { if (fn()) return true; await sleep(25); } return false; };

test('principal y respaldo: se encuentran, el código protege, llega el estado y se nota la caída', async () => {
  const wsPort = 47900 + Math.floor(Math.random() * 50), beaconPort = wsPort + 60;
  const toPrincipal = [], toBackup = [];
  const p = createRedundancy({ name: 'PC-A', wsPort, beaconPort, onRemote: (m) => toPrincipal.push(m) });
  const b = createRedundancy({ name: 'PC-B', wsPort, beaconPort, onRemote: (m) => toBackup.push(m) });
  try {
    b.startBackup();
    const st = await p.startPrincipal('1234');
    assert.equal(st.role, 'principal');
    assert.equal(st.pin, '1234');
    // El anuncio por UDP llega al respaldo (misma máquina).
    assert.ok(await until(() => b.status().found.some((f) => f.port === wsPort)), 'el respaldo no encontró al principal');
    // Código equivocado: rechazado y no reintenta.
    b.connect('127.0.0.1', wsPort, '0000');
    assert.ok(await until(() => toBackup.some((m) => m.type === 'denied')));
    assert.equal(b.status().linked, false);
    // Código bueno.
    p.publish({ songId: 's1', t: 12.5, playing: true });
    b.connect('127.0.0.1', wsPort, '1234');
    assert.ok(await until(() => b.status().linked));
    assert.ok(await until(() => p.status().clients.includes('PC-B')));
    // Al conectarse recibe el último estado, luego los nuevos y los latidos.
    assert.ok(await until(() => toBackup.some((m) => m.type === 'state' && m.songId === 's1' && m.recvAt > 0)));
    p.publish({ songId: 's2', t: 3, playing: false });
    assert.ok(await until(() => toBackup.some((m) => m.type === 'state' && m.songId === 's2')));
    p.publish({ songId: 's2', t: 3.2, playing: false });
    assert.ok(await until(() => toBackup.filter((m) => m.type === 'state').length >= 3));
    // El respaldo avisa de que toma el control.
    assert.equal(b.sendToPrincipal({ type: 'took' }), true);
    assert.ok(await until(() => toPrincipal.some((m) => m.type === 'took' && m.name === 'PC-B')));
    // El principal se cae: el respaldo lo nota.
    p.stop();
    assert.ok(await until(() => toBackup.some((m) => m.type === 'lost')));
    assert.equal(b.status().linked, false);
    // Vuelve: el respaldo se reconecta solo.
    await p.startPrincipal('1234');
    assert.ok(await until(() => b.status().linked, 6000), 'no se reconectó');
  } finally { p.stop(); b.stop(); }
});

test('sin código válido se genera uno de 4 cifras; y el puerto ocupado da error', async () => {
  const wsPort = 48000 + Math.floor(Math.random() * 50);
  const a = createRedundancy({ wsPort, beaconPort: wsPort + 60 });
  const c = createRedundancy({ wsPort, beaconPort: wsPort + 61 });
  try {
    const st = await a.startPrincipal('ab');
    assert.match(st.pin, /^\d{4}$/);
    await assert.rejects(c.startPrincipal('1111'), (e) => e.code === 'EADDRINUSE');
    assert.equal(c.status().role, 'off');
  } finally { a.stop(); c.stop(); }
});
