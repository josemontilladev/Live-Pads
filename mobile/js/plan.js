// ─────────────────────────────────────────────────────────────────────────
// Planes en LivePads Móvil (web). La app móvil es la compañera del equipo:
// no bloquea nada, solo muestra el plan de la cuenta, avisa una vez de que
// ahora hay planes y deja suscribirse a Pro (PayPal) desde el teléfono.
// El plan Iglesia lo contrata el dueño de la librería desde LivePads en su PC.
// ─────────────────────────────────────────────────────────────────────────

import { invokeFunction, isLoggedIn } from './supabase.js';

const SEEN_KEY = 'lpm.plans.announced.v1';
const MISSION = 'Cada suscripción sirve para seguir mejorando LivePads y ser de bendición para toda la comunidad cristiana: más funciones, más innovación y una app que evoluciona cada día hasta ser la app definitiva para la alabanza en las iglesias.';
const $ = (id) => document.getElementById(id);
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
let info = null;
let pollTimer = null;

function daysLeft(until) {
  const d = (new Date(until).getTime() - Date.now()) / 864e5;
  return d <= 0 ? 0 : d > 1 ? Math.round(d) : 1;
}

function chipText(i) {
  if (!i) return '';
  if (i.source === 'comp') return 'Pro';
  if (i.source === 'church') return 'Iglesia';
  if (i.status === 'trial') return `Prueba · ${daysLeft(i.until)} d`;
  if (i.plan === 'pro' || i.plan === 'church') return i.plan === 'church' ? 'Iglesia' : 'Pro';
  return 'Gratis';
}

function statusText(i) {
  if (!i) return 'No se pudo consultar tu plan (sin conexión).';
  if (i.source === 'comp') return 'Tienes <b>Pro de cortesía</b> del equipo GI, sin fecha de fin. ¡Gracias por servir!';
  if (i.source === 'church') return 'Tu iglesia te incluye en su plan <b>Iglesia</b>.';
  if (i.status === 'trial') {
    return i.founder
      ? `Como <b>fundador</b> tienes <b>Pro gratis hasta el ${fmt(i.until)}</b>. Después podrás seguir con Pro a <b>mitad de precio para siempre</b>.`
      : `Estás probando <b>Pro</b>: te quedan <b>${daysLeft(i.until)} días</b>, sin tarjeta.`;
  }
  if (i.plan !== 'free') {
    const name = i.plan === 'church' ? 'Iglesia' : 'Pro';
    if (i.status === 'canceled') return `Plan <b>${name}</b> cancelado: sigue activo hasta el ${fmt(i.until)}.`;
    if (i.status === 'past_due') return 'PayPal no pudo cobrar tu renovación. Revisa tu método de pago.';
    return `Plan <b>${name}</b> activo · renueva el ${fmt(i.until)}.`;
  }
  return 'Estás en el plan <b>Gratis</b>. Con <b>Pro</b> tienes canciones ilimitadas, Stems, todos los pads, el detector de acordes y la sincronización con tu equipo en LivePads para PC.';
}

const canBuy = (i) => i && i.plan === 'free' || (i && i.status === 'trial');
const price = (f, normal, founder) => (f ? `<s>${normal}</s> ${founder}` : normal);

