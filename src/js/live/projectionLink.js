// ─────────────────────────────────────────────────────────────────────────
// Letras para la congregación: LivePads maneja el programa de proyección.
//   · Al cargar una canción, la abre en FreeShow, OpenLP o ProPresenter (por título).
//   · Al cambiar de sección mientras suena (también con los saltos del mapa o del
//     arreglo en vivo), pone esa sección en pantalla.
//   · Con la LETRA SINCRONIZADA (live/lyricSyncStore.js) y OpenLP o ProPresenter: cambia
//     DIAPOSITIVA A DIAPOSITIVA justo cuando empieza a cantarse (lee el texto de cada
//     diapositiva del programa y lo casa con las líneas: projectionCore.planSlides).
// APIs (verificadas en el código de cada programa):
//   FreeShow  REST :5506  POST / { action: name_select_show | name_select_slide | next_slide | clear_slide, value }
//   OpenLP 3  HTTP :4316  /api/v2/plugins/songs/search?text=  ·  POST /api/v2/plugins/songs/live {id}
//                         GET /api/v2/controller/live-items  ·  POST /api/v2/controller/show {id: índice}
//   ProPresenter 7 (API de red, puerto que elijas)  /v1/libraries · /v1/library/{id}
//                         /v1/presentation/{uuid}/focus · /v1/presentation/{uuid}/group/{grupo}/trigger
// Las peticiones salen del proceso principal (main.js → proj-request): solo http y solo esas rutas.
// ─────────────────────────────────────────────────────────────────────────

import { markersFor } from '../data/markers.js';
import { groupName, openlpSlideIndex, bestTitle, planSlides } from './projectionCore.js';
import { lyricLines, getLyricSync } from './lyricSyncStore.js';
import { pushModal } from '../ui/modalStack.js';

const KEY = 'livepads.projection';
export const APPS = {
  freeshow: { label: 'FreeShow', port: 5506, hint: 'En FreeShow: Configuración → Conexión → activa «API» (WebSocket/REST). Puerto 5506 por defecto.' },
  openlp: { label: 'OpenLP', port: 4316, hint: 'En OpenLP: Configuración → Remota/API (viene activa). Puerto 4316 por defecto; contraseña solo si activaste la autenticación.' },
  propresenter: { label: 'ProPresenter', port: 50001, hint: 'En ProPresenter 7: Ajustes → Red → activa la red y escribe aquí ese puerto.' },
};
const DEF = { app: '', host: '127.0.0.1', port: '', password: '', user: 'openlp', openSong: true, follow: true };

export function getProjection() { try { return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (_) { return { ...DEF }; } }
function saveProjection(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) {} }

const base = (c) => `http://${String(c.host || '127.0.0.1').trim()}:${Number(c.port) || APPS[c.app].port}`;
async function req(method, url, body, headers) {
  const api = window.electronAPI;
  if (!api?.projRequest) throw new Error('Esta versión no puede conectarse.');
  return api.projRequest({ method, url, body, headers });
}

// ── Clientes ───────────────────────────────────────────────────────────────
function freeshow(c) {
  const auth = c.password ? { Authorization: `Bearer ${c.password}` } : undefined;
  const act = (action, extra = {}) => req('POST', `${base(c)}/`, { action, ...extra }, auth);
  return {
    async test() { const r = await req('POST', `${base(c)}/`, {}, auth); if (r.status === 401) throw new Error('Contraseña incorrecta'); if (!r.status) throw new Error(r.error || 'Sin respuesta'); return 'FreeShow responde'; },
    openSong: (title) => act('name_select_show', { value: title }),
    goSection: (label) => act('name_select_slide', { value: groupName(label) }),
    next: () => act('next_slide'),
    clear: () => act('clear_slide'),
  };
}

