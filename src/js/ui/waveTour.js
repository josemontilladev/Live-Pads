// Guía de la onda (4 pasos): la primera vez que se ve una canción con secciones,
// un globo señala cada pieza y explica qué hace. «Saltar» la cierra para siempre;
// se puede volver a ver desde «+ Sección» → «Ver la guía de la onda».

const DONE_KEY = 'livepads-wavetour-done';
let open = null;

function steps(root, editable) {
  const pill = root.querySelector('.sw-pill');
  return [
    { el: pill || root.querySelector('.sw-markers'), title: 'Estas son las secciones',
      text: 'Cada color es una parte de la canción (Intro, Verso, Coro…). Haz <b>clic</b> en una etiqueta para ir a esa parte.' },
    { el: root.querySelector('.sw-wave'), title: 'Doble clic para repetir',
      text: 'Haz <b>doble clic</b> sobre una sección de la onda y se repetirá en bucle para practicarla. Con <b>Mayús + arrastrar</b> eliges un tramo a mano.' },
    { el: pill || root.querySelector('.sw-markers'), title: editable ? '▾ para cambiar' : 'Opciones de cada sección',
      text: editable
        ? 'Pasa el ratón por una etiqueta: <b>▾</b> abre las opciones y <b>✕</b> la quita. Arrástrala para moverla (se pega al compás) o selecciónala y usa <b>← →</b>. Ctrl+Z deshace.'
        : 'Con clic derecho en una etiqueta puedes ir a esa sección o practicarla en bucle.' },
    { el: root.querySelector('#sw-practice'), title: 'Practicar',
      text: 'Aquí bajas la velocidad sin cambiar el tono y eliges la sección a repetir. <b>Practicar</b> la pone al 80 % con cuenta de entrada y la va subiendo sola.' },
  ].filter((s) => s.el);
}

function close(done) {
  if (!open) return;
  open.bubble.remove(); open.ring.remove();
  window.removeEventListener('resize', open.place, true);
  window.removeEventListener('keydown', open.onKey, true);
  open = null;
  if (done) { try { localStorage.setItem(DONE_KEY, '1'); } catch (_) {} }
}

export function startWaveTour(root, { editable = true } = {}) {
  close(false);
  const list = steps(root, editable);
  if (!list.length) return;
  let i = 0;
  const ring = document.createElement('div'); ring.className = 'wt-ring';
  const bubble = document.createElement('div'); bubble.className = 'wt-bubble'; bubble.setAttribute('role', 'dialog');
  document.body.append(ring, bubble);
  const place = () => {
    const s = list[i]; const r = s.el.getBoundingClientRect();
    ring.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
    const bw = Math.min(320, window.innerWidth - 24);
    let left = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 12);
    bubble.style.width = bw + 'px'; bubble.style.left = left + 'px';
    const bh = bubble.offsetHeight || 150;
    const above = r.top - bh - 14 > 8;
    bubble.style.top = (above ? r.top - bh - 14 : r.bottom + 14) + 'px';
    bubble.classList.toggle('is-below', !above);
  };
  const paint = () => {
    const s = list[i];
    bubble.innerHTML = `<div class="wt-step">${i + 1} de ${list.length}</div><b class="wt-title">${s.title}</b><p>${s.text}</p>
      <div class="wt-actions"><button type="button" class="wt-skip">Saltar</button>${i ? '<button type="button" class="wt-prev">Atrás</button>' : ''}<button type="button" class="wt-next">${i + 1 < list.length ? 'Siguiente' : 'Entendido'}</button></div>`;
    place();
  };
  bubble.addEventListener('click', (e) => {
    if (e.target.closest('.wt-skip')) close(true);
    else if (e.target.closest('.wt-prev')) { i = Math.max(0, i - 1); paint(); }
    else if (e.target.closest('.wt-next')) { if (i + 1 < list.length) { i++; paint(); } else close(true); }
  });
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } };
  window.addEventListener('resize', place, true);
  window.addEventListener('keydown', onKey, true);
  open = { bubble, ring, place, onKey };
  paint();
  bubble.querySelector('.wt-next')?.focus();
}

/** La primera vez que se ven secciones (una vez por equipo). */
let scheduled = false;
export function maybeStartWaveTour(root, opts) {
  if (scheduled || open) return;
  try { if (localStorage.getItem(DONE_KEY) === '1') return; } catch (_) { return; }
  const shown = () => root.offsetParent !== null && document.body.dataset.workspace !== 'stems';
  if (!root || !shown()) return;
  scheduled = true;
  setTimeout(() => { if (shown() && root.querySelector('.sw-pill')) startWaveTour(root, opts); else scheduled = false; }, 900);
}
