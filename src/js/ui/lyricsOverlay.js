// ─────────────────────────────────────────────────────────────────────────
// Letra de una canción en un panel grande sobre los pads de batería.
//
// Antes, «Letra» desplegaba la letra DENTRO de la tarjeta de la lista: con una
// letra larga la tarjeta crecía, empujaba las demás canciones y había que hacer
// scroll (se perdía de vista la canción siguiente). Ahora:
//  · la lista sigue entera a la izquierda;
//  · la letra ocupa el sitio de los pads (el mezclador sigue debajo), en dos
//    columnas si es larga, con su propio scroll;
//  · ✕ o Esc la cierran.
//
// La lógica de abrir/cerrar sigue siendo la del desplegable de la tarjeta
// (songState.js): este panel solo MUESTRA su contenido y sus botones (editar,
// acordes, pantalla completa) pulsan los de la tarjeta, así no se duplica nada.
// ─────────────────────────────────────────────────────────────────────────

let host = null, panel = null, bodyEl = null, titleEl = null, subEl = null, chordsBtn = null;
let srcCard = null;

const openAccordion = () => document.querySelector('#panel-setlist .gi-song-item .gi-lyrics-accordion.open');

function clickInCard(sel) {
  const b = srcCard && srcCard.querySelector(sel);
  if (b) b.click();
}

function sync() {
  const acc = openAccordion();
  if (!acc) { hide(); return; }
  srcCard = acc.closest('.gi-song-item');
  const content = acc.querySelector('.lyrics-text-content');
  titleEl.textContent = (srcCard.querySelector('.gi-song-title') || {}).textContent || '';
  subEl.textContent = (srcCard.querySelector('.gi-song-artist') || {}).textContent || '';
  // Columnas en un contenedor interior: el exterior hace el scroll vertical (si las
  // columnas estuvieran en el que tiene alto fijo, la letra se iría hacia los lados).
  bodyEl.innerHTML = `<div class="lyr-ov-cols">${content ? content.innerHTML : ''}</div>`;
  const hidden = !!(content && content.classList.contains('hide-chords'));
  bodyEl.classList.toggle('hide-chords', hidden);
  chordsBtn.classList.toggle('is-on', !hidden);
  chordsBtn.title = hidden ? 'Mostrar acordes' : 'Ocultar acordes';
  if (panel.hidden) { panel.hidden = false; host.classList.add('lyrics-mode'); bodyEl.scrollTop = 0; }
}

function hide() {
  srcCard = null;
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  host.classList.remove('lyrics-mode');
  bodyEl.innerHTML = '';
}

export function initLyricsOverlay() {
  host = document.getElementById('panel-drums');
  if (!host || document.getElementById('lyrics-overlay')) return;
  panel = document.createElement('section');
  panel.id = 'lyrics-overlay';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Letra de la canción');
  panel.innerHTML = `
    <header class="lyr-ov-head">
      <div class="lyr-ov-titles"><b class="lyr-ov-title"></b><span class="lyr-ov-sub"></span></div>
      <div class="lyr-ov-tools">
        <button type="button" class="lyr-ov-btn" data-do="edit" title="Editar letra y acordes">Editar</button>
        <button type="button" class="lyr-ov-btn" data-do="chords" title="Ocultar acordes">Acordes</button>
        <button type="button" class="lyr-ov-btn" data-do="fs" title="Pantalla completa (uso en vivo)">Pantalla completa</button>
        <button type="button" class="lyr-ov-close" data-do="close" title="Cerrar la letra (Esc)" aria-label="Cerrar la letra">✕</button>
      </div>
    </header>
    <div class="lyr-ov-body lyrics-text-content"></div>`;
  host.insertBefore(panel, host.firstChild);
  bodyEl = panel.querySelector('.lyr-ov-body');
  titleEl = panel.querySelector('.lyr-ov-title');
  subEl = panel.querySelector('.lyr-ov-sub');
  chordsBtn = panel.querySelector('[data-do="chords"]');
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const what = b.dataset.do;
    if (what === 'close') clickInCard('.btn-lyrics');          // mismo efecto que volver a pulsar «Letra»
    else if (what === 'edit') clickInCard('[data-action="edit-lyrics"]');
    else if (what === 'chords') clickInCard('[data-action="toggle-chords"]');
    else if (what === 'fs') clickInCard('[data-action="lyrics-fullscreen"]');
    // El desplegable de la tarjeta cambió (o la tarjeta se volvió a pintar): se actualiza.
    requestAnimationFrame(sync);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    if (document.querySelector('.modal:not(.hidden), dialog[open]')) return;   // Esc es del diálogo abierto
    clickInCard('.btn-lyrics');
    requestAnimationFrame(sync);
  });
  // Abrir/cerrar la letra, cambiar acordes, editar la letra o re-pintar la lista.
  for (const ev of ['livepads:lyrics-panel', 'livepads:songs-changed', 'livepads:service-changed']) {
    window.addEventListener(ev, () => requestAnimationFrame(sync));
  }
}
