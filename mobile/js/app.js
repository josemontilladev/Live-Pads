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
import { Player, loadCoverUrl, audioCtx } from './audio.js';
import { PAD_KEYS, togglePad, stopPads, setPadsVolume, activePadKey } from './pads.js';
import {
  startMetronome, stopMetronome, metroRunning,
  setMetroBpm, setMetroVolume, setMetroPan,
} from './metronome.js';

const $ = (id) => document.getElementById(id);
const screens = { login: $('screen-login'), library: $('screen-library'), player: $('screen-player') };

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
  player.stop(); stopPads(); stopMetronome();
  signOut();
  show('login');
});

// ── Biblioteca ──────────────────────────────────────────────────────────
async function enterLibrary() {
  show('library');
  // Pinta al instante desde caché mientras llega la red.
  const cachedLib = getActiveLibraryId();
  if (cachedLib) {
    libraryId = cachedLib;
    const c = cachedSongs(cachedLib);
    if (c) { songs = c; renderSongs(); }
  }
  try {
    const libs = await listLibraries();
    if (!Array.isArray(libs) || !libs.length) {
      $('song-list').innerHTML = '<p class="empty">Tu cuenta no tiene librerías todavía. Crea una desde LivePads en tu PC.</p>';
      return;
    }
    const chosen = libs.find(l => l.id === libraryId) || libs[0];
    libraryId = chosen.id;
    setActiveLibraryId(libraryId);
    $('lib-name').textContent = chosen.name || 'Repertorio';
    await refreshData();
  } catch (err) {
    if (!songs.length) $('song-list').innerHTML = `<p class="empty">Sin conexión y sin datos guardados aún.<br>Conéctate una vez para descargar el repertorio.</p>`;
  }
}

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

function renderSongs() {
  const list = visibleSongs();
  $('lib-count').textContent = `${list.length} canciones`;
  const box = $('song-list');
  if (!list.length) { box.innerHTML = '<p class="empty">No hay canciones aquí.</p>'; return; }
  box.innerHTML = list.map((s, i) => `
    <button class="song-card" data-i="${i}">
      <span class="song-cover" data-cover="${s.coverPath || ''}">${(s.title || '?')[0].toUpperCase()}</span>
      <span class="song-info"><b>${esc(s.title)}</b><small>${esc(s.artist || '—')}</small></span>
      <span class="song-meta">
        <span class="key-badge">${esc(s.key || '—')}</span>
        ${s.bpm ? `<span class="bpm-badge">${esc(String(s.bpm))} BPM</span>` : ''}
      </span>
    </button>`).join('');
  box.querySelectorAll('.song-card').forEach(el => {
    el.addEventListener('click', () => openSong(list[Number(el.dataset.i)]));
  });
  lazyCovers(box);
}

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
async function openSong(song) {
  current = song;
  track = song.sequencePath ? 'sequence' : 'original';
  player.stop();
  show('player');
  history.pushState({ player: true }, '');

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

  // Carátula grande
  const img = $('pl-cover'); const fb = $('pl-cover-fallback');
  img.hidden = true; fb.hidden = false;
  if (song.coverPath) {
    let url = coverUrls.get(song.coverPath);
    if (url === undefined) { url = await loadCoverUrl(libraryId, song.coverPath); coverUrls.set(song.coverPath, url); }
    if (url && current === song) { img.src = url; img.hidden = false; fb.hidden = true; }
  }
}

function closePlayer() {
  player.stop(); stopMetronome(); stopPads();
  clearInterval(uiTimer); uiTimer = null;
  current = null;
  show('library');
}
$('pl-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => { if (current) closePlayer(); });

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
  player.seek((Number(e.target.value) / 100) * player.duration);
});

function updateTransport(reset) {
  $('pl-play').textContent = player.playing ? '⏸' : '▶';
  if (reset) { $('pl-seek').value = 0; $('pl-cur').textContent = '0:00'; $('pl-dur').textContent = '0:00'; }
  if (player.playing && !uiTimer) {
    uiTimer = setInterval(() => {
      if (!player.buffer) return;
      $('pl-cur').textContent = fmt(player.currentTime);
      $('pl-dur').textContent = fmt(player.duration);
      $('pl-seek').value = String(Math.round((player.currentTime / Math.max(1, player.duration)) * 100));
      if (!player.playing) { clearInterval(uiTimer); uiTimer = null; $('pl-play').textContent = '▶'; }
    }, 250);
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
    btn.classList.remove('on'); btn.textContent = '▶ Click';
    return;
  }
  const dots = () => [...document.querySelectorAll('.beat-dot')];
  startMetronome(Number($('pl-bpm').textContent), current?.timeSig, (beat) => {
    dots().forEach((d, i) => d.classList.toggle('hit', i === beat));
  });
  btn.classList.add('on'); btn.textContent = '■ Click';
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
