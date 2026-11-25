// ─────────────────────────────────────────────────────────────────────────
// Paquete del servicio sin conexión (lado de la app). Menú «⋯» del servicio:
//   · «Guardar paquete para otro portátil (USB)…» → .lpservicio con canciones y audios
//   · «Abrir paquete de servicio…» → junta las canciones con la librería, copia los
//     audios que falten y abre el servicio, con los tonos del día.
// El archivo lo escribe y lee el proceso principal (servicePack.js).
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSongs, getEffectiveKey, createNewSetlist, setKeyOverride } from '../data/service.js';
import { getSongs } from '../state/store.js';
import { requireRoom } from '../billing/license.js';
import { packSong, mergePack, findInLibrary } from '../data/servicePackCore.js';
import { renderGiList } from './giList.js';

const mb = (b) => (b / 1048576).toFixed(b > 104857600 ? 0 : 1).replace('.', ',') + ' MB';

export async function exportServicePack({ name = 'Servicio', date = '' } = {}) {
  const api = window.electronAPI;
  const list = getServiceSongs();
  if (!list.length) { window.showToast?.('El servicio no tiene canciones.', 'info'); return; }
  if (!api?.servicePackExport) { window.showToast?.('Esta versión no puede crear paquetes.', 'error'); return; }
  try {
    window.showToast?.('Preparando el paquete del servicio…', 'info');
    const r = await api.servicePackExport({ name, date, songs: list.map(packSong), keys: list.map((s) => getEffectiveKey(s) || s.key || '') });
    if (!r) return;
    const falta = r.missing && r.missing.length ? ` Faltan ${r.missing.length} audio${r.missing.length === 1 ? '' : 's'} que este portátil no tiene descargados.` : '';
    window.showToast?.(`✓ Paquete guardado: ${list.length} ${list.length === 1 ? 'canción' : 'canciones'} y ${r.files} audio${r.files === 1 ? '' : 's'} (${mb(r.bytes)}).${falta}`, r.missing && r.missing.length ? 'warning' : 'success', { ttl: 9000 });
  } catch (e) {
    window.showToast?.('No se pudo guardar el paquete: ' + ((e && e.message) || e), 'error');
  }
}

export async function importServicePack() {
  const api = window.electronAPI;
  if (!api?.servicePackImport) { window.showToast?.('Esta versión no puede abrir paquetes.', 'error'); return; }
  let r;
  try { r = await api.servicePackImport(); } catch (e) { window.showToast?.('No se pudo abrir el paquete: ' + ((e && e.message) || e), 'error'); return; }
  if (!r) return;
  const m = r.manifest;
  const lib = getSongs();
  // Plan Gratis: las canciones nuevas tienen que caber en el límite.
  const nuevas = m.songs.filter((s) => !findInLibrary(lib, packSong(s))).length;
  if (nuevas && !requireRoom('songs', lib.length, nuevas, `Este paquete trae ${nuevas} ${nuevas === 1 ? 'canción' : 'canciones'} nueva${nuevas === 1 ? '' : 's'} y el plan Gratis permite hasta 10 en la librería.`)) return;
  const res = mergePack(lib, m.songs);
  for (const s of res.added) lib.push(s);
  try { api.saveGiSetlist?.(lib); } catch (_) {}
  try { renderGiList(document.getElementById('gi-search')?.value || ''); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  // El servicio, con sus canciones (las de esta librería) y los tonos del día.
  createNewSetlist(m.name || 'Servicio', m.date || null, res.songs);
  res.songs.forEach((s, i) => { const k = (m.keys || [])[i]; if (k) setKeyOverride(s, k); });
  document.querySelector('.s-toggle[data-target="service-setlist-list"]')?.click();
  const parts = [`${res.songs.length} ${res.songs.length === 1 ? 'canción' : 'canciones'}`];
  if (res.added.length) parts.push(`${res.added.length} nueva${res.added.length === 1 ? '' : 's'} en la librería`);
  if (r.written) parts.push(`${r.written} audio${r.written === 1 ? '' : 's'} copiado${r.written === 1 ? '' : 's'}`);
  window.showToast?.(`✓ Servicio «${m.name || 'Servicio'}» abierto: ${parts.join(' · ')}.`, 'success', { ttl: 8000 });
}
