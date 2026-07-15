// Menú compartido "Cargar audio" + descarga desde YouTube, para una canción sin
// audio en un slot. Lo usan la Librería (giList) y el Servicio (serviceListView)
// para ofrecer las MISMAS opciones (Subir archivo / Desde YouTube / Extraer del
// original) sin duplicar la lógica de descarga, carátula y sync a la nube.
//
// Cada contexto provee `loadAndPlayTrack` y un `onAssigned(song)` que persiste y
// refresca a su manera (la librería guarda getSongs(); el servicio guarda la
// lista de servicio y sincroniza a la librería).

import { showDialog } from './dialog.js';

// Descarga el audio original desde una URL de YouTube, lo asigna a `song`
// (audio.original + youtubeUrl + carátula) y sube el youtubeUrl a la nube.
// `onAssigned(song)` corre tras asignar.
export function assignFromYoutube(song, onAssigned) {
  if (!navigator.onLine) { window.showToast?.('Necesitas internet para descargar de YouTube.', 'warning'); return; }
  showDialog('Audio desde YouTube', 'Pega el enlace de YouTube…', async (url) => {
    if (!url || !url.trim()) return;
    window.showToast?.('Descargando audio de YouTube… (puede tardar unos segundos)', 'info');
    try {
      const res = await window.electronAPI.downloadYoutubeAudio({ url: url.trim(), title: song.title });
      // Compat: antes devolvía un string; ahora { url, cover }.
      const audioUrl = typeof res === 'string' ? res : res.url;
      const cover = (res && typeof res === 'object') ? res.cover : null;
      if (!song.audio) song.audio = {};
      song.audio.original = audioUrl;
      if (cover && !song.cover) song.cover = cover; // no piso una carátula previa
      song.youtubeUrl = url.trim();
      // Auto-sync del youtubeUrl a la librería activa de Supabase (best-effort).
      if (navigator.onLine) {
        import('../cloud/songSync.js').then(m => m.pushSongYoutubeUrl(song)).catch(() => {});
      }
      if (typeof onAssigned === 'function') onAssigned(song);
      window.showToast?.('Audio original asignado desde YouTube.', 'success');
    } catch (err) { window.showToast?.(err.message || 'No se pudo descargar el audio.', 'error'); }
  });
}

// Lleva el audio original de `song` a Stems (extraer secuencia). El archivo se
// lee vía IPC y se envuelve como File para que workspace lo trate como un drop.
async function extractToStems(song) {
  const path = song.audio?.original;
  if (!path) { window.showToast?.('Esta canción no tiene audio original cargado.', 'warning'); return; }
  const stemsTab = document.querySelector('.ws-tab[data-workspace="stems"]');
  if (stemsTab) stemsTab.click();
  try {
    const ab = await window.electronAPI.readAudioFile(path);
    const match = path.match(/[^/\\]+$/);
    const filename = match ? decodeURIComponent(match[0]) : `${song.title || 'audio'}.mp3`;
    const file = new File([ab], filename, { type: 'audio/mpeg' });
    const ws = await import('../stems/workspace.js');
    await ws.acceptIncomingFile(file);
  } catch (err) {
    console.error('Auto-load to stems failed:', err);
    window.showToast?.('No se pudo abrir el audio en Stems: ' + (err.message || err), 'error');
  }
}

// Menú que aparece al clickear un botón de audio cuando el slot aún no tiene
// audio. Opciones según el tipo:
//   · original: subir archivo | desde YouTube
//   · sequence: subir archivo | extraer del original (si hay original)
// Si solo hay una opción, va directo al file picker (sin menú vacío).
export function showLoadAudioMenu({ anchor, song, type, loadAndPlayTrack, onAssigned }) {
  const hasOriginal = !!(song.audio && song.audio.original);
  const items = [{ key: 'local', label: '⬆ Subir archivo' }];
  if (type === 'original') items.push({ key: 'youtube', label: '▶ Desde YouTube' });
  else if (type === 'sequence' && hasOriginal) items.push({ key: 'extract', label: '✂ Extraer del original' });

  if (items.length < 2) { loadAndPlayTrack(song, type); return; }

  document.querySelector('.orig-src-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'orig-src-menu';
  menu.innerHTML = items.map(it => `<button type="button" data-src="${it.key}">${it.label}</button>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = 190;
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true); };
  const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
  menu.onclick = (e) => {
    const btn = e.target.closest('[data-src]');
    if (!btn) return;
    close();
    const src = btn.dataset.src;
    if (src === 'local')   { loadAndPlayTrack(song, type); return; }
    if (src === 'youtube') { assignFromYoutube(song, onAssigned); return; }
    if (src === 'extract') { extractToStems(song); return; }
  };
}
