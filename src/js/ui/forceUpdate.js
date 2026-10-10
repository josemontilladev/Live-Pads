// ─────────────────────────────────────────────────────────────────────────
// Actualización obligatoria.
//
// La web publica la versión mínima permitida (livepads.online/app-version.json).
// Si esta app es más vieja, se muestra una pantalla que no se puede cerrar: la
// versión nueva se descarga sola y un botón la instala y reinicia. Sin conexión
// no se bloquea (un servicio en vivo no puede quedarse sin app).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from './modalStack.js';

const CHECK_EVERY_MS = 3 * 3600 * 1000;
const DOWNLOAD_URL = 'https://github.com/josemontilladev/Live-Pads/releases/latest';
let shown = false;

// -1 si a < b, 0 si iguales, 1 si a > b ("1.0.185" vs "1.0.190")
export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function block(current, cfg) {
  if (shown) return;
  shown = true;
  const api = window.electronAPI || {};
  const ov = document.createElement('div');
  ov.id = 'force-update';
  ov.innerHTML = `
    <div class="fu-card" role="alertdialog" aria-modal="true" aria-label="Actualización obligatoria">
      <img src="assets/logo.png" alt="" width="56" height="56">
      <h2>Actualización obligatoria</h2>
      <p>${cfg.message ? String(cfg.message).replace(/[<>&]/g, '') : 'Esta versión de LivePads ya no es compatible. Actualiza para seguir usando la app, tu cuenta y tu plan.'}</p>
      <p class="fu-ver">Tienes la versión ${current} · se necesita la ${cfg.min} o posterior</p>
      <div class="fu-bar"><i></i></div>
      <p class="fu-status">Buscando la versión nueva…</p>
      <div class="fu-acts">
        <button type="button" class="acc-btn fu-install" disabled>Instalar y reiniciar</button>
        <button type="button" class="acc-btn ghost fu-manual">Descargar desde la web</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  pushModal(() => {}, ov.querySelector('.fu-card')); // Esc no la cierra
  const bar = ov.querySelector('.fu-bar i');
  const status = ov.querySelector('.fu-status');
  const install = ov.querySelector('.fu-install');
  const ready = () => {
    bar.style.width = '100%';
    status.textContent = 'Lista para instalar.';
    install.disabled = false;
  };
  install.onclick = () => { status.textContent = 'Instalando… la app se reiniciará sola.'; api.installUpdate?.(); };
  ov.querySelector('.fu-manual').onclick = () => api.openExternal?.(DOWNLOAD_URL);
  api.onUpdateProgress?.((p) => {
    const pct = Math.max(0, Math.min(100, Math.round((p && p.percent) || 0)));
    bar.style.width = `${pct}%`;
    status.textContent = `Descargando la versión nueva… ${pct}%`;
  });
  api.onUpdateReady?.(ready);
  api.onUpdateError?.(() => { status.textContent = 'No se pudo descargar automáticamente. Usa «Descargar desde la web».'; });
  Promise.resolve(api.getUpdateStatus?.()).then((s) => { if (s) ready(); }).catch(() => {});
  Promise.resolve(api.checkForUpdates?.()).then((r) => {
    if (r && r.status === 'latest') status.textContent = 'Preparando la actualización…';
  }).catch(() => {});
}

async function check() {
  const api = window.electronAPI;
  if (!api?.getMinVersion || shown) return;
  try {
    const [cfg, current] = await Promise.all([api.getMinVersion(), api.getAppVersion()]);
    if (cfg && current && cmpVersion(current, cfg.min) < 0) block(current, cfg);
  } catch (_) { /* sin red: no se bloquea */ }
}

export function startForceUpdateWatch() {
  check();
  setInterval(check, CHECK_EVERY_MS);
  window.addEventListener('online', check);
}

// Para pruebas: muestra la pantalla con datos dados.
export function __showForTest(current, cfg) { block(current, cfg); }
