// ─────────────────────────────────────────────────────────────────────────
// Companion por internet (portátil). Lo mismo que el servidor de la WiFi manda a
// los móviles, también por el canal en tiempo real de la nube de LivePads
// (Supabase Realtime, canal público «lpc-<código>»). Así los móviles se conectan
// desde cualquier red (datos móviles o cualquier WiFi): el QR abre la página
// publicada con ?s=<código>.
//
//  · start(code, onRemote) / stop()
//  · send(obj): estado, letra, indicaciones… («state» solo al cambiar; «stage» a 1 por segundo como mucho)
//  · onRemote(msg, reply): lo que mandan los móviles (hello, auth, cmd, ping)
//  · clients(): móviles vistos en el último minuto
// Cuota: cada mensaje cuenta en Supabase; por eso el monitor de escenario se
// limita a 1 envío por segundo y solo si cambió.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function readCloudConfig() {
  try {
    const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'cloud', 'config.js'), 'utf8');
    return { url: /SUPABASE_URL = '([^']+)'/.exec(s)[1], key: /SUPABASE_ANON_KEY = '([^']+)'/.exec(s)[1] };
  } catch (_) { return null; }
}

let ws = null, topic = null, ref = 0, joined = false, beat = null, retry = null, retries = 0;
let code = null, onRemote = null, wanted = false, onCollision = null;
const hostId = Math.random().toString(36).slice(2, 12);
let joinedAt = 0, announceTimer = null, collided = false;
function announce() { broadcastEvent('h', { hid: hostId, since: joinedAt }); }
function broadcastEvent(event, payload) {
  if (!joined) return;
  raw({ topic, event: 'broadcast', ref: String(++ref), payload: { type: 'broadcast', event, payload } });
}
const seen = new Map();   // cid → último aviso (ms)
const seenStage = new Map();   // cid de móviles en modo escenario → último aviso (ms)
// El monitor de escenario (hasta 1 mensaje por segundo) solo se manda si algún móvil lo
// está mirando: es lo que más gasta de la cuota de la nube compartida.
function anyStage() { const now = Date.now(); for (const [k, t] of seenStage) { if (now - t > 70000) seenStage.delete(k); } return seenStage.size > 0; }
let lastStateJson = null, lastStageJson = null, lastStageAt = 0, stageTimer = null, pendingStage = null;

function raw(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }
function broadcastRaw(payload) {
  if (!joined) return false;
  raw({ topic, event: 'broadcast', ref: String(++ref), payload: { type: 'broadcast', event: 'm', payload } });
  return true;
}

function connect() {
  const cfg = readCloudConfig();
  if (!wanted || !cfg || !code) return;
  cleanup();
  topic = `realtime:lpc-${code}`;
  try { ws = new WebSocket(`${cfg.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(cfg.key)}&vsn=1.0.0`); }
  catch (_) { schedule(); return; }
  ws.on('open', () => {
    const r = String(++ref);
    raw({ topic, event: 'phx_join', ref: r, join_ref: r, payload: { config: { broadcast: { self: false }, presence: { key: '' }, private: false } } });
    beat = setInterval(() => raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 25000);
  });
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(String(d)); } catch (_) { return; }
    if (m.topic === topic && m.event === 'phx_reply' && !joined) {
      if (m.payload && m.payload.status === 'ok') {
        joined = true; retries = 0; joinedAt = joinedAt || Date.now(); collided = false;
        announce(); clearInterval(announceTimer); announceTimer = setInterval(announce, 60000);
        resendAll();
      }
      return;
    }
    if (m.topic === topic && m.event === 'broadcast' && m.payload && m.payload.event === 'h') {
      const p = m.payload.payload || {};
      if (!p.hid || p.hid === hostId) return;
      const theyFirst = (p.since || 0) < joinedAt || ((p.since || 0) === joinedAt && String(p.hid) < hostId);
      if (theyFirst) { if (!collided && onCollision) { collided = true; try { onCollision(); } catch (_) {} } }
      else announce();   // que el recién llegado sepa que este código ya está en uso
      return;
    }
    if (m.topic === topic && m.event === 'broadcast' && m.payload && m.payload.event === 'c') {
      const p = m.payload.payload || {};
      const cid = String(p.cid || '').slice(0, 20);
      if (!cid) return;
      seen.set(cid, Date.now());
      if (p.st) seenStage.set(cid, Date.now()); else seenStage.delete(cid);
      if (p.type === 'hello') { resendAll(cid); return; }
      if (p.type === 'ping') return;
      if (onRemote) { try { onRemote(p, (reply) => broadcastRaw(Object.assign({ to: cid }, reply))); } catch (_) {} }
    }
  });
  ws.on('close', () => { joined = false; schedule(); });
  ws.on('error', () => { try { ws.close(); } catch (_) {} });
}
function schedule() {
  clearInterval(beat); beat = null;
  if (!wanted) return;
  clearTimeout(retry);
  retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)));
}
function cleanup() {
  clearInterval(beat); beat = null; joined = false; clearInterval(announceTimer); announceTimer = null;
  // Sin oyente de «error», cerrar un socket que aún conecta tumbaría el proceso.
  if (ws) { try { ws.removeAllListeners(); ws.on('error', () => {}); ws.close(); } catch (_) {} ws = null; }
}
// Al unirse (o al llegar un móvil nuevo): lo que suena ahora.
function resendAll(to) {
  const extra = to ? { to } : {};
  if (lastStateJson) broadcastRaw(Object.assign(JSON.parse(lastStateJson), extra));
  if (lastStageJson && anyStage()) broadcastRaw(Object.assign(JSON.parse(lastStageJson), extra));
}

function start(newCode, handler, collisionHandler) {
  const next = String(newCode || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
  if (next !== code) joinedAt = 0;   // código nuevo: este equipo es el recién llegado
  code = next;
  onCollision = collisionHandler || null;
  onRemote = handler || null;
  wanted = !!code;
  retries = 0;
  connect();
}
function stop() { wanted = false; clearTimeout(retry); clearTimeout(stageTimer); cleanup(); seen.clear(); seenStage.clear(); }

/** Lo mismo que se manda por la WiFi. */
function send(obj) {
  if (!wanted || !obj) return;
  if (obj.type === 'state' || obj.type === 'no-song') {
    const j = JSON.stringify(obj);
    if (j === lastStateJson) return;
    lastStateJson = j;
    broadcastRaw(obj);
    return;
  }
  if (obj.type === 'stage') {
    const j = JSON.stringify(Object.assign({}, obj, { pos: obj.pos != null ? Math.round(obj.pos) : obj.pos }));
    if (j === lastStageJson) return;
    lastStageJson = j;
    if (!anyStage()) return;   // nadie en modo escenario: no gasta mensajes
    const wait = 1000 - (Date.now() - lastStageAt);
    pendingStage = obj;
    if (wait <= 0) { lastStageAt = Date.now(); broadcastRaw(pendingStage); pendingStage = null; }
    else if (!stageTimer) stageTimer = setTimeout(() => { stageTimer = null; if (pendingStage) { lastStageAt = Date.now(); broadcastRaw(pendingStage); pendingStage = null; } }, wait);
    return;
  }
  broadcastRaw(obj);   // indicaciones, «playing»… (poco frecuentes)
}

function clients() {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 70000) seen.delete(k);
  return seen.size;
}
const status = () => ({ wanted, connected: joined, code });

module.exports = { start, stop, send, clients, status };
