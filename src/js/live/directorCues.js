// ─────────────────────────────────────────────────────────────────────────
// Indicaciones del director y control remoto desde el móvil.
//
// · Indicaciones («Repetir», «Coro», «Final», «Suave»…): el director las elige en
//   LivePads (botón «Indicaciones») o desde su móvil, y llegan a la vez:
//     – a los móviles de la banda (Companion), en grande unos segundos;
//     – a los auriculares, con la voz grabada en español, por la MISMA salida que
//       el click (salidas 3-4 si están activadas: la congregación no la oye).
// · Control remoto: el móvil del líder (con el PIN que muestra el panel del
//   Companion) puede dar Play/Pausa, cambiar de canción o parar todo.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';

const G = 'assets/Spanish%20Guides/';
const sec = (f) => `${G}Song%20Sections/${encodeURIComponent(f)}.wav`;
const cue = (f) => `${G}Guide%20Cues/${encodeURIComponent(f)}.wav`;

export const CUES = [
  { id: 'repeat', text: 'Repetir', file: sec('Spanish - Repetir (Tag)') },
  { id: 'last', text: 'Última vez', file: cue('Spanish - Last Time (Ultima Vez)') },
  { id: 'chorus', text: 'Coro', file: sec('Spanish - Coro (Chorus)') },
  { id: 'verse', text: 'Verso', file: sec('Spanish - Verso (Verse)') },
  { id: 'bridge', text: 'Puente', file: sec('Spanish - Puente (Bridge)') },
  { id: 'pre', text: 'Pre coro', file: sec('Spanish - Pre Coro (Pre Chorus)') },
  { id: 'instrumental', text: 'Instrumental', file: sec('Spanish - Instrumental') },
  { id: 'ending', text: 'Final', file: sec('Spanish - Ending (Final)') },
  { id: 'big-ending', text: 'Final grande', file: cue('Spanish - Big Ending (Final Grande)') },
  { id: 'soft', text: 'Suave', file: cue('Spanish - Softly (Suave)') },
  { id: 'build', text: 'Sube intensidad', file: cue('Spanish - Build (Sube Intensidad)') },
  { id: 'down', text: 'Baja intensidad', file: sec('Spanish - Baja Intensidad (Breakdown)') },
  { id: 'all', text: 'Toda la banda', file: cue('Spanish - All In (Toda La Banda)') },
  { id: 'acapella', text: 'A capella', file: cue('Spanish - A Capella') },
  { id: 'break', text: 'Pausa', file: cue('Spanish - Break (Pausa)') },
  { id: 'hold', text: 'Sostener', file: cue('Spanish - Hold (Sostener)') },
  { id: 'key-up', text: 'Sube tono', file: cue('Spanish - Key Change Up (Sube Tono)') },
  { id: 'key-down', text: 'Baja tono', file: cue('Spanish - Key Change Down (Baja Tono)') },
];
const byId = new Map(CUES.map((c) => [c.id, c]));

let deps = { getEngine: () => null, panic: () => {} };
const VOICE_KEY = 'livepads.cues.voice';
export const voiceOn = () => { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch (_) { return true; } };
const setVoice = (on) => { try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch (_) {} };

const buffers = new Map();
async function playVoice(c) {
  const engine = deps.getEngine();
  const ctx = engine && engine.ctx;
  if (!ctx || !c.file) return;
  try {
    let buf = buffers.get(c.id);
    if (!buf) { buf = await ctx.decodeAudioData(await (await fetch(c.file)).arrayBuffer()); buffers.set(c.id, buf); }
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createBufferSource();
    const g = ctx.createGain(); g.gain.value = 1.4;
    src.buffer = buf; src.connect(g);
    g.connect(engine.clickBus || ctx.destination);   // por donde va el click (in-ears si 3-4)
    src.start();
  } catch (_) { /* sin voz: la indicación igual llega a los móviles y a la pantalla */ }
}

let banner = null, bannerT = null;
function showBanner(text, from = '') {
  if (!banner) { banner = document.createElement('div'); banner.className = 'dc-banner'; document.body.appendChild(banner); }
  banner.innerHTML = `<b>${esc(text)}</b>${from ? `<span>${esc(from)}</span>` : ''}`;
  banner.classList.add('show');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => banner && banner.classList.remove('show'), 3500);
}

