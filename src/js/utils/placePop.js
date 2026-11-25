// ─────────────────────────────────────────────────────────────────────────
// Paneles pequeños que salen de un botón de la barra del espectro («Voz»,
// «Arreglo»): siempre dentro de la ventana y uno solo a la vez.
//
//  · placePop(p, anchor): encima del botón (o debajo si no cabe), sin salirse por
//    ningún lado. Si el botón está escondido (pantallas estrechas: vive en «Más»),
//    se usa «Más» como referencia. Se recoloca cuando el panel termina de pintarse
//    (su contenido puede llegar después y hacerlo crecer).
//  · claimPop(id, close): avisa de que se abre un panel; el que estaba abierto se cierra.
//    También entra en la pila de ventanas: Esc lo cierra a él (no dispara el «Pánico»,
//    que pararía la música en pleno servicio).
// ─────────────────────────────────────────────────────────────────────────
import { pushModal } from '../ui/modalStack.js';

function anchorRect(anchor) {
  const vis = (el) => el && el.offsetParent && el.getBoundingClientRect().width > 0;
  const el = vis(anchor) ? anchor : (vis(document.getElementById('sw-more')) ? document.getElementById('sw-more') : null);
  if (el) return el.getBoundingClientRect();
  return { top: innerHeight - 80, bottom: innerHeight - 80, left: innerWidth / 2, right: innerWidth / 2 };
}

function place(p, anchor) {
  if (!p.isConnected || p.hidden) return;
  p.style.maxHeight = `${Math.max(160, innerHeight - 16)}px`;
  p.style.overflowY = 'auto';
  const r = anchorRect(anchor);
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  const above = r.top - h - 8, below = r.bottom + 8;
  p.style.top = `${above >= 8 ? above : Math.max(8, Math.min(innerHeight - h - 8, below))}px`;
}

export function placePop(p, anchor) {
  place(p, anchor);
  requestAnimationFrame(() => place(p, anchor));
  setTimeout(() => place(p, anchor), 250);
  if (!p._popRO && 'ResizeObserver' in window) {
    p._popRO = new ResizeObserver(() => place(p, anchor));
    p._popRO.observe(p);
  }
}

export function claimPop(id, close) {
  window.dispatchEvent(new CustomEvent('livepads:pop-open', { detail: { id } }));
  const onOther = (e) => { if (e.detail.id !== id) close(); };
  window.addEventListener('livepads:pop-open', onOther);
  const pop = pushModal(() => close());
  let done = false;
  return () => { if (done) return; done = true; window.removeEventListener('livepads:pop-open', onOther); try { pop(); } catch (_) {} };
}
