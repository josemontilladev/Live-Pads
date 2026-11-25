// ─────────────────────────────────────────────────────────────────────────
// Notas para la banda por sección (lógica pura en bandNotesCore.js).
//   · openBandNotes(song)      → ventana para escribirlas (canción de la librería)
//   · decorateSections(root, notes) → las pinta bajo cada encabezado de la letra
//   · companionNotes(song)     → lo que viaja a los móviles (Companion)
// Se guardan en la canción de la LIBRERÍA (la que se sincroniza con el equipo),
// aunque se abran desde el servicio.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { getSongs } from '../state/store.js';
import { getServiceSongs, syncServiceWithLibrary } from '../data/service.js';
import { getUser } from '../cloud/supabase.js';
import { pushModal } from '../ui/modalStack.js';
import { WHO, whoLabel, cleanNotes, cleanNote, notesForSection, generalNotes, sectionsOf, MAX_TEXT } from './bandNotesCore.js';

/** La canción de la librería que corresponde a `song` (o la propia si no está). */
export function libSongFor(song) {
  if (!song) return null;
  const lib = getSongs() || [];
  return lib.find((x) => x === song)
    || (song.cloudId && lib.find((x) => x.cloudId && String(x.cloudId) === String(song.cloudId)))
    || (song.id != null && lib.find((x) => x.id != null && String(x.id) === String(song.id)))
    || song;
}

/** Canción de una tarjeta (ref del panel de letra: librería o servicio). */
export function songFromRef(ref) {
  if (!ref || ref.id == null) return null;
  if (ref.attr === 'data-service-id') {
    const s = (getServiceSongs() || []).find((x) => String(x.serviceId) === String(ref.id));
    return s ? libSongFor(s) : null;
  }
  return (getSongs() || []).find((x) => String(x.id) === String(ref.id)) || null;
}

export function notesOf(song) {
  const lib = libSongFor(song);
  return cleanNotes((lib && lib.bandNotes) || (song && song.bandNotes) || []);
}

function myName() {
  const u = getUser();
  if (!u) return '';
  return (u.user_metadata && u.user_metadata.display_name) || (u.email ? u.email.split('@')[0] : '');
}

