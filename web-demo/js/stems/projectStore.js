// Stem editor project persistence — thin wrapper over electronAPI IPC.
// Stems live under userData/StemProjects/current/stems/<id>_<filename>.
// project.json sits alongside and captures knobs + track ordering.
//
// File contents are referenced from the renderer via the livepads://
// protocol so playback works with webSecurity enabled.

export async function saveCurrent(state) {
  if (!window.electronAPI?.stemsSaveCurrent) return;
  await window.electronAPI.stemsSaveCurrent(state);
}

export async function loadCurrent() {
  if (!window.electronAPI?.stemsLoadCurrent) return null;
  return await window.electronAPI.stemsLoadCurrent();
}

export async function clearCurrent() {
  if (!window.electronAPI?.stemsClearCurrent) return;
  await window.electronAPI.stemsClearCurrent();
}

// Returns the livepads:// URL where the stem was stored — that URL is
// what gets saved into project.json so rehydrate can locate the file.
export async function saveStem(id, originalName, arrayBuffer) {
  if (!window.electronAPI?.stemsSaveFile) return null;
  return await window.electronAPI.stemsSaveFile({
    id,
    name: originalName,
    buffer: arrayBuffer
  });
}

export async function removeStem(livepadsUrl) {
  if (!livepadsUrl || !window.electronAPI?.stemsRemoveFile) return;
  await window.electronAPI.stemsRemoveFile(livepadsUrl);
}

// Fetch a stored stem as an ArrayBuffer ready for decodeAudioData.
export async function fetchStem(livepadsUrl) {
  const res = await fetch(livepadsUrl);
  if (!res.ok) throw new Error(`Stem fetch failed: HTTP ${res.status}`);
  return await res.arrayBuffer();
}
