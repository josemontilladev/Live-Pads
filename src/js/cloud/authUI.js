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

function buildGate() {
  const gate = el(`
    <div id="auth-gate">
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
      <div class="auth-card">
        <img class="auth-logo-img" src="assets/logo.png" alt="LivePads" width="64" height="64">
        <div class="auth-logo">Live<span>Pads</span></div>
        <p class="auth-sub">Tu repertorio, en cualquier equipo.</p>

        <div class="auth-msg" id="auth-msg"></div>

        <!-- BIENVENIDA -->
        <div class="auth-view active" data-view="welcome">
          <button class="auth-btn google" data-act="google">${googleSvg()} Continuar con Google</button>
          <div class="auth-divider">o</div>
          <button class="auth-btn primary" data-act="go-login">Iniciar sesión</button>
          <button class="auth-btn ghost"   data-act="go-signup">Crear cuenta</button>
          <button class="auth-btn ghost"   data-act="local">Entrar sin cuenta</button>
        </div>

        <!-- LOGIN -->
        <div class="auth-view" data-view="login">
          <button class="auth-back" data-act="back">← Volver</button>
          <div class="auth-field">
            <label>Correo</label>
            <input type="email" id="login-email" autocomplete="email" placeholder="tu@correo.com">
          </div>
          <div class="auth-field">
            <label>Contraseña</label>
            <input type="password" id="login-pass" autocomplete="current-password" placeholder="••••••••">
          </div>
          <button class="auth-btn primary" data-act="do-login">Entrar</button>
          <div class="auth-divider">o</div>
          <button class="auth-btn google" data-act="google">${googleSvg()} Continuar con Google</button>
          <div class="auth-foot">
            <button class="auth-link" data-act="go-recover">¿Olvidaste tu contraseña?</button>
          </div>
        </div>

        <!-- REGISTRO -->
        <div class="auth-view" data-view="signup">
          <button class="auth-back" data-act="back">← Volver</button>
          <div class="auth-field">
            <label>Nombre</label>
            <input type="text" id="signup-name" autocomplete="name" placeholder="Tu nombre">
          </div>
          <div class="auth-field">
            <label>Correo</label>
            <input type="email" id="signup-email" autocomplete="email" placeholder="tu@correo.com">
          </div>
          <div class="auth-field">
            <label>Contraseña (mín. 6)</label>
            <input type="password" id="signup-pass" autocomplete="new-password" placeholder="••••••••">
          </div>
          <button class="auth-btn primary" data-act="do-signup">Crear cuenta</button>
        </div>

        <!-- RECUPERAR -->
        <div class="auth-view" data-view="recover">
          <button class="auth-back" data-act="back">← Volver</button>
          <div class="auth-field">
            <label>Correo</label>
            <input type="email" id="recover-email" autocomplete="email" placeholder="tu@correo.com">
          </div>
          <button class="auth-btn primary" data-act="do-recover">Enviar enlace de recuperación</button>
        </div>

        <!-- CONFIRMACIÓN DE CORREO -->
        <div class="auth-view" data-view="confirm">
          <div class="auth-confirm-icon">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="m4 6 8 6 8-6"/></svg>
          </div>
          <p class="auth-sub" id="confirm-text" style="margin-bottom:18px">Te enviamos un correo de confirmación. Ábrelo y confirma tu cuenta para poder iniciar sesión.</p>
          <button class="auth-btn primary" data-act="go-login">Ya confirmé, iniciar sesión</button>
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
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = 'Un momento…'; }
  else { btn.disabled = false; btn.textContent = labelWhenDone || btn.dataset.label || btn.textContent; }
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
    }
  });
  // Enter envía el formulario de la vista activa.
  rootEl.addEventListener('keydown', (ev) => {
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
