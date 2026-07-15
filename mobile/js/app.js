// ─────────────────────────────────────────────────────────────────────────
// LivePads Móvil — wiring de las 3 pantallas (login / biblioteca / player).
// Filosofía: pantalla de reproducción = lo que se usa EN VIVO, con targets
// grandes. Todo lo pesado (audio) se carga al pedirlo y queda cacheado.
// ─────────────────────────────────────────────────────────────────────────

import { restoreSession, signIn, signOut, isLoggedIn } from './supabase.js';
import {
  listLibraries, getActiveLibraryId, setActiveLibraryId,
  fetchSongs, cachedSongs, fetchSetlists,
} from './cloud.js';
import { Player, loadCoverUrl, audioCtx, isSongCached, prefetchSong } from './audio.js';
import { PAD_KEYS, togglePad, stopPads, setPadsVolume, activePadKey } from './pads.js';
import {
  startMetronome, stopMetronome, metroRunning,
  setMetroBpm, setMetroVolume, setMetroPan,
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
let track = 'sequence';      // 'sequence' | 'original'
const player = new Player();
let uiTimer = null;
const coverUrls = new Map(); // coverPath → objectURL (memo de sesión)

// ── Arranque ────────────────────────────────────────────────────────────
(async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const user = await restoreSession();
  if (user) await enterLibrary();
  else show('login');
})();

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
  if (!list.length) { box.innerHTML = '<p class="empty">No hay canciones aquí.</p>'; return; }
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

async function openSong(song, keepHistory) {
  current = song;
  playlist = visibleSongs();
  playIndex = playlist.findIndex(s => s.cloudId === song.cloudId);
  track = song.sequencePath ? 'sequence' : 'original';
  loadedPath = null;
  player.stop(); stopPads(); stopMetronomeUI();
  show('player');
  if (!keepHistory) history.pushState({ player: true }, '');
  requestWakeLock();
  renderNav();

  $('pl-song').textContent = song.title;
  $('pl-artist').textContent = song.artist || '—';
  $('pl-key').textContent = song.key || '—';
  $('pl-bpm').textContent = song.bpm || '120';
  setMetroBpm(song.bpm || 120);
  renderTrackSeg();
  renderBeatDots();
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
    $('mini-play').innerHTML = player.playing ? ICON.pause : ICON.play;
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
$('mini').addEventListener('click', (e) => {
  if (e.target.closest('#mini-play')) {
    audioCtx();
    if (player.playing) player.pause(); else if (player.buffer) player.play();
    updateTransport();
    return;
  }
  reopenPlayer();
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

function trackPath() {
  return track === 'sequence' ? current?.sequencePath : current?.originalPath;
}

function renderTrackSeg() {
  document.querySelectorAll('#track-seg .seg-btn').forEach(btn => {
    const t = btn.dataset.track;
    const has = t === 'sequence' ? !!current?.sequencePath : !!current?.originalPath;
    btn.disabled = !has;
    btn.classList.toggle('active', t === track);
  });
}
document.querySelectorAll('#track-seg .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled || track === btn.dataset.track) return;
    track = btn.dataset.track;
    player.stop();
    loadedPath = null;
    renderTrackSeg();
    updateTransport(true);
  });
});

let loadedPath = null;
async function ensureLoaded() {
  const path = trackPath();
  if (!path) { toast('Esta canción no tiene ese audio.'); return false; }
  if (loadedPath === path && player.buffer) return true;
  const st = $('pl-state');
  try {
    st.textContent = 'Cargando audio…';
    await player.load(libraryId, path, { onState: () => { st.textContent = 'Descargando de la nube…'; } });
    loadedPath = path;
    st.textContent = '';
    return true;
  } catch (err) {
    st.textContent = '';
    toast('No se pudo cargar el audio: ' + (err.message || 'sin conexión'));
    return false;
  }
}

$('pl-play').addEventListener('click', async () => {
  audioCtx(); // gesto: desbloquea el audio del navegador
  if (player.playing) { player.pause(); updateTransport(); return; }
  const btn = $('pl-play');
  btn.disabled = true;
  const ok = await ensureLoaded();
  btn.disabled = false;
  if (!ok) return;
  player.play();
  updateTransport();
});
player.onEnded = () => updateTransport();

$('pl-rew').addEventListener('click', () => { player.seek(player.currentTime - 10); updateTransport(); });
$('pl-fwd').addEventListener('click', () => { player.seek(player.currentTime + 10); updateTransport(); });
$('pl-seek').addEventListener('input', (e) => {
  if (!player.buffer) return;
  player.seek((Number(e.target.value) / 1000) * player.duration);
});

function updateTransport(reset) {
  $('pl-play').innerHTML = player.playing ? ICON.pause : ICON.play;
  $('pl-play').setAttribute('aria-label', player.playing ? 'Pausar' : 'Reproducir');
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
function renderBeatDots() {
  const beats = parseInt(String(current?.timeSig || '4/4').split('/')[0], 10) || 4;
  $('beat-dots').innerHTML = Array.from({ length: beats }, (_, i) =>
    `<span class="beat-dot ${i === 0 ? 'accent' : ''}"></span>`).join('');
}
$('metro-toggle').addEventListener('click', () => {
  audioCtx();
  const btn = $('metro-toggle');
  if (metroRunning()) {
    stopMetronome();
    btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false');
    return;
  }
  const dots = () => [...document.querySelectorAll('.beat-dot')];
  startMetronome(Number($('pl-bpm').textContent), current?.timeSig, (beat) => {
    dots().forEach((d, i) => d.classList.toggle('hit', i === beat));
  });
  btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
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
function songPadKey() {
  let k = (current?.key || '').trim();
  if (!k) return null;
  k = k.replace(/m(aj7|7)?$/i, '').trim();            // Am → A (colchón en la raíz)
  k = k.length > 1 ? k[0].toUpperCase() + k.slice(1) : k.toUpperCase();
  k = KEY_ALIASES[k] || k;
  return PAD_KEYS.includes(k) ? k : null;
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
