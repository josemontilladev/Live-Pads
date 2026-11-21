// ─────────────────────────────────────────────────────────────────────────
// Pantalla de bienvenida / login / registro (dentro del .exe).
//
// Se muestra al arrancar si la nube está activada y no hay sesión guardada.
// Siempre deja la opción "Entrar sin cuenta" (modo local de siempre), así que
// nunca bloquea a quien no quiera cuenta.
// ─────────────────────────────────────────────────────────────────────────

import {
  isCloudEnabled, restoreSession, isLoggedIn, getUser,
  signIn, signUp, resetPassword, signInWithGoogle,
} from './supabase.js';

const LOCAL_CHOICE_KEY = 'livepads-skip-account'; // recuerda "entrar sin cuenta"

let rootEl = null;
let onDone = null;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function googleSvg() {
  return `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 16 2 9.1 6.5 6.3 14.7z"/><path fill="#4CAF50" d="M24 46c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 36.6 26.9 38 24 38c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.1 41.4 16 46 24 46z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C40.9 36.6 44 31 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>`;
}

// Iconos de línea (mismo trazo que el resto de la app).
const ICON = {
  mail: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
  pads: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
  team: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
};
function field({ id, type, label, icon, autocomplete, placeholder, pass = false }) {
  return `
    <label class="auth-field" for="${id}">
      <span class="auth-field-label">${label}</span>
      <span class="auth-input">
        <span class="auth-input-icon">${ICON[icon]}</span>
        <input type="${type}" id="${id}" autocomplete="${autocomplete}" placeholder="${placeholder}" spellcheck="false">
        ${pass ? `<button type="button" class="auth-eye" data-act="toggle-pass" data-for="${id}" title="Mostrar u ocultar la contraseña" aria-label="Mostrar u ocultar la contraseña">${ICON.eye}</button>` : ''}
      </span>
    </label>`;
}
function head(title, sub, back = true) {
  return `
    <div class="auth-head">
      ${back ? `<button type="button" class="auth-back" data-act="back" title="Volver" aria-label="Volver">${ICON.back}</button>` : ''}
      <div><h2 class="auth-title">${title}</h2>${sub ? `<p class="auth-lead">${sub}</p>` : ''}</div>
    </div>`;
}

