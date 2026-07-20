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

// Trigger a browser-side download of the current library as a JSON file
// shaped identically to what loadGiSetlistFromFile() consumes — so the
// exported file is round-tripped back in via the existing import button.
// Filename includes ISO date for easy backups: livepads-library-YYYY-MM-DD.json
export function exportGiSetlistToFile(songs) {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    data: { songs: Array.isArray(songs) ? songs : [] }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `livepads-library-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  // Cleanup — defer so Chrome has time to start the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
  return payload.data.songs.length;
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
