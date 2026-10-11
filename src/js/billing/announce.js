// ─────────────────────────────────────────────────────────────────────────
// Aviso de una sola vez: «LivePads ahora tiene planes». El texto se adapta a
// cada persona (cortesía, fundador, prueba, sin cuenta). Se marca como visto
// en localStorage para no repetirlo.
// ─────────────────────────────────────────────────────────────────────────

import { getPlanInfo, openPlans, refreshLicense } from './license.js';
import { isLoggedIn } from '../cloud/supabase.js';
import { pushModal } from '../ui/modalStack.js';

const SEEN_KEY = 'lp.plans.announced.v1';
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function message(info) {
  if (info.source === 'comp') {
    return {
      title: 'Tienes LivePads Pro de cortesía',
      body: 'LivePads ahora tiene planes de pago. Por ser parte del equipo, tu cuenta tiene <b>Pro gratis y sin fecha de fin</b>. No tienes que hacer nada.',
      cta: null,
    };
  }
  if (info.source === 'church') {
    return {
      title: 'Tu iglesia te incluye en su plan',
      body: 'LivePads ahora tiene planes. Tu librería tiene el plan <b>Iglesia</b>, así que tienes todo incluido.',
      cta: null,
    };
  }
  if (info.plan !== 'free' && info.source === 'own') {
    return { title: '¡Gracias por apoyar LivePads!', body: `Tu plan ${info.plan === 'church' ? 'Iglesia' : 'Pro'} está activo.`, cta: null };
  }
  if (info.status === 'trial' && info.founder) {
    return {
      title: 'Gracias por ser de los primeros',
      body: `LivePads ahora tiene planes. Como <b>fundador</b> tienes <b>Pro gratis hasta el ${fmt(info.until)}</b>. Después podrás seguir con Pro a <b>mitad de precio para siempre</b>, o quedarte en el plan Gratis.`,
      cta: 'Ver planes',
    };
  }
  if (info.status === 'trial') {
    return {
      title: 'Estás probando LivePads Pro',
      body: `Tienes todas las funciones de Pro gratis durante ${info.trialDaysLeft} día${info.trialDaysLeft === 1 ? '' : 's'}, sin tarjeta. Después puedes elegir un plan o seguir en el plan Gratis.`,
      cta: 'Ver planes',
    };
  }
  if (!isLoggedIn()) {
    return {
      title: 'LivePads ahora tiene planes',
      body: 'Sin cuenta usas el plan <b>Gratis</b>: hasta 10 canciones, el pad de Chris Rocha, metrónomo, afinador y modo en vivo. <b>Crea tu cuenta gratis</b> y prueba Pro 14 días, sin tarjeta: Stems, todos los pads, detector de acordes y sincronización con tu equipo.',
      cta: 'Ver planes',
    };
  }
  return {
    title: 'LivePads ahora tiene planes',
    body: 'Estás en el plan <b>Gratis</b>. Con <b>Pro</b> tienes canciones ilimitadas, Stems, todos los pads, el detector de acordes y la sincronización con tu equipo.',
    cta: 'Ver planes',
  };
}

export async function maybeAnnouncePlans() {
  if (!getPlanInfo().enabled) return;
  try { if (localStorage.getItem(SEEN_KEY)) return; } catch (_) { return; }
  // Con sesión, espera a saber el plan real antes de decir nada.
  if (isLoggedIn()) { try { await refreshLicense(); } catch (_) {} }
  const info = getPlanInfo();
  const m = message(info);

  const ov = document.createElement('div');
  ov.id = 'plans-announce';
  ov.innerHTML = `
    <div class="pl-panel pl-announce" role="dialog" aria-label="${m.title}">
      <div class="pl-head"><h3>Novedades</h3><button class="pl-close" type="button" aria-label="Cerrar">✕</button></div>
      <h2 class="pl-ann-title">${m.title}</h2>
      <p class="pl-ann-body">${m.body}</p>
      <p class="pl-mission">🙏 Cada suscripción sirve para seguir mejorando LivePads y ser de bendición para toda la comunidad cristiana: más funciones, más innovación y una app que evoluciona cada día hasta ser la app definitiva para la alabanza en las iglesias.</p>
      <div class="pl-foot">
        ${m.cta ? `<button type="button" class="acc-btn pl-ann-cta">${m.cta}</button>` : ''}
        <button type="button" class="acc-btn ghost pl-ann-ok">Entendido</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('open'));
  let pop = null;
  const close = () => {
    try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch (_) {}
    if (pop) { pop(); pop = null; }
    ov.remove();
  };
  pop = pushModal(close, ov.querySelector('.pl-panel'));
  ov.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (e.target === ov || t?.classList.contains('pl-close') || t?.classList.contains('pl-ann-ok')) close();
    else if (t?.classList.contains('pl-ann-cta')) { close(); openPlans(); }
  });
}
