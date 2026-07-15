// ─────────────────────────────────────────────────────────────────────────
// Arranque CLOUD del desktop: puerta de login → trae las canciones de la nube
// (mismas de LivePads/Supabase) → las deja en window.__CLOUD_SONGS__ → carga el
// renderer real (app.js). Fase 1: pads/click/metrónomo/mezclador/setlist. La
// reproducción de la pista (secuencia/original desde R2) es fase 2, así que el
// audio de pista se omite aquí (audio: null) para no intentar rutas locales.
// ─────────────────────────────────────────────────────────────────────────

import { restoreSession, signIn, isLoggedIn, rest, signInWithGoogle, handleOAuthCallback, getUser, signOut } from './cloudapi/supabase.js';
import { setLibraryId, cloudResolve, cloudResolveFile, watchCovers, prefetchAll } from './cloudapi/media.js';

const LIB_KEY = 'lpm-active-library';
let ACTIVE_LIB = null;

// Service Worker (scope /desktop/): deja pads/js/css/imágenes en caché local
// para que la app cargue y reaccione rápido, y funcione offline. Con aviso de
// nueva versión.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) netBanner('update');
      });
    });
  }).catch(() => {});
}

// Banner fijo (arriba): 'offline' persistente o 'update' con botón Recargar.
function netBanner(kind) {
  let b = document.getElementById('cloud-net');
  if (!b) {
    b = document.createElement('div');
    b.id = 'cloud-net';
    b.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9700;display:flex;align-items:center;gap:10px;padding:9px 15px;border-radius:11px;font:600 12.5px Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    document.body.appendChild(b);
  }
  if (kind === 'offline') {
    b.style.background = '#3a2a12'; b.style.color = '#fbbf24'; b.style.border = '1px solid rgba(251,191,36,.3)';
    b.textContent = 'Sin conexión · usando lo descargado';
    b.style.display = 'flex';
  } else if (kind === 'update') {
    b.style.background = '#fbae00'; b.style.color = '#111'; b.style.border = 'none';
    b.innerHTML = 'Nueva versión disponible <button style="height:28px;padding:0 12px;margin-left:6px;border:none;border-radius:8px;background:rgba(0,0,0,.2);color:#111;font-weight:800;cursor:pointer">Recargar</button>';
    b.querySelector('button').onclick = () => location.reload();
    b.style.display = 'flex';
  } else {
    b.style.display = 'none';
  }
}
window.addEventListener('offline', () => netBanner('offline'));
window.addEventListener('online', () => { const b = document.getElementById('cloud-net'); if (b && !b.querySelector('button')) b.style.display = 'none'; });
if (!navigator.onLine) setTimeout(() => netBanner('offline'), 1000);

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
  window.__cloudResolve = cloudResolve;         // pistas grandes → streaming R2
  window.__cloudResolveFile = cloudResolveFile; // samples/carátulas → blob cacheado
  const rows = await rest(
    `/songs?library_id=eq.${libId}&select=id,title,artist,bpm,key,genre,lyrics,youtube_url,tags,meta&order=title.asc`
  );
  return (Array.isArray(rows) ? rows : []).map(rowToCatalogSong);
}

// ── Banner de progreso visible (arriba, centrado) ──────────────────────────
function progressEl() {
  let b = document.getElementById('cloud-progress');
  if (!b) {
    b = document.createElement('div');
    b.id = 'cloud-progress';
    b.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9600;display:none;align-items:center;gap:12px;min-width:280px;max-width:90vw;padding:11px 16px;border-radius:12px;background:rgba(18,18,18,.97);border:1px solid rgba(251,174,0,.32);color:#fbae00;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.55)';
    b.innerHTML = '<div class="cp-spin" style="width:18px;height:18px;border:3px solid rgba(251,174,0,.25);border-top-color:#fbae00;border-radius:50%;animation:cloudspin .9s linear infinite;flex:none"></div>' +
      '<div style="flex:1;min-width:0"><div id="cp-text">Descargando…</div>' +
      '<div style="height:4px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:6px;overflow:hidden"><div id="cp-bar" style="height:100%;width:0;background:#fbae00;border-radius:3px;transition:width .2s"></div></div></div>';
    document.body.appendChild(b);
  }
  return b;
}
function showProgress(done, total, label) {
  const b = progressEl();
  b.style.display = 'flex';
  const pct = total ? Math.round((done / total) * 100) : 0;
  b.querySelector('#cp-text').textContent = `${label || 'Descargando todo para usar sin latencia'} · ${done}/${total} (${pct}%)`;
  b.querySelector('#cp-bar').style.width = pct + '%';
  b.querySelector('.cp-spin').style.display = 'block';
}
function finishProgress(msg) {
  const b = progressEl();
  b.querySelector('#cp-text').textContent = msg;
  b.querySelector('#cp-bar').style.width = '100%';
  b.querySelector('.cp-spin').style.display = 'none';
  setTimeout(() => { b.style.display = 'none'; }, 3500);
}

