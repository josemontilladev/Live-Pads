// Ajustes → Archivos de audio → «Copia de seguridad»: guardar y restaurar en un
// archivo las canciones, los mapeos MIDI, los kits propios y las preferencias.
// El proceso principal lee y escribe los archivos; aquí van las preferencias de
// la ventana (localStorage) y las confirmaciones.
import { q } from '../utils/dom.js';
import { confirmDialogAsync } from './dialog.js';

// Preferencias que viajan en la copia. Fuera: sesión, licencia y marcas de
// sincronización (son de la cuenta y del equipo, no del contenido).
const INCLUDE = /^(livepads|lastPadBankIdx|lastKitBankIdx|tpAutoAdvance|serviceSongs|stems-)/;
const EXCLUDE = /stamp|dirty|license|session|token|auth|trial|plan|tour|seen|cache|catalog|audio-out|click-alt/i;

export function collectPrefs() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (INCLUDE.test(k) && !EXCLUDE.test(k)) out[k] = localStorage.getItem(k);
    }
  } catch (_) {}
  return out;
}

export function applyPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(prefs)) {
    if (typeof v !== 'string' || !INCLUDE.test(k) || EXCLUDE.test(k)) continue;
    try { localStorage.setItem(k, v); n++; } catch (_) {}
  }
  // Que la sincronización de ajustes suba lo restaurado en vez de pisarlo con lo de la nube.
  try { localStorage.setItem('livepads-settings-dirty', '1'); } catch (_) {}
  return n;
}

const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' }); } catch (_) { return iso || 'fecha desconocida'; } };

export function initBackupSetting({ getSongCount, flushSongs } = {}) {
  const api = window.electronAPI;
  const saveBtn = q('#btn-backup-save'), restoreBtn = q('#btn-backup-restore');
  if (!api || !api.backupSave || !saveBtn || !restoreBtn) return;

  saveBtn.addEventListener('click', async () => {
    try {
      if (flushSongs) await flushSongs();          // que la copia lleve hasta el último cambio
      const r = await api.backupSave({ prefs: collectPrefs() });
      if (r) window.showToast?.(`✓ Copia guardada: ${r.songs} ${r.songs === 1 ? 'canción' : 'canciones'}, mapeos MIDI, kits y preferencias.`, 'success');
    } catch (err) { window.showToast?.('No se pudo guardar la copia: ' + ((err && err.message) || err), 'error'); }
  });

  restoreBtn.addEventListener('click', async () => {
    try {
      const r = await api.backupOpen();
      if (!r) return;
      if (r.error) { window.showToast?.(r.error, 'error'); return; }
      const d = r.data, now = getSongCount ? getSongCount() : 0;
      const ok = await confirmDialogAsync({
        title: 'Restaurar copia de seguridad',
        message: `Esta copia es del ${fmtDate(d.savedAt)} y trae ${d.songs.length} ${d.songs.length === 1 ? 'canción' : 'canciones'}`
          + `${d.midiMap ? ', mapeos MIDI' : ''}${d.userDrums ? ', kits de batería' : ''} y preferencias. `
          + `Reemplazará lo que hay ahora en este equipo (${now} ${now === 1 ? 'canción' : 'canciones'}); antes se guarda una copia automática de lo actual en Datos/backups. `
          + 'Si usas la nube, después se sincronizará con tu repertorio compartido. La app se recargará.',
        confirmLabel: 'Restaurar', cancelLabel: 'Cancelar', danger: true,
      });
      if (!ok) return;
      await api.backupApply(d);
      applyPrefs(d.prefs);
      location.reload();
    } catch (err) { window.showToast?.('No se pudo restaurar: ' + ((err && err.message) || err), 'error'); }
  });
}
