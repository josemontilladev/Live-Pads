// ─────────────────────────────────────────────────────────────────────────
// Ventana de la letra (lyrics.html): se abre con «Letra» en una canción y se
// puede llevar a otra pantalla (TV, segundo monitor). La pantalla de Pads no
// cambia: el baterista sigue viendo sus pads.
//
// Recibe { title, artist, key, html, hideChords } por 'lyrics-data' (main.js).
// Tamaño de letra y acordes se recuerdan; «Seguir canción» hace que cambie sola
// a la canción que suena en LivePads.
// ─────────────────────────────────────────────────────────────────────────

import { paintThemeVars, savedThemeId, THEME_STORAGE_KEY } from './ui/themeVars.js';
import { applyChordNumbers, NUMS_KEY } from './utils/chordNumbers.js';
import { applyLyricsBackground, BG_KEY } from './ui/lyricsBackground.js';

// El mismo tema que la ventana principal (antes salía siempre con los colores
// base). Si se cambia el tema con la ventana abierta, se repinta sola: las dos
// ventanas comparten localStorage y el evento 'storage' avisa del cambio.
paintThemeVars(savedThemeId());
window.addEventListener('storage', (e) => { if (e.key === THEME_STORAGE_KEY) paintThemeVars(savedThemeId()); });
// Acordes como grados (1·4·5): misma preferencia que la app; cambia al instante.
applyChordNumbers();
window.addEventListener('storage', (e) => { if (e.key === NUMS_KEY) applyChordNumbers(); });
// Alto contraste (escenario): misma clave que ui/themes.js.
const paintHC = () => { let on = false; try { on = localStorage.getItem('livepads.contrast') === '1'; } catch (_) {} if (on) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast; };
paintHC();
window.addEventListener('storage', (e) => { if (e.key === 'livepads.contrast') paintHC(); });
// Fondo en movimiento (ui/lyricsBackground.js): se elige desde el panel de letra de la app.
applyLyricsBackground();
window.addEventListener('storage', (e) => { if (e.key === BG_KEY) applyLyricsBackground(); });

const api = window.electronAPI;
const $ = (s) => document.querySelector(s);
const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

let size = Math.max(14, Math.min(64, parseInt(ls('lw-size', '26'), 10) || 26));
let chords = ls('lw-chords', '1') !== '0';
let follow = ls('lw-follow', '1') !== '0';

const body = $('.lw-body'), cols = $('.lw-cols');

function paint() {
  document.documentElement.style.setProperty('--lw-size', size + 'px');
  body.classList.toggle('hide-chords', !chords);
  $('#lw-chords').classList.toggle('is-on', chords);
  $('#lw-follow').classList.toggle('is-on', follow);
}

$('#lw-smaller').onclick = () => { size = Math.max(14, size - 2); lsSet('lw-size', String(size)); paint(); };
$('#lw-bigger').onclick = () => { size = Math.min(64, size + 2); lsSet('lw-size', String(size)); paint(); };
$('#lw-chords').onclick = () => { chords = !chords; lsSet('lw-chords', chords ? '1' : '0'); paint(); };
$('#lw-follow').onclick = () => {
  follow = !follow; lsSet('lw-follow', follow ? '1' : '0'); paint();
  api && api.lyricsWindowSetFollow && api.lyricsWindowSetFollow(follow);
};
// Atajos: + / − tamaño, C acordes.
document.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') $('#lw-bigger').click();
  else if (e.key === '-') $('#lw-smaller').click();
  else if (e.key === 'c' || e.key === 'C') $('#lw-chords').click();
});

if (api && api.onLyricsData) {
  api.onLyricsData((d) => {
    if (!d) return;
    $('.lw-title').textContent = d.title || 'Letra';
    $('.lw-sub').textContent = [d.artist, d.key ? `Tono ${d.key}` : ''].filter(Boolean).join(' · ');
    document.title = `${d.title || 'Letra'} · LivePads`;
    // El HTML ya viene formateado por la app (formatLyrics, con el tono del servicio).
    cols.innerHTML = d.html || '<p class="lw-empty">Esta canción no tiene letra.</p>';
    body.scrollTop = 0;
  });
}
// La letra avanza sola: resalta la línea que va (la manda el panel de la app) y la mantiene a la vista.
if (api && api.onLyricsLine) {
  api.onLyricsLine((i) => {
    const ls = cols.querySelectorAll('.lyric-line');
    ls.forEach((el, k) => { el.classList.toggle('lw-now', k === i); el.classList.toggle('lw-past', i >= 0 && k < i); });
    const el = i >= 0 ? ls[i] : null;
    if (el) body.scrollTo({ top: Math.max(0, el.offsetTop - body.clientHeight * 0.3), behavior: 'smooth' });
  });
}
if (api && api.lyricsWindowSetFollow) api.lyricsWindowSetFollow(follow);
paint();
