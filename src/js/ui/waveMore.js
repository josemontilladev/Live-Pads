// Menú «Más» de la cabecera de la onda (Pads).
//
// La cabecera tenía siete controles en fila (Acordes, Letra, Práctica, Sección,
// zoom, ver acordes, contraer). A la vista quedan «Letra», «Más» y contraer; el
// resto vive en este desplegable. Los botones son LOS MISMOS elementos de antes
// (solo cambian de sitio en index.html), así que sus manejadores, sus atajos y
// el mapeo MIDI siguen funcionando igual.

const btn = document.getElementById('sw-more');
const pop = document.getElementById('sw-more-pop');

function place() {
  // Fijo en pantalla y hacia ARRIBA: la cabecera recorta lo que se sale de ella y
  // debajo está la barra del reproductor.
  const r = btn.getBoundingClientRect();
  pop.style.left = '0px'; pop.style.top = '0px';
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  pop.style.top = `${Math.max(8, r.top - h - 8)}px`;
}

// «Más» se marca si hay algo encendido dentro (acordes o práctica activos).
function paintActive() {
  btn.classList.toggle('has-active', !!pop.querySelector('[aria-pressed="true"]'));
}

function close() {
  if (pop.hidden) return;
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', close);
  paintActive();
}
function onOutside(e) {
  if (pop.contains(e.target) || btn.contains(e.target)) return;
  close();
}
function open() {
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  place();
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', close);
}

if (btn && pop) {
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    // El zoom se suele pulsar varias veces seguidas: no cierra. Lo demás, sí.
    requestAnimationFrame(() => { paintActive(); if (!b.closest('.sw-zoom')) close(); else place(); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // Acordes y práctica también cambian por atajo o MIDI: se repinta al cambiar de canción.
  window.addEventListener('livepads:song-state', () => requestAnimationFrame(paintActive));
}