/** Texto libre a la banda (móviles y pantalla), sin voz: p. ej. los acordes de una transición. */
export function sendText(text, from = '') {
  if (!text) return;
  try { window.electronAPI?.companionCue?.({ id: 'text', text: String(text).slice(0, 40), from }); } catch (_) {}
  showBanner(text, from);
}

/** Envía una indicación: a los móviles, a la pantalla y (si está activada) con voz a los auriculares. */
export function sendCue(id, from = '') {
  const c = byId.get(id);
  if (!c) return;
  try { window.electronAPI?.companionCue?.({ id: c.id, text: c.text, from }); } catch (_) {}
  showBanner(c.text, from);
  if (voiceOn()) playVoice(c);
}

// ── Paleta en LivePads ──
let pal = null;
function closePalette() { if (pal) { pal.remove(); pal = null; document.removeEventListener('pointerdown', onOut, true); document.removeEventListener('keydown', onKey, true); } }
function onOut(e) { if (pal && !pal.contains(e.target) && !e.target.closest('#btn-cues')) closePalette(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePalette(); } }
export function toggleCuePalette(anchor) {
  if (pal) { closePalette(); return; }
  pal = document.createElement('div');
  pal.className = 'dc-pal';
  pal.innerHTML = `<div class="dc-head"><b>Indicaciones a la banda</b><span>Llegan a los móviles (Companion) y, con voz, a los auriculares</span></div>
    <button type="button" class="dc-trans" data-trans="1">Transición al tono de la siguiente<small data-ref="tplan"></small></button>
    <div class="dc-grid">${CUES.map((c) => `<button type="button" data-cue="${c.id}">${esc(c.text)}</button>`).join('')}</div>
    <label class="dc-voice"><input type="checkbox" ${voiceOn() ? 'checked' : ''}> Decirlas en voz por los auriculares (por la salida del click)</label>`;
  document.body.appendChild(pal);
  const r = anchor.getBoundingClientRect();
  pal.style.top = (r.bottom + 8) + 'px';
  pal.style.left = Math.max(8, Math.min(window.innerWidth - pal.offsetWidth - 8, r.right - pal.offsetWidth)) + 'px';
  pal.addEventListener('click', (e) => {
    if (e.target.closest('[data-trans]')) { import('./keyTransition.js').then((m) => { m.playTransition(); closePalette(); }); return; }
    const b = e.target.closest('[data-cue]'); if (b) sendCue(b.dataset.cue);
  });
  import('./keyTransition.js').then((m) => { const p = m.transitionPlan(); const el = pal && pal.querySelector('[data-ref="tplan"]'); if (el) el.textContent = p.steps.length > 1 ? p.steps.map((s) => s.name).join(' → ') : 'La siguiente está en el mismo tono'; });
  pal.querySelector('.dc-voice input').addEventListener('change', (e) => setVoice(e.target.checked));
  setTimeout(() => { document.addEventListener('pointerdown', onOut, true); document.addEventListener('keydown', onKey, true); }, 0);
}

// ── Órdenes del móvil del líder ──
function onRemote(c) {
  if (!c || !c.cmd) return;
  const click = (sel) => document.querySelector(sel)?.click();
  if (c.cmd === 'cue') { sendCue(c.arg, c.from || 'Móvil'); return; }
  if (c.cmd === 'play') click('#tp-play-btn');
  else if (c.cmd === 'next') click('#btn-service-next');
  else if (c.cmd === 'prev') click('#btn-service-prev');
  else if (c.cmd === 'stop' || c.cmd === 'panic') deps.panic();
  const label = { play: 'Play / Pausa', next: 'Canción siguiente', prev: 'Canción anterior', stop: 'Parar todo', panic: 'Parar todo' }[c.cmd];
  if (label) window.showToast?.(`Móvil${c.from ? ` (${c.from})` : ''}: ${label}`, 'info');
}

export function initDirectorCues(d) {
  deps = { ...deps, ...d };
  document.getElementById('btn-cues')?.addEventListener('click', (e) => { e.stopPropagation(); toggleCuePalette(e.currentTarget); });
  try { window.electronAPI?.onCompanionCommand?.(onRemote); } catch (_) {}
}
