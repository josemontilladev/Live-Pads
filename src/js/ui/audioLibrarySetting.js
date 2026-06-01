// UI del setting "Biblioteca de audios" en el sidebar Ajustes.
//
// Permite al usuario apuntar Sequences/ y Original Tracks/ a una carpeta
// custom (típicamente dentro de OneDrive/Dropbox/etc.) para que sincronicen
// entre sus máquinas SIN tener que subir los audios a Supabase.
//
// Flujo:
//   1. Al cargar la app, refresh() lee la config del main y muestra la ruta
//      efectiva en el card.
//   2. "Cambiar carpeta…" abre el dialog nativo de OS, valida que la carpeta
//      sea escribible (vía audio-library-set), y ofrece migrar los audios
//      existentes desde la ruta anterior.
//   3. "Restaurar" limpia la config; vuelve a userData (default).

import { q } from '../utils/dom.js';
import { confirmDialogAsync } from './dialog.js';

let state = { customPath: null, defaultPath: '', effectivePath: '' };

function shorten(p) {
  if (!p) return '—';
  if (p.length <= 56) return p;
  return p.slice(0, 30) + '…' + p.slice(-22);
}

function setMsg(text, kind = 'ok') {
  const m = q('#audio-lib-msg');
  if (!m) return;
  if (!text) { m.hidden = true; m.textContent = ''; m.className = 'audio-lib-msg'; return; }
  m.hidden = false;
  m.textContent = text;
  m.className = `audio-lib-msg ${kind}`;
  setTimeout(() => { m.hidden = true; m.textContent = ''; }, kind === 'ok' ? 5000 : 9000);
}

async function refresh() {
  const cfg = await window.electronAPI?.audioLibraryGet?.();
  if (!cfg) return;
  state = cfg;
  const pathEl = q('#audio-lib-path');
  if (pathEl) {
    pathEl.textContent = shorten(state.effectivePath);
    pathEl.title = state.effectivePath;
    pathEl.classList.toggle('is-custom', !!state.customPath);
  }
}

async function onPick() {
  const picked = await window.electronAPI?.audioLibraryPick?.();
  if (!picked) return;
  if (picked === state.customPath || picked === state.defaultPath) {
    setMsg('Esa ya es la carpeta actual.', 'info');
    return;
  }
  const previous = state.effectivePath;
  try {
    await window.electronAPI.audioLibrarySet({ path: picked });
  } catch (e) {
    setMsg('No se pudo configurar: ' + (e.message || e), 'error');
    return;
  }
  const wantsMigrate = await confirmDialogAsync({
    title: 'Migrar audios existentes',
    message: `Carpeta cambiada a:\n${picked}\n\n¿Copiar los audios que ya tenías en\n${previous}\n hacia la nueva carpeta? (no borra los originales — los puedes limpiar a mano después).`,
    confirmLabel: 'Copiar audios', danger: false,
  });
  if (wantsMigrate) {
    try {
      const r = await window.electronAPI.audioLibraryMigrate({ fromPath: previous, toPath: picked });
      setMsg(`✓ Carpeta cambiada. Copiados ${r.copied} archivos, ${r.skipped} ya existían.`, 'ok');
    } catch (e) {
      setMsg('Carpeta cambiada, pero la migración falló: ' + (e.message || e), 'error');
    }
  } else {
    setMsg('✓ Carpeta cambiada. (Audios anteriores no se copiaron.)', 'ok');
  }
  await refresh();
}

async function onReset() {
  if (!state.customPath) {
    setMsg('Ya estás usando la carpeta por defecto.', 'info');
    return;
  }
  const ok = await confirmDialogAsync({
    title: 'Restaurar carpeta por defecto',
    message: `Volver a usar la carpeta interna de LivePads:\n${state.defaultPath}\n\nLos audios en la carpeta custom no se borran — solo se deja de leerlos. Si querés migrarlos antes, cancelá y copialos a mano.`,
    confirmLabel: 'Restaurar', danger: false,
  });
  if (!ok) return;
  try {
    await window.electronAPI.audioLibrarySet({ path: null });
    setMsg('✓ Restaurado a la carpeta por defecto.', 'ok');
    await refresh();
  } catch (e) {
    setMsg('No se pudo restaurar: ' + (e.message || e), 'error');
  }
}

export function initAudioLibrarySetting() {
  const pickBtn = q('#btn-audio-lib-pick');
  const resetBtn = q('#btn-audio-lib-reset');
  if (pickBtn) pickBtn.onclick = onPick;
  if (resetBtn) resetBtn.onclick = onReset;
  refresh();
}