function ensureSheet() {
  let el = $('plan-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'plan-sheet';
  el.className = 'sheet hidden';
  el.innerHTML = '<div class="sheet-card plan-card"></div>';
  el.addEventListener('click', onClick);
  document.body.appendChild(el);
  return el;
}

function render(title) {
  const el = ensureSheet();
  const f = !!info?.founder;
  el.querySelector('.plan-card').innerHTML = `
    <h3>${title || 'Tu plan de LivePads'}</h3>
    <p class="plan-status">${statusText(info)}</p>
    ${canBuy(info) ? `
      <div class="plan-buy">
        <button type="button" class="btn-primary" data-buy="year">Pro anual · ${price(f, '$49.99', '$24.99')}</button>
        <button type="button" class="btn-ghost" data-buy="month">Pro mensual · ${price(f, '$6.99', '$3.49')}</button>
      </div>
      <p class="plan-note">El plan <b>Iglesia</b> (5 miembros) lo contrata el dueño de la librería desde LivePads en su PC.</p>` : ''}
    <p class="plan-mission">🙏 ${MISSION}</p>
    <p class="plan-msg" id="plan-msg"></p>
    <div class="plan-foot">
      ${info && info.plan !== 'free' && info.source === 'own' ? '<button type="button" class="btn-ghost" data-act="manage">Administrar pago</button>' : ''}
      ${isLoggedIn() ? '<button type="button" class="btn-ghost" data-act="sync">Ya pagué · comprobar</button>' : ''}
      <a class="btn-ghost plan-link" href="https://livepads.online/#precios" target="_blank" rel="noopener">Ver planes</a>
      <button type="button" class="btn-ghost" data-act="close">Cerrar</button>
    </div>`;
  el.classList.remove('hidden');
}

function msg(t) { const m = $('plan-msg'); if (m) m.textContent = t; }

function paint() {
  const chip = $('btn-plan');
  if (chip) { chip.textContent = chipText(info) || 'Plan'; chip.classList.toggle('is-pro', !!info && info.plan !== 'free'); }
}

async function refresh(action = 'status', extra = {}) {
  const r = await invokeFunction('billing', { action, ...extra });
  if (r && r.plan) { info = r; paint(); }
  return r;
}

async function onClick(e) {
  const el = $('plan-sheet');
  const t = e.target.closest('button');
  if (e.target === el || t?.dataset.act === 'close') {
    el.classList.add('hidden');
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) {}
    return;
  }
  if (!t) return;
  if (t.dataset.buy) {
    msg('Abriendo PayPal…');
    // Se abre la ventana ya (antes del await) para que el navegador no la bloquee.
    const w = window.open('', '_blank');
    try {
      const r = await invokeFunction('billing', { action: 'subscribe', plan: 'pro', interval: t.dataset.buy });
      if (!r?.approveUrl) throw new Error(r?.error || 'Sin enlace de pago');
      if (w) w.location = r.approveUrl; else location.href = r.approveUrl;
      msg('Completa el pago en PayPal y vuelve aquí: tu plan se activa solo.');
      clearInterval(pollTimer);
      let n = 0;
      pollTimer = setInterval(async () => {
        if (++n > 120) return clearInterval(pollTimer);
        try {
          const s = await refresh('sync', { subId: r.subId });
          if (s?.plan === 'pro' && s.source === 'own') { clearInterval(pollTimer); render('¡Gracias por apoyar LivePads!'); }
        } catch (_) {}
      }, 5000);
    } catch (err) {
      if (w) w.close();
      msg(`No se pudo iniciar el pago: ${err.message || err}`);
    }
    return;
  }
  if (t.dataset.act === 'sync') {
    msg('Comprobando…');
    try { await refresh('sync'); render(); msg('Plan actualizado.'); } catch (err) { msg(err.message || String(err)); }
  }
  if (t.dataset.act === 'manage') {
    try { const r = await invokeFunction('billing', { action: 'manage' }); window.open(r.url, '_blank'); } catch (err) { msg(err.message || String(err)); }
  }
}

export function openPlanSheet() { render(); }

/** Tras entrar a la librería: consulta el plan, pinta el chip y avisa una vez. */
export async function initPlan() {
  const chip = $('btn-plan');
  if (chip && !chip.dataset.bound) { chip.dataset.bound = '1'; chip.addEventListener('click', () => render()); }
  if (!isLoggedIn() || !navigator.onLine) return;
  try { await refresh('status'); } catch (_) { return; }
  let seen = false;
  try { seen = !!localStorage.getItem(SEEN_KEY); } catch (_) {}
  if (!seen) render(info?.source === 'comp' ? 'Tienes LivePads Pro de cortesía' : 'LivePads ahora tiene planes');
}
