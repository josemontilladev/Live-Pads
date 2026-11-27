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
import { bindTalkbackButton, talkbackPrefs, setTalkbackPrefs, talkbackRoute, onTalkbackChange } from './talkback.js';

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
let offTalk = null;
function closePalette() { if (offTalk) { offTalk(); offTalk = null; } if (pal) { pal.remove(); pal = null; document.removeEventListener('pointerdown', onOut, true); document.removeEventListener('keydown', onKey, true); } }
function onOut(e) { if (pal && !pal.contains(e.target) && !e.target.closest('#btn-cues')) closePalette(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePalette(); } }
export function toggleCuePalette(anchor) {
  if (pal) { closePalette(); return; }
  pal = document.createElement('div');
  pal.className = 'dc-pal';
  pal.innerHTML = `<div class="dc-head"><b>Indicaciones a la banda</b><span>Llegan a los móviles (Companion) y, con voz, a los auriculares</span></div>
    <div class="dc-tb">
      <button type="button" class="tb-btn" aria-pressed="false" title="Talkback: tu voz llega solo a los in-ears de la banda. Asignable a un pedal MIDI con «Aprender»."><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span><b>Hablar a la banda</b><small>Mantén pulsado para hablar · un toque lo deja abierto</small></span></button>
      <div class="dc-tb-opts"><select class="tb-mic" aria-label="Micrófono del talkback"><option value="">Micrófono predeterminado</option></select><label class="dc-tb-vol" title="Volumen de tu voz en los in-ears">Voz <input type="range" class="tb-vol" min="0.2" max="2" step="0.1" aria-label="Volumen de tu voz"></label></div>
      <p class="dc-tb-route"></p>
      <label class="dc-tb-main" hidden><input type="checkbox"> Mis salidas 1-2 solo van a los in-ears (no a la sala)</label>
    </div>
    <button type="button" class="dc-trans" data-trans="1">Transición al tono de la siguiente<small data-ref="tplan"></small></button>
    <div class="dc-grid">${CUES.map((c) => `<button type="button" data-cue="${c.id}">${esc(c.text)}</button>`).join('')}</div>
    <label class="dc-voice"><input type="checkbox" ${voiceOn() ? 'checked' : ''}> Decirlas en voz por los auriculares (por la salida del click)</label>`;
  document.body.appendChild(pal);
  const r = anchor.getBoundingClientRect();
  // Si no cabe debajo del botón, sube lo justo (en pantallas bajas no se sale por abajo).
  pal.style.top = Math.max(8, Math.min(window.innerHeight - pal.offsetHeight - 8, r.bottom + 8)) + 'px';
  pal.style.left = Math.max(8, Math.min(window.innerWidth - pal.offsetWidth - 8, r.right - pal.offsetWidth)) + 'px';
  pal.addEventListener('click', (e) => {
    if (e.target.closest('[data-trans]')) { import('./keyTransition.js').then((m) => { m.playTransition(); closePalette(); }); return; }
    const b = e.target.closest('[data-cue]'); if (b) sendCue(b.dataset.cue);
  });
  import('./keyTransition.js').then((m) => { const p = m.transitionPlan(); const el = pal && pal.querySelector('[data-ref="tplan"]'); if (el) el.textContent = p.steps.length > 1 ? p.steps.map((s) => s.name).join(' → ') : 'La siguiente está en el mismo tono'; });
  pal.querySelector('.dc-voice input').addEventListener('change', (e) => setVoice(e.target.checked));
  wireTalkback(pal);
  setTimeout(() => { document.addEventListener('pointerdown', onOut, true); document.addEventListener('keydown', onKey, true); }, 0);
}

// ── Talkback (live/talkback.js) dentro de la paleta ──
function wireTalkback(root) {
  const btn = root.querySelector('.tb-btn'), mic = root.querySelector('.tb-mic'), vol = root.querySelector('.tb-vol');
  const route = root.querySelector('.dc-tb-route'), main = root.querySelector('.dc-tb-main'), mainBox = main.querySelector('input');
  const p = talkbackPrefs();
  vol.value = String(p.volume);
  mainBox.checked = !!p.mainOk;
  const paintRoute = () => {
    const r = talkbackRoute();
    btn.classList.toggle('is-blocked', !r);
    route.textContent = r === 'alt' ? 'Tu voz sale por las salidas 3-4 (in-ears): la sala no la oye.'
      : r === 'main' ? 'Tu voz sale por las salidas 1-2: marcaste que solo van a los in-ears.'
      : 'Para usarlo, activa «Click y guía por las salidas 3-4» en Ajustes → Audio (con una interfaz de 4 salidas).';
    main.hidden = r === 'alt';
  };
  paintRoute();
  offTalk = bindTalkbackButton(btn);
  mainBox.addEventListener('change', () => { setTalkbackPrefs({ mainOk: mainBox.checked }); paintRoute(); });
  vol.addEventListener('input', () => setTalkbackPrefs({ volume: Number(vol.value) }));
  mic.addEventListener('change', () => setTalkbackPrefs({ mic: mic.value }));
  navigator.mediaDevices?.enumerateDevices?.().then((devs) => {
    const ins = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    mic.insertAdjacentHTML('beforeend', ins.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Micrófono ' + (i + 1))}</option>`).join(''));
    mic.value = ins.some((d) => d.deviceId === p.mic) ? p.mic : '';
  }).catch(() => {});
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
