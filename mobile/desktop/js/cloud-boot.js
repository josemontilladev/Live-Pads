// ─────────────────────────────────────────────────────────────────────────
// Arranque CLOUD del desktop: puerta de login → trae las canciones de la nube
// (mismas de LivePads/Supabase) → las deja en window.__CLOUD_SONGS__ → carga el
// renderer real (app.js). Fase 1: pads/click/metrónomo/mezclador/setlist. La
// reproducción de la pista (secuencia/original desde R2) es fase 2, así que el
// audio de pista se omite aquí (audio: null) para no intentar rutas locales.
// ─────────────────────────────────────────────────────────────────────────

import { restoreSession, signIn, isLoggedIn, rest, signInWithGoogle, handleOAuthCallback } from './cloudapi/supabase.js';
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

// Botón "Descargar offline": se integra en la cabecera del Setlist (junto a
// import/export), NO flota sobre el transporte. Baja audios + carátulas del
// repertorio a la caché del navegador (comparte caché con el móvil).
function addOfflineButton() {
  if (document.getElementById('cloud-offline-btn')) return;
  const host = document.querySelector('.setlist-header-actions');
  if (!host) { setTimeout(addOfflineButton, 500); return; } // el renderer aún no montó

  const btn = document.createElement('button');
  btn.id = 'cloud-offline-btn';
  btn.className = 'icon-btn accent-btn';
  btn.title = 'Descargar audios y carátulas para usar sin internet';
  const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 3v9"/><polyline points="8 9 12 13 16 9"/><path d="M4 15a5 5 0 0 0 4 6h9a4 4 0 0 0 1-7.9A6 6 0 0 0 6.5 9"/></svg>';
  btn.innerHTML = ICON;
  const toast = (t) => { try { window.showToast ? window.showToast(t) : (btn.title = t); } catch (_) {} };

  btn.addEventListener('click', async () => {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    btn.style.opacity = '0.6';
    try {
      const r = await prefetchSongs(window.__CLOUD_SONGS__ || [], (done, total) => {
        btn.title = `Descargando ${done}/${total}…`;
      });
      toast(r.failed ? `Descargado (${r.failed} fallaron)` : '✓ Repertorio disponible sin internet');
    } catch (_) {
      toast('No se pudo descargar');
    } finally {
      delete btn.dataset.busy;
      btn.style.opacity = '1';
      btn.title = 'Descargar audios y carátulas para usar sin internet';
    }
  });
  host.appendChild(btn);
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
  // ¿Volvemos de Google? (tokens en el hash) → sesión lista.
  const oauthUser = await handleOAuthCallback();
  const user = oauthUser || await restoreSession();
  if (user && isLoggedIn()) return startWithSession();
  showLogin('');
  el('cloud-google').addEventListener('click', () => {
    el('cloud-login-err').textContent = '';
    signInWithGoogle();
  });
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
