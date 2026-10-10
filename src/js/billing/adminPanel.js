// ─────────────────────────────────────────────────────────────────────────
// Panel de administración de suscripciones (solo administradores).
// Habla con la función `admin`, que vuelve a comprobar el correo en el servidor:
// este panel solo es la interfaz.
// ─────────────────────────────────────────────────────────────────────────

import { invokeFunction } from '../cloud/supabase.js';
import { pushModal } from '../ui/modalStack.js';
import { confirmDialogAsync } from '../ui/dialog.js';

let overlay = null;
let popModal = null;
let data = null;      // { stats, rows }
let payments = null;  // filas de lp_payments
let tab = 'cuentas';
let filter = 'all';
let query = '';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function ensureCss() {
  if (document.getElementById('plans-css')) return;
  const l = document.createElement('link');
  l.id = 'plans-css'; l.rel = 'stylesheet'; l.href = 'css/modules/_plans.css';
  document.head.appendChild(l);
}

const admin = (action, extra = {}) => invokeFunction('admin', { action, ...extra });

function msg(text, kind = '') {
  const m = overlay?.querySelector('.adm-msg');
  if (m) { m.textContent = text; m.className = `adm-msg ${kind}`; }
}

function untilText(r) {
  if (r.kind === 'comp') return 'Sin fecha de fin';
  if (r.kind === 'trial') return `Hasta ${fmtDate(r.until)}`;
  if (r.kind === 'paid') return `${r.status === 'canceled' ? 'Termina' : 'Renueva'} ${fmtDate(r.until)}`;
  return '';
}

function rowsHTML() {
  const q = query.trim().toLowerCase();
  const list = (data?.rows || []).filter((r) => (filter === 'all' || r.kind === filter) &&
    (!q || String(r.email).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q)));
  if (!list.length) return '<div class="adm-empty">Sin resultados.</div>';
  return list.slice(0, 300).map((r) => `
    <div class="adm-row" data-id="${esc(r.id)}">
      <div class="adm-who">
        <b>${esc(r.email)}</b>
        <span>${esc(r.name || '')}${r.name ? ' · ' : ''}alta ${fmtDate(r.created)}${r.lastSeen ? ` · última vez ${fmtDate(r.lastSeen)}` : ''}</span>
      </div>
      <div class="adm-plan">
        <span class="adm-badge adm-${esc(r.kind)}">${esc(r.kind === 'free' ? 'Gratis' : `${r.plan === 'church' ? 'Iglesia' : 'Pro'} · ${r.label}`)}</span>
        <span class="adm-until">${esc([untilText(r), r.founder ? 'Fundador' : '', r.kind === 'paid' && r.interval ? (r.interval === 'year' ? 'anual' : 'mensual') : ''].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="adm-acts">
        ${r.kind === 'comp'
          ? '<button type="button" class="acc-btn ghost sm" data-act="revoke">Quitar cortesía</button>'
          : r.kind === 'paid' ? '' : '<button type="button" class="acc-btn ghost sm" data-act="comp">Dar cortesía</button>'}
        ${r.kind === 'paid' || r.kind === 'comp' ? '' : '<button type="button" class="acc-btn ghost sm" data-act="trial">+14 días de prueba</button>'}
      </div>
    </div>`).join('') + (list.length > 300 ? `<div class="adm-empty">Mostrando 300 de ${list.length}. Usa la búsqueda.</div>` : '');
}

function paymentsHTML() {
  if (!payments) return '<div class="adm-empty">Cargando…</div>';
  if (!payments.length) return '<div class="adm-empty">Todavía no hay movimientos.</div>';
  const emails = new Map((data?.rows || []).map((r) => [r.id, r.email]));
  const NAMES = {
    'PAYMENT.SALE.COMPLETED': 'Cobro', 'PAYMENT.SALE.REFUNDED': 'Reembolso', 'PAYMENT.SALE.REVERSED': 'Contracargo',
    'BILLING.SUBSCRIPTION.ACTIVATED': 'Suscripción activada', 'BILLING.SUBSCRIPTION.CANCELLED': 'Suscripción cancelada',
    'BILLING.SUBSCRIPTION.SUSPENDED': 'Suspendida (pago fallido)', 'BILLING.SUBSCRIPTION.EXPIRED': 'Expirada',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'Pago fallido', 'BILLING.SUBSCRIPTION.UPDATED': 'Suscripción actualizada',
    'BILLING.SUBSCRIPTION.RE-ACTIVATED': 'Reactivada', 'subscribe.created': 'Abrió el pago', 'cancel.user': 'Canceló desde la app',
    'admin.grant_comp': 'Cortesía dada', 'admin.revoke_comp': 'Cortesía quitada', 'admin.extend_trial': 'Prueba extendida', 'admin.sync_team': 'Cortesía al equipo',
  };
  return payments.map((p) => `
    <div class="adm-row adm-pay">
      <div class="adm-who"><b>${esc(NAMES[p.event] || p.event)}</b><span>${esc(emails.get(p.user_id) || p.user_id || '')}</span></div>
      <div class="adm-plan"><span class="adm-amount">${p.amount != null ? esc(`${money(p.amount)} ${p.currency || ''}`) : ''}</span>
      <span class="adm-until">${esc(new Date(p.created_at).toLocaleString())}</span></div>
    </div>`).join('');
}

