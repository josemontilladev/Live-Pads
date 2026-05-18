const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openAudioFile: () => ipcRenderer.invoke('open-audio-file'),
  openAudioFiles: () => ipcRenderer.invoke('open-audio-files'),
  savePreset: (data) => ipcRenderer.invoke('save-preset', data),
  loadPresets: () => ipcRenderer.invoke('load-presets'),
  deletePreset: (id) => ipcRenderer.invoke('delete-preset', id),
  windowAction: (action) => ipcRenderer.invoke('window-action', action),
  assignAudioFile: (data) => ipcRenderer.invoke('assign-audio-file', data),
  saveGiSetlist: (songs) => ipcRenderer.invoke('save-gi-setlist', songs),
  loadGiSetlist: () => ipcRenderer.invoke('load-gi-setlist'),
  syncMongoSetlist: () => ipcRenderer.invoke('sync-mongo-setlist'),
  getAbsolutePath: (relPath) => ipcRenderer.invoke('get-absolute-path', relPath),
  assignDrumSample: (data) => ipcRenderer.invoke('assign-drum-sample', data),
  saveUserDrums: (data) => ipcRenderer.invoke('save-user-drums', data),
  loadUserDrums: () => ipcRenderer.invoke('load-user-drums'),
  loadMidiMap: () => ipcRenderer.invoke('load-midi-map'),
  saveMidiMap: (data) => ipcRenderer.invoke('save-midi-map', data)
});
