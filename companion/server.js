// Companion server — HTTP + WebSocket served on the LAN so phones on the
// same WiFi can open a passive lyrics viewer pointing at the current song.
//
// Lifecycle: start() opens the server on a free port (3001 → 3010), stop()
// closes it cleanly. broadcast() pushes state to every connected client.
// getStatus() returns { running, port, url, clients } for the UI panel.
//
// No auth — LAN-only. The renderer is the source of truth: it calls
// publishSong(song) via IPC whenever the active song changes, and the server
// rebroadcasts to every WS peer + caches the last state so late joiners
// receive it on connect.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const cloud = require('./cloud');
const CLIENT_DIR = path.join(__dirname, 'client');
const PORT_RANGE = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon'
};

let httpServer = null;
let wss = null;
let activePort = null;
let lastState = { type: 'no-song' };
let preferredIp = null; // overrides auto-detected IP when user picks one manually

// ── Control remoto e indicaciones (de ida y vuelta) ──
// Cualquiera en la red puede VER la letra; para CONTROLAR (play, siguiente…) o enviar
// indicaciones a la banda hace falta el PIN de 4 cifras que muestra LivePads (así nadie
// de la congregación conectado al mismo wifi puede tocar el sonido). Nuevo en cada arranque.
let pin = String(Math.floor(1000 + Math.random() * 9000));
let onCommand = null;                  // (cmd) => void — lo pone main.js (manda al renderer)
const REMOTE_CMDS = new Set(['play', 'stop', 'next', 'prev', 'cue', 'panic']);
function setCommandHandler(fn) { onCommand = typeof fn === 'function' ? fn : null; }
function newPin() { pin = String(Math.floor(1000 + Math.random() * 9000)); return pin; }
function handleMessage(ws, raw) {
  let m;
  try { m = JSON.parse(String(raw)); } catch (_) { return; }
  handleRemote(m, (reply) => { try { ws.send(JSON.stringify(reply)); } catch (_) {} }, 'wifi');
}
// Mensajes de los móviles (por la WiFi o por internet). Por internet, tras 5 PIN
// incorrectos seguidos ese móvil queda un minuto sin poder probar (contra adivinarlo).
const pinFails = new Map();   // id → { n, until }
function handleRemote(m, reply, who) {
  if (!m || typeof m !== 'object') return;
  const key = String(m.cid || who || '');
  const f = pinFails.get(key);
  if (f && f.until > Date.now()) { reply({ type: 'auth', ok: false, wait: true }); return; }
  const ok = String(m.pin || '') === pin;
  if ((m.type === 'auth' || m.type === 'cmd') && m.pin != null) {
    if (ok) pinFails.delete(key);
    else { const n = (f ? f.n : 0) + 1; pinFails.set(key, { n, until: n >= 5 ? Date.now() + 60000 : 0 }); }
  }
  if (m.type === 'auth') { reply({ type: 'auth', ok }); return; }
  if (m.type !== 'cmd') return;
  if (!ok) { reply({ type: 'auth', ok: false }); return; }
  const cmd = String(m.cmd || '');
  if (!REMOTE_CMDS.has(cmd)) return;
  const arg = typeof m.arg === 'string' ? m.arg.slice(0, 40) : null;
  if (onCommand) { try { onCommand({ cmd, arg, from: String(m.name || '').slice(0, 30) }); } catch (_) {} }
}

/** Indicación del director a todos los móviles: { id, text }. */
function broadcastCue(cue) {
  if (!cue || !cue.text) return;
  broadcast({ type: 'cue', id: String(cue.id || ''), text: String(cue.text).slice(0, 40), from: String(cue.from || '').slice(0, 30), at: Date.now() });
}

// Heuristics to surface the real WiFi/Ethernet IP and downrank VPN tunnels
// (Cloudflare WARP, Tailscale, WireGuard, OpenVPN, etc.). The user can still
// override via setPreferredIp() if the auto-pick is wrong on their machine.
const VPN_NAME_RE = /vpn|tap|tun|utun|wg|wireguard|openvpn|cloudflare|warp|proton|nord|express|tailscale|zerotier|hamachi|virtualbox|vmware|hyper-v|docker|wsl/i;
const LAN_NAME_RE = /wi-?fi|wlan|ethernet|eth\d|en\d|^lan/i;

function scoreInterface(name, addr) {
  let score = 0;
  // Hotspot ranges win outright — Windows Mobile Hotspot hands out
  // 192.168.137.x and Android tethering 192.168.43.x. When the laptop is its
  // own access point ("church mode"), that's exactly the network the phones
  // are on, so the QR must point there.
  if (/^192\.168\.137\./.test(addr) || /^192\.168\.43\./.test(addr)) score += 200;
  // Address-range scoring — 192.168.x.x is the gold standard for home LAN.
  if (/^192\.168\./.test(addr))     score += 100;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score += 40;
  else if (/^10\./.test(addr))       score += 30;
  // Link-local — almost never useful.
  if (/^169\.254\./.test(addr)) score -= 100;

  // Name-based hints — beats range when the user has VPN running on 10.x.
  if (LAN_NAME_RE.test(name)) score += 50;
  if (VPN_NAME_RE.test(name)) score -= 80;

  return score;
}