// Pantalla de acceso: a la izquierda la marca y lo que ofrece la cuenta; a la
// derecha la tarjeta con cada paso. Toma los colores del tema elegido. En
// ventanas estrechas queda solo la tarjeta, centrada.
function buildGate() {
  const gate = el(`
    <div id="auth-gate">
      <div class="auth-glow" aria-hidden="true"></div>
      <div class="auth-winctrls">
        <button class="auth-wm" data-win="minimize" title="Minimizar" aria-label="Minimizar">
          <svg viewBox="0 0 10 1" width="10" height="10"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="auth-wm" data-win="maximize" title="Maximizar" aria-label="Maximizar">
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0,0v10h10V0H0z M9,9H1V1h8V9z" fill="currentColor"/></svg>
        </button>
        <button class="auth-wm auth-wm-close" data-win="close" title="Cerrar" aria-label="Cerrar">
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M10,0.7L9.3,0L5,4.3L0.7,0L0,0.7L4.3,5L0,9.3L0.7,10L5,5.7L9.3,10L10,9.3L5.7,5L10,0.7z" fill="currentColor"/></svg>
        </button>
      </div>

      <div class="auth-shell">
        <section class="auth-hero" aria-label="LivePads">
          <div class="auth-brand">
            <img class="auth-logo-img" src="assets/logo.png" alt="" width="44" height="44">
            <span class="auth-logo">LivePads</span>
          </div>
          <h1 class="auth-headline">Todo tu servicio,<br>en un solo lugar.</h1>
          <p class="auth-tagline">Pads, metrónomo, letras y pistas listos para tocar en vivo. Con tu cuenta, tu repertorio te sigue a cualquier equipo.</p>
          <ul class="auth-features">
            <li><span class="auth-feat-icon">${ICON.pads}</span><span><b>Pads y metrónomo</b>En el tono y el tempo de cada canción.</span></li>
            <li><span class="auth-feat-icon">${ICON.layers}</span><span><b>Stems y secuencias</b>Arma la mezcla y ensaya por secciones.</span></li>
            <li><span class="auth-feat-icon">${ICON.team}</span><span><b>Tu equipo sincronizado</b>Canciones, tonos y servicios al día para todos.</span></li>
          </ul>
        </section>

        <div class="auth-card" role="group" aria-label="Acceso">
          <div class="auth-card-brand">
            <img class="auth-logo-img" src="assets/logo.png" alt="" width="40" height="40">
            <span class="auth-logo">LivePads</span>
          </div>
          <div class="auth-msg" id="auth-msg" role="status" aria-live="polite"></div>

          <!-- BIENVENIDA -->
          <div class="auth-view active" data-view="welcome">
            ${head('Te damos la bienvenida', 'Inicia sesión para tener tu repertorio sincronizado con tu equipo.', false)}
            <button class="auth-btn google" data-act="google">${googleSvg()} Continuar con Google</button>
            <div class="auth-divider">o con tu correo</div>
            <button class="auth-btn ghost" data-act="go-login">Iniciar sesión</button>
            <button class="auth-btn ghost" data-act="go-signup">Crear cuenta</button>
            <div class="auth-foot">
              <button class="auth-link" data-act="local">Entrar sin cuenta</button>
              <span class="auth-foot-note">Usa LivePads solo en este equipo.</span>
            </div>
          </div>

          <!-- LOGIN -->
          <div class="auth-view" data-view="login">
            ${head('Iniciar sesión', 'Con el correo de tu cuenta de LivePads.')}
            ${field({ id: 'login-email', type: 'email', label: 'Correo', icon: 'mail', autocomplete: 'email', placeholder: 'tu@correo.com' })}
            ${field({ id: 'login-pass', type: 'password', label: 'Contraseña', icon: 'lock', autocomplete: 'current-password', placeholder: 'Tu contraseña', pass: true })}
            <div class="auth-row-end"><button class="auth-link" data-act="go-recover">¿Olvidaste tu contraseña?</button></div>
            <button class="auth-btn primary" data-act="do-login">Entrar</button>
            <div class="auth-divider">o</div>
            <button class="auth-btn google" data-act="google">${googleSvg()} Continuar con Google</button>
          </div>

          <!-- REGISTRO -->
          <div class="auth-view" data-view="signup">
            ${head('Crear cuenta', 'Gratis. Pruebas Pro 14 días, sin tarjeta.')}
            ${field({ id: 'signup-name', type: 'text', label: 'Nombre', icon: 'user', autocomplete: 'name', placeholder: 'Tu nombre' })}
            ${field({ id: 'signup-email', type: 'email', label: 'Correo', icon: 'mail', autocomplete: 'email', placeholder: 'tu@correo.com' })}
            ${field({ id: 'signup-pass', type: 'password', label: 'Contraseña', icon: 'lock', autocomplete: 'new-password', placeholder: 'Mínimo 6 caracteres', pass: true })}
            <button class="auth-btn primary" data-act="do-signup">Crear cuenta</button>
            <div class="auth-divider">o</div>
            <button class="auth-btn google" data-act="google">${googleSvg()} Continuar con Google</button>
          </div>

          <!-- RECUPERAR -->
          <div class="auth-view" data-view="recover">
            ${head('Recuperar contraseña', 'Te enviamos un enlace para elegir una nueva.')}
            ${field({ id: 'recover-email', type: 'email', label: 'Correo', icon: 'mail', autocomplete: 'email', placeholder: 'tu@correo.com' })}
            <button class="auth-btn primary" data-act="do-recover">Enviar enlace</button>
          </div>

          <!-- CONFIRMACIÓN DE CORREO -->
          <div class="auth-view" data-view="confirm">
            <div class="auth-confirm-icon">${ICON.mail}</div>
            <h2 class="auth-title auth-title--center">Revisa tu correo</h2>
            <p class="auth-lead auth-lead--center" id="confirm-text">Te enviamos un correo de confirmación. Ábrelo y confirma tu cuenta para poder iniciar sesión.</p>
            <button class="auth-btn primary" data-act="go-login">Ya confirmé, iniciar sesión</button>
          </div>
        </div>
      </div>
    </div>
  `);
  return gate;
}