function render() {
  const s = data?.stats;
  overlay.querySelector('.pl-panel').innerHTML = `
    <div class="pl-head">
      <h3>Administrar suscripciones</h3>
      <button class="pl-close" type="button" aria-label="Cerrar">✕</button>
    </div>
    <div class="adm-stats">
      ${s ? `
        <div><b>${money(s.mrr)}</b><span>al mes (estimado)</span></div>
        <div><b>${s.paid}</b><span>pagando</span></div>
        <div><b>${s.trial}</b><span>en prueba</span></div>
        <div><b>${s.comp}</b><span>cortesía</span></div>
        <div><b>${s.free}</b><span>gratis</span></div>
        <div><b>${s.total}</b><span>cuentas</span></div>` : '<div class="adm-empty">Cargando…</div>'}
    </div>
    <div class="adm-bar">
      <div class="pl-seg">
        <button type="button" data-tab="cuentas" class="${tab === 'cuentas' ? 'on' : ''}">Cuentas</button>
        <button type="button" data-tab="pagos" class="${tab === 'pagos' ? 'on' : ''}">Movimientos</button>
      </div>
      ${tab === 'cuentas' ? `
        <input class="adm-q" type="search" placeholder="Buscar por correo o nombre…" value="${esc(query)}">
        <select class="adm-filter">
          ${[['all', 'Todas'], ['paid', 'Pagando'], ['trial', 'En prueba'], ['comp', 'Cortesía'], ['free', 'Gratis']]
            .map(([v, t]) => `<option value="${v}" ${filter === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <button type="button" class="acc-btn sm" data-act="sync-team" title="Da Pro de cortesía a todos los miembros de tus librerías">Cortesía a mi equipo</button>` : ''}
      <button type="button" class="acc-btn ghost sm" data-act="reload">Actualizar</button>
    </div>
    <div class="adm-msg" aria-live="polite"></div>
    <div class="adm-list">${tab === 'cuentas' ? (data ? rowsHTML() : '<div class="adm-empty">Cargando…</div>') : paymentsHTML()}</div>
  `;
}

function renderList() {
  const l = overlay?.querySelector('.adm-list');
  if (l) l.innerHTML = tab === 'cuentas' ? rowsHTML() : paymentsHTML();
}

async function load() {
  try {
    data = await admin('overview');
    if (tab === 'pagos') payments = (await admin('payments', { limit: 100 })).rows;
    render();
  } catch (e) {
    render();
    msg(`No se pudo cargar: ${(e && e.message) || e}`, 'error');
  }
}

async function act(name, id) {
  const row = data?.rows.find((r) => r.id === id);
  const who = row ? row.email : '';
  try {
    if (name === 'comp') {
      if (!(await confirmDialogAsync({ title: 'Dar Pro de cortesía', message: `${who} tendrá Pro gratis sin fecha de fin.`, confirmLabel: 'Dar cortesía', danger: false }))) return;
      const r = await admin('grant_comp', { userId: id });
      msg(r.skipped ? `No se cambió: ${r.skipped}.` : `Cortesía dada a ${who}.`, r.skipped ? '' : 'ok');
    } else if (name === 'revoke') {
      if (!(await confirmDialogAsync({ title: 'Quitar cortesía', message: `${who} pasará al plan Gratis (o a su prueba, si le queda).`, confirmLabel: 'Quitar' }))) return;
      await admin('revoke_comp', { userId: id });
      msg(`Cortesía quitada a ${who}.`, 'ok');
    } else if (name === 'trial') {
      const r = await admin('extend_trial', { userId: id, days: 14 });
      msg(`${who}: prueba hasta el ${fmtDate(r.until)}.`, 'ok');
    } else if (name === 'sync-team') {
      if (!(await confirmDialogAsync({ title: 'Cortesía a mi equipo', message: 'Todos los miembros de tus librerías tendrán Pro gratis (no cambia a quien ya paga).', confirmLabel: 'Aplicar', danger: false }))) return;
      const r = await admin('sync_team');
      msg(`Equipo: ${r.granted} con cortesía${r.skipped ? `, ${r.skipped} sin cambios` : ''} (de ${r.total} miembros).`, 'ok');
    }
    data = await admin('overview');
    const keepMsg = overlay.querySelector('.adm-msg')?.outerHTML;
    render();
    if (keepMsg) overlay.querySelector('.adm-msg').outerHTML = keepMsg;
  } catch (e) {
    msg(`Error: ${(e && e.message) || e}`, 'error');
  }
}

async function onClick(e) {
  const t = e.target.closest('button');
  if (e.target === overlay || (t && t.classList.contains('pl-close'))) { close(); return; }
  if (!t) return;
  if (t.dataset.tab) {
    tab = t.dataset.tab;
    render();
    if (tab === 'pagos' && !payments) {
      try { payments = (await admin('payments', { limit: 100 })).rows; } catch (err) { payments = []; msg(String(err.message || err), 'error'); }
      renderList();
    }
    return;
  }
  if (t.dataset.act === 'reload') { payments = null; msg('Actualizando…'); await load(); return; }
  if (t.dataset.act === 'sync-team') { act('sync-team'); return; }
  const row = t.closest('.adm-row');
  if (row && t.dataset.act) act(t.dataset.act, row.dataset.id);
}

function onInput(e) {
  if (e.target.classList.contains('adm-q')) { query = e.target.value; renderList(); }
  if (e.target.classList.contains('adm-filter')) { filter = e.target.value; renderList(); }
}

function close() {
  if (popModal) { popModal(); popModal = null; }
  overlay?.remove();
  overlay = null;
}

export function openAdminPanel() {
  if (overlay) return;
  ensureCss();
  overlay = document.createElement('div');
  overlay.id = 'admin-overlay';
  overlay.className = 'adm-overlay';
  overlay.innerHTML = '<div class="pl-panel adm-panel" role="dialog" aria-label="Administrar suscripciones"></div>';
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('input', onInput);
  overlay.addEventListener('change', onInput);
  document.body.appendChild(overlay);
  data = null; payments = null;
  render();
  requestAnimationFrame(() => overlay?.classList.add('open'));
  popModal = pushModal(close, overlay.querySelector('.pl-panel'));
  load();
}
