// MongoDB → local library sync.
//
// The cloud collection is a writeable source-of-truth maintained from
// another tool; pressing #btn-sync-gi pulls it down and merges into the
// in-memory `giSetlistSongs` array. Matching is by `_id` if known, else
// by case-insensitive title+artist. Changes are persisted via the deps
// and the library re-renders.
//
// Network failure is non-fatal — the app falls back to local-only mode.

import { showToast } from '../ui/toast.js';

/**
 * Bind the MongoDB sync button. Idempotent — safe to call once at boot.
 *
 * @param {Object} deps
 *   - getSongs       () => Song[]       — read current library
 *   - persist        ()                  — save library to disk + cloud-mirror
 *   - rerender       (filter)            — repaint the library after merge
 *   - updateFilterCounts ()              — refresh genre filter counts
 *   - getSearchFilter () => string       — current search-input value
 */
export function bindMongoSync(deps) {
  const btn = document.getElementById('btn-sync-gi');
  if (!btn) return;

  btn.onclick = async () => {
    if (!window.electronAPI) return;
    try {
      btn.style.animation = 'pulse 1s infinite';
      btn.style.color = '#fbae00';

      const mongoSongs = await window.electronAPI.syncMongoSetlist();
      if (!mongoSongs || !mongoSongs.length) {
        throw new Error('No se encontraron canciones en MongoDB');
      }

      const songs = deps.getSongs();
      let updatedCount = 0;
      let newCount = 0;

      mongoSongs.forEach(mSong => {
        const existingIdx = songs.findIndex(s =>
          (s._id && s._id === mSong._id) ||
          (s.title.toLowerCase() === mSong.title.toLowerCase() &&
           (s.artist || '').toLowerCase() === (mSong.artist || '').toLowerCase())
        );

        if (existingIdx >= 0) {
          const existing = songs[existingIdx];
          let changed = false;
          if (!existing._id) { existing._id = mSong._id; changed = true; }
          if (existing.lyrics !== mSong.lyrics) { existing.lyrics = mSong.lyrics; changed = true; }
          if (existing.bpm !== mSong.bpm) { existing.bpm = mSong.bpm; changed = true; }
          if (existing.key !== mSong.key) { existing.key = mSong.key; changed = true; }
          if (existing.genre !== mSong.genre) { existing.genre = mSong.genre; changed = true; }
          if (changed) updatedCount++;
        } else {
          songs.push({
            id: 'song_sync_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            _id: mSong._id,
            title: mSong.title,
            artist: mSong.artist || '',
            bpm: mSong.bpm || '',
            key: mSong.key || '',
            genre: mSong.genre || '',
            lyrics: mSong.lyrics || ''
          });
          newCount++;
        }
      });

      if (updatedCount > 0 || newCount > 0) {
        deps.persist();
        deps.updateFilterCounts();
        deps.rerender(deps.getSearchFilter());
        showToast(`Sincronización exitosa. Nuevas: ${newCount}, Actualizadas: ${updatedCount}`, 'success');
      } else {
        showToast('Tu librería ya está al día, sin cambios.', 'success');
      }
    } catch (e) {
      console.error('Error sincronizando con MongoDB:', e);
      showToast('Error de red. Operando en Modo Local.', 'warning');
    } finally {
      btn.style.animation = '';
      btn.style.color = '';
    }
  };
}
