// ─────────────────────────────────────────────────────────────────────────
// Panel "Mi cuenta y librerías": gestionar librerías (carpetas), invitar al
// equipo y unirse con un código. Se abre desde el menú principal.
// ─────────────────────────────────────────────────────────────────────────

import { isCloudEnabled, isLoggedIn, getUser, signOut, invokeFunction, signInWithGoogle, updatePassword, deleteAccount } from './supabase.js';
import { confirmDialogAsync, showDialog } from '../ui/dialog.js';
import { pushModal } from '../ui/modalStack.js';
import { withBusy } from '../utils/dom.js';

// ¿La cuenta ya tiene a Google como método de acceso?
function hasGoogleIdentity(u) {
  const ids = (u && u.identities) || [];
  return ids.some(i => (i.provider || '').toLowerCase() === 'google');
}
import { openAuthGate } from './authUI.js';
import {
  listLibraries, createLibrary, renameLibrary, deleteLibrary, leaveLibrary,
  listMembers, removeMember, changeMemberRole,
  listInvites, createInvite, revokeInvite, acceptInvite,
  getActiveLibraryId, setActiveLibraryId,
} from './libraries.js';
import { saveServiceAsSetlist, listSharedSetlists, loadSharedSetlist, deleteSharedSetlist } from './setlistSync.js';

