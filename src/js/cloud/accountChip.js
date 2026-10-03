// ─────────────────────────────────────────────────────────────────────────
// Chip de cuenta en la barra superior: avatar + librería activa. Abre el
// "Centro de cuenta" (Mi cuenta, Librerías, Equipo) en la pantalla principal,
// sin pasar por el menú lateral. Se actualiza al entrar/salir y al cambiar de
// librería.
// ─────────────────────────────────────────────────────────────────────────

import { isCloudEnabled, isLoggedIn, getUser, onAuthChange } from './supabase.js';
import { getCachedLibraries, getActiveLibraryId } from './libraries.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paint(btn) {
  if (!isLoggedIn()) {
    btn.classList.add('is-guest');
    btn.innerHTML = '<span class="acc-chip-avatar">·</span><span class="acc-chip-text"><b>Iniciar sesión</b><i>Sincroniza con tu equipo</i></span>';
    btn.title = 'Iniciar sesión';
    return;
  }
  btn.classList.remove('is-guest');
  const u = getUser() || {};
  const name = (u.user_metadata && u.user_metadata.display_name) || (u.email ? u.email.split('@')[0] : 'Cuenta');
  const initial = (name.trim().charAt(0) || 'U').toUpperCase();
  let lib = '';
  try {
    const id = getActiveLibraryId();
    const l = (getCachedLibraries() || []).find((x) => x.id === id);
    lib = l ? l.name : '';
  } catch (_) {}
  btn.innerHTML = `<span class="acc-chip-avatar">${esc(initial)}</span><span class="acc-chip-text"><b>${esc(name)}</b><i>${esc(lib || 'Sin librería activa')}</i></span><span class="acc-chip-caret">▾</span>`;
  btn.title = 'Mi cuenta, librerías y equipo';
}

export function startAccountChip() {
  if (!isCloudEnabled()) return;
  const host = document.querySelector('#topbar .topbar-actions');
  if (!host || document.getElementById('btn-account-chip')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btn-account-chip';
  btn.className = 'acc-chip';
  btn.setAttribute('aria-label', 'Mi cuenta y librerías');
  host.insertBefore(btn, host.firstChild);
  paint(btn);
  btn.addEventListener('click', async () => {
    try {
      const m = await import('./accountPanel.js');
      await m.openAccountPanel();
    } catch (e) {
      window.showToast?.(`No se pudo abrir Mi cuenta: ${(e && e.message) || e}`, 'error');
    }
  });
  const refresh = () => paint(btn);
  window.addEventListener('livepads:libraries-changed', refresh);
  onAuthChange(refresh);
  // Las librerías se cargan async tras el arranque: repinta un par de veces.
  setTimeout(refresh, 1500);
  setTimeout(refresh, 5000);
}
