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

import { q, withBusy } from '../utils/dom.js';
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
    // Caso clave en la 2da PC: hay una carpeta configurada pero no existe en
    // esta máquina (OneDrive no sincronizó aún, distinta letra de unidad…).
    // La app cae a la carpeta interna; hay que avisarlo o parecerá que se
    // "perdieron" los audios.
    const unavailable = cfg.customConfigured && !cfg.available;
    pathEl.textContent = unavailable
      ? '⚠ Carpeta configurada no disponible — usando la interna'
      : shorten(state.effectivePath);
    pathEl.title = unavailable
      ? `Configurada: ${state.customPath}\n(no existe en esta máquina — OneDrive quizá no sincronizó aún o la ruta es distinta)\nUsando ahora: ${state.effectivePath}`
      : state.effectivePath;
    pathEl.classList.toggle('is-custom', !!state.customPath && !unavailable);
    pathEl.classList.toggle('is-unavailable', unavailable);
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
      const failed = r.failed || [];
      if (failed.length) {
        const sample = failed.slice(0, 3).join(', ') + (failed.length > 3 ? '…' : '');
        setMsg(`Carpeta cambiada. Copiados ${r.copied}, ${r.skipped} ya existían, ${failed.length} fallaron (${sample}).`, 'error');
      } else {
        setMsg(`✓ Carpeta cambiada. Copiados ${r.copied} archivos, ${r.skipped} ya existían.`, 'ok');
      }
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

// "Revisar audios": audita la reconciliación BD ↔ archivos y ofrece reparar
// (vincular huérfanos por título + limpiar referencias rotas).
async function onAudit() {
  const auditBtn = q('#btn-audio-lib-audit');
  let r;
  try {
    // El IPC puede tardar ~1s (lista archivos + chequea placeholders) → botón
    // ocupado para que no parezca colgado ni se re-clickee.
    r = await withBusy(auditBtn, 'Revisando…', () => window.electronAPI?.libraryAudioAudit?.());
  } catch (e) {
    setMsg('No se pudo revisar: ' + (e.message || e), 'error');
    return;
  }
  if (!r) return;
  const broken = r.brokenRefs?.length || 0;
  const orphans = r.orphanFiles?.length || 0;
  const offline = r.offline?.length || 0;

  if (!broken && !orphans && !offline) {
    setMsg('✓ Todo en orden: sin referencias rotas ni audios huérfanos.', 'ok');
    return;
  }

  const lines = [];
  if (broken)  lines.push(`• ${broken} referencia(s) rota(s) (canción → audio inexistente)`);
  if (orphans) lines.push(`• ${orphans} audio(s) huérfano(s) (archivo sin canción)`);
  if (offline) lines.push(`• ${offline} audio(s) aún en la nube (sin descargar en esta PC)`);

  // Si hay algo reparable (roto o huérfano), ofrece reparar. Los offline solo
  // se informan (se resuelven con "Conservar siempre en este dispositivo").
  if (!broken && !orphans) {
    setMsg(`${offline} audio(s) aún en la nube. Tip: clic derecho en la carpeta → "Conservar siempre en este dispositivo".`, 'info');
    return;
  }

  const ok = await confirmDialogAsync({
    title: 'Revisión de audios',
    message: `${lines.join('\n')}\n\n¿Reparar ahora? Vincula los huérfanos a su canción por nombre y limpia las referencias rotas (deja esos slots vacíos para reasignar).` +
             (offline ? `\n\n(Los ${offline} "en la nube" no se tocan — descargalos con "Conservar siempre en este dispositivo".)` : ''),
    confirmLabel: 'Reparar', danger: false,
  });
  if (!ok) return;
  try {
    const res = await withBusy(auditBtn, 'Reparando…', () => window.electronAPI.libraryAudioRepair());
    window.dispatchEvent(new CustomEvent('livepads:library-reload'));
    setMsg(`✓ Reparado: ${res.linked} vinculado(s), ${res.cleared} referencia(s) limpiada(s).`, 'ok');
  } catch (e) {
    setMsg('La reparación falló: ' + (e.message || e), 'error');
  }
}

export function initAudioLibrarySetting() {
  const pickBtn = q('#btn-audio-lib-pick');
  const resetBtn = q('#btn-audio-lib-reset');
  const auditBtn = q('#btn-audio-lib-audit');
  if (pickBtn) pickBtn.onclick = onPick;
  if (resetBtn) resetBtn.onclick = onReset;
  if (auditBtn) auditBtn.onclick = onAudit;
  refresh();
}