function show(view) {
  rootEl.querySelectorAll('.auth-view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  clearMsg();
  const first = rootEl.querySelector(`.auth-view[data-view="${view}"] input`);
  if (first) setTimeout(() => first.focus(), 30);
}

function msg(text, kind = 'error') {
  const m = rootEl.querySelector('#auth-msg');
  m.textContent = text;
  m.className = `auth-msg show ${kind}`;
}
function clearMsg() {
  const m = rootEl.querySelector('#auth-msg');
  m.className = 'auth-msg';
  m.textContent = '';
}

function busy(btn, on, labelWhenDone) {
  // Se guarda el HTML (no solo el texto): el botón de Google perdía su icono.
  if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.textContent = 'Un momento…'; }
  else { btn.disabled = false; if (labelWhenDone) btn.textContent = labelWhenDone; else if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

function finish() {
  if (rootEl) rootEl.classList.add('hidden');
  if (onDone) { const cb = onDone; onDone = null; cb(getUser()); }
}

async function handleLogin(btn) {
  const email = rootEl.querySelector('#login-email').value.trim();
  const pass  = rootEl.querySelector('#login-pass').value;
  if (!email || !pass) return msg('Escribe tu correo y contraseña.');
  busy(btn, true);
  try {
    await signIn(email, pass);
    localStorage.removeItem(LOCAL_CHOICE_KEY);
    finish();
  } catch (e) { msg(e.message); busy(btn, false); }
}

async function handleSignup(btn) {
  const name  = rootEl.querySelector('#signup-name').value.trim();
  const email = rootEl.querySelector('#signup-email').value.trim();
  const pass  = rootEl.querySelector('#signup-pass').value;
  if (!email || !pass) return msg('Escribe tu correo y contraseña.');
  if (pass.length < 6) return msg('La contraseña debe tener al menos 6 caracteres.');
  busy(btn, true);
  try {
    const { needsConfirmation } = await signUp(email, pass, name);
    if (needsConfirmation) {
      rootEl.querySelector('#confirm-text').textContent =
        `Te enviamos un correo a ${email}. Ábrelo y confirma tu cuenta para poder iniciar sesión.`;
      show('confirm');
    } else {
      localStorage.removeItem(LOCAL_CHOICE_KEY);
      finish();
    }
  } catch (e) { msg(e.message); }
  busy(btn, false);
}

async function handleRecover(btn) {
  const email = rootEl.querySelector('#recover-email').value.trim();
  if (!email) return msg('Escribe tu correo.');
  busy(btn, true);
  try {
    await resetPassword(email);
    msg('Si ese correo tiene cuenta, te enviamos un enlace para restablecer la contraseña.', 'ok');
  } catch (e) { msg(e.message); }
  busy(btn, false);
}

async function handleGoogle(btn) {
  busy(btn, true);
  try {
    await signInWithGoogle();
    localStorage.removeItem(LOCAL_CHOICE_KEY);
    finish();
  } catch (e) { msg(e.message); busy(btn, false); }
}

function wire() {
  rootEl.addEventListener('click', (ev) => {
    const win = ev.target.closest('[data-win]');
    if (win) { try { window.electronAPI?.windowAction(win.dataset.win); } catch (_) {} return; }
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    switch (act) {
      case 'go-login':   show('login'); break;
      case 'go-signup':  show('signup'); break;
      case 'go-recover': show('recover'); break;
      case 'back':       show('welcome'); break;
      case 'local':
        localStorage.setItem(LOCAL_CHOICE_KEY, '1');
        finish();
        break;
      case 'do-login':   handleLogin(btn); break;
      case 'do-signup':  handleSignup(btn); break;
      case 'do-recover': handleRecover(btn); break;
      case 'google':     handleGoogle(btn); break;
      case 'toggle-pass': {
        const inp = rootEl.querySelector('#' + btn.dataset.for);
        if (inp) { inp.type = inp.type === 'password' ? 'text' : 'password'; btn.classList.toggle('is-on', inp.type === 'text'); inp.focus(); }
        break;
      }
    }
  });
  // Enter envía el formulario de la vista activa; Escape vuelve a bienvenida.
  // Con el login delante, los atajos de la app (Ctrl+L modo en vivo, Espacio…)
  // no deben actuar: las teclas se quedan en esta pantalla.
  window.addEventListener('keydown', (ev) => {
    if (!rootEl || rootEl.classList.contains('hidden') || !rootEl.isConnected) return;
    if (!rootEl.contains(ev.target)) { ev.stopImmediatePropagation(); if (ev.key !== 'Tab') ev.preventDefault(); }
  }, true);
  rootEl.addEventListener('keydown', (ev) => {
    ev.stopPropagation();   // que no llegue a los atajos de la app
    if (ev.key === 'Escape') {
      const active = rootEl.querySelector('.auth-view.active');
      if (active && active.dataset.view !== 'welcome') { ev.preventDefault(); show('welcome'); }
      return;
    }
    if (ev.key !== 'Enter') return;
    const view = rootEl.querySelector('.auth-view.active');
    if (!view) return;
    const primary = view.querySelector('.auth-btn.primary[data-act^="do-"]');
    if (primary) { ev.preventDefault(); primary.click(); }
  });
}

// Punto de entrada. Devuelve una promesa que resuelve con el usuario (o null si
// eligió modo local) — el arranque de la app continúa detrás del overlay.
export async function initAuthGate() {
  // Sin nube configurada → modo local directo, sin pantalla.
  if (!isCloudEnabled()) return null;

  await restoreSession();
  // Sesión válida recordada → entra directo.
  if (isLoggedIn()) return getUser();
  // Eligió antes "sin cuenta" → respeta su decisión, no molesta.
  if (localStorage.getItem(LOCAL_CHOICE_KEY) === '1') return null;

  rootEl = buildGate();
  document.body.appendChild(rootEl);
  wire();
  show('welcome');

  return new Promise((resolve) => { onDone = resolve; });
}

// Para cerrar sesión desde dentro de la app (ajustes): vuelve a mostrar la
// pantalla de bienvenida.
export function openAuthGate() {
  if (!rootEl) { rootEl = buildGate(); document.body.appendChild(rootEl); wire(); }
  rootEl.classList.remove('hidden');
  show('welcome');
  return new Promise((resolve) => { onDone = resolve; });
}
