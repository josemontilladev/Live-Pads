// ─────────────────────────────────────────────────────────────────────────
// Respaldo entre dos PCs (red local). Proceso principal; sin Electron para poder
// probarlo con Node.
//
//   · PRINCIPAL: abre un WebSocket (puerto 47833) y anuncia su presencia por UDP
//     (difusión al puerto 47834, una vez por segundo). Reenvía a los respaldos el
//     estado que le da la interfaz cada 200 ms (canción, posición, sonando…), que es
//     también el latido. Solo atiende a quien sabe el código de 4 cifras.
//   · RESPALDO: escucha los anuncios (lista de principales en la red), se conecta
//     con el código y pasa a la interfaz cada mensaje. Si se corta, reintenta solo.
//
// La interfaz (src/js/live/redundancy.js) decide qué hacer con el estado: seguir
// en silencio y, si el latido falta, tomar el relevo.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const dgram = require('dgram');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const WS_PORT = 47833, BEACON_PORT = 47834, BEACON_MS = 1000;

function createRedundancy({ onRemote = () => {}, onStatus = () => {}, name = os.hostname(), wsPort = WS_PORT, beaconPort = BEACON_PORT } = {}) {
  let role = 'off';
  let pin = '';
  // Principal
  let wss = null, beaconSock = null, beaconTimer = null, lastState = null;
  // Respaldo
  let listenSock = null, client = null, target = null, retryTimer = null, linked = false;
  const found = new Map();   // ip:port → { name, ip, port, seen }

  const status = () => ({
    role, pin: role === 'principal' ? pin : '',
    clients: wss ? [...wss.clients].filter((c) => c.lpAuth && c.readyState === WebSocket.OPEN).map((c) => c.lpName || '?') : [],
    linked, target: target ? { host: target.host, port: target.port } : null,
    found: [...found.values()].filter((f) => Date.now() - f.seen < 4000).map(({ name: n, ip, port }) => ({ name: n, ip, port })),
  });
  const emitStatus = () => { try { onStatus(status()); } catch (_) {} };

  function broadcast(obj) {
    if (!wss) return;
    const msg = JSON.stringify(obj);
    for (const c of wss.clients) if (c.lpAuth && c.readyState === WebSocket.OPEN) { try { c.send(msg); } catch (_) {} }
  }

  function stopAll() {
    clearInterval(beaconTimer); clearTimeout(retryTimer);
    beaconTimer = retryTimer = null;
    if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch (_) {} } try { wss.close(); } catch (_) {} wss = null; }
    if (beaconSock) { try { beaconSock.close(); } catch (_) {} beaconSock = null; }
    if (client) { client.lpClosing = true; try { client.terminate(); } catch (_) {} client = null; }
    if (listenSock) { try { listenSock.close(); } catch (_) {} listenSock = null; }
    linked = false; target = null; lastState = null; found.clear();
  }

  function startPrincipal(code) {
    stopAll();
    role = 'principal';
    pin = /^\d{4}$/.test(String(code || '')) ? String(code) : String(Math.floor(1000 + Math.random() * 9000));
    return new Promise((resolve, reject) => {
      const s = new WebSocketServer({ port: wsPort });
      s.once('error', (e) => { role = 'off'; wss = null; reject(e); });
      s.once('listening', () => {
        wss = s;
        s.on('connection', (ws, req) => {
          ws.lpIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
          const kill = setTimeout(() => { if (!ws.lpAuth) ws.terminate(); }, 5000);
          ws.on('message', (raw) => {
            let m; try { m = JSON.parse(raw); } catch (_) { return; }
            if (!ws.lpAuth) {
              if (m.type === 'hello' && String(m.pin) === pin) {
                ws.lpAuth = true; ws.lpName = String(m.name || ws.lpIp).slice(0, 40); clearTimeout(kill);
                ws.send(JSON.stringify({ type: 'welcome', name }));
                if (lastState) ws.send(JSON.stringify({ ...lastState, type: 'state', sentAt: Date.now() }));
                emitStatus();
              } else { try { ws.send(JSON.stringify({ type: 'denied' })); } catch (_) {} ws.close(); }
              return;
            }
            // El respaldo avisa de que ha tomado el control (a mano, con el principal vivo).
            if (m.type === 'took') onRemote({ type: 'took', name: ws.lpName });
          });
          ws.on('close', () => { clearTimeout(kill); emitStatus(); });
          ws.on('error', () => {});
        });
        // Anuncio por UDP para que el respaldo encuentre este PC sin escribir la IP.
        try {
          beaconSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          beaconSock.on('error', () => {});
          beaconSock.bind(() => {
            try { beaconSock.setBroadcast(true); } catch (_) {}
            const beacon = () => {
              const msg = Buffer.from(JSON.stringify({ lp: 'lp-red', v: 1, name, port: wsPort }));
              for (const addr of broadcastAddrs()) beaconSock.send(msg, beaconPort, addr, () => {});
            };
            beacon(); beaconTimer = setInterval(beacon, BEACON_MS);
          });
        } catch (_) {}
        emitStatus();
        resolve(status());
      });
    });
  }

  function publish(state) {
    if (role !== 'principal' || !state || typeof state !== 'object') return;
    lastState = state;
    broadcast({ ...state, type: 'state', sentAt: Date.now() });
  }

  function startBackup() {
    stopAll();
    role = 'respaldo';
    try {
      listenSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      listenSock.on('error', () => {});
      listenSock.on('message', (buf, rinfo) => {
        let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; }
        if (m.lp !== 'lp-red' || !(m.port > 0)) return;
        const key = rinfo.address + ':' + m.port;
        const isNew = !found.has(key);
        found.set(key, { name: String(m.name || rinfo.address).slice(0, 40), ip: rinfo.address, port: m.port, seen: Date.now() });
        if (isNew) emitStatus();
      });
      listenSock.bind(beaconPort);
    } catch (_) {}
    emitStatus();
    return status();
  }

  function connect(host, port, code) {
    if (role !== 'respaldo') startBackup();
    target = { host: String(host || '').trim(), port: Number(port) || wsPort, pin: String(code || '') };
    clearTimeout(retryTimer);
    if (client) { client.lpClosing = true; try { client.terminate(); } catch (_) {} client = null; }
    const open = () => {
      if (!target || role !== 'respaldo') return;
      const ws = new WebSocket(`ws://${target.host}:${target.port}`, { handshakeTimeout: 2500 });
      client = ws;
      ws.on('open', () => { try { ws.send(JSON.stringify({ type: 'hello', pin: target.pin, name })); } catch (_) {} });
      ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch (_) { return; }
        if (m.type === 'welcome') { linked = true; emitStatus(); onRemote({ type: 'linked', name: m.name }); return; }
        if (m.type === 'denied') { target = null; linked = false; emitStatus(); onRemote({ type: 'denied' }); return; }
        m.recvAt = Date.now();
        onRemote(m);
      });
      ws.on('close', () => {
        const was = linked; linked = false;
        if (client === ws) client = null;
        if (was) { emitStatus(); onRemote({ type: 'lost' }); }
        if (!ws.lpClosing && target && role === 'respaldo') retryTimer = setTimeout(open, 1500);
      });
      ws.on('error', () => {});
    };
    open();
    return status();
  }

  function sendToPrincipal(obj) {
    if (client && linked && client.readyState === WebSocket.OPEN) { try { client.send(JSON.stringify(obj)); return true; } catch (_) {} }
    return false;
  }

  return {
    status,
    startPrincipal,
    startBackup,
    connect,
    publish,
    sendToPrincipal,
    stop() { stopAll(); role = 'off'; pin = ''; emitStatus(); return status(); },
  };
}

// Direcciones de difusión de cada red IPv4 (más la general), para que el anuncio llegue
// también con varias tarjetas (WiFi + cable).
function broadcastAddrs() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) {
    if (n.family !== 'IPv4' || n.internal || !n.netmask) continue;
    const ip = n.address.split('.').map(Number), mask = n.netmask.split('.').map(Number);
    out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
  }
  return [...out];
}

module.exports = { createRedundancy, WS_PORT, BEACON_PORT };
