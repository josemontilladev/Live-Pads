// ─────────────────────────────────────────────────────────────────────────
// Ventana de planes: Gratis / Pro / Iglesia, mensual o anual.
// Pagar abre PayPal en el navegador; mientras tanto la ventana pregunta cada
// pocos segundos si ya se activó (y el webhook lo confirma en el servidor).
// ─────────────────────────────────────────────────────────────────────────

import { PRICES, PLAN_NAMES } from './plans.js';
import { getPlanInfo, callBilling, refreshLicense } from './license.js';
import { isLoggedIn, getUser } from '../cloud/supabase.js';
import { getCachedLibraries, getActiveLibraryId } from '../cloud/libraries.js';
import { pushModal } from '../ui/modalStack.js';
import { confirmDialogAsync } from '../ui/dialog.js';

let overlay = null;
let popModal = null;
let pollTimer = null;
let interval = 'year';
let reason = '';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${n.toFixed(2)}`;

function ensureCss() {
  if (document.getElementById('plans-css')) return;
  const l = document.createElement('link');
  l.id = 'plans-css'; l.rel = 'stylesheet'; l.href = 'css/modules/_plans.css';
  document.head.appendChild(l);
}

function ownedLibraries() {
  const uid = getUser()?.id;
  return (getCachedLibraries() || []).filter((l) => l.owner_id === uid);
}

function priceBlock(plan, info) {
  const p = PRICES[plan];
  const f = info.founder;
  const reg = interval === 'year' ? p.year : p.month;
  const now = f ? (interval === 'year' ? p.founderYear : p.founderMonth) : reg;
  const per = interval === 'year' ? '/año' : '/mes';
  const monthly = interval === 'year' ? `<span class="pl-sub">${money(now / 12)} al mes</span>` : '';
  return `<div class="pl-price">${f ? `<s>${money(reg)}</s>` : ''}<b>${money(now)}</b><span>${per}</span></div>${monthly}`;
}

function statusLine(info) {
  if (!isLoggedIn()) return 'Crea tu cuenta gratis y prueba Pro 14 días, sin tarjeta.';
  if (info.status === 'trial') return `Prueba Pro: te quedan ${info.trialDaysLeft} día${info.trialDaysLeft === 1 ? '' : 's'}.`;
  if (info.source === 'church') return 'Tu iglesia te incluye en su plan.';
  if (info.source === 'comp') return 'Tienes Pro de cortesía del equipo GI. ¡Gracias por servir!';
  if (info.plan !== 'free') {
    const until = info.until ? new Date(info.until).toLocaleDateString() : '';
    if (info.status === 'canceled') return `Plan ${PLAN_NAMES[info.plan]} cancelado: sigue activo hasta el ${until}.`;
    if (info.status === 'past_due') return 'PayPal no pudo cobrar la renovación. Revisa tu método de pago.';
    return `Plan ${PLAN_NAMES[info.plan]} activo${until ? ` · renueva el ${until}` : ''}.`;
  }
  return 'Estás en el plan Gratis.';
}

function render() {
  const info = getPlanInfo();
  const libs = isLoggedIn() ? ownedLibraries() : [];
  const active = getActiveLibraryId();
  const paidOwn = info.plan !== 'free' && info.source === 'own';
  const cur = (plan) => info.plan === plan && (info.source === 'own' || info.source === 'comp' || (plan === 'pro' && info.status === 'trial'));

  overlay.querySelector('.pl-panel').innerHTML = `
    <div class="pl-head">
      <h3>Planes de LivePads</h3>
      <button class="pl-close" type="button" aria-label="Cerrar">✕</button>
    </div>
    ${reason ? `<div class="pl-reason">${esc(reason)}</div>` : ''}
    <div class="pl-status">${esc(statusLine(info))}${info.founder ? ' <span class="pl-founder">Fundador · 50 % para siempre</span>' : ''}</div>
    <div class="pl-seg" role="tablist">
      <button type="button" data-int="month" class="${interval === 'month' ? 'on' : ''}">Mensual</button>
      <button type="button" data-int="year" class="${interval === 'year' ? 'on' : ''}">Anual <em>ahorra hasta 40 %</em></button>
    </div>
    <div class="pl-cards">
      <div class="pl-card ${info.plan === 'free' ? 'is-current' : ''}">
        <h4>Gratis</h4>
        <div class="pl-price"><b>$0</b></div>
        <ul>
          <li>Hasta 10 canciones</li>
          <li>Pad de Chris Rocha</li>
          <li>Metrónomo, afinador y modo en vivo</li>
        </ul>
        ${info.plan === 'free' ? '<div class="pl-tag">Tu plan</div>' : ''}
      </div>
      <div class="pl-card pl-card--pro ${cur('pro') ? 'is-current' : ''}">
        <h4>Pro</h4>
        ${priceBlock('pro', info)}
        <ul>
          <li>Canciones ilimitadas</li>
          <li>Todos los bancos de pads</li>
          <li>Stems (multipistas)</li>
          <li>Detector de acordes y YouTube</li>
          <li>Sincronización en la nube</li>
        </ul>
        ${cur('pro') && info.status !== 'trial' ? '<div class="pl-tag">Tu plan</div>'
          : `<button type="button" class="acc-btn pl-buy" data-plan="pro">${paidOwn ? 'Cambiar a Pro' : 'Elegir Pro'}</button>`}
      </div>
      <div class="pl-card ${cur('church') ? 'is-current' : ''}">
        <h4>Iglesia</h4>
        ${priceBlock('church', info)}
        <ul>
          <li>Todo lo de Pro</li>
          <li>Para 5 miembros de tu librería</li>
          <li>Servicios compartidos con el equipo</li>
        </ul>
        ${cur('church') ? '<div class="pl-tag">Tu plan</div>' : libs.length
          ? `<select class="pl-lib">${libs.map((l) => `<option value="${esc(l.id)}" ${l.id === active ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
             <button type="button" class="acc-btn pl-buy" data-plan="church">Elegir Iglesia</button>`
          : `<div class="pl-hint">${isLoggedIn() ? 'Crea una librería en Mi cuenta para contratarlo.' : ''}</div>`}
      </div>
    </div>
    <div class="pl-foot">
      ${!isLoggedIn() ? '<button type="button" class="acc-btn pl-login">Crear cuenta / Iniciar sesión</button>' : ''}
      ${paidOwn ? '<button type="button" class="acc-btn ghost sm pl-manage">Administrar pago en PayPal</button>' : ''}
      ${paidOwn && info.status !== 'canceled' ? '<button type="button" class="acc-btn ghost sm pl-cancel">Cancelar renovación</button>' : ''}
      ${isLoggedIn() ? '<button type="button" class="acc-btn ghost sm pl-refresh">Ya pagué · comprobar</button>' : ''}
    </div>
    <div class="pl-msg" aria-live="polite"></div>
    <div class="pl-legal">Pagos seguros con PayPal. Cancela cuando quieras desde aquí o desde PayPal.</div>
  `;
}

function msg(text, kind = '') {
  const m = overlay?.querySelector('.pl-msg');
  if (m) { m.textContent = text; m.className = `pl-msg ${kind}`; }
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function buy(plan) {
  if (!isLoggedIn()) { openLogin(); return; }
  const libraryId = plan === 'church' ? overlay.querySelector('.pl-lib')?.value : undefined;
  msg('Abriendo PayPal…');
  try {
    const r = await callBilling('subscribe', { plan, interval, libraryId });
    if (!r || !r.approveUrl) throw new Error((r && r.error) || 'Sin enlace de pago');
    await window.electronAPI?.openExternal?.(r.approveUrl);
    msg('Completa el pago en el navegador. Esta ventana se actualiza sola al terminar.');
    const subId = r.subId;
    let tries = 0;
    stopPoll();
    pollTimer = setInterval(async () => {
      if (!overlay || ++tries > 120) { stopPoll(); return; } // ~10 min
      try {
        const info = await callBilling('sync', { subId });
        if (info && info.plan === plan && info.source === 'own') {
          stopPoll();
          render();
          msg(`¡Listo! Plan ${PLAN_NAMES[plan]} activado. Gracias por apoyar LivePads.`, 'ok');
        }
      } catch (_) {}
    }, 5000);
  } catch (e) {
    msg(`No se pudo iniciar el pago: ${(e && e.message) || e}`, 'error');
  }
}

function openLogin() {
  close();
  import('../cloud/authUI.js').then((m) => m.openAuthGate()).catch(() => {});
}

async function onClick(e) {
  const t = e.target.closest('button');
  if (e.target === overlay || (t && t.classList.contains('pl-close'))) { close(); return; }
  if (!t) return;
  if (t.dataset.int) { interval = t.dataset.int; render(); return; }
  if (t.classList.contains('pl-buy')) { buy(t.dataset.plan); return; }
  if (t.classList.contains('pl-login')) { openLogin(); return; }
  if (t.classList.contains('pl-manage')) {
    try { const r = await callBilling('manage'); await window.electronAPI?.openExternal?.(r.url); } catch (err) { msg(String(err.message || err), 'error'); }
    return;
  }
  if (t.classList.contains('pl-cancel')) {
    const yes = await confirmDialogAsync({ title: 'Cancelar renovación', message: 'Seguirás teniendo tu plan hasta el final del periodo pagado.', confirmLabel: 'Cancelar renovación', cancelLabel: 'Volver' });
    if (!yes) return;
    try { await callBilling('cancel'); render(); msg('Renovación cancelada.', 'ok'); } catch (err) { msg(String(err.message || err), 'error'); }
    return;
  }
  if (t.classList.contains('pl-refresh')) {
    msg('Comprobando…');
    try { await callBilling('sync'); render(); msg('Plan actualizado.', 'ok'); } catch (err) { msg(String(err.message || err), 'error'); }
  }
}

function close() {
  stopPoll();
  if (popModal) { popModal(); popModal = null; }
  overlay?.remove();
  overlay = null;
  window.removeEventListener('livepads:plan-changed', onPlanChanged);
}
function onPlanChanged() { if (overlay) render(); }

export function openPlansModal({ reason: why = '' } = {}) {
  reason = why;
  if (overlay) { render(); return; }
  ensureCss();
  overlay = document.createElement('div');
  overlay.id = 'plans-overlay';
  overlay.innerHTML = '<div class="pl-panel" role="dialog" aria-label="Planes de LivePads"></div>';
  overlay.addEventListener('click', onClick);
  document.body.appendChild(overlay);
  render();
  requestAnimationFrame(() => overlay?.classList.add('open'));
  popModal = pushModal(close, overlay.querySelector('.pl-panel'));
  window.addEventListener('livepads:plan-changed', onPlanChanged);
  refreshLicense().catch(() => {});
}
