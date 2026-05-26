// ─────────────────────────────────────────────────────────────────────────
// Pantalla de bienvenida / login / registro (dentro del .exe).
//
// Se muestra al arrancar si la nube está activada y no hay sesión guardada.
// Siempre deja la opción "Entrar sin cuenta" (modo local de siempre), así que
// nunca bloquea a quien no quiera cuenta.
// ─────────────────────────────────────────────────────────────────────────

import {
  isCloudEnabled, restoreSession, isLoggedIn, getUser,
  signIn, signUp, resetPassword,
} from './supabase.js';

const LOCAL_CHOICE_KEY = 'livepads-skip-account'; // recuerda "entrar sin cuenta"

let rootEl = null;
let onDone = null;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function buildGate() {
  const gate = el(`
    <div id="auth-gate">
      <div class="auth-card">
        <div class="auth-logo">Live<span>Pads</span></div>
        <p class="auth-sub">Tu repertorio, en cualquier equipo.</p>

        <div class="auth-msg" id="auth-msg"></div>

        <!-- BIENVENIDA -->
        <div class="auth-view active" data-view="welcome">
          <button class="auth-btn primary" data-act="go-login">Iniciar sesión</button>
          <button class="auth-btn ghost"   data-act="go-signup">Crear cuenta</button>
          <div class="auth-divider">o</div>
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

function wire() {
  rootEl.addEventListener('click', (ev) => {
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
