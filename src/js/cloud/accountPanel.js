// ─────────────────────────────────────────────────────────────────────────
// Panel "Mi cuenta y librerías": gestionar librerías (carpetas), invitar al
// equipo y unirse con un código. Se abre desde el menú principal.
// ─────────────────────────────────────────────────────────────────────────

import { isCloudEnabled, isLoggedIn, getUser, signOut } from './supabase.js';
import { openAuthGate } from './authUI.js';
import {
  listLibraries, createLibrary, renameLibrary, deleteLibrary,
  listMembers, removeMember, changeMemberRole,
  listInvites, createInvite, revokeInvite, acceptInvite,
  getActiveLibraryId, setActiveLibraryId,
} from './libraries.js';

let overlay = null;
let state = { libs: [], activeId: null };

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = el(`<div id="account-overlay" class="hidden"><div class="acc-panel" id="acc-panel"></div></div>`);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return overlay;
}

function close() { if (overlay) overlay.classList.add('hidden'); }

function msg(text, kind = 'error') {
  const m = overlay.querySelector('#acc-msg');
  if (!m) return;
  m.textContent = text;
  m.className = `acc-msg show ${kind}`;
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

    <div class="acc-section">
      <h4>Tus librerías</h4>
      <div class="acc-lib-list" id="acc-libs"><div class="acc-empty">Cargando…</div></div>
      <div class="acc-row">
        <input id="acc-new-lib" placeholder="Nombre de una nueva librería…" maxlength="60">
        <button class="acc-btn" data-act="create-lib">Crear</button>
      </div>
    </div>

    <div class="acc-section" id="acc-manage"></div>

    <div class="acc-section">
      <h4>Unirme a una librería</h4>
      <div class="acc-row">
        <input id="acc-join-code" placeholder="Pega aquí el código de invitación…">
        <button class="acc-btn ghost" data-act="join">Unirme</button>
      </div>
    </div>

    <div class="acc-msg" id="acc-msg"></div>
  `;
  await refreshLibs();
}

async function refreshLibs() {
  const box = overlay.querySelector('#acc-libs');
  try {
    state.libs = await listLibraries() || [];
  } catch (e) { box.innerHTML = `<div class="acc-empty">No se pudieron cargar (${escapeHtml(e.message)})</div>`; return; }
  state.activeId = getActiveLibraryId();
  if (!state.activeId && state.libs[0]) { state.activeId = state.libs[0].id; setActiveLibraryId(state.activeId); }

  const uid = getUser()?.id;
  if (!state.libs.length) {
    box.innerHTML = `<div class="acc-empty">Aún no tienes librerías. Crea una abajo.</div>`;
  } else {
    box.innerHTML = state.libs.map(l => `
      <div class="acc-lib ${l.id === state.activeId ? 'active' : ''}" data-lib="${l.id}">
        <span class="lib-name">${escapeHtml(l.name)}</span>
        <span class="lib-badge">${l.owner_id === uid ? 'Propietario' : 'Invitado'}</span>
        ${l.id === state.activeId ? '<span class="lib-check">✓</span>' : ''}
      </div>`).join('');
  }
  await renderManage();
}

// Gestión de la librería activa (miembros + invitaciones) — solo si eres dueño.
async function renderManage() {
  const wrap = overlay.querySelector('#acc-manage');
  const active = state.libs.find(l => l.id === state.activeId);
  const uid = getUser()?.id;
  if (!active) { wrap.innerHTML = ''; return; }
  const isOwner = active.owner_id === uid;

  if (!isOwner) {
    wrap.innerHTML = `<h4>${escapeHtml(active.name)}</h4>
      <div class="acc-empty">Eres invitado en esta librería. Solo el propietario gestiona miembros.</div>`;
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
  box.innerHTML = pending.map(i => `
    <div class="acc-invite">
      <span class="i-email">${escapeHtml(i.email)} · ${i.role === 'editor' ? 'Editor' : 'Solo ver'}</span>
      <button class="acc-btn ghost sm" data-act="copy-code" data-code="${escapeHtml(i.token)}">Copiar código</button>
      <button class="acc-btn danger sm" data-act="revoke" data-id="${i.id}">Anular</button>
    </div>`).join('');
}

// ── Acciones ────────────────────────────────────────────────────────────────
async function onClick(e) {
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
          const name = prompt('Nuevo nombre de la librería:', active ? active.name : '');
          if (name && name.trim()) { await renameLibrary(state.activeId, name); await refreshLibs(); }
          return;
        }
        case 'delete-lib': {
          const active = state.libs.find(l => l.id === state.activeId);
          if (!confirm(`¿Eliminar "${active?.name}" y todo su contenido? Esto no se puede deshacer.`)) return;
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
          msg('Invitación creada. Comparte el código con esa persona (botón "Copiar código").', 'ok');
          await renderInvites(state.activeId);
          if (inv && inv.token) { try { await navigator.clipboard.writeText(inv.token); } catch (_) {} }
          return;
        }
        case 'copy-code':
          try { await navigator.clipboard.writeText(btn.dataset.code); msg('Código copiado al portapapeles.', 'ok'); } catch (_) {}
          return;
        case 'revoke':
          await revokeInvite(btn.dataset.id);
          return renderInvites(state.activeId);
        case 'kick':
          if (!confirm('¿Quitar a este miembro de la librería?')) return;
          await removeMember(btn.dataset.id);
          return renderMembers(state.activeId);
        case 'join': {
          const code = overlay.querySelector('#acc-join-code').value;
          if (!code.trim()) return msg('Pega el código de invitación.');
          await acceptInvite(code);
          overlay.querySelector('#acc-join-code').value = '';
          msg('¡Te uniste a la librería!', 'ok');
          return refreshLibs();
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
  await render();
}
