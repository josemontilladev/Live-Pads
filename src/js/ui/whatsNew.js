// ─────────────────────────────────────────────────────────────────────────
// «Qué hay de nuevo»: se muestra UNA vez, al abrir la app después de una
// actualización que trae novedades. Una instalación nueva no lo ve (ya
// descubre todo en el tutorial). Se marca como visto en localStorage.
//
// Para anunciar una versión nueva: cambiar EDITION (y los puntos). EDITION no
// es la versión de la app: varias versiones pueden compartir la misma
// edición si no traen nada que anunciar.
// ─────────────────────────────────────────────────────────────────────────
import { pushModal } from './modalStack.js';

const SEEN_KEY = 'lp.whatsnew.seen';
const EDITION = '2026-11-practica-2';
// Señal de que la app ya se usaba antes (la escribe app.js desde hace meses).
const USED_BEFORE_KEY = 'livepads-active-workspace';

const ITEMS = [
  ['🎙️', 'Grábate mejor', 'Cuenta de entrada, escucharte con audífonos y "Calibrar latencia" para que tus tomas caigan exactas (▾ junto al botón ●).'],
  ['🔁', 'Varias tomas en loop', 'Con el loop A-B activo, cada vuelta queda como una pasada: suena la última y comparas las demás con Solo.'],
  ['🔔', 'Avisos de la comunidad', 'Te avisamos cuando tu pack se aprueba o se rechaza, y puedes corregir tus loops sin volver a subirlos.'],
  ['⚑', 'Reportar loops', 'Si un loop de la comunidad tiene problemas de derechos o calidad, repórtalo y el equipo lo revisa.'],
];

export function maybeShowWhatsNew({ onTryLibrary } = {}) {
  let seen, usedBefore;
  try {
    seen = localStorage.getItem(SEEN_KEY);
    usedBefore = !!localStorage.getItem(USED_BEFORE_KEY);
  } catch (_) { return; }
  if (seen === EDITION) return;
  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, EDITION); } catch (_) {} };
  // Instalación nueva: nada que anunciar (todo es nuevo para esa persona).
  if (!usedBefore) { markSeen(); return; }
  if (document.getElementById('whats-new') || document.getElementById('plans-announce')) return;

  const ov = document.createElement('div');
  ov.id = 'whats-new';
  ov.innerHTML = `
    <div class="pl-panel pl-announce" role="dialog" aria-label="Qué hay de nuevo en LivePads">
      <div class="pl-head"><h3>Novedades</h3><button class="pl-close" type="button" aria-label="Cerrar">✕</button></div>
      <h2 class="pl-ann-title">Qué hay de nuevo en LivePads</h2>
      <ul class="wn-list">
        ${ITEMS.map(([ico, t, d]) => `<li><span class="wn-ico" aria-hidden="true">${ico}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('')}
      </ul>
      <div class="pl-foot">
        <button type="button" class="acc-btn ghost" data-act="ok">Entendido</button>
        <button type="button" class="acc-btn" data-act="try">Probar la Biblioteca</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('open'));

  let pop = null;
  const close = () => { markSeen(); if (pop) { pop(); pop = null; } ov.remove(); };
  pop = pushModal(close, ov.querySelector('.pl-panel'));
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('.pl-close') || e.target.closest('[data-act="ok"]')) { close(); return; }
    if (e.target.closest('[data-act="try"]')) { close(); onTryLibrary?.(); }
  });
}
