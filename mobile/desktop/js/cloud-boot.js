// ─────────────────────────────────────────────────────────────────────────
// Arranque CLOUD del desktop: puerta de login → trae las canciones de la nube
// (mismas de LivePads/Supabase) → las deja en window.__CLOUD_SONGS__ → carga el
// renderer real (app.js). Fase 1: pads/click/metrónomo/mezclador/setlist. La
// reproducción de la pista (secuencia/original desde R2) es fase 2, así que el
// audio de pista se omite aquí (audio: null) para no intentar rutas locales.
// ─────────────────────────────────────────────────────────────────────────

import { restoreSession, signIn, isLoggedIn, rest } from './cloudapi/supabase.js';
import { setLibraryId, cloudResolve, watchCovers, prefetchSongs } from './cloudapi/media.js';

const LIB_KEY = 'lpm-active-library';
let ACTIVE_LIB = null;

function el(id) { return document.getElementById(id); }

// Fila de la nube → canción con el MISMO formato que canciones_app.json (lo que
// el renderer espera). Fase 1: sin audio de pista (se conecta R2 en fase 2).
function rowToCatalogSong(r) {
  const m = r.meta || {};
  return {
    id: 'song_cloud_' + r.id,
    cloudId: r.id,
    title: r.title || 'Sin título',
    artist: r.artist || '',
    bpm: r.bpm || '',
    key: r.key || '',
    genre: r.genre || 'adoracion',
    lyrics: r.lyrics || '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    youtubeUrl: r.youtube_url || '',
    timeSig: m.timeSig || '4/4',
    favorite: !!m.favorite,
    showChords: !!m.showChords,
    addedAt: m.addedAt || Date.now(),
    // Rutas reales: el renderer las resuelve a R2 vía window.__cloudResolve.
    audio: m.audio || { sequence: null, original: null },
    cover: m.cover || null,
  };
}

async function pickLibraryId() {
  const saved = (() => { try { return localStorage.getItem(LIB_KEY); } catch (_) { return null; } })();
  const libs = await rest('/libraries?select=id,name&order=created_at.asc');
  if (!Array.isArray(libs) || !libs.length) return null;
  if (saved && libs.some(l => l.id === saved)) return saved;
  // La que tenga más canciones (evita "Mi librería" vacía).
  let best = libs[0].id, bestN = -1;
  for (const l of libs) {
    try {
      const c = await rest(`/songs?library_id=eq.${l.id}&select=id`);
      const n = Array.isArray(c) ? c.length : 0;
      if (n > bestN) { bestN = n; best = l.id; }
    } catch (_) {}
  }
  try { localStorage.setItem(LIB_KEY, best); } catch (_) {}
  return best;
}

async function loadCloudSongs() {
  const libId = await pickLibraryId();
  if (!libId) return [];
  ACTIVE_LIB = libId;
  setLibraryId(libId);
  window.__cloudResolve = cloudResolve; // el renderer resuelve audio/carátulas por R2
  const rows = await rest(
    `/songs?library_id=eq.${libId}&select=id,title,artist,bpm,key,genre,lyrics,youtube_url,tags,meta&order=title.asc`
  );
  return (Array.isArray(rows) ? rows : []).map(rowToCatalogSong);
}

// Botón flotante "Descargar offline": baja audios + carátulas del repertorio a
// la caché del navegador para tocar sin internet (comparte caché con el móvil).
function addOfflineButton() {
  if (document.getElementById('cloud-offline-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'cloud-offline-btn';
  btn.title = 'Descargar audios y carátulas para usar sin internet';
  btn.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:9000;display:flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:10px;border:1px solid rgba(251,174,0,.35);background:rgba(251,174,0,.12);color:#fbae00;font:600 13px Inter,system-ui,sans-serif;cursor:pointer';
  btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Descargar offline</span>';
  btn.addEventListener('click', async () => {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const label = btn.querySelector('span');
    try {
      const r = await prefetchSongs(window.__CLOUD_SONGS__ || [], (done, total) => {
        label.textContent = `Descargando ${done}/${total}…`;
      });
      label.textContent = r.failed ? `Listo (${r.failed} fallaron)` : '✓ Disponible sin internet';
    } catch (_) {
      label.textContent = 'Error al descargar';
    } finally {
      delete btn.dataset.busy;
      setTimeout(() => { const s = btn.querySelector('span'); if (s) s.textContent = 'Descargar offline'; }, 4000);
    }
  });
  document.body.appendChild(btn);
}

// Entrega las canciones al renderer (que ya arrancó y espera en loadGiSetlist).
function deliverSongs(songs) {
  window.__CLOUD_SONGS__ = songs || [];
  if (typeof window.__onCloudSongs === 'function') window.__onCloudSongs();
}

async function startWithSession() {
  el('cloud-login').style.display = 'none';
  el('cloud-loading').style.display = 'flex';
  let songs = [];
  try { songs = await loadCloudSongs(); } catch (e) { songs = []; }
  deliverSongs(songs);
  watchCovers();      // resuelve las carátulas livepads:// → R2
  addOfflineButton(); // botón de descarga offline
  // El renderer ya se ve por debajo; quitamos la puerta.
  const gate = document.getElementById('cloud-gate');
  if (gate) gate.style.display = 'none';
}

function showLogin(msg) {
  el('cloud-loading').style.display = 'none';
  el('cloud-login').style.display = 'flex';
  if (msg) el('cloud-login-err').textContent = msg;
}

async function main() {
  const user = await restoreSession();
  if (user && isLoggedIn()) return startWithSession();
  showLogin('');
  el('cloud-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('cloud-login-btn');
    el('cloud-login-err').textContent = '';
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await signIn(el('cloud-login-email').value, el('cloud-login-pass').value);
      await startWithSession();
    } catch (err) {
      showLogin(/invalid/i.test(err.message) ? 'Correo o contraseña incorrectos.' : (err.message || 'No se pudo entrar.'));
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

main();
