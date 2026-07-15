// Ítems de menú compartidos para gestionar el AUDIO y la CARÁTULA de una
// canción. Los usan el panel de Stems y las tarjetas de Pads (Librería +
// Servicio) para tener EXACTAMENTE las mismas opciones en los dos lados.
// `onAssigned(song)` lo provee cada contexto para persistir/refrescar a su
// manera (la Librería guarda getSongs() y repinta su card; el Servicio
// persiste el servicio y espeja a la librería; Stems refresca su panel).

import { assignFromYoutube } from './audioLoadMenu.js';

const ICO_UP  = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 19V6"/><path d="M5 12l7-7 7 7"/></svg>';
const ICO_YT  = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M23 12s0-3.8-.5-5.6a3 3 0 0 0-2.1-2.1C18.6 3.8 12 3.8 12 3.8s-6.6 0-8.4.5A3 3 0 0 0 1.5 6.4C1 8.2 1 12 1 12s0 3.8.5 5.6a3 3 0 0 0 2.1 2.1c1.8.5 8.4.5 8.4.5s6.6 0 8.4-.5a3 3 0 0 0 2.1-2.1C23 15.8 23 12 23 12zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z"/></svg>';
const ICO_IMG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

// Sube un archivo local a un slot (copia a la librería, content-addressed) sin
// reproducirlo. Persiste/refresca vía onAssigned.
async function loadSlotFromFile(song, slot, onAssigned) {
  try {
    const file = await window.electronAPI.openAudioFile();
    if (!file || !file.path) return;
    const url = await window.electronAPI.assignAudioFile({ sourcePath: file.path, type: slot });
    if (!song.audio) song.audio = {};
    song.audio[slot] = url;
    onAssigned?.(song);
    window.showToast?.(`✓ ${slot === 'original' ? 'Original' : 'Secuencia'} cargada en «${song.title}».`, 'success');
  } catch (e) {
    window.showToast?.('No se pudo cargar el audio: ' + (e.message || e), 'error');
  }
}

// Elige una imagen y la usa de carátula manual (local, no se sube a la nube —
// la web GI.Setlist saca su carátula del youtubeUrl).
async function replaceCover(song, onAssigned) {
  try {
    const url = await window.electronAPI.assignCoverFile();
    if (!url) return;
    song.cover = url;
    onAssigned?.(song);
    window.showToast?.('✓ Carátula actualizada.', 'success');
  } catch (e) {
    window.showToast?.('No se pudo cambiar la carátula: ' + (e.message || e), 'error');
  }
}

// Devuelve los ítems de audio/carátula listos para openCardMoreMenu.
export function audioMenuItems(song, onAssigned) {
  const hasSeq = !!(song.audio && song.audio.sequence);
  const hasOrig = !!(song.audio && song.audio.original);
  return [
    { label: (hasSeq ? 'Reemplazar' : 'Subir') + ' secuencia (archivo)', icon: ICO_UP, onSelect: () => loadSlotFromFile(song, 'sequence', onAssigned) },
    { label: (hasOrig ? 'Reemplazar' : 'Subir') + ' original (archivo)', icon: ICO_UP, onSelect: () => loadSlotFromFile(song, 'original', onAssigned) },
    { label: 'Original desde YouTube', icon: ICO_YT, onSelect: () => assignFromYoutube(song, onAssigned) },
    { label: (song.cover ? 'Reemplazar' : 'Poner') + ' carátula', icon: ICO_IMG, onSelect: () => replaceCover(song, onAssigned) },
  ];
}