function openlp(c) {
  let token = null;
  const login = async () => {
    if (!c.password || token) return;
    const r = await req('POST', `${base(c)}/api/v2/core/login`, { username: c.user || 'openlp', password: c.password });
    if (!r.ok || !r.json || !r.json.token) throw new Error('Usuario o contraseña de OpenLP incorrectos');
    token = r.json.token;
  };
  const h = () => (token ? { Authorization: token } : undefined);
  const call = async (method, path, body) => { await login(); return req(method, `${base(c)}${path}`, body, h()); };
  return {
    async test() { const r = await call('GET', '/api/v2/core/system'); if (!r.ok) throw new Error(r.error || `OpenLP respondió ${r.status}`); return 'OpenLP responde'; },
    async openSong(title) {
      const r = await call('GET', `/api/v2/plugins/songs/search?text=${encodeURIComponent(title)}`);
      const list = Array.isArray(r.json) ? r.json.map((x) => (Array.isArray(x) ? { id: x[0], name: x[1] } : { id: x.id, name: x.title || x.name })) : [];
      const hit = bestTitle(title, list);
      if (!hit) return { ok: false, notFound: true };
      return call('POST', '/api/v2/plugins/songs/live', { id: hit.id });
    },
    async goSection(label) {
      const r = await call('GET', '/api/v2/controller/live-items');
      const slides = r.json && Array.isArray(r.json.slides) ? r.json.slides : [];
      const i = openlpSlideIndex(slides, label);
      if (i < 0) return { ok: false, notFound: true };
      return call('POST', '/api/v2/controller/show', { id: i });
    },
    async slides() {
      const r = await call('GET', '/api/v2/controller/live-items');
      const sl = r.json && Array.isArray(r.json.slides) ? r.json.slides : [];
      return sl.map((x) => ({ text: String(x.text || x.html || '') }));
    },
    goSlide: (i) => call('POST', '/api/v2/controller/show', { id: i }),
    next: () => call('POST', '/api/v2/controller/progress', { action: 'next' }),
    clear: () => call('POST', '/api/v2/core/display', { display: 'blank' }),
  };
}

function propresenter(c) {
  let uuid = null;
  const get = (path) => req('GET', `${base(c)}${path}`);
  const idOf = (x) => (x && x.id ? x.id : x) || {};
  return {
    async test() { const r = await get('/v1/version'); if (!r.ok) throw new Error(r.error || `ProPresenter respondió ${r.status}`); return 'ProPresenter responde'; },
    async openSong(title) {
      uuid = null;
      const libs = await get('/v1/libraries');
      for (const lib of Array.isArray(libs.json) ? libs.json : []) {
        const L = idOf(lib);
        const r = await get(`/v1/library/${encodeURIComponent(L.uuid || L.name)}`);
        const items = (r.json && (r.json.items || r.json)) || [];
        const hit = bestTitle(title, Array.isArray(items) ? items.map(idOf) : []);
        if (hit) { uuid = hit.uuid; return get(`/v1/presentation/${encodeURIComponent(uuid)}/focus`); }
      }
      return { ok: false, notFound: true };
    },
    async goSection(label) {
      const target = uuid ? `/v1/presentation/${encodeURIComponent(uuid)}` : '/v1/presentation/active';
      const r = await get(`${target}/group/${encodeURIComponent(groupName(label))}/trigger`);
      if (r.ok) return r;
      return get(`${target}/group/${encodeURIComponent(label)}/trigger`);   // grupo con el nombre en español
    },
    async slides() {
      if (!uuid) return [];
      const r = await get(`/v1/presentation/${encodeURIComponent(uuid)}`);
      const p = (r.json && (r.json.presentation || r.json)) || {};
      const out = [];
      for (const g of Array.isArray(p.groups) ? p.groups : []) for (const sl of Array.isArray(g.slides) ? g.slides : []) out.push({ text: String((sl && (sl.text || sl.label)) || '') });
      return out;
    },
    goSlide: (i) => get(`/v1/presentation/${encodeURIComponent(uuid || 'active')}/${i}/trigger`),
    next: () => get('/v1/presentation/active/next/trigger'),
    clear: () => get('/v1/clear/layer/slide'),
  };
}
const CLIENTS = { freeshow, openlp, propresenter };
const clientFor = (c) => (c.app && CLIENTS[c.app] ? CLIENTS[c.app](c) : null);

