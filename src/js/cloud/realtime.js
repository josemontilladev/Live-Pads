// Cambios del equipo en TIEMPO REAL (Supabase Realtime, sin la librería oficial).
//
// Se abre un WebSocket al servicio Realtime del proyecto y se escuchan los
// cambios de la librería activa en `songs`, `setlists`, `deletions` y
// `library_files`. Cuando otro equipo (u otra PC tuya) guarda algo, aquí llega
// el aviso en ~1 s y libraryLive baja los cambios — en vez de esperar a la
// ronda periódica. Si Realtime no está disponible (sin red, tablas sin
// publicar), no pasa nada: la ronda periódica sigue funcionando.
//
//   watchLibrary(libId, { onChange(table) })   // reemplaza la suscripción anterior
//   stopWatching()
//
// Protocolo Phoenix (vsn 1.0.0): phx_join con la config de postgres_changes y
// el JWT del usuario (las RLS deciden qué cambios llegan), heartbeat cada 25 s
// y reconexión con espera creciente.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { getValidToken, onAuthChange, isLoggedIn } from './supabase.js';

const TABLES = ['songs', 'setlists', 'deletions', 'library_files'];
const HEARTBEAT_MS = 25000;
const TOKEN_REFRESH_MS = 10 * 60 * 1000;

let ws = null;
let current = null;        // { libId, onChange }
let ref = 0;
let heartbeat = 0;
let tokenTimer = 0;
let retryTimer = 0;
let retries = 0;
let topic = '';
let lastToken = null;
let pendingBeats = 0;      // latidos sin respuesta: 2 seguidos = conexión zombi → reconectar

const nextRef = () => String(++ref);

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function cleanupSocket() {
  clearInterval(heartbeat); clearInterval(tokenTimer); clearTimeout(retryTimer);
  heartbeat = tokenTimer = retryTimer = 0;
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch (_) {}
  }
  ws = null;
}

// Reconexión inmediata (sin la espera creciente): la usan el latido sin
// respuesta y los errores del canal, que no son fallos de red repetidos.
function scheduleReconnectNow() {
  if (!current) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => connect(), 300);
}

function scheduleReconnect() {
  if (!current) return;
  clearTimeout(retryTimer);
  const wait = Math.min(60000, 1000 * 2 ** Math.min(retries, 6));   // 1 s, 2 s, 4 s… hasta 1 min
  retries++;
  retryTimer = setTimeout(() => connect(), wait);
}

async function connect() {
  cleanupSocket();
  if (!current || !isLoggedIn()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) { scheduleReconnect(); return; }
  const token = await getValidToken().catch(() => null);
  if (!token || !current) { scheduleReconnect(); return; }
  lastToken = token;
  const url = `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
  const { libId } = current;
  topic = `realtime:livepads-lib-${libId}`;
  try { ws = new WebSocket(url); } catch (_) { scheduleReconnect(); return; }

  ws.onopen = () => {
    const joinRef = nextRef();
    send({
      topic, event: 'phx_join', ref: joinRef, join_ref: joinRef,
      payload: {
        config: {
          broadcast: { self: false }, presence: { key: '' },
          postgres_changes: TABLES.map((table) => ({ event: '*', schema: 'public', table, filter: `library_id=eq.${libId}` })),
        },
        access_token: token,
      },
    });
    pendingBeats = 0;
    heartbeat = setInterval(() => {
      // Un socket puede quedar "abierto" sin entregar nada (red que parpadeó,
      // suspensión del equipo): si el servidor deja de responder al latido,
      // se reconecta en vez de quedarse sordo.
      if (pendingBeats >= 2) { scheduleReconnectNow(); return; }
      pendingBeats++;
      send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
    }, HEARTBEAT_MS);
    // El JWT caduca: se renueva en el canal sin reconectar.
    tokenTimer = setInterval(async () => {
      const t = await getValidToken().catch(() => null);
      if (t && t !== lastToken) { lastToken = t; send({ topic, event: 'access_token', payload: { access_token: t }, ref: nextRef() }); }
    }, TOKEN_REFRESH_MS);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.topic === 'phoenix') { if (msg.event === 'phx_reply') pendingBeats = 0; return; }
    if (msg.topic !== topic) return;
    // Error del canal (p. ej. token caducado): suscribirse de nuevo.
    if (msg.event === 'system' && msg.payload?.status === 'error') { scheduleReconnectNow(); return; }
    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') { retries = 0; return; }
    if (msg.event === 'phx_reply' && msg.payload?.status === 'error') { scheduleReconnect(); return; }
    if (msg.event === 'postgres_changes') {
      const table = msg.payload?.data?.table || '';
      try { current?.onChange?.(table); } catch (_) {}
    }
    if (msg.event === 'phx_error' || msg.event === 'phx_close') scheduleReconnect();
  };
  ws.onclose = () => scheduleReconnect();
  ws.onerror = () => { /* onclose se encarga */ };
}

/** Escucha la librería `libId` (reemplaza la anterior). Sin libId, deja de escuchar. */
export function watchLibrary(libId, { onChange } = {}) {
  if (!libId) { stopWatching(); return; }
  if (current && current.libId === libId && ws && ws.readyState <= WebSocket.OPEN) { current.onChange = onChange; return; }
  current = { libId, onChange };
  retries = 0;
  connect();
}

export function stopWatching() {
  current = null;
  cleanupSocket();
}

export const isWatching = () => !!(ws && ws.readyState === WebSocket.OPEN);

// Al cerrar sesión, se corta. Si la sesión se renovó (token nuevo), se le pasa
// al canal al momento: con el token viejo caducado, Realtime deja de entregar.
onAuthChange(async () => {
  if (!isLoggedIn()) { stopWatching(); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const t = await getValidToken().catch(() => null);
  if (t && t !== lastToken) { lastToken = t; send({ topic, event: 'access_token', payload: { access_token: t }, ref: nextRef() }); }
});
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (current) { retries = 0; connect(); } });
}
