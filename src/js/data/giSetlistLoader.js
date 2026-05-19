// Loads the GI-Setlist song catalog from disk (or a local fallback) and
// returns the songs array. The renderer/caller is responsible for assigning
// the result to its own state and triggering UI refresh — this module
// stays purely about I/O.

// Ensures every song has a stable id so the surgical highlight update can
// find it again across renders. Mutates the songs in place.
function ensureSongIds(songs, prefix) {
  const stamp = Date.now();
  for (let i = 0; i < songs.length; i++) {
    if (!songs[i].id) songs[i].id = `${prefix}_${i}_${stamp}`;
  }
  return songs;
}

// Reads the saved catalog (via electronAPI in production, or a bundled
// fallback JSON in dev/web). Returns the songs array, or null when nothing
// is on disk yet (first run / unimported state).
export async function loadGiSetlistFromFile() {
  try {
    if (window.electronAPI && window.electronAPI.loadGiSetlist) {
      const json = await window.electronAPI.loadGiSetlist();
      if (json && json.data && json.data.songs) {
        return ensureSongIds(json.data.songs, 'song');
      }
    }

    // Fallback (not running in Electron) — bundled catalog under src/assets/
    const res = await fetch('../assets/setlists/canciones_app.json');
    if (res.ok) {
      const json = await res.json();
      if (json.data && json.data.songs) {
        return ensureSongIds(json.data.songs, 'song_fb');
      }
    }
    return null;
  } catch (e) {
    console.log('GI-Setlist local no encontrado, esperando importación manual.');
    return null;
  }
}
