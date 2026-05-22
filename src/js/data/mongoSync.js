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
import { htmlToPlainLyrics } from '../utils/text.js';

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
      // Empty result is NOT a connection failure — say so plainly instead of
      // dropping into the misleading "Modo Local" warning.
      if (!mongoSongs || !mongoSongs.length) {
        showToast('Conectado, pero no hay canciones en la nube todavía.', 'warning');
        return;
      }

      const songs = deps.getSongs();
      let updatedCount = 0;
      let newCount = 0;

      mongoSongs.forEach(mSong => {
        const mLyrics = htmlToPlainLyrics(mSong.lyrics);
        // Tono: prefer the explicit key, fall back to the original key when
        // GI.Setlist only filled that one in. (BPM + chords-in-lyrics already
        // come through above.)
        const mKey = mSong.key || mSong.originalKey || '';
        const existingIdx = songs.findIndex(s =>
          (s._id && s._id === mSong._id) ||
          (s.title.toLowerCase() === mSong.title.toLowerCase() &&
           (s.artist || '').toLowerCase() === (mSong.artist || '').toLowerCase())
        );

        if (existingIdx >= 0) {
          const existing = songs[existingIdx];
          let changed = false;
          if (!existing._id) { existing._id = mSong._id; changed = true; }
          if (existing.lyrics !== mLyrics) { existing.lyrics = mLyrics; changed = true; }
          if (existing.bpm !== mSong.bpm) { existing.bpm = mSong.bpm; changed = true; }
          if (mKey && existing.key !== mKey) { existing.key = mKey; changed = true; }
          if (existing.genre !== mSong.genre) { existing.genre = mSong.genre; changed = true; }
          if (changed) updatedCount++;
        } else {
          songs.push({
            id: 'song_sync_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            addedAt: Date.now(),
            _id: mSong._id,
            title: mSong.title,
            artist: mSong.artist || '',
            bpm: mSong.bpm || '',
            key: mKey,
            genre: mSong.genre || '',
            lyrics: mLyrics || ''
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
      const raw = (e && e.message) ? e.message : '';
      // Distinguish a genuine connectivity/timeout failure from config issues
      // so the user isn't told "sin internet" when the URI is just missing.
      const msg = /URI no configurada/i.test(raw)
        ? 'Falta configurar la conexión (mongoUri). Revisa config.json.'
        : 'No se pudo conectar con la nube. Reintenta en unos segundos.';
      showToast(msg, 'warning');
    } finally {
      btn.style.animation = '';
      btn.style.color = '';
    }
  };

  bindMongoPush(deps);
}

// "Subir a la nube" — pushes the local library UP to GI.Setlist (cloud
// backup + reverse sync). New songs get a cloud _id back so future pushes
// update instead of duplicating.
function bindMongoPush(deps) {
  const btn = document.getElementById('btn-push-gi');
  if (!btn || !window.electronAPI || !window.electronAPI.pushMongoSetlist) return;

  btn.onclick = async () => {
    const songs = deps.getSongs();
    if (!songs || !songs.length) {
      showToast('Tu librería está vacía — nada que subir.', 'warning');
      return;
    }
    if (!confirm(`Esto subirá tu librería (${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'}) a la nube, creando o actualizando en GI.Setlist. ¿Continuar?`)) return;

    try {
      btn.style.animation = 'pulse 1s infinite';
      btn.style.color = '#fbae00';

      const res = await window.electronAPI.pushMongoSetlist(songs);
      if (!res) throw new Error('Sin respuesta del servidor');

      // Persist the new cloud ids onto the local songs so the next push
      // updates them in place (no duplicates).
      let stamped = 0;
      if (res.idMap) {
        for (const s of songs) {
          if (s._id) continue;
          const mid = res.idMap[s.id];
          if (mid) { s._id = mid; stamped++; }
        }
      }
      if (stamped > 0) deps.persist();

      if (res.errors && res.errors.length) {
        console.warn('Push errors:', res.errors);
        showToast(`Subidas: ${res.created} nuevas, ${res.updated} actualizadas · ${res.errors.length} con error.`, 'warning');
      } else {
        showToast(`Subida exitosa. Nuevas: ${res.created}, Actualizadas: ${res.updated}.`, 'success');
      }
    } catch (e) {
      console.error('Error subiendo a la nube:', e);
      showToast('No se pudo subir a la nube. Reintenta en unos segundos.', 'warning');
    } finally {
      btn.style.animation = '';
      btn.style.color = '';
    }
  };
}
