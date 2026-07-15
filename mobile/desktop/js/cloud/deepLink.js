// ─────────────────────────────────────────────────────────────────────────
// Deep-link de invitación: al hacer clic en un enlace livepads://join?token=…
// el proceso principal nos entrega el token por IPC (electronAPI.onDeepLinkJoin)
// y aquí unimos al usuario a la librería compartida. Si aún no ha iniciado
// sesión, guardamos el token y lo procesamos en cuanto entre.
// ─────────────────────────────────────────────────────────────────────────

import { isLoggedIn, onAuthChange } from './supabase.js';
import { acceptInvite } from './libraries.js';
import { showToast } from '../ui/toast.js';

let pendingToken = null;
let joining = false;

async function join(token) {
  const t = String(token || '').trim();
  if (!t || joining) return;
  if (!isLoggedIn()) {
    pendingToken = t;
    showToast('Inicia sesión para unirte a la librería del enlace.', 'info');
    return;
  }
  joining = true;
  try {
    await acceptInvite(t);                               // valida el token + crea la membresía + activa la librería
    try { window.dispatchEvent(new Event('livepads:libraries-changed')); } catch (_) {}
    showToast('¡Te uniste a la librería compartida! Bajando su repertorio…', 'success');
    try { const { checkLibraryNow } = await import('./libraryLive.js'); checkLibraryNow(); } catch (_) {}
  } catch (e) {
    showToast(e.message || 'No se pudo unir con ese enlace.', 'error');
  } finally {
    joining = false;
  }
}

export function initDeepLink() {
  if (window.electronAPI?.onDeepLinkJoin) window.electronAPI.onDeepLinkJoin(join);
  // Si llegó un enlace sin sesión, únete en cuanto el usuario inicie sesión.
  onAuthChange((session) => {
    if (session && session.access_token && pendingToken) {
      const t = pendingToken; pendingToken = null; join(t);
    }
  });
}
