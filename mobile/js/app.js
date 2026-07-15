// ─────────────────────────────────────────────────────────────────────────
// LivePads Móvil — wiring de las 3 pantallas (login / biblioteca / player).
// Filosofía: pantalla de reproducción = lo que se usa EN VIVO, con targets
// grandes. Todo lo pesado (audio) se carga al pedirlo y queda cacheado.
// ─────────────────────────────────────────────────────────────────────────

import { restoreSession, signIn, signOut, isLoggedIn, signInWithGoogle, handleOAuthCallback } from './supabase.js';
import {
  listLibraries, getActiveLibraryId, setActiveLibraryId,
  fetchSongs, cachedSongs, fetchSetlists,
} from './cloud.js';
import { Player, loadCoverUrl, audioCtx, isSongCached, prefetchSong } from './audio.js';
import { PAD_KEYS, togglePad, startPad, stopPads, setPadsVolume, activePadKey } from './pads.js';
import {
  startMetronome, stopMetronome, metroRunning,
  setMetroBpm, setMetroVolume, setMetroPan,
  setMetroTimeSig, setMetroSubdivision,
} from './metronome.js';

const $ = (id) => document.getElementById(id);
const screens = { login: $('screen-login'), library: $('screen-library'), player: $('screen-player') };

// Iconos SVG (estilo Lucide, trazo 2). Se inyectan donde el estado cambia.
const ICON = {
  play: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="7 4 20 12 7 20 7 4"/></svg>',
  pause: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/></svg>',
};

function show(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// ── Estado ──────────────────────────────────────────────────────────────
let libraryId = null;
let libraries = [];
let songs = [];
let setlists = [];
let activeSetlistId = null;
let query = '';
let current = null;          // canción abierta
let mode = 'sequence';       // 'sequence' | 'click' | 'original'
let semitones = 0;           // transposición del colchón (pad)
let loopEnabled = false;     // repetir canción
const player = new Player();
let uiTimer = null;
const coverUrls = new Map(); // coverPath → objectURL (memo de sesión)

// ── Arranque ────────────────────────────────────────────────────────────
(async function boot() {
  registerSW();
  bindNetwork();
  // ¿Volvemos de Google? (tokens en el hash) → crea la sesión.
  const oauthUser = await handleOAuthCallback();
  const user = oauthUser || await restoreSession();
  if (user) await enterLibrary();
  else show('login');
})();

// ── Robustez: Service Worker con aviso de nueva versión ───────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        // Hay una versión nueva instalada y ya había una controlando la página.
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
      });
    });
  }).catch(() => {});
}
function showUpdateBanner() {
  const b = $('update-banner');
  if (!b) return;
  b.classList.remove('hidden');
}
$('update-reload')?.addEventListener('click', () => location.reload());

// ── Robustez: indicador de "sin conexión" ─────────────────────────────────
function bindNetwork() {
  const paint = () => {
    const off = !navigator.onLine;
    $('offline-banner')?.classList.toggle('hidden', !off);
    document.body.classList.toggle('is-offline', off);
  };
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
}

$('login-google').addEventListener('click', () => {
  $('login-err').textContent = '';
  signInWithGoogle(); // redirige a Google
});