// ── Seguir la canción en vivo ──────────────────────────────────────────────
let cur = { song: null, type: '', audio: null, section: null, plan: null, slide: -1 }, client = null, timer = 0, lastErr = 0;
const SLIDE_LEAD = 0.4;    // la diapositiva entra un poco antes de que se cante (con su transición, ya se lee al empezar)
export const projectionLog = [];   // últimas acciones (para la ventana y las pruebas)

function note(what, r) {
  projectionLog.push({ at: Date.now(), what, ok: !!(r && r.ok), status: r && r.status });
  if (projectionLog.length > 30) projectionLog.shift();
  if (r && !r.ok && !r.notFound && Date.now() - lastErr > 30000) {
    lastErr = Date.now();
    const c = getProjection();
    window.showToast?.(`No se pudo hablar con ${APPS[c.app]?.label || 'el programa de proyección'} (${c.host}:${Number(c.port) || APPS[c.app]?.port}): ${r.error || 'respondió ' + r.status}.`, 'warning');
  }
}
const safe = (what, fn) => Promise.resolve().then(fn).then((r) => note(what, r), (e) => note(what, { ok: false, error: String((e && e.message) || e) }));

function sectionAt(t) {
  const ms = markersFor(cur.song, cur.type).slice().sort((a, b) => a.t - b.t);
  let s = null;
  for (const m of ms) if (m.t <= t + 0.08) s = m;
  return s;
}
function tick() {
  const c = getProjection();
  if (!client || !c.follow || !cur.audio || cur.audio.paused || !cur.song) return;
  if (cur.plan && cur.plan.length) {
    const t = (cur.audio.currentTime || 0) + SLIDE_LEAD;
    let k = -1;
    for (let i = 0; i < cur.plan.length && cur.plan[i].t <= t; i++) k = i;
    const slide = k >= 0 ? cur.plan[k].slide : -1;
    if (slide >= 0 && slide !== cur.slide) { cur.slide = slide; safe(`diapositiva ${slide + 1}`, () => client.goSlide(slide)); }
    return;
  }
  const s = sectionAt(cur.audio.currentTime || 0);
  const key = s ? `${s.t}|${s.label}` : null;
  if (key === cur.section) return;
  cur.section = key;
  if (s) safe(`sección ${s.label}`, () => client.goSection(s.label));
}
async function preparePlan(state) {
  if (!client || !client.slides || !state.song) return;
  const sync = getLyricSync(state.song, state.type);
  if (!sync) { state.plan = null; return; }
  const texts = lyricLines(state.song.lyrics).map((l) => l.text);
  const slides = await client.slides();
  if (state !== cur) return;
  const plan = planSlides(slides, sync.ev.map((e) => ({ t: e[0], text: texts[e[1]] || '' })));
  state.plan = plan.length >= 2 ? plan : null;
  state.slide = -1;
  projectionLog.push({ at: Date.now(), what: state.plan ? `plan: ${plan.length} cambios de diapositiva (${slides.length} diapositivas)` : 'sin plan por diapositiva (por secciones)', ok: true });
}
function restart() {
  const c = getProjection();
  client = clientFor(c);
  clearInterval(timer); timer = 0;
  if (client) timer = setInterval(tick, 150);
}

export function initProjectionLink() {
  window.addEventListener('livepads:track-loaded', (e) => {
    const d = e.detail || {};
    cur = { song: d.song || null, type: d.type || '', audio: d.audio || null, section: null, plan: null, slide: -1 };
    const c = getProjection();
    const mine = cur;
    const opened = client && c.openSong && cur.song && cur.song.title ? client.openSong(cur.song.title) : Promise.resolve(null);
    if (client && c.openSong && cur.song && cur.song.title) safe(`abrir ${cur.song.title}`, () => opened);
    // Letra sincronizada + programa que deja leer sus diapositivas → diapositiva a diapositiva.
    Promise.resolve(opened).catch(() => null).then(() => new Promise((r) => setTimeout(r, 450))).then(() => preparePlan(mine)).catch(() => {});
  });
  window.addEventListener('livepads:track-cleared', () => { cur = { song: null, type: '', audio: null, section: null, plan: null, slide: -1 }; });
  window.addEventListener('livepads:songs-changed', (e) => { if (cur.song && (!e.detail || e.detail.songId === cur.song.id)) preparePlan(cur).catch(() => {}); });
  restart();
}

