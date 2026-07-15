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

  const overlay = document.createElement('div');
  overlay.className = 'stems-newsong-overlay';
  overlay.innerHTML = `<div class="stems-newsong-modal">${songEditFormHTML(newSong, { placeholderForNewSong: true })}</div>`;
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
    newSong.genre = modal.querySelector('.edit-genre').value;
    const tagsEl = modal.querySelector('.edit-tags');
    newSong.tags = tagsEl ? tagsEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
    applyLibrarySelection(modal, newSong);
    try { onSaved && onSaved(newSong); } catch (err) { console.error('onSaved del modal de canción falló:', err); }
    close();
  });
}
