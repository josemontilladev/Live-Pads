// ─────────────────────────────────────────────────────────────────────────
// "En vivo ahora": lo que la cabina (LivePads escritorio) publica en la tabla
// now_playing de la librería. Se sondea cada pocos segundos mientras la app
// está visible; si la fila no existe (migración pendiente) o es vieja, la
// tarjeta simplemente no se muestra.
// ─────────────────────────────────────────────────────────────────────────

import { rest } from './supabase.js';

const POLL_MS = 5000;
const STALE_MS = 3 * 60 * 60 * 1000;   // una fila de hace >3 h ya no es "ahora"

let timer = null;
let libraryId = null;
let onOpen = null;
let lastSig = '';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function render(row) {
  const card = $('live-card');
  if (!card) return;
  const fresh = row && row.title && (Date.now() - Date.parse(row.updated_at || 0)) < STALE_MS;
  if (!fresh) { card.classList.add('hidden'); lastSig = ''; return; }
  const sig = JSON.stringify([row.song_id, row.title, row.key, row.next_title, row.next_key, row.position, row.total, row.is_live]);
  if (sig === lastSig) return;
  lastSig = sig;
  card.dataset.songId = row.song_id || '';
  card.classList.toggle('is-live', !!row.is_live);
  $('live-title').innerHTML = `${esc(row.title)}${row.artist ? ` <span class="live-artist">· ${esc(row.artist)}</span>` : ''}`;
  $('live-key').textContent = row.key || '';
  const pos = row.position && row.total ? `${row.position}/${row.total} · ` : '';
  $('live-next').textContent = row.next_title
    ? `${pos}Siguiente: ${row.next_title}${row.next_key ? ` (${row.next_key})` : ''}`
    : `${pos}Última del servicio`;
  card.classList.remove('hidden');
}

async function tick() {
  if (!libraryId || document.hidden || !navigator.onLine) return;
  try {
    const rows = await rest(
      `/now_playing?library_id=eq.${libraryId}&select=song_id,title,artist,key,next_song_id,next_title,next_key,position,total,is_live,updated_at`
    );
    render(Array.isArray(rows) ? rows[0] : null);
  } catch (_) {
    render(null);
  }
}

export function startLiveWatch(libId, openHandler) {
  libraryId = libId;
  onOpen = openHandler;
  lastSig = '';
  if (!timer) {
    timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    window.addEventListener('online', tick);
    const card = $('live-card');
    if (card) card.addEventListener('click', () => { if (onOpen) onOpen(card.dataset.songId || null); });
  }
  tick();
}
