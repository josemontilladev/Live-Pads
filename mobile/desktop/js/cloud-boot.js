// ─────────────────────────────────────────────────────────────────────────
// Arranque CLOUD del desktop.
//
// Usa el MISMO cliente de nube del renderer (js/cloud/supabase.js) — una sola
// sesión — para que su motor nativo (songSync / setlistSync / libraryLive)
// sincronice igual que LivePads de escritorio: lo que crees o edites aquí se
// sube a Supabase y aparece en la PC y en el móvil, y su polling trae lo que
// cambien los demás.
//
// Este módulo solo aporta: puerta de login, elección de librería, resolución de
// medios desde R2 y la descarga para uso sin internet.
// ─────────────────────────────────────────────────────────────────────────

import {
  restoreSession, signIn, isLoggedIn, getUser, signOut, rest, applySessionTokens,
} from './cloud/supabase.js';
import { getActiveLibraryId, setActiveLibraryId, listLibraries } from './cloud/libraries.js';
import { setLibraryId, cloudResolve, cloudResolveFile, watchCovers, prefetchAll } from './cloudapi/media.js';

const LIB_KEY = 'livepads-active-library';
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

// Mensaje de carga en la puerta (título grande + detalle chico) → siempre se
// sabe QUÉ está pasando mientras arranca.
function loadStep(title, detail) {
  const t = el('cloud-loading-msg'); if (t) t.textContent = title;
  const d = el('cloud-loading-sub'); if (d) d.textContent = detail || '';
}

// Indicador de fondo (arriba-derecha) cuando sincroniza tras estar dentro:
// "Sincronizando…" / "Actualizado ✓". Discreto, se oculta solo.
function syncPill(text, ok) {
  let p = document.getElementById('cloud-sync-pill');
  if (!p) {
    p = document.createElement('div');
    p.id = 'cloud-sync-pill';
    p.style.cssText = 'position:fixed;top:12px;right:16px;z-index:9400;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:10px;background:rgba(20,20,20,.96);border:1px solid rgba(255,255,255,.12);color:#9aa0ad;font:600 12px Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .3s';
    document.body.appendChild(p);
  }
  p.innerHTML = ok
    ? '<span style="color:#86efac">✓</span> ' + text
    : '<span style="width:12px;height:12px;border:2px solid rgba(251,174,0,.3);border-top-color:#fbae00;border-radius:50%;display:inline-block;animation:cloudspin .8s linear infinite"></span> ' + text;
  p.style.opacity = '1';
  p.style.display = 'flex';
  clearTimeout(syncPill._t);
  if (ok) syncPill._t = setTimeout(() => { p.style.opacity = '0'; setTimeout(() => { p.style.display = 'none'; }, 300); }, 2200);
}
// El motor del renderer avisa cuando termina de bajar cambios → "Actualizado".
window.addEventListener('livepads:library-synced', () => syncPill('Actualizado', true));
window.addEventListener('livepads:setlists-synced', () => syncPill('Servicios actualizados', true));

// Elige la librería ACTIVA (la que el renderer usará para sincronizar).
// Se guarda con la MISMA clave que el renderer (libraries.js) para que su motor
// de nube y el nuestro apunten a la misma.
async function pickLibraryId() {
  const saved = getActiveLibraryId();
  // Sin red: usa la última recordada (no se puede consultar).
  if (!navigator.onLine && saved) return saved;
  let libs = [];
  try { libs = await listLibraries(); } catch (_) { return saved || null; }
  if (!Array.isArray(libs) || !libs.length) return saved || null;
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
  setActiveLibraryId(best);
  return best;
}