let downloading = false;
async function runFullDownload(auto) {
  if (downloading) return;
  downloading = true;
  const btn = document.getElementById('cloud-offline-btn');
  if (btn) { btn.dataset.busy = '1'; btn.style.opacity = '0.6'; }
  showProgress(0, 1, auto ? 'Preparando todo para 0 latencia' : 'Descargando todo');
  try {
    const r = await prefetchAll(window.__CLOUD_SONGS__ || [], window.__CLOUD_DRUMS__ || null, (done, total) => {
      showProgress(done, total);
    });
    finishProgress(r.failed ? `✓ Descargado (${r.failed} fallaron)` : '✓ Todo en memoria local · sin latencia');
    try { localStorage.setItem('lpd-prefetched-' + ACTIVE_LIB, '1'); } catch (_) {}
  } catch (_) {
    finishProgress('No se pudo descargar todo');
  } finally {
    downloading = false;
    if (btn) { delete btn.dataset.busy; btn.style.opacity = '1'; }
  }
}

// Botón "Descargar offline" en la cabecera del Setlist + auto la 1ª vez.
function addOfflineButton() {
  if (document.getElementById('cloud-offline-btn')) return;
  const host = document.querySelector('.setlist-header-actions');
  if (!host) { setTimeout(addOfflineButton, 500); return; } // el renderer aún no montó

  const btn = document.createElement('button');
  btn.id = 'cloud-offline-btn';
  btn.className = 'icon-btn accent-btn';
  btn.title = 'Descargar TODO (audios, carátulas y kits) para usar sin latencia';
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 3v9"/><polyline points="8 9 12 13 16 9"/><path d="M4 15a5 5 0 0 0 4 6h9a4 4 0 0 0 1-7.9A6 6 0 0 0 6.5 9"/></svg>';
  btn.addEventListener('click', () => runFullDownload(false));
  host.appendChild(btn);

  // Primera vez en este equipo: descarga todo automáticamente (una sola vez).
  let already = false;
  try { already = !!localStorage.getItem('lpd-prefetched-' + ACTIVE_LIB); } catch (_) {}
  if (!already) setTimeout(() => runFullDownload(true), 2500);
}

// Entrega las canciones al renderer (que ya arrancó y espera en loadGiSetlist).
function deliverSongs(songs) {
  window.__CLOUD_SONGS__ = songs || [];
  if (typeof window.__onCloudSongs === 'function') window.__onCloudSongs();
}

// Kits de batería personalizados del usuario (user_settings.data.drums).
async function loadCloudDrums() {
  try {
    const u = getUser();
    if (!u || !u.id) return null;
    const rows = await rest(`/user_settings?select=data&user_id=eq.${u.id}`);
    const data = Array.isArray(rows) && rows[0] ? rows[0].data : null;
    return data && data.drums ? data.drums : null;
  } catch (_) { return null; }
}

async function startWithSession() {
  el('cloud-login').style.display = 'none';
  el('cloud-loading').style.display = 'flex';
  let songs = [];
  try { songs = await loadCloudSongs(); } catch (e) { songs = []; }
  // Kits de batería (definiciones); los samples viven en R2 (subidos con la
  // biblioteca). Se entregan al renderer vía el shim de loadUserDrums.
  try { window.__CLOUD_DRUMS__ = await loadCloudDrums(); } catch (_) { window.__CLOUD_DRUMS__ = null; }
  window.__CLOUD_DRUMS_READY__ = true;
  if (typeof window.__onCloudDrums === 'function') window.__onCloudDrums();
  deliverSongs(songs);
  watchCovers();        // resuelve las carátulas livepads:// → R2
  addOfflineButton();   // botón de descarga offline
  addAccountButton();   // botón de cuenta / cerrar sesión en el header
  // El renderer ya se ve por debajo; quitamos la puerta.
  const gate = document.getElementById('cloud-gate');
  if (gate) gate.style.display = 'none';
}

// Botón de CUENTA en el header (mi sistema de login, no el del renderer).
// Muestra el correo y permite cerrar sesión fácilmente.
function addAccountButton() {
  if (document.getElementById('cloud-acct-btn')) return;
  const host = document.querySelector('.topbar-actions');
  if (!host) { setTimeout(addAccountButton, 500); return; }
  const user = getUser() || {};
  const email = user.email || (user.user_metadata && user.user_metadata.email) || 'Mi cuenta';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-flex';
  const btn = document.createElement('button');
  btn.id = 'cloud-acct-btn';
  btn.className = 'icon-btn';
  btn.title = email;
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const menu = document.createElement('div');
  menu.style.cssText = 'position:absolute;right:0;top:calc(100% + 8px);min-width:230px;background:#141414;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px;z-index:9500;display:none;box-shadow:0 14px 44px rgba(0,0,0,.55)';
  menu.innerHTML = '<div style="font-size:11px;color:#9aa0ad;margin-bottom:3px">Sesión iniciada</div>' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:14px;word-break:break-all;color:#f2f2f2">' + email + '</div>' +
    '<button id="cloud-logout" style="width:100%;height:40px;border:none;border-radius:10px;background:rgba(255,107,107,.12);color:#ff6b6b;font-weight:700;cursor:pointer">Cerrar sesión</button>';
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  host.insertBefore(wrap, host.firstChild);
  menu.querySelector('#cloud-logout').addEventListener('click', () => { signOut(); location.reload(); });
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