let overlay = null;
let popModal = null;
let msgTimeout = null;
let state = { libs: [], activeId: null, activeTab: 'cuenta' };

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Abre el cliente de correo del usuario con la invitación ya redactada (incluye
// el código para unirse). Correo real desde su propia cuenta, sin servidor.
function openInviteEmail(email, code) {
  const active = state.libs.find(l => l.id === state.activeId);
  const libName = active ? active.name : 'mi librería';
  const subject = `Invitación a "${libName}" en LivePads`;
  const body =
`¡Hola!

Te invito a la librería "${libName}" en LivePads.

Cómo unirte:
1) Descarga LivePads e inicia sesión (o crea tu cuenta).
2) Abre el menú → "Mi cuenta y librerías".
3) En "Unirme a una librería", pega este código:

${code}

¡Nos vemos!`;
  const url = `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.location.href = url;
  } catch (_) {}
}

// Intenta enviar la invitación por correo automático (Edge Function + Resend).
// Si la función no está desplegada o falla, cae al cliente de correo (mailto).
// Devuelve 'sent' | 'mailto'.
async function sendInvite(email, code) {
  const active = state.libs.find(l => l.id === state.activeId);
  const libraryName = active ? active.name : 'mi librería';
  try {
    await invokeFunction('send-invite', { email, code, libraryName });
    return 'sent';
  } catch (_) {
    openInviteEmail(email, code);
    return 'mailto';
  }
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = el(`<div id="account-overlay" class="hidden"><div class="acc-panel" id="acc-panel"></div></div>`);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return overlay;
}

function close() {
  if (popModal) { popModal(); popModal = null; }
  if (overlay) overlay.classList.add('hidden');
}

function msg(text, kind = 'error') {
  const m = overlay.querySelector('#acc-msg');
  if (!m) return;
  if (msgTimeout) { clearTimeout(msgTimeout); msgTimeout = null; }
  m.textContent = text;
  m.className = `acc-msg show ${kind}`;
  msgTimeout = setTimeout(() => {
    m.className = 'acc-msg';
    msgTimeout = null;
  }, kind === 'ok' ? 3500 : 6000);
}

function switchTab(tab) {
  state.activeTab = tab;
  overlay.querySelectorAll('.acc-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  overlay.querySelectorAll('.acc-tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
}

// ── Render principal ────────────────────────────────────────────────────────
async function render() {
  const panel = overlay.querySelector('#acc-panel');
  const u = getUser();
  const initial = (u && (u.user_metadata?.display_name || u.email || '?')).trim().charAt(0).toUpperCase();
  const name = (u && (u.user_metadata?.display_name)) || (u && u.email && u.email.split('@')[0]) || 'Usuario';

  panel.innerHTML = `
    <div class="acc-head">
      <h3>Mi cuenta y librerías</h3>
      <button class="acc-x" data-act="close">×</button>
    </div>
    <div class="acc-user">
      <div class="acc-avatar">${escapeHtml(initial || 'U')}</div>
      <div class="acc-user-info">
        <div class="name">${escapeHtml(name)}</div>
        <div class="email">${escapeHtml(u ? u.email : '')}</div>
      </div>
      <button class="acc-btn ghost sm" data-act="signout">Cerrar sesión</button>
    </div>

    <div class="acc-tabs" role="tablist">
      <button class="acc-tab ${state.activeTab === 'cuenta' ? 'active' : ''}" data-tab="cuenta" role="tab">Cuenta</button>
      <button class="acc-tab ${state.activeTab === 'librerias' ? 'active' : ''}" data-tab="librerias" role="tab">Librerías</button>
      <button class="acc-tab ${state.activeTab === 'equipo' ? 'active' : ''}" data-tab="equipo" role="tab">Equipo</button>
    </div>

    <!-- TAB: CUENTA — acceso, contraseña, eliminar cuenta -->
    <div class="acc-tab-panel ${state.activeTab !== 'cuenta' ? 'hidden' : ''}" data-panel="cuenta">
      <div class="acc-section">
        <h4>Acceso rápido</h4>
        ${u && hasGoogleIdentity(u)
          ? `<div class="acc-empty">✓ Google vinculado — ya puedes entrar con el botón de Google.</div>`
          : `<button class="acc-btn ghost acc-btn-wide" data-act="link-google">
               <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 16 2 9.1 6.5 6.3 14.7z"/><path fill="#4CAF50" d="M24 46c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 36.6 26.9 38 24 38c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.1 41.4 16 46 24 46z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C40.9 36.6 44 31 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
               Vincular con Google
             </button>
             <div class="acc-hint">Inicia con Google usando tu mismo correo para no escribir la contraseña la próxima vez.</div>`}
        <button class="acc-btn ghost acc-btn-full" data-act="change-pass">Cambiar contraseña</button>
      </div>

      <div class="acc-section acc-danger">
        <h4>Zona de peligro</h4>
        <button class="acc-btn danger acc-btn-full" data-act="delete-account">Eliminar mi cuenta</button>
        <div class="acc-hint">Borra tu cuenta y los datos asociados (librerías propias, canciones y configuración). No se puede deshacer.</div>
      </div>
    </div>

    <!-- TAB: LIBRERÍAS — tuyas, crear, unirse, push/pull, servicios -->
    <div class="acc-tab-panel ${state.activeTab !== 'librerias' ? 'hidden' : ''}" data-panel="librerias">
      <div class="acc-section">
        <h4>Tus librerías</h4>
        <div class="acc-lib-list" id="acc-libs"><div class="acc-empty">Cargando…</div></div>
        <div class="acc-row">
          <input id="acc-new-lib" placeholder="Nombre de una nueva librería…" maxlength="60">
          <button class="acc-btn" data-act="create-lib">Crear</button>
        </div>
      </div>

      <div class="acc-section">
        <h4>Unirme a una librería</h4>
        <div class="acc-row">
          <input id="acc-join-code" placeholder="Pega aquí el código de invitación…">
          <button class="acc-btn ghost" data-act="join">Unirme</button>
        </div>
      </div>

      <div class="acc-section">
        <h4>Canciones de esta librería</h4>
        <div class="acc-row">
          <button class="acc-btn ghost acc-btn-flex" data-act="pull-songs">⬇ Bajar canciones</button>
          <button class="acc-btn acc-btn-flex" data-act="push-songs">⬆ Subir mis canciones</button>
        </div>
        <div class="acc-hint">Subir copia tus canciones locales a la nube (las comparte con tu equipo). Bajar trae las de la librería a este equipo.</div>
      </div>

      <div class="acc-section">
        <h4>Servicios compartidos</h4>
        <div id="acc-setlists"><div class="acc-empty">Cargando…</div></div>
        <div class="acc-row">
          <button class="acc-btn acc-btn-flex" data-act="save-setlist">☁ Guardar servicio actual</button>
        </div>
        <div class="acc-hint">Guarda el orden del servicio actual para que tu equipo lo cargue. Solo incluye canciones que estén en la nube.</div>
      </div>
    </div>

    <!-- TAB: EQUIPO — miembros + invitaciones (solo si owner de la lib activa) -->
    <div class="acc-tab-panel ${state.activeTab !== 'equipo' ? 'hidden' : ''}" data-panel="equipo">
      <div class="acc-section" id="acc-manage"></div>
    </div>

    <div class="acc-msg" id="acc-msg"></div>
  `;
  await refreshLibs();
}

async function refreshLibs() {
  const box = overlay.querySelector('#acc-libs');
  try {
    state.libs = await listLibraries() || [];
    // No auto-creamos librería: una cuenta nueva arranca limpia. El usuario
    // crea la suya manualmente o se une a una vía código de invitación.
  } catch (e) { box.innerHTML = `<div class="acc-empty">No se pudieron cargar (${escapeHtml(e.message)})</div>`; return; }
  state.activeId = getActiveLibraryId();
  if (!state.activeId && state.libs[0]) { state.activeId = state.libs[0].id; setActiveLibraryId(state.activeId); }

  const uid = getUser()?.id;
  if (!state.libs.length) {
    box.innerHTML = `<div class="acc-empty">Aún no tienes librerías.<br>
      <span style="color:var(--text-dim)">Crea una abajo, o si te invitaron pega tu código en "Unirme a una librería".</span></div>`;
  } else {
    box.innerHTML = state.libs.map(l => `
      <div class="acc-lib ${l.id === state.activeId ? 'active' : ''}" data-lib="${l.id}">
        <span class="lib-name">${escapeHtml(l.name)}</span>
        <span class="lib-badge">${l.owner_id === uid ? 'Propietario' : 'Invitado'}</span>
        ${l.id === state.activeId ? '<span class="lib-check">✓</span>' : ''}
      </div>`).join('');
  }
  await renderManage();
  await renderSetlists();
  // Avisa al selector de repertorio (cabecera de Librería) para que se actualice.
  try { window.dispatchEvent(new Event('livepads:libraries-changed')); } catch (_) {}
}

// Lista los setlists/servicios compartidos de la librería activa.
async function renderSetlists() {
  const box = overlay.querySelector('#acc-setlists');
  if (!box) return;
  if (!state.activeId) { box.innerHTML = '<div class="acc-empty">Elige una librería.</div>'; return; }
  let rows;
  try { rows = await listSharedSetlists(); }
  catch (e) { box.innerHTML = `<div class="acc-empty">No se pudieron cargar.</div>`; return; }
  if (!rows.length) { box.innerHTML = '<div class="acc-empty">Aún no hay servicios guardados.</div>'; return; }
  box.innerHTML = rows.map(s => `
    <div class="acc-member">
      <span class="m-email">${escapeHtml(s.name)} · ${(s.song_ids || []).length} canciones</span>
      <button class="acc-btn ghost sm" data-act="load-setlist" data-id="${s.id}">Cargar</button>
      <button class="acc-btn danger sm" data-act="del-setlist" data-id="${s.id}">Borrar</button>
    </div>`).join('');
}

// Gestión de la librería activa (miembros + invitaciones) — solo si eres dueño.
async function renderManage() {
  const wrap = overlay.querySelector('#acc-manage');
  if (!wrap) return;
  const active = state.libs.find(l => l.id === state.activeId);
  const uid = getUser()?.id;
  if (!active) {
    wrap.innerHTML = `<h4>Equipo</h4>
      <div class="acc-empty">Selecciona una librería en la pestaña <b>Librerías</b> para gestionar su equipo.</div>`;
    return;
  }
  const isOwner = active.owner_id === uid;

  if (!isOwner) {
    wrap.innerHTML = `<h4>${escapeHtml(active.name)}</h4>
      <div class="acc-empty">Eres invitado en esta librería. Solo el propietario gestiona miembros.</div>
      <div class="acc-row"><button class="acc-btn danger acc-btn-flex" data-act="leave-lib" data-lib="${active.id}">Salir de esta librería</button></div>`;
    return;
  }

  wrap.innerHTML = `
    <h4>Equipo de "${escapeHtml(active.name)}"</h4>
    <div id="acc-members"><div class="acc-empty">Cargando miembros…</div></div>

    <div class="acc-row">
      <input id="acc-inv-email" type="email" placeholder="correo@persona.com">
      <select id="acc-inv-role">
        <option value="viewer">Solo ver</option>
        <option value="editor">Editar</option>
      </select>
      <button class="acc-btn" data-act="invite">Invitar</button>
    </div>
    <div id="acc-invites"></div>

    <div class="acc-foot">
      <button class="acc-btn ghost sm" data-act="rename-lib">Renombrar</button>
      <button class="acc-btn danger sm" data-act="delete-lib">Eliminar librería</button>
    </div>
  `;
  await Promise.all([renderMembers(active.id), renderInvites(active.id)]);
}

async function renderMembers(libId) {
  const box = overlay.querySelector('#acc-members');
  if (!box) return;
  let members;
  try { members = await listMembers(libId) || []; }
  catch (e) { box.innerHTML = `<div class="acc-empty">${escapeHtml(e.message)}</div>`; return; }
  const uid = getUser()?.id;
  box.innerHTML = members.map(m => {
    const email = m.profiles?.email || m.profiles?.display_name || '—';
    const isOwner = m.role === 'owner';
    const isSelf = m.user_id === uid;
    return `<div class="acc-member">
      <span class="m-email">${escapeHtml(email)}${isSelf ? ' (tú)' : ''}</span>
      <span class="acc-role-tag ${isOwner ? 'owner' : ''}">${isOwner ? 'Propietario' : (m.role === 'editor' ? 'Editor' : 'Solo ver')}</span>
      ${(!isOwner) ? `<button class="acc-btn danger sm" data-act="kick" data-id="${m.id}">Quitar</button>` : ''}
    </div>`;
  }).join('') || '<div class="acc-empty">Sin miembros.</div>';
}

async function renderInvites(libId) {
  const box = overlay.querySelector('#acc-invites');
  if (!box) return;
  let invites;
  try { invites = await listInvites(libId) || []; }
  catch (e) { box.innerHTML = ''; return; }
  const pending = invites.filter(i => i.status === 'pending');
  if (!pending.length) { box.innerHTML = ''; return; }
  // Cada invitación pendiente: cabecera con email/rol y el código visible en
  // un input readonly + botón "Copiar". Reduce fricción cuando hay que
  // compartirlo manualmente (chat, mensaje de voz, etc.).
  box.innerHTML = pending.map(i => `
    <div class="acc-invite">
      <div class="acc-invite-head">
        <span class="i-email">${escapeHtml(i.email)}</span>
        <span class="acc-role-tag ${i.role === 'editor' ? '' : ''}">${i.role === 'editor' ? 'Editor' : 'Solo ver'}</span>
        <button class="acc-btn danger sm" data-act="revoke" data-id="${i.id}" title="Anular invitación">Anular</button>
      </div>
      <div class="acc-invite-code">
        <input type="text" readonly value="${escapeHtml(i.token)}" class="acc-code-input" aria-label="Código de invitación" data-act="select-code">
        <button class="acc-btn ghost sm" data-act="copy-code" data-code="${escapeHtml(i.token)}">Copiar</button>
        <button class="acc-btn sm" data-act="mail-invite" data-email="${escapeHtml(i.email)}" data-code="${escapeHtml(i.token)}">Enviar correo</button>
      </div>
    </div>`).join('');
}

// ── Acciones ────────────────────────────────────────────────────────────────
async function onClick(e) {
  const tabBtn = e.target.closest('.acc-tab[data-tab]');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
  const btn = e.target.closest('[data-act]');
  if (btn) {
    const act = btn.dataset.act;
    try {
      switch (act) {
        case 'close': return close();
        case 'signout':
          await signOut();
          close();
          await openAuthGate();
          return;
        case 'change-pass': {
          showDialog('Cambiar contraseña', 'Nueva contraseña (mín. 6)', async (val) => {
            const pass = (val || '').trim();
            if (pass.length < 6) return msg('La contraseña debe tener al menos 6 caracteres.');
            try { await updatePassword(pass); msg('Contraseña actualizada.', 'ok'); }
            catch (e2) { msg(e2.message); }
          });
          return;
        }
        case 'delete-account': {
          const ok = await confirmDialogAsync({
            title: 'Eliminar mi cuenta',
            message: 'Esto borra tu cuenta y tus datos (librerías propias, canciones y configuración) de forma permanente. ¿Continuar?',
            confirmLabel: 'Eliminar cuenta', danger: true,
          });
          if (!ok) return;
          try {
            await deleteAccount();
            close();
            await openAuthGate();
          } catch (e2) { msg(e2.message || 'No se pudo eliminar la cuenta.'); }
          return;
        }
        case 'leave-lib': {
          const ok = await confirmDialogAsync({
            title: 'Salir de la librería',
            message: 'Dejarás de ver el repertorio compartido de esta librería. ¿Continuar?',
            confirmLabel: 'Salir', danger: true,
          });
          if (!ok) return;
          await leaveLibrary(btn.dataset.lib);
          msg('Saliste de la librería.', 'ok');
          return refreshLibs();
        }
        case 'save-setlist': {
          showDialog('Guardar servicio', 'Nombre del servicio…', async (val) => {
            try {
              const r = await saveServiceAsSetlist(val);
              msg(`Servicio guardado (${r.saved} canciones${r.skipped ? `, ${r.skipped} omitidas por no estar en la nube` : ''}).`, 'ok');
              await renderSetlists();
            } catch (e2) { msg(e2.message); }
          });
          return;
        }
        case 'load-setlist': {
          try {
            // Acción directa de red: botón ocupado para evitar doble-clic (que
            // cargaba el servicio dos veces).
            const r = await withBusy(btn, '⟳ Cargando…', () => loadSharedSetlist(btn.dataset.id));
            msg(`Servicio cargado (${r.loaded} canciones${r.missing ? `, ${r.missing} no están en este equipo — baja las canciones` : ''}).`, 'ok');
          } catch (e2) { msg(e2.message); }
          return;
        }
        case 'del-setlist': {
          const ok = await confirmDialogAsync({ title: 'Borrar servicio', message: '¿Borrar este servicio compartido para todo el equipo?', confirmLabel: 'Borrar', danger: true });
          if (!ok) return;
          try { await deleteSharedSetlist(btn.dataset.id); await renderSetlists(); msg('Servicio borrado.', 'ok'); }
          catch (e2) { msg(e2.message); }
          return;
        }
        case 'link-google': {
          btn.disabled = true; const lbl = btn.textContent; btn.textContent = 'Abriendo Google…';
          try {
            const u = getUser();
            await signInWithGoogle();
            const after = getUser();
            // Si el correo de Google no coincide, Supabase entra a OTRA cuenta.
            if (u && after && after.email && u.email && after.email.toLowerCase() !== u.email.toLowerCase()) {
              msg(`Entraste con otra cuenta de Google (${after.email}). Para vincular, usa el mismo correo: ${u.email}.`, 'error');
            } else {
              msg('¡Google vinculado! La próxima vez entra con el botón de Google.', 'ok');
            }
            await refreshLibs();
          } catch (e2) { msg(e2.message || 'No se pudo vincular Google.'); }
          finally { btn.disabled = false; btn.textContent = lbl; }
          return;
        }
        case 'create-lib': {
          const name = overlay.querySelector('#acc-new-lib').value;
          if (!name.trim()) return msg('Escribe un nombre.');
          const lib = await createLibrary(name);
          setActiveLibraryId(lib.id);
          overlay.querySelector('#acc-new-lib').value = '';
          msg('Librería creada.', 'ok');
          return refreshLibs();
        }
        case 'rename-lib': {
          const active = state.libs.find(l => l.id === state.activeId);
          // Prompt nativo → showDialog tematizado.
          showDialog(`Renombrar "${active ? active.name : ''}"`, 'Nuevo nombre…', async (val) => {
            const name = (val || '').trim();
            if (!name) return;
            try { await renameLibrary(state.activeId, name); msg('Librería renombrada.', 'ok'); await refreshLibs(); }
            catch (e2) { msg(e2.message); }
          });
          return;
        }
        case 'delete-lib': {
          const active = state.libs.find(l => l.id === state.activeId);
          const ok = await confirmDialogAsync({
            title: 'Eliminar librería',
            message: `¿Eliminar "${active?.name}" y todo su contenido? Esto no se puede deshacer.`,
            confirmLabel: 'Eliminar', danger: true,
          });
          if (!ok) return;
          await deleteLibrary(state.activeId);
          msg('Librería eliminada.', 'ok');
          return refreshLibs();
        }
        case 'invite': {
          const email = overlay.querySelector('#acc-inv-email').value;
          const role = overlay.querySelector('#acc-inv-role').value;
          if (!email.trim()) return msg('Escribe el correo de la persona.');
          const inv = await createInvite(state.activeId, email, role);
          overlay.querySelector('#acc-inv-email').value = '';
          await renderInvites(state.activeId);
          if (inv && inv.token) {
            try { await navigator.clipboard.writeText(inv.token); } catch (_) {}
            const how = await sendInvite(inv.email || email, inv.token);
            msg(how === 'sent'
              ? `Invitación enviada por correo a ${inv.email || email}. (El código también quedó copiado.)`
              : 'Invitación creada. Se abrió tu correo para enviarla (y el código quedó copiado).', 'ok');
          }
          return;
        }
        case 'copy-code':
          try { await navigator.clipboard.writeText(btn.dataset.code); msg('Código copiado al portapapeles.', 'ok'); } catch (_) {}
          return;
        case 'select-code':
          try { btn.select(); } catch (_) {}
          return;
        case 'mail-invite': {
          const how = await sendInvite(btn.dataset.email, btn.dataset.code);
          msg(how === 'sent'
            ? `Invitación enviada por correo a ${btn.dataset.email}.`
            : 'Se abrió tu correo con la invitación lista para enviar.', 'ok');
          return;
        }
        case 'revoke':
          await revokeInvite(btn.dataset.id);
          return renderInvites(state.activeId);
        case 'kick': {
          const ok = await confirmDialogAsync({
            title: 'Quitar miembro',
            message: '¿Quitar a este miembro de la librería?',
            confirmLabel: 'Quitar', danger: true,
          });
          if (!ok) return;
          await removeMember(btn.dataset.id);
          return renderMembers(state.activeId);
        }
        case 'join': {
          const code = overlay.querySelector('#acc-join-code').value;
          if (!code.trim()) return msg('Pega el código de invitación.');
          await acceptInvite(code);
          overlay.querySelector('#acc-join-code').value = '';
          msg('¡Te uniste a la librería!', 'ok');
          return refreshLibs();
        }
        case 'push-songs': {
          btn.disabled = true; const lbl = btn.textContent;
          try {
            // Cuenta local visible para que el usuario sepa el tamaño del lote
            // antes de que termine (push es una sola request bulk, así que no
            // hay "progreso real", pero el conteo da contexto).
            const { getSongs } = await import('../state/store.js');
            const total = getSongs().length;
            btn.textContent = `⟳ Subiendo ${total} canciones…`;
            const { pushLibrarySongs } = await import('./songSync.js');
            const r = await pushLibrarySongs();
            msg(`Subidas ${r.created} nuevas, actualizadas ${r.updated}${r.linked ? `, vinculadas ${r.linked} (ya existían)` : ''}.`, 'ok');
          } finally { btn.disabled = false; btn.textContent = lbl; }
          return;
        }
        case 'pull-songs': {
          btn.disabled = true; const lbl = btn.textContent;
          try {
            btn.textContent = '⟳ Bajando canciones…';
            const { pullLibrarySongs } = await import('./songSync.js');
            const r = await pullLibrarySongs();
            msg(`Añadidas ${r.added}, actualizadas ${r.refreshed}${r.linked ? `, vinculadas ${r.linked} (ya las tenías)` : ''}.`, 'ok');
          } finally { btn.disabled = false; btn.textContent = lbl; }
          return;
        }
      }
    } catch (err) { msg(err.message || 'Algo salió mal.'); }
    return;
  }
  // click en una librería de la lista → activarla
  const libRow = e.target.closest('.acc-lib[data-lib]');
  if (libRow) {
    state.activeId = libRow.dataset.lib;
    setActiveLibraryId(state.activeId);
    refreshLibs();
  }
}

// ── API pública ───────────────────────────────────────────────────────────
export async function openAccountPanel() {
  if (!isCloudEnabled()) {
    if (window.showToast) window.showToast('La nube no está configurada en esta versión.', 'info');
    return;
  }
  if (!isLoggedIn()) {
    // Aún no ha entrado: muéstrale la pantalla de login primero.
    const user = await openAuthGate();
    if (!user) return; // eligió seguir en modo local
  }
  ensureOverlay();
  overlay.classList.remove('hidden');
  overlay.removeEventListener('click', onClick);
  overlay.addEventListener('click', onClick);
  if (popModal) { popModal(); popModal = null; }
  popModal = pushModal(() => close());
  await render();
}
