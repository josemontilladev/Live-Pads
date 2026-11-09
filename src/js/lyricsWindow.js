// ─────────────────────────────────────────────────────────────────────────
// Ventana de la letra (lyrics.html): se abre con «Letra» en una canción y se
// puede llevar a otra pantalla (TV, segundo monitor). La pantalla de Pads no
// cambia: el baterista sigue viendo sus pads.
//
// Recibe { title, artist, key, html, hideChords } por 'lyrics-data' (main.js).
// Tamaño de letra y acordes se recuerdan; «Seguir canción» hace que cambie sola
// a la canción que suena en LivePads.
// ─────────────────────────────────────────────────────────────────────────

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
if (api && api.lyricsWindowSetFollow) api.lyricsWindowSetFollow(follow);
paint();