// ── Login ───────────────────────────────────────────────────────────────
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  $('login-err').textContent = '';
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await signIn($('login-email').value, $('login-pass').value);
    await enterLibrary();
  } catch (err) {
    $('login-err').textContent = /invalid/i.test(err.message)
      ? 'Correo o contraseña incorrectos.'
      : (err.message || 'No se pudo iniciar sesión.');
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('btn-logout').addEventListener('click', () => {
  stopEverything();
  signOut();
  show('login');
});

// ── Biblioteca ──────────────────────────────────────────────────────────
async function enterLibrary() {
  show('library');
  // Pinta al instante desde caché mientras llega la red.
  const cachedLib = getActiveLibraryId();
  let painted = false;
  if (cachedLib) {
    libraryId = cachedLib;
    const c = cachedSongs(cachedLib);
    if (c) { songs = c; renderSongs(); painted = true; }
  }
  if (!painted) renderSkeleton(); // evita el pantallazo en blanco en la 1ª carga
  try {
    libraries = await listLibraries();
    if (!Array.isArray(libraries) || !libraries.length) {
      $('song-list').innerHTML = '<p class="empty">Tu cuenta no tiene librerías todavía. Crea una desde LivePads en tu PC.</p>';
      return;
    }
    // Respeta la elegida antes; si es la primera vez, elige la que TENGA
    // canciones (una cuenta suele tener "Mi librería" vacía + el repertorio real).
    let chosen = libraries.find(l => l.id === libraryId);
    if (!chosen) chosen = await pickDefaultLibrary(libraries);
    await useLibrary(chosen);
  } catch (err) {
    if (!songs.length) $('song-list').innerHTML = `<p class="empty">Sin conexión y sin datos guardados aún.<br>Conéctate una vez para descargar el repertorio.</p>`;
  }
}

// La librería con más canciones (la que el usuario de verdad usa).
async function pickDefaultLibrary(libs) {
  if (libs.length === 1) return libs[0];
  const counts = await Promise.all(
    libs.map(l => fetchSongs(l.id).then(s => s.length).catch(() => 0))
  );
  let best = 0;
  counts.forEach((n, i) => { if (n > counts[best]) best = i; });
  return libs[best];
}

async function useLibrary(lib) {
  libraryId = lib.id;
  setActiveLibraryId(libraryId);
  $('lib-name').innerHTML = `${esc(lib.name || 'Repertorio')} <span class="caret">▾</span>`;
  activeSetlistId = null;
  renderChips._auto = false; // permite auto-seleccionar el setlist de HOY
  await refreshData();
}

// ── Selector de repertorio ──────────────────────────────────────────────
$('lib-picker').addEventListener('click', () => {
  const box = $('lib-sheet-list');
  box.innerHTML = libraries.map(l =>
    `<button class="sheet-item ${l.id === libraryId ? 'active' : ''}" data-id="${l.id}">
       <span>${esc(l.name)}</span>${l.id === libraryId ? '<span>✓</span>' : ''}
     </button>`).join('');
  box.querySelectorAll('.sheet-item').forEach(el => {
    el.addEventListener('click', async () => {
      $('lib-sheet').classList.add('hidden');
      const lib = libraries.find(l => l.id === el.dataset.id);
      if (lib && lib.id !== libraryId) { songs = []; renderSongs(); await useLibrary(lib); }
    });
  });
  $('lib-sheet').classList.remove('hidden');
});
$('lib-sheet-close').addEventListener('click', () => $('lib-sheet').classList.add('hidden'));
$('lib-sheet').addEventListener('click', (e) => {
  if (e.target === $('lib-sheet')) $('lib-sheet').classList.add('hidden');
});

async function refreshData() {
  const [s, sl] = await Promise.all([
    fetchSongs(libraryId),
    fetchSetlists(libraryId).catch(() => []),
  ]);
  songs = s;
  setlists = sl;
  renderChips();
  renderSongs();
}

$('btn-refresh').addEventListener('click', async () => {
  toast('Actualizando…');
  try { await refreshData(); toast(`✓ ${songs.length} canciones`); }
  catch (_) { toast('Sin conexión'); }
});

$('search').addEventListener('input', (e) => { query = e.target.value; renderSongs(); });

const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function renderChips() {
  const box = $('setlist-chips');
  if (!setlists.length) { box.innerHTML = ''; return; }
  const today = todayISO();
  const chip = (id, label, isToday) =>
    `<button class="chip ${activeSetlistId === id ? 'active' : ''}" data-id="${id ?? ''}">` +
    `${isToday ? '<span class="hoy">HOY</span>' : ''}${label}</button>`;
  box.innerHTML =
    chip(null, 'Todas', false) +
    setlists.map(sl => chip(sl.id, sl.name, sl.date === today)).join('');
  box.querySelectorAll('.chip').forEach(el => {
    el.addEventListener('click', () => {
      activeSetlistId = el.dataset.id || null;
      renderChips(); renderSongs();
    });
  });
  // Auto-seleccionar la lista de HOY la primera vez.
  if (activeSetlistId === null && !renderChips._auto) {
    renderChips._auto = true;
    const hoy = setlists.find(sl => sl.date === today);
    if (hoy) { activeSetlistId = hoy.id; renderChips(); renderSongs(); }
  }
}

function visibleSongs() {
  let list = songs;
  const sl = setlists.find(x => x.id === activeSetlistId);
  if (sl) {
    const bySongId = new Map(songs.map(s => [s.cloudId, s]));
    list = sl.songIds.map(id => bySongId.get(id)).filter(Boolean);
  }
  const q = norm(query.trim());
  if (q) list = list.filter(s => norm(s.title).includes(q) || norm(s.artist).includes(q));
  return list;
}

// Placeholders animados mientras carga (percepción de velocidad).
function renderSkeleton(n = 8) {
  $('song-list').innerHTML = Array.from({ length: n }, () => `
    <div class="song-card skel" aria-hidden="true">
      <span class="skel-box skel-cover"></span>
      <span class="song-info"><span class="skel-box skel-line w60"></span><span class="skel-box skel-line w35"></span></span>
      <span class="skel-box skel-key"></span>
    </div>`).join('');
}

function renderSongs() {
  const list = visibleSongs();
  $('lib-count').textContent = `${list.length} canciones`;
  const box = $('song-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty">
      <svg class="empty-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p>${query ? 'Sin resultados para tu búsqueda.' : 'No hay canciones en esta lista.'}</p>
    </div>`;
    return;
  }
  box.innerHTML = list.map((s, i) => `
    <button class="song-card" data-i="${i}" data-cid="${s.cloudId}">
      <span class="song-cover" data-cover="${s.coverPath || ''}">${(s.title || '?')[0].toUpperCase()}</span>
      <span class="song-info">
        <b>${esc(s.title)}</b>
        <small>${esc(s.artist || '—')}</small>
      </span>
      <span class="song-meta">
        <span class="song-meta-top">
          <span class="offline-dot" data-cid="${s.cloudId}" title="Disponible sin internet"></span>
          <span class="key-badge">${esc(s.key || '—')}</span>
        </span>
        ${s.bpm ? `<span class="bpm-badge">${esc(String(s.bpm))} BPM</span>` : ''}
      </span>
    </button>`).join('');
  box.querySelectorAll('.song-card').forEach(el => {
    el.addEventListener('click', () => openSong(list[Number(el.dataset.i)]));
  });
  lazyCovers(box);
  markOfflineDots(list);
  updateOfflineBar(list);
}

// Punto verde en las canciones que ya están descargadas (usables sin internet).
async function markOfflineDots(list) {
  for (const s of list) {
    const ok = await isSongCached(libraryId, s);
    document.querySelectorAll(`.offline-dot[data-cid="${s.cloudId}"]`)
      .forEach(el => el.classList.toggle('ready', ok));
  }
}

// Barra de descarga: cuántas de la vista faltan por bajar.
async function updateOfflineBar(list) {
  const bar = $('btn-offline');
  const withAudio = list.filter(s => s.sequencePath || s.originalPath);
  if (!withAudio.length) { bar.classList.add('hidden'); return; }
  let missing = 0;
  for (const s of withAudio) if (!(await isSongCached(libraryId, s))) missing++;
  const ico = $('offline-ico');
  if (!missing) {
    bar.classList.remove('hidden');
    bar.classList.add('done');
    // Icono ✓ (descargado)
    ico.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
    $('offline-txt').textContent = `${withAudio.length} listas sin internet`;
  } else {
    bar.classList.remove('hidden', 'done');
    ico.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
    $('offline-txt').textContent = `Descargar ${missing} para usar sin internet`;
  }
}

// Descarga todo lo visible (útil antes del domingo, con WiFi).
$('btn-offline').addEventListener('click', async () => {
  const bar = $('btn-offline');
  if (bar.classList.contains('done') || bar.dataset.busy) return;
  const list = visibleSongs().filter(s => s.sequencePath || s.originalPath);
  bar.dataset.busy = '1';
  let done = 0;
  for (const s of list) {
    $('offline-txt').textContent = `Descargando ${++done}/${list.length}…`;
    try { await prefetchSong(libraryId, s); } catch (_) {}
    document.querySelectorAll(`.offline-dot[data-cid="${s.cloudId}"]`).forEach(el => el.classList.add('ready'));
  }
  delete bar.dataset.busy;
  toast('✓ Descargadas para usar sin internet');
  updateOfflineBar(visibleSongs());
});

function esc(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Carátulas: perezosas (solo las visibles) y memoizadas. Tras la primera vez
// quedan en Cache Storage → siguientes sesiones sin red.
function lazyCovers(root) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const path = en.target.dataset.cover;
      if (!path) return;
      let url = coverUrls.get(path);
      if (url === undefined) {
        url = await loadCoverUrl(libraryId, path);
        coverUrls.set(path, url);
      }
      if (url) {
        en.target.style.backgroundImage = `url("${url}")`;
        en.target.style.backgroundSize = 'cover';
        en.target.textContent = '';
      }
    });
  }, { rootMargin: '200px' });
  root.querySelectorAll('[data-cover]').forEach(el => { if (el.dataset.cover) io.observe(el); });
}

// ── Reproducción ────────────────────────────────────────────────────────
let playlist = [];   // orden visible al abrir (para ◀▶)
let playIndex = -1;

async function openSong(song, keepHistory, opts = {}) {
  const minimized = !!opts.minimized;   // reproducir sin abrir el reproductor
  const autoplay = !!opts.autoplay;     // arrancar de una (mini prev/next)
  current = song;
  playlist = visibleSongs();
  playIndex = playlist.findIndex(s => s.cloudId === song.cloudId);
  // Modo por defecto: secuencia si hay; si no, original; si no, click.
  mode = song.sequencePath ? 'sequence' : (song.originalPath ? 'original' : 'click');
  semitones = 0; // cada canción arranca en su tono
  loadedPath = null;
  player.stop(); stopPads(); stopMetronomeUI();
  if (!minimized) {
    show('player');
    if (!keepHistory) history.pushState({ player: true }, '');
    requestWakeLock();
  }
  renderNav();

  $('pl-song').textContent = song.title;
  $('pl-artist').textContent = song.artist || '—';
  $('pl-key').textContent = song.key || '—';
  $('pl-bpm').textContent = song.bpm || '120';
  setMetroBpm(song.bpm || 120);
  // Compás de la canción en el selector (editable por el usuario).
  const sig = song.timeSig || '4/4';
  const sigSel = $('metro-sig');
  if (sigSel) { sigSel.value = ['2/4', '3/4', '4/4', '6/8', '12/8'].includes(sig) ? sig : '4/4'; }
  setMetroTimeSig(sigSel ? sigSel.value : sig);
  renderTrackSeg();
  renderBeatDots();
  renderTranspose();
  renderPads();
  updateTransport(true);
  $('pl-state').textContent = '';

  updateMini();

  // Carátula grande
  const img = $('pl-cover'); const fb = $('pl-cover-fallback');
  img.hidden = true; fb.hidden = false;
  if (song.coverPath) {
    let url = coverUrls.get(song.coverPath);
    if (url === undefined) { url = await loadCoverUrl(libraryId, song.coverPath); coverUrls.set(song.coverPath, url); }
    if (url && current === song) {
      img.src = url; img.hidden = false; fb.hidden = true;
      setMiniCover(url);
    }
  }

  // Precarga la SIGUIENTE del setlist (para que el cambio sea instantáneo).
  prefetchNeighbor();

  // Mini prev/next: si venía sonando, arranca la nueva de una.
  if (autoplay) {
    const okKey = songPadKey();
    if (okKey && mode !== 'original') startPad(okKey).then(() => renderPads()).catch(() => {});
    const path = trackPath();
    if (path) { const ok = await ensureLoaded(); if (ok) player.play(); }
    else startMetro();
    updateTransport();
  }
}

// Baja en silencio el audio de la próxima canción del setlist (best-effort).
let prefetchTimer = null;
function prefetchNeighbor() {
  clearTimeout(prefetchTimer);
  const next = playIndex >= 0 && playIndex < playlist.length - 1 ? playlist[playIndex + 1] : null;
  if (!next) return;
  prefetchTimer = setTimeout(() => { prefetchSong(libraryId, next).catch(() => {}); }, 1500);
}

// ── Minimizar / reabrir (mini-reproductor persistente, estilo Spotify) ────
// Volver NO detiene la música: baja el reproductor a una barra y deja seguir
// sonando mientras se navega la lista. Solo se detiene al abrir OTRA canción,
// al cerrar sesión, o con la X del mini.
function minimizePlayer() {
  releaseWakeLock();
  show('library');
  renderSongs();
  updateMini();
}
function reopenPlayer() {
  if (!current) return;
  show('player');
  history.pushState({ player: true }, '');
  requestWakeLock();
  updateTransport();
  updateMini();
}
function stopEverything() {
  player.stop(); stopMetronome(); stopPads();
  clearInterval(uiTimer); uiTimer = null;
  releaseWakeLock();
  current = null;
  updateMini();
}
$('pl-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => {
  // Solo minimiza si el reproductor está a la vista (no en la lista).
  if (current && !screens.player.classList.contains('hidden')) minimizePlayer();
});

// ── Mini-reproductor ──────────────────────────────────────────────────────
function updateMini() {
  const mini = $('mini');
  const onLibrary = !screens.library.classList.contains('hidden');
  if (current && onLibrary) {
    $('mini-title').textContent = current.title;
    $('mini-artist').textContent = current.artist || '—';
    $('mini').classList.remove('hidden');
    $('mini-play').innerHTML = masterActive() ? ICON.pause : ICON.play;
    // Etiqueta de modo (SEC / ORI / CLK) y disponibilidad del toggle.
    const label = mode === 'original' ? 'ORI' : mode === 'click' ? 'CLK' : 'SEC';
    const mm = $('mini-mode');
    mm.textContent = label;
    const canToggle = !!(current.sequencePath && current.originalPath);
    mm.classList.toggle('mode-orig', mode === 'original');
    mm.disabled = !canToggle;
    // ⏮ / ⏭
    $('mini-prev').disabled = playIndex <= 0;
    $('mini-next').disabled = playIndex < 0 || playIndex >= playlist.length - 1;
    document.body.classList.add('has-mini');
  } else {
    mini.classList.add('hidden');
    document.body.classList.remove('has-mini');
  }
}
function setMiniCover(url) {
  const c = $('mini-cover');
  if (!c) return;
  c.style.backgroundImage = `url("${url}")`;
  c.style.backgroundSize = 'cover';
  c.innerHTML = '';
}
$('mini-open').addEventListener('click', reopenPlayer);
$('mini-play').addEventListener('click', masterToggle);
$('mini-prev').addEventListener('click', () => miniNav(-1));
$('mini-next').addEventListener('click', () => miniNav(1));

// ⏮ / ⏭ desde el mini: cambia de canción SIN abrir el reproductor completo.
function miniNav(dir) {
  if (playIndex < 0) return;
  const ni = playIndex + dir;
  if (ni < 0 || ni >= playlist.length) return;
  const wasPlaying = masterActive();
  openSong(playlist[ni], true, { minimized: true, autoplay: wasPlaying });
}

// Toggle Secuencia ↔ Original en el mini (cambio de fuente en vivo, sin abrir).
$('mini-mode').addEventListener('click', async () => {
  if (!current) return;
  const target = mode === 'original' ? 'sequence' : 'original';
  // Solo si esa pista existe.
  const has = target === 'sequence' ? !!current.sequencePath : !!current.originalPath;
  if (!has) { toast(target === 'original' ? 'Sin pista original' : 'Sin secuencia'); return; }
  const wasPlaying = masterActive();
  mode = target;
  renderTrackSeg();
  if (player.playing) player.pause();
  stopMetronomeUI();
  loadedPath = null;
  // El pad acompaña a Secuencia, no a Original.
  if (mode === 'original') stopPads();
  else { const k = songPadKey(); if (k && activePadKey() !== k) startPad(k).then(() => renderPads()).catch(() => {}); }
  if (wasPlaying) {
    const ok = await ensureLoaded();
    if (ok) { player.setVolume(readMusicVol()); player.play(); }
  }
  updateTransport();
  updateMini();
});

// Apaga solo el metrónomo + su botón (al cambiar de canción).
function stopMetronomeUI() {
  stopMetronome();
  const btn = $('metro-toggle');
  if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
}

// ── Navegación dentro del setlist (◀ 3/12 ▶) ─────────────────────────────
function renderNav() {
  const nav = $('pl-nav');
  if (playlist.length <= 1 || playIndex < 0) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  $('pl-pos').textContent = `${playIndex + 1} / ${playlist.length}`;
  $('pl-prev').disabled = playIndex <= 0;
  $('pl-next').disabled = playIndex >= playlist.length - 1;
}
$('pl-prev').addEventListener('click', () => { if (playIndex > 0) openSong(playlist[playIndex - 1], true); });
$('pl-next').addEventListener('click', () => { if (playIndex < playlist.length - 1) openSong(playlist[playIndex + 1], true); });

// ── Wake Lock: la pantalla NO se apaga con una canción abierta ───────────
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
  catch (_) { /* no soportado o denegado: sin drama */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch (_) {}
  wakeLock = null;
}
// Al volver a la app, re-pedir el lock (se libera al ocultar la pestaña).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current) requestWakeLock();
});

// Ruta de audio del modo actual ('click' no tiene pista → null).
function trackPath() {
  if (mode === 'sequence') return current?.sequencePath || null;
  if (mode === 'original') return current?.originalPath || null;
  return null; // click
}

function renderTrackSeg() {
  document.querySelectorAll('#track-seg .seg-btn').forEach(btn => {
    const m = btn.dataset.mode;
    const has = m === 'sequence' ? !!current?.sequencePath
      : m === 'original' ? !!current?.originalPath
      : true; // click siempre disponible
    btn.disabled = !has;
    btn.classList.toggle('active', m === mode);
  });
}

// Cambio de modo EN VIVO (como LivePads): si está sonando, cambia la fuente sin
// parar el pad; si está en pausa, solo deja listo el modo para el próximo play.
document.querySelectorAll('#track-seg .seg-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const m = btn.dataset.mode;
    if (btn.disabled || m === mode) return;
    const wasPlaying = masterActive();
    mode = m;
    renderTrackSeg();

    // Corta la fuente anterior (pista o click), el PAD sigue.
    if (player.playing) player.pause();
    stopMetronomeUI();
    loadedPath = null;

    // El pad acompaña a Secuencia y Click, pero NO a Original.
    if (mode === 'original') {
      stopPads();
    } else {
      const key = songPadKey();
      if (key && activePadKey() !== key) startPad(key).then(() => renderPads()).catch(() => {});
    }

    if (wasPlaying) {
      // Arranca la nueva fuente de inmediato.
      if (mode === 'click') {
        startMetro();
      } else {
        const ok = await ensureLoaded();
        if (ok) { player.setVolume(readMusicVol()); player.play(); }
      }
    }
    updateTransport(true);
    renderPads();
  });
});

function readMusicVol() {
  const el = document.getElementById('mix-music-vol');
  return el ? Number(el.value) / 100 : 1;
}

// Estado de carga: se muestra en el reproductor grande (pl-state) Y, discreto,
// encima del mini (mini-status) para que se vea también desde la lista.
function setLoadStatus(text) {
  const st = $('pl-state'); if (st) st.textContent = text || '';
  const ms = $('mini-status');
  if (ms) { ms.textContent = text || ''; ms.classList.toggle('hidden', !text); }
}

let loadedPath = null;
async function ensureLoaded() {
  const path = trackPath();
  if (!path) { toast('Esta canción no tiene ese audio.'); return false; }
  if (loadedPath === path && player.buffer) return true;
  try {
    setLoadStatus('Cargando audio…');
    await player.load(libraryId, path, {
      onState: (phase, pct) => {
        setLoadStatus(phase === 'descargando'
          ? `Descargando de la nube… ${pct != null ? pct + '%' : ''}`
          : 'Preparando audio…');
      },
    });
    loadedPath = path;
    setLoadStatus('');
    return true;
  } catch (err) {
    // Deja un mensaje accionable: volver a tocar ▶ reintenta (y si la sesión
    // caducó, validToken la renueva en el reintento).
    setLoadStatus(navigator.onLine ? '⚠ No cargó · toca play para reintentar' : '⚠ Sin conexión · descarga esta canción primero');
    return false;
  }
}

// ── PLAY MAESTRO (como LivePads) ──────────────────────────────────────────
// Un solo botón arranca "la canción completa":
//   · Si hay pista (secuencia u original): reproduce la pista + el PAD del tono.
//   · Si NO hay pista: reproduce el CLICK (metrónomo) + el PAD del tono.
// Pausar detiene todo (pista/click/pad).
function masterActive() { return player.playing || metroRunning(); }

async function masterToggle() {
  audioCtx(); // gesto: desbloquea el audio del navegador
  if (masterActive()) {
    if (player.playing) player.pause();
    stopMetronomeUI();
    stopPads();
    updateTransport();
    renderPads();
    return;
  }
  // Arranca el colchón (pad) en el tono de la canción — salvo en ORIGINAL, que
  // ya trae su propia música y no debe superponerse un colchón.
  const key = songPadKey();
  if (key && mode !== 'original') { startPad(key).then(() => renderPads()).catch(() => {}); }

  const path = trackPath();
  if (path) {
    // Hay secuencia/original → reproduce la pista.
    const btn = $('pl-play');
    btn.disabled = true;
    const ok = await ensureLoaded();
    btn.disabled = false;
    if (ok) player.play();
  } else {
    // Sin pista → el "play" es el click (metrónomo).
    startMetro();
  }
  updateTransport();
}
$('pl-play').addEventListener('click', masterToggle);
player.onEnded = () => {
  if (loopEnabled && player.buffer) { player.seek(0); player.play(); } // repetir
  updateTransport();
};

// ── Transponer el colchón (pad) ───────────────────────────────────────────
function renderTranspose() {
  const base = baseKey();
  $('tr-key').textContent = base ? songPadKey() : '—';
  const v = $('tr-val');
  v.textContent = semitones > 0 ? `+${semitones}` : String(semitones);
  v.classList.toggle('shifted', semitones !== 0);
  $('tr-down').disabled = !base;
  $('tr-up').disabled = !base;
}
function transposeBy(d) {
  if (!baseKey()) return;
  semitones = Math.max(-6, Math.min(6, semitones + d));
  renderTranspose();
  renderPads();
  // Si el colchón está sonando, cámbialo al nuevo tono (crossfade suave).
  if (activePadKey()) { const k = songPadKey(); if (k) startPad(k).then(() => renderPads()).catch(() => {}); }
}
$('tr-down').addEventListener('click', () => transposeBy(-1));
$('tr-up').addEventListener('click', () => transposeBy(1));
$('tr-val').addEventListener('dblclick', () => { semitones = 0; renderTranspose(); renderPads(); const k = songPadKey(); if (activePadKey() && k) startPad(k).then(() => renderPads()).catch(() => {}); });

// ── Loop / repetir ────────────────────────────────────────────────────────
$('loop-btn').addEventListener('click', () => {
  loopEnabled = !loopEnabled;
  $('loop-btn').classList.toggle('on', loopEnabled);
  $('loop-btn').setAttribute('aria-pressed', String(loopEnabled));
  toast(loopEnabled ? 'Repetir activado' : 'Repetir desactivado');
});

$('pl-rew').addEventListener('click', () => { player.seek(player.currentTime - 10); updateTransport(); });
$('pl-fwd').addEventListener('click', () => { player.seek(player.currentTime + 10); updateTransport(); });
$('pl-seek').addEventListener('input', (e) => {
  if (!player.buffer) return;
  player.seek((Number(e.target.value) / 1000) * player.duration);
});

function updateTransport(reset) {
  const active = masterActive();
  $('pl-play').innerHTML = active ? ICON.pause : ICON.play;
  $('pl-play').setAttribute('aria-label', active ? 'Pausar' : 'Reproducir');
  updateMini();
  if (reset) { $('pl-seek').value = 0; $('pl-cur').textContent = '0:00'; $('pl-dur').textContent = '0:00'; }
  if (player.playing && !uiTimer) {
    uiTimer = setInterval(() => {
      if (!player.buffer) return;
      $('pl-cur').textContent = fmt(player.currentTime);
      $('pl-dur').textContent = fmt(player.duration);
      $('pl-seek').value = String(Math.round((player.currentTime / Math.max(1, player.duration)) * 1000));
      if (!player.playing) { clearInterval(uiTimer); uiTimer = null; $('pl-play').innerHTML = ICON.play; }
    }, 200);
  }
}

// ── Mezcla (volúmenes + paneo) ──────────────────────────────────────────
$('mix-music-vol').addEventListener('input', e => player.setVolume(Number(e.target.value) / 100));
$('mix-music-pan').addEventListener('input', e => player.setPan(Number(e.target.value) / 100));
$('mix-click-vol').addEventListener('input', e => setMetroVolume(Number(e.target.value) / 100));
$('mix-click-pan').addEventListener('input', e => setMetroPan(Number(e.target.value) / 100));
$('mix-pads-vol').addEventListener('input', e => setPadsVolume(Number(e.target.value) / 100));

// ── Metrónomo ───────────────────────────────────────────────────────────
function currentSig() { return $('metro-sig')?.value || current?.timeSig || '4/4'; }
function renderBeatDots() {
  const beats = parseInt(String(currentSig()).split('/')[0], 10) || 4;
  $('beat-dots').innerHTML = Array.from({ length: beats }, (_, i) =>
    `<span class="beat-dot ${i === 0 ? 'accent' : ''}"></span>`).join('');
}
// Compás: cambia el patrón (y los puntos) en vivo.
$('metro-sig').addEventListener('change', (e) => {
  setMetroTimeSig(e.target.value);
  renderBeatDots();
});
// Subdivisión 1x / 2x.
document.querySelectorAll('.sub-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sub-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMetroSubdivision(Number(btn.dataset.sub));
  });
});
// Arranca el metrónomo y refleja su botón (compartido por el botón Click y el
// play maestro de canciones sin pista).
function startMetro() {
  const dots = () => [...document.querySelectorAll('.beat-dot')];
  startMetronome(Number($('pl-bpm').textContent), currentSig(), (beat) => {
    dots().forEach((d, i) => d.classList.toggle('hit', i === beat));
  });
  const btn = $('metro-toggle');
  if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
}
$('metro-toggle').addEventListener('click', () => {
  audioCtx();
  if (metroRunning()) { stopMetronomeUI(); updateTransport(); return; }
  startMetro();
  updateTransport();
});
function bpmNudge(d) {
  const v = Math.max(30, Math.min(300, Number($('pl-bpm').textContent) + d));
  $('pl-bpm').textContent = String(v);
  setMetroBpm(v);
}
$('bpm-down').addEventListener('click', () => bpmNudge(-1));
$('bpm-up').addEventListener('click', () => bpmNudge(1));

// ── Pads de notas ───────────────────────────────────────────────────────
const KEY_ALIASES = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
// Tono base (raíz) de la canción, sin transponer.
function baseKey() {
  let k = (current?.key || '').trim();
  if (!k) return null;
  k = k.replace(/m(aj7|7)?$/i, '').trim();            // Am → A (colchón en la raíz)
  k = k.length > 1 ? k[0].toUpperCase() + k.slice(1) : k.toUpperCase();
  k = KEY_ALIASES[k] || k;
  return PAD_KEYS.includes(k) ? k : null;
}
// Tono del colchón APLICANDO la transposición (semitones).
function songPadKey() {
  const base = baseKey();
  if (!base) return null;
  const i = PAD_KEYS.indexOf(base);
  return PAD_KEYS[(i + semitones + 120) % 12];
}

function renderPads() {
  const grid = $('pads-grid');
  const songKey = songPadKey();
  grid.innerHTML = PAD_KEYS.map(k =>
    `<button class="pad-btn ${activePadKey() === k ? 'on' : ''} ${songKey === k ? 'song-key' : ''}" data-key="${k}">${k}</button>`
  ).join('');
  grid.querySelectorAll('.pad-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      audioCtx();
      btn.classList.add('loading');
      try { await togglePad(btn.dataset.key); }
      catch (_) { toast('No se pudo cargar el pad.'); }
      btn.classList.remove('loading');
      renderPads();
    });
  });
  $('pads-hint').textContent = songKey
    ? `El tono de esta canción es ${songKey} (marcado con ●)`
    : 'Toca un tono para encender el colchón';
}