// ── Ventana de ajustes ─────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export function openProjectionSettings() {
  if (document.getElementById('proj-box')) return;
  let c = getProjection();
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box proj-box" id="proj-box" role="dialog" aria-modal="true" aria-label="Letras en el programa de proyección">
      <div class="vn-head"><b>Letras en el programa de proyección</b><span>LivePads abre la canción y pone cada sección en pantalla mientras suena (también con los saltos del arreglo).</span></div>
      <div class="ui-seg proj-apps" role="group" aria-label="Programa">
        <button type="button" class="ui-seg-btn" data-app="">Ninguno</button>
        ${Object.entries(APPS).map(([k, a]) => `<button type="button" class="ui-seg-btn" data-app="${k}">${a.label}</button>`).join('')}
      </div>
      <p class="proj-hint" data-ref="hint"></p>
      <div class="proj-grid" data-ref="fields">
        <label class="vn-field">Equipo (IP) <input data-f="host" value="${esc(c.host)}" placeholder="127.0.0.1 (este equipo)" spellcheck="false"></label>
        <label class="vn-field">Puerto <input data-f="port" value="${esc(c.port)}" inputmode="numeric" maxlength="5"></label>
        <label class="vn-field" data-ref="userf">Usuario <input data-f="user" value="${esc(c.user)}" spellcheck="false"></label>
        <label class="vn-field">Contraseña <input data-f="password" type="password" value="${esc(c.password)}" placeholder="Si la pusiste"></label>
      </div>
      <label class="sm-use"><input type="checkbox" class="mo-switch" data-f="openSong" ${c.openSong ? 'checked' : ''}> <span><b>Abrir la canción al cargarla</b><small>La busca por título en el programa.</small></span></label>
      <label class="sm-use"><input type="checkbox" class="mo-switch" data-f="follow" ${c.follow ? 'checked' : ''}> <span><b>Cambiar de diapositiva con las secciones</b><small>Verso, Coro, Puente… según los marcadores de la pista.</small></span></label>
      <div class="proj-test"><button type="button" class="vn-btn" data-act="test">Probar conexión</button><span data-ref="result" aria-live="polite"></span></div>
      <div class="vn-actions"><button type="button" class="vn-btn vn-btn--primary" data-act="close">Listo</button></div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => { pop(); ov.remove(); restart(); };
  const pop = pushModal(close, ov);
  const paint = () => {
    ov.querySelectorAll('[data-app]').forEach((b) => b.classList.toggle('is-on', b.dataset.app === c.app));
    $('[data-ref="fields"]').hidden = !c.app;
    $('[data-ref="userf"]').hidden = c.app !== 'openlp';
    $('[data-ref="hint"]').textContent = c.app ? APPS[c.app].hint : 'Elige el programa que usa tu iglesia para proyectar las letras.';
    $('[data-f="port"]').placeholder = c.app ? String(APPS[c.app].port) : '';
    ov.querySelectorAll('.sm-use').forEach((x) => { x.hidden = !c.app; });
    $('.proj-test').hidden = !c.app;
  };
  const save = () => { saveProjection(c); restart(); };
  ov.addEventListener('click', async (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const app = e.target.closest('[data-app]');
    if (app) { c.app = app.dataset.app; c.port = ''; $('[data-f="port"]').value = ''; save(); paint(); $('[data-ref="result"]').textContent = ''; return; }
    if (e.target.closest('[data-act="test"]')) {
      const out = $('[data-ref="result"]');
      out.className = ''; out.textContent = 'Probando…';
      try { out.textContent = '✓ ' + await clientFor(c).test(); out.className = 'is-ok'; }
      catch (err) { out.textContent = '✗ ' + ((err && err.message) || err); out.className = 'is-bad'; }
    }
  });
  ov.addEventListener('input', (e) => { const f = e.target.dataset.f; if (f && e.target.type !== 'checkbox') { c[f] = e.target.value.trim(); save(); } });
  ov.addEventListener('change', (e) => { const f = e.target.dataset.f; if (f && e.target.type === 'checkbox') { c[f] = e.target.checked; save(); } });
  paint();
}