function getLanCandidates() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      out.push({
        ip: info.address,
        iface: name,
        score: scoreInterface(name, info.address)
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function getLanIp() {
  if (preferredIp) return preferredIp;
  const candidates = getLanCandidates();
  return candidates[0] ? candidates[0].ip : '127.0.0.1';
}

function setPreferredIp(ip) {
  // Only accept an IP that the OS actually advertises — prevents typos
  // pointing the QR at a dead address.
  const valid = getLanCandidates().some(c => c.ip === ip);
  preferredIp = valid ? ip : null;
}

function serveStatic(req, res) {
  // Una URL mal formada («/%») hacía saltar decodeURIComponent y, sin nadie que lo
  // atrapara, mostraba un diálogo de error del proceso principal sobre la app.
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (_) { res.writeHead(400); res.end('Bad request'); return; }
  if (urlPath === '/') urlPath = '/index.html';

  // Prevent path traversal — only serve files inside CLIENT_DIR.
  const filePath = path.normalize(path.join(CLIENT_DIR, urlPath));
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(buf);
  });
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveStatic);
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') reject(err);
      else reject(err);
    });
    server.once('listening', () => resolve(server));
    server.listen(port, '0.0.0.0');
  });
}

async function start() {
  if (httpServer) return getStatus();

  let server = null;
  let portUsed = null;
  for (const p of PORT_RANGE) {
    try {
      server = await tryListen(p);
      portUsed = p;
      break;
    } catch (e) {
      // Port busy → try next.
    }
  }
  if (!server) throw new Error('No free port in 3001-3010 for Companion server');

  httpServer = server;
  activePort = portUsed;

  wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws) => {
    // Send the cached state immediately so late joiners see the active song.
    try { ws.send(JSON.stringify(lastState)); } catch (e) {}
    if (lastStage) { try { ws.send(JSON.stringify(lastStage)); } catch (e) {} }
    ws.on('message', (raw) => handleMessage(ws, raw));
  });
  if (cloudCode) setCloud(cloudCode);

  return getStatus();
}

async function stop() {
  cloud.stop();
  if (wss) {
    for (const client of wss.clients) {
      try { client.close(); } catch (e) {}
    }
    try { wss.close(); } catch (e) {}
    wss = null;
  }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(() => resolve()));
    httpServer = null;
  }
  activePort = null;
  return getStatus();
}

function broadcast(payload) {
  try { cloud.send(payload); } catch (_) {}
  if (!wss) return;
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      try { client.send(data); } catch (e) {}
    }
  }
}

let lastPlaying = false;
let lastStage = null;   // monitor de escenario (?escenario): sección, acordes, tiempo, siguiente

function publishStage(stage) {
  lastStage = Object.assign({ type: 'stage' }, stage || {});
  broadcast(lastStage);
}

let lastTheme = null;
/** Colores del tema activo de LivePads (los móviles se pintan igual). */
function setTheme(t) {
  if (!t || typeof t !== 'object') return;
  const pick = {};
  for (const k of ['id', 'bg', 'bg2', 'bg3', 'accent', 'accent2', 'text', 'muted', 'border', 'onAccent', 'gradient'])
    if (t[k] != null) pick[k] = String(t[k]).slice(0, 400);
  lastTheme = pick;
  lastState = Object.assign({}, lastState, { theme: lastTheme });
  broadcast(lastState);
}

function publishSong(song) {
  if (!song) {
    lastState = { type: 'no-song', theme: lastTheme };
  } else {
    lastState = {
      type: 'state',
      song: {
        id: song.id || null,
        title: song.title || '',
        artist: song.artist || '',
        key: song.key || '',
        bpm: song.bpm || '',
        lyrics: song.lyrics || ''
      },
      playing: lastPlaying,
      theme: lastTheme
    };
  }
  broadcast(lastState);
}

function publishPlaying(playing) {
  lastPlaying = !!playing;
  if (lastState && lastState.type === 'state') {
    lastState = Object.assign({}, lastState, { playing: lastPlaying });
  }
  // Lightweight stand-alone event so clients can update the live dot
  // without re-rendering the whole song view.
  broadcast({ type: 'playing', value: lastPlaying });
}

// ── Por internet ─────────────────────────────────────────────────────────
// Página publicada del Companion (GitHub Pages). El QR «Por internet» la abre con ?s=<código>.
const COMPANION_WEB = 'https://companion.livepads.online/';
let cloudCode = null;
/** Activa (con su código) o apaga el modo por internet. */
let onCodeCollision = null;
function setCodeCollisionHandler(fn) { onCodeCollision = fn; }
function setCloud(code) {
  cloudCode = code || null;
  if (cloudCode && httpServer) cloud.start(cloudCode, (m, reply) => handleRemote(m, reply, 'cloud'), () => { if (onCodeCollision) onCodeCollision(); });
  else cloud.stop();
  if (cloudCode) { cloud.send(lastState); if (lastStage) cloud.send(lastStage); }
}

function getStatus() {
  const ip = getLanIp();
  const candidates = getLanCandidates();
  const cs = cloud.status();
  return {
    cloud: cloudCode ? { url: COMPANION_WEB + '?s=' + cloudCode, code: cloudCode, web: COMPANION_WEB.replace(/^https:\/\//, '').replace(/\/$/, ''), connected: cs.connected, clients: cloud.clients() } : null,
    running: !!httpServer,
    port: activePort,
    url: httpServer ? `http://${ip}:${activePort}` : null,
    ip,
    candidates, // [{ip, iface, score}, ...] — surfaced in the panel for manual override
    clients: wss ? wss.clients.size : 0,
    pin
  };
}

module.exports = { start, stop, publishSong, publishPlaying, publishStage, getStatus, setPreferredIp, setCommandHandler, broadcastCue, newPin, setCloud, setTheme, setCodeCollisionHandler };
