// ─────────────────────────────────────────────────────────────────────────
// Arranque CLOUD del desktop: puerta de login → trae las canciones de la nube
// (mismas de LivePads/Supabase) → las deja en window.__CLOUD_SONGS__ → carga el
// renderer real (app.js). Fase 1: pads/click/metrónomo/mezclador/setlist. La
// reproducción de la pista (secuencia/original desde R2) es fase 2, así que el
// audio de pista se omite aquí (audio: null) para no intentar rutas locales.
// ─────────────────────────────────────────────────────────────────────────

import { restoreSession, signIn, isLoggedIn } from './cloudapi/supabase.js';
import { rest } from './cloudapi/supabase.js';

const LIB_KEY = 'lpm-active-library';

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
    audio: { sequence: null, original: null }, // fase 2: R2
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
  const rows = await rest(
    `/songs?library_id=eq.${libId}&select=id,title,artist,bpm,key,genre,lyrics,youtube_url,tags,meta&order=title.asc`
  );
  return (Array.isArray(rows) ? rows : []).map(rowToCatalogSong);
}

// Inyecta el renderer real (module) una vez tenemos las canciones.
function bootRenderer() {
  const s = document.createElement('script');
  s.type = 'module';
  s.src = 'js/app.js';
  document.body.appendChild(s);
  // Fallback: oculta la puerta cloud aunque el observer del preloader no dispare.
  setTimeout(() => { const g = document.getElementById('cloud-gate'); if (g) g.style.display = 'none'; }, 3000);
}

async function startWithSession() {
  el('cloud-login').style.display = 'none';
  el('cloud-loading').style.display = 'flex';
  try {
    window.__CLOUD_SONGS__ = await loadCloudSongs();
  } catch (e) {
    window.__CLOUD_SONGS__ = [];
  }
  el('cloud-loading').style.display = 'none';
  bootRenderer();
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