// Deja lista la resolución de medios (R2) y la librería activa. A partir de
// aquí, el motor de nube del renderer (libraryLive) trae y sube las canciones.
async function setupCloud() {
  let libId = null;
  try { libId = await pickLibraryId(); } catch (_) {}
  if (!libId) libId = getActiveLibraryId();
  if (!libId) return null;
  setActiveLibraryId(libId);
  ACTIVE_LIB = libId;
  setLibraryId(libId);
  window.__cloudResolve = cloudResolve;         // pistas grandes → streaming R2
  window.__cloudResolveFile = cloudResolveFile; // samples/carátulas → blob cacheado
  return libId;
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
    // Canciones desde el store del renderer; kits desde la caché local.
    let songs = [];
    try { const { getSongs } = await import('./state/store.js'); songs = getSongs() || []; } catch (_) {}
    let drums = null;
    try { drums = JSON.parse(localStorage.getItem('lp-drums') || 'null'); } catch (_) {}
    const r = await prefetchAll(songs, drums, (done, total) => {
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

  // NO se descarga solo (tarda y puede no quererse ahora): si aún no está todo
  // en local, el botón se resalta para que se vea que la opción está ahí.
  let already = false;
  try { already = !!localStorage.getItem('lpd-prefetched-' + ACTIVE_LIB); } catch (_) {}
  if (!already) {
    btn.classList.add('cloud-dl-hint');
    btn.title = 'Descargar TODO para usar sin internet y sin latencia (recomendado antes del servicio)';
  }
}

async function startWithSession() {
  el('cloud-login').style.display = 'none';
  el('cloud-loading').style.display = 'flex';

  loadStep('Preparando tu repertorio…', 'Conectando con la nube');
  await setupCloud(); // librería activa + resolución de medios R2

  // Kits de batería + MIDI de la nube (antes de que arranque el resto).
  try {
    loadStep('Cargando tu configuración…', 'Kits de batería y MIDI');
    const { bootSyncBeforeLoad } = await import('./cloud/userSettings.js');
    await bootSyncBeforeLoad();
  } catch (_) {}

  // A partir de aquí manda el motor de nube del RENDERER: baja canciones Y
  // servicios (pullNow ahora hace ambos), y sube lo que se cree/edite aquí.
  try {
    loadStep('Cargando canciones y servicios…', 'Descargando tu repertorio de la nube');
    const { checkLibraryNow } = await import('./cloud/libraryLive.js');
    // Con red lenta, no dejes el gate colgado: máx 15s (el renderer muestra el
    // repertorio cacheado mientras, y el poll seguirá trayendo lo que falte).
    await Promise.race([
      checkLibraryNow(),
      new Promise((r) => setTimeout(r, 15000)),
    ]);
    // Persiste el catálogo YA (no dependas del evento, que puede registrarse
    // después): así una recarga offline abre con el repertorio real.
    const { getSongs } = await import('./state/store.js');
    if (window.electronAPI && window.electronAPI.saveGiSetlist) {
      window.electronAPI.saveGiSetlist(getSongs());
    }
    loadStep('¡Listo!', '');
  } catch (_) {}

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

// Vuelta de Google: GoTrue deja los tokens en el hash. Se los damos al cliente
// del renderer (una sola sesión) y limpiamos la URL.
async function handleOAuthCallback() {
  const hash = location.hash || '';
  if (hash.indexOf('access_token=') === -1) return null;
  const p = new URLSearchParams(hash.slice(1));
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  const expires_in = Number(p.get('expires_in')) || 3600;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  if (!access_token) return null;
  try { return await applySessionTokens({ access_token, refresh_token, expires_in }); }
  catch (_) { return null; }
}

// Redirige a Google (mismo flujo que usa el shim para el renderer).
function googleLogin() {
  const redirectTo = location.origin + location.pathname;
  location.href = 'https://hmrviyzisgoovyttnsth.supabase.co/auth/v1/authorize?provider=google' +
    `&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function main() {
  // ¿Volvemos de Google? (tokens en el hash) → sesión lista.
  const oauthUser = await handleOAuthCallback();
  const user = oauthUser || await restoreSession();
  if (user && isLoggedIn()) return startWithSession();
  showLogin('');
  el('cloud-google').addEventListener('click', () => {
    el('cloud-login-err').textContent = '';
    googleLogin();
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
