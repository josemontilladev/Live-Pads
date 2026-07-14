// ─────────────────────────────────────────────────────────────────────────
// Buzón de INVITACIONES dentro de la app.
//
// Antes, invitar a alguien significaba pasarle un código por WhatsApp para que
// lo pegara. Ahora, si invitas a esa persona POR SU EMAIL y tiene LivePads
// abierto con sesión iniciada y conexión, le aparece sola la invitación:
//
//     «Fulano te invitó a "Repertorio GI" · [Aceptar] [Ahora no]»
//
// Al aceptar: se crea la membresía, esa librería pasa a ser la activa, se bajan
// las canciones y los setlists, y se le ofrece descargar los audios.
//
// Requiere la RPC `my_pending_invites()` (migración 0010): el invitado NO puede
// leer la tabla `invites` por RLS (todavía no es miembro), así que esa función
// SECURITY DEFINER le devuelve solo lo dirigido a su email.
// ─────────────────────────────────────────────────────────────────────────

import { rpc, isLoggedIn, onAuthChange } from './supabase.js';
import { acceptInvite, listLibraries } from './libraries.js';
import { confirmDialogAsync } from '../ui/dialog.js';

const POLL_MS = 60000; // una ronda por minuto: una invitación no es urgente
const STARTUP_DELAY_MS = 6000;

let timer = null;
let started = false;
let checking = false;
// Invitaciones ya ofrecidas en esta sesión: si dijo "ahora no", no volvemos a
// interrumpirle (la invitación sigue disponible en Mi cuenta → Unirme).
const seen = new Set();

// Tras entrar a la librería: canciones + setlists, y ofrecer los audios.
async function downloadRepertoire(libraryName) {
  window.showToast?.(`Te uniste a "${libraryName}". Bajando el repertorio…`, 'success');

  let resumen = '';
  try {
    const { pullLibrarySongs } = await import('./songSync.js');
    const r = await pullLibrarySongs();
    resumen = `${r.added + r.refreshed} canción(es)`;
    try {
      const { pullSharedSetlists } = await import('./setlistSync.js');
      const sl = await pullSharedSetlists();
      if (sl.added + sl.updated) resumen += ` y ${sl.added + sl.updated} setlist(s)`;
    } catch (_) { /* sin setlists: no es crítico */ }
  } catch (err) {
    window.showToast?.('No se pudieron bajar las canciones: ' + (err.message || ''), 'info');
    return;
  }

  // Los AUDIOS pueden ser cientos de MB: se pregunta, no se impone (puede estar
  // con datos móviles o con poco disco).
  let pending = 0;
  try {
    const { estadoBiblioteca } = await import('./fileSync.js');
    pending = (await estadoBiblioteca()).pendingDownload;
  } catch (_) { /* la librería aún no tiene archivos subidos */ }

  if (!pending) {
    window.showToast?.(`Listo: ${resumen}.`, 'success');
    return;
  }

  const ok = await confirmDialogAsync({
    title: 'Descargar los audios',
    message: `Ya tienes ${resumen}. Faltan ${pending} archivo(s) de audio y carátulas para poder reproducir las canciones en este equipo. ¿Los descargo ahora?`,
    confirmLabel: '⬇ Descargar',
    danger: false,
  });
  if (!ok) {
    window.showToast?.('Puedes descargarlos cuando quieras en Mi cuenta → Archivos.', 'info');
    return;
  }

  try {
    const { bajarBiblioteca } = await import('./fileSync.js');
    const r = await bajarBiblioteca(({ done, total }) => {
      window.showToast?.(`Descargando audios ${done}/${total}…`, 'info');
    });
    window.showToast?.(`✓ Repertorio completo: ${r.downloaded} archivo(s) descargados.`, 'success');
    window.dispatchEvent(new CustomEvent('songs-changed'));
  } catch (err) {
    window.showToast?.('Error al descargar audios: ' + (err.message || ''), 'info');
  }
}

async function checkNow() {
  if (checking || !isLoggedIn() || !navigator.onLine) return;
  checking = true;
  try {
    const rows = await rpc('my_pending_invites');
    if (!Array.isArray(rows) || !rows.length) return;

    // De una en una: si hay varias, se ofrecerán en rondas siguientes.
    const inv = rows.find((r) => !seen.has(r.id));
    if (!inv) return;
    seen.add(inv.id);

    const rol =
      inv.role === 'editor'
        ? 'podrás ver y EDITAR el repertorio del equipo'
        : 'podrás ver y descargar el repertorio del equipo';
    const ok = await confirmDialogAsync({
      title: '📬 Invitación a un repertorio',
      message: `${inv.inviter} te invitó a "${inv.library_name}". Si aceptas, ${rol}, y se descargarán sus canciones en este equipo.`,
      confirmLabel: 'Aceptar invitación',
      danger: false,
    });
    if (!ok) return;

    // acceptInvite ya crea la membresía, deja la librería como activa y registra
    // la actividad "se unió".
    await acceptInvite(inv.token);
    try { await listLibraries(); } catch (_) {}
    try { window.dispatchEvent(new Event('livepads:libraries-changed')); } catch (_) {}

    await downloadRepertoire(inv.library_name);
  } catch (err) {
    // Sin red, sesión expirada, o la RPC aún no desplegada: se reintenta en la
    // próxima ronda, sin molestar al usuario con un error.
  } finally {
    checking = false;
  }
}

// Arranca el buzón. Idempotente.
export function startInviteInbox() {
  if (started) return;
  started = true;
  window.addEventListener('focus', checkNow);
  window.addEventListener('online', checkNow);
  // Recién iniciada la sesión es EL momento de mirar el buzón: el invitado
  // suele abrir la app justo para eso.
  onAuthChange((session) => {
    if (session) setTimeout(checkNow, 1500);
    else seen.clear(); // otra cuenta = otro buzón
  });
  timer = setInterval(checkNow, POLL_MS);
  setTimeout(checkNow, STARTUP_DELAY_MS);
}

export function stopInviteInbox() {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}

// Comprobar ya (p. ej. justo después de iniciar sesión).
export function checkInvitesNow() { return checkNow(); }
