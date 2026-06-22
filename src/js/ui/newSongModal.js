// Modal popup para crear una canción nueva. Mismo look y comportamiento en
// Pads y en Stems (antes Pads abría el form inline en el sidebar y se "perdía").
// Llama onSaved(newSong) cuando el usuario guarda con un título válido.
//
//   openNewSongModal({ onSaved, defaults })
//     defaults?: { genre?, favorite?, libraryId? } — preconfigura la canción.

import { songEditFormHTML, applyLibrarySelection } from './songEditForm.js';
import { pushModal } from './modalStack.js';

export function openNewSongModal({ onSaved, defaults = {} } = {}) {
  const newSong = {
    id: 'song_' + Date.now(),
    addedAt: Date.now(),
    title: 'Nueva Canción',
    artist: '', bpm: '', key: '',
    genre: defaults.genre || 'adoracion',
    tags: [],
    audio: { sequence: null, original: null },
  };
  if (defaults.favorite) newSong.favorite = true;
  if (defaults.libraryId) newSong.libraryId = defaults.libraryId;

  const headerHTML = `
    <div class="newsong-head">
      <span class="newsong-head-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </span>
      <span class="newsong-head-text">
        <h3 class="newsong-head-title">Nueva canción</h3>
        <span class="newsong-head-sub">Tono, BPM y compás se aplican al lanzarla.</span>
      </span>
    </div>`;
  const overlay = document.createElement('div');
  overlay.className = 'stems-newsong-overlay';
  overlay.innerHTML = `<div class="stems-newsong-modal">${headerHTML}${songEditFormHTML(newSong, { placeholderForNewSong: true })}</div>`;
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.stems-newsong-modal');

  const pop = pushModal(() => close(), modal);
  const close = () => { try { pop(); } catch (_) {} overlay.remove(); };

  setTimeout(() => { try { modal.querySelector('.edit-title').focus(); } catch (_) {} }, 40);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit-cancel') { close(); return; }
    if (action !== 'edit-save') return;
    const titleEl = modal.querySelector('.edit-title');
    const t = titleEl.value.trim();
    if (!t) { titleEl.focus(); return; }
    newSong.title = t;
    newSong.artist = modal.querySelector('.edit-artist').value.trim();
    newSong.bpm = modal.querySelector('.edit-bpm').value.trim();
    newSong.key = modal.querySelector('.edit-key').value;
    newSong.timeSig = modal.querySelector('.edit-timesig')?.value || '4/4';
    newSong.genre = modal.querySelector('.edit-genre').value;
    const tagsEl = modal.querySelector('.edit-tags');
    newSong.tags = tagsEl ? tagsEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
    applyLibrarySelection(modal, newSong);
    try { onSaved && onSaved(newSong); } catch (err) { console.error('onSaved del modal de canción falló:', err); }
    close();
  });
}