function save(song, list) {
  const lib = libSongFor(song);
  if (!lib) return;
  lib.bandNotes = cleanNotes(list);
  libSig = notesSigOfLibrary();
  try { syncServiceWithLibrary(); } catch (_) {}
  try { window.electronAPI?.saveGiSetlist?.(getSongs()); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  window.dispatchEvent(new CustomEvent('livepads:band-notes', { detail: { songId: lib.id } }));
}

/** Para el Companion: notas con el destinatario ya en texto. */
export function companionNotes(song) {
  return notesOf(song).map((n) => ({ sec: n.sec, who: n.who === 'all' ? '' : whoLabel(n.who), text: n.text, by: n.by }));
}

function noteHtml(n) {
  const who = n.who && n.who !== 'all' ? `<b>${esc(whoLabel(n.who))}</b>` : '';
  return `<div class="bn-note">${who}<span>${esc(n.text)}</span>${n.by ? `<i>${esc(n.by)}</i>` : ''}</div>`;
}

/** Pinta las notas bajo cada encabezado de sección de `root` (y las generales arriba). */
export function decorateSections(root, notes) {
  if (!root) return;
  root.querySelectorAll('.bn-inline, .bn-general').forEach((e) => e.remove());
  const list = cleanNotes(notes);
  if (!list.length) return;
  const gen = generalNotes(list);
  if (gen.length) {
    const g = document.createElement('div');
    g.className = 'bn-general';
    g.innerHTML = gen.map(noteHtml).join('');
    root.prepend(g);
  }
  for (const h of root.querySelectorAll('.section-header-line')) {
    const mine = notesForSection(list, h.textContent || '');
    if (!mine.length) continue;
    const box = document.createElement('div');
    box.className = 'bn-inline';
    box.innerHTML = mine.map(noteHtml).join('');
    h.after(box);
  }
}

// ── Ventana para escribirlas ──────────────────────────────────────────────
export function openBandNotes(song) {
  const lib = libSongFor(song);
  if (!lib) return;
  const secs = sectionsOf(lib.lyrics, lib.markers);
  let editing = null;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box bn-box" role="dialog" aria-modal="true" aria-label="Notas para la banda">
      <div class="vn-head"><b>Notas para la banda</b><span>${esc(lib.title || '')}</span></div>
      <p class="vn-why">Se ven en la letra, en la hoja impresa y en el Companion de cada músico, justo en esa sección. Las ve todo el equipo.</p>
      <div class="bn-list" data-ref="list"></div>
      <div class="bn-form">
        <div class="bn-form-row">
          <label class="vn-field">Sección
            <select data-ref="sec"><option value="">Toda la canción</option>${secs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
          </label>
          <label class="vn-field">Para
            <select data-ref="who">${WHO.map((w) => `<option value="${w.id}">${esc(w.label)}</option>`).join('')}</select>
          </label>
        </div>
        <label class="vn-field">Nota <input data-ref="text" maxlength="${MAX_TEXT}" placeholder="Ej. Aquí para todo menos el piano"></label>
      </div>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel-edit" hidden>Cancelar cambio</button>
        <button type="button" class="vn-btn" data-act="add">Añadir nota</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="close">Listo</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const popModal = pushModal(() => close(), ov);
  const close = () => { popModal(); ov.remove(); };

  const resetForm = () => {
    editing = null;
    $('[data-ref="text"]').value = '';
    $('[data-act="add"]').textContent = 'Añadir nota';
    $('[data-act="cancel-edit"]').hidden = true;
  };
  const paint = () => {
    const list = notesOf(lib);
    const box = $('[data-ref="list"]');
    if (!list.length) { box.innerHTML = '<p class="bn-empty">Todavía no hay notas. Elige la sección, para quién, y escribe la nota.</p>'; return; }
    box.innerHTML = list.map((n) => `
      <div class="bn-row${editing === n.id ? ' is-editing' : ''}" data-id="${esc(n.id)}">
        <span class="bn-sec">${esc(n.sec || 'Toda la canción')}</span>
        <span class="bn-who">${esc(whoLabel(n.who))}</span>
        <button type="button" class="bn-text" data-act="edit" title="Cambiar esta nota">${esc(n.text)}${n.by ? `<small>${esc(n.by)}</small>` : ''}</button>
        <button type="button" class="bn-del" data-act="del" aria-label="Borrar la nota" title="Borrar">×</button>
      </div>`).join('');
  };
  const submit = () => {
    const text = $('[data-ref="text"]').value.trim();
    if (!text) { $('[data-ref="text"]').focus(); return; }
    const list = notesOf(lib);
    const base = editing ? list.find((n) => n.id === editing) : null;
    const n = cleanNote({ id: base ? base.id : undefined, sec: $('[data-ref="sec"]').value, who: $('[data-ref="who"]').value, text, by: base ? base.by || myName() : myName(), at: Date.now() });
    save(lib, base ? list.map((x) => (x.id === base.id ? n : x)) : list.concat(n));
    resetForm(); paint();
    $('[data-ref="text"]').focus();
  };

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add') { submit(); return; }
    if (act === 'cancel-edit') { resetForm(); paint(); return; }
    const row = e.target.closest('.bn-row');
    if (!row) return;
    const list = notesOf(lib), n = list.find((x) => x.id === row.dataset.id);
    if (!n) return;
    if (act === 'del') { save(lib, list.filter((x) => x.id !== n.id)); if (editing === n.id) resetForm(); paint(); return; }
    if (act === 'edit') {
      editing = n.id;
      const secSel = $('[data-ref="sec"]');
      if (n.sec && ![...secSel.options].some((o) => o.value === n.sec)) secSel.insertAdjacentHTML('beforeend', `<option value="${esc(n.sec)}">${esc(n.sec)}</option>`);
      secSel.value = n.sec; $('[data-ref="who"]').value = n.who; $('[data-ref="text"]').value = n.text;
      $('[data-act="add"]').textContent = 'Guardar cambio';
      $('[data-act="cancel-edit"]').hidden = false;
      paint(); $('[data-ref="text"]').focus();
    }
  });
  $('[data-ref="text"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  paint();
  setTimeout(() => $('[data-ref="text"]').focus(), 30);
}

// Llegaron cambios de la nube: si cambió alguna nota de la librería, se avisa
// (el panel de letra y los móviles se ponen al día). Solo si cambió algo: la
// bajada periódica no debe reenviar la canción a los móviles sin motivo.
let libSig = null;
function notesSigOfLibrary() {
  let s = '';
  for (const x of getSongs() || []) if (Array.isArray(x.bandNotes) && x.bandNotes.length) s += `${x.cloudId || x.id}:${x.bandNotes.length}:${x.bandNotes.map((n) => n.at).join(',')};`;
  return s;
}
window.addEventListener('livepads:library-synced', () => {
  const sig = notesSigOfLibrary();
  if (libSig !== null && sig !== libSig) window.dispatchEvent(new CustomEvent('livepads:band-notes', { detail: { fromCloud: true } }));
  libSig = sig;
});
