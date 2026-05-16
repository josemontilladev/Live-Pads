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
  getAbsolutePath: (relPath) => ipcRenderer.invoke('get-absolute-path', relPath),
});
