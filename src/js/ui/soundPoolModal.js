// Sound Pool Modal — opens when the user clicks an empty drum pad slot
// while in edit-kit mode. Lets the user either:
//   - Pick an already-loaded sample from any custom kit (onAssign callback)
//   - Upload a fresh file from disk (onUploadNew callback)
//
// All styling lives in CSS (.spm-* classes) — JS only builds DOM + wires
// behavior. Class-based hover effects, theme-aware accents via CSS vars.

import { q } from '../utils/dom.js';
import { getCleanSampleName } from '../utils/format.js';
import { KIT_BANKS } from '../data/banks.js';
import { pushModal } from './modalStack.js';

const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><polygon points="5,3 19,12 5,21"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;

let previewAudio = null;
let previewBtn = null;

function stopPreview() {
  if (previewAudio) {
    try {
      previewAudio.pause();
      previewAudio.onended = null;
      previewAudio.onerror = null;
    } catch {}
    previewAudio = null;
  }
}

// Collect unique samples currently loaded across all custom kits.
function collectAvailableSamples() {
  const seen = new Set();
  const out = [];
  KIT_BANKS.forEach(kit => {
    if (!kit.isCustom || !kit.pads) return;
    kit.pads.forEach(p => {
      if (p.sample && !seen.has(p.sample)) {
        seen.add(p.sample);
        out.push({ path: p.sample, id: p.id, label: p.label, kitName: kit.name });
      }
    });
  });
  return out;
}

// Helper: builds an element with class + optional text/innerHTML.
function el(tag, className, opts = {}) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  if (opts.title) e.title = opts.title;
  return e;
}

export function openSoundPoolModal(padLabel, onAssign, onUploadNew) {
  const existing = q('#sound-pool-modal');
  if (existing) existing.remove();

  const modal = el('div', null);
  modal.id = 'sound-pool-modal';

  const samples = collectAvailableSamples();

  /* ── Box ── */
  const box = el('div', 'spm-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Selector de sonido');

  /* ── Header ── */
  const header = el('div', 'spm-header');
  const titleWrap = el('div');
  titleWrap.appendChild(el('span', 'spm-badge', { text: 'Selector de sonido' }));
  titleWrap.appendChild(el('h3', 'spm-title', { text: padLabel }));

  const closeBtn = el('button', 'spm-close', { title: 'Cerrar' });
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  /* ── Content ── */
  const content = el('div', 'spm-content');

  const uploadBtn = el('button', 'spm-upload');
  uploadBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="15" height="15"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Subir nuevo archivo desde PC`;

  const sectionLabel = el('div', 'spm-section-label');
  sectionLabel.textContent = samples.length > 0
    ? `${samples.length} sonido${samples.length !== 1 ? 's' : ''} disponible${samples.length !== 1 ? 's' : ''}`
    : 'Sonidos en la App';

  const listEl = el('div', 'spm-list');

  if (samples.length === 0) {
    const empty = el('div', 'spm-empty');
    empty.innerHTML = `<div class="spm-empty-emoji">🥁</div>Aún no has cargado sonidos.<br>Usa "Subir nuevo archivo" para comenzar.`;
    listEl.appendChild(empty);
  } else {
    samples.forEach(item => appendSampleRow(listEl, item));
  }

  content.appendChild(uploadBtn);
  content.appendChild(sectionLabel);
  content.appendChild(listEl);
  box.appendChild(header);
  box.appendChild(content);
  modal.appendChild(box);
  document.body.appendChild(modal);

  // Integra el modal a la pila central: Esc lo cierra (antes no), y el foco
  // arranca en el botón de cerrar (gestión de foco como los demás modales).
  const pop = pushModal(() => close());
  const close = () => {
    pop();
    stopPreview();
    previewBtn = null;
    modal.remove();
  };
  closeBtn.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  uploadBtn.onclick = () => { close(); onUploadNew(); };
  try { closeBtn.focus(); } catch (_) {}

  function appendSampleRow(parent, item) {
    const cleanName = getCleanSampleName(item.path);

    const row = el('div', 'spm-row');

    const nameEl = el('div', 'spm-row-name');
    const nameText = el('div', 'spm-row-title', { text: cleanName, title: cleanName });
    const kitTag = el('div', 'spm-row-kit', { text: item.kitName || '' });
    nameEl.appendChild(nameText);
    nameEl.appendChild(kitTag);

    const actions = el('div', 'spm-row-actions');

    // ── Play button (preview)
    const playBtn = el('button', 'spm-play', { title: 'Preescuchar', html: ICON_PLAY });
    playBtn.onclick = () => {
      // Stop whichever row was previewing before
      if (previewBtn && previewBtn !== playBtn) previewBtn.classList.remove('playing');
      stopPreview();

      playBtn.innerHTML = ICON_STOP;
      playBtn.classList.add('playing');
      previewBtn = playBtn;

      const resetBtn = () => {
        playBtn.innerHTML = ICON_PLAY;
        playBtn.classList.remove('playing');
        if (previewBtn === playBtn) previewBtn = null;
        previewAudio = null;
      };

      const audio = new Audio(item.path);
      audio.volume = 0.8;
      audio.onerror = () => {
        console.error('Audio load error for:', item.path);
        resetBtn();
      };
      audio.onended = resetBtn;
      previewAudio = audio;
      audio.play().catch(err => {
        console.error('Preview error:', err, item.path);
        resetBtn();
      });
    };

    // ── Assign button
    const assignBtn = el('button', 'spm-assign', { text: 'Usar' });
    assignBtn.onclick = () => {
      close(); // saca el modal de la pila + limpia preview
      onAssign(item.path);
    };

    actions.appendChild(playBtn);
    actions.appendChild(assignBtn);
    row.appendChild(nameEl);
    row.appendChild(actions);
    parent.appendChild(row);
  }
}
