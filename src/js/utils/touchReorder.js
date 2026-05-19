// Touch-friendly reorder helper. The native HTML5 drag-and-drop API
// doesn't fire on touch — this fills the gap with pointer events so
// the library and service lists also reorder on tablets / touchscreens.
//
// Behavior on long-press (300ms hold) of a draggable card:
//   1. The card is marked .dragging (CSS dims it).
//   2. As the finger moves, the card under the finger gets .drag-over.
//   3. On release, if a different card was the last drag-over, fire
//      the supplied onReorder(fromIdx, toIdx) callback.
//
// Designed to coexist with the native drag listeners — we only handle
// `touch` pointer types and call e.preventDefault() once the long-press
// fires, so the browser's native scroll/select doesn't compete.

import { q } from './dom.js';

/**
 * @param {string} containerSelector  — the list container, e.g. '#gi-songs-container'
 * @param {string} itemSelector       — card selector inside, e.g. '.gi-song-item'
 * @param {string} indexAttr          — dataset key with the source index, e.g. 'libIndex'
 * @param {Function} onReorder        — (fromIdx, toIdx) callback when dropped
 */
export function bindTouchReorder(containerSelector, itemSelector, indexAttr, onReorder) {
  const container = q(containerSelector);
  if (!container) return;

  let pressTimer = null;
  let dragging = null;       // card currently being dragged
  let dragOverCard = null;   // last card the finger was over
  const LONG_PRESS_MS = 300;

  const clearDragOver = () => {
    if (dragOverCard) {
      dragOverCard.classList.remove('drag-over');
      dragOverCard = null;
    }
  };

  const endDrag = (commit) => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    if (commit && dragOverCard && dragOverCard !== dragging) {
      const fromIdx = parseInt(dragging.dataset[indexAttr], 10);
      const toIdx   = parseInt(dragOverCard.dataset[indexAttr], 10);
      if (Number.isFinite(fromIdx) && Number.isFinite(toIdx) && fromIdx !== toIdx) {
        onReorder(fromIdx, toIdx);
      }
    }
    clearDragOver();
    dragging = null;
  };

  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return; // mouse stays on native HTML5 drag
    const card = e.target.closest(itemSelector);
    if (!card || !container.contains(card) || card.draggable === false) return;
    // Don't initiate drag if the press lands on an action button — those
    // need to remain tappable.
    if (e.target.closest('button')) return;

    pressTimer = setTimeout(() => {
      pressTimer = null;
      dragging = card;
      card.classList.add('dragging');
    }, LONG_PRESS_MS);
  }, { passive: true });

  container.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (!dragging) return;
    e.preventDefault();

    // pointer events expose clientX/Y; map to elementFromPoint to find
    // which card the finger is currently over.
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const overCard = target ? target.closest(itemSelector) : null;
    if (overCard !== dragOverCard) {
      clearDragOver();
      if (overCard && container.contains(overCard) && overCard !== dragging) {
        overCard.classList.add('drag-over');
        dragOverCard = overCard;
      }
    }
  });

  container.addEventListener('pointerup', (e) => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (e.pointerType !== 'touch') return;
    endDrag(true);
  });

  container.addEventListener('pointercancel', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    endDrag(false);
  });
}
