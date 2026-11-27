// ─────────────────────────────────────────────────────────────────────────
// Vista de directo táctil: pantalla completa con botones grandes para tocar en vivo
// desde una pantalla táctil o una tablet junto al teclado.
//   · Arriba: canción anterior / siguiente del servicio, título, tono y BPM.
//   · Sección actual y la que viene (con cuenta atrás).
//   · Todas las secciones como botones: un toque = saltar (según el modo de salto:
//     ya, al compás o al final de la sección). La que suena y la preparada, marcadas.
//   · Abajo: Play/Pausa, Repetir sección, Terminar suave, Plan B, progreso y vúmetro.
// Botón en la cabecera (#btn-live-touch), en el Buscador y con Esc o «Salir» se cierra.
// ─────────────────────────────────────────────────────────────────────────

import { whilePlaying } from '../audio/playClock.js';
import { getCurrentSong, getTrackAudio, getCurrentType } from '../audio/trackPlayer.js';
import { getServiceSongs, getActiveServiceIndex, getEffectiveKey, serviceNextSong, servicePrevSong, peekNextServiceSong } from '../data/service.js';
import { markersFor } from '../data/markers.js';
import { arrange, arrangeGoto, arrangeCancel, getPendingJump, jumpMode, setJumpMode } from '../live/arrange.js';
import { JUMP_MODES } from '../live/arrangeCore.js';
import { attachVuMeter } from './vuMeter.js';
import { pushModal } from './modalStack.js';
import { sectionHue } from './seqWaveform.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (s) => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');
const click = (sel) => document.querySelector(sel)?.click();

let ov = null, off = null, pop = null, lastSecSig = '', ro = null;

export const isLiveTouchOpen = () => !!ov;

function sections() {
  const song = getCurrentSong();
  if (!song) return [];
  return (markersFor(song, getCurrentType()) || []).filter((m) => m && Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t);
}

function paint() {
  if (!ov) return;
  const $ = (s) => ov.querySelector(s);
  const song = getCurrentSong();
  const a = getTrackAudio();
  const svc = getServiceSongs();
  const idx = getActiveServiceIndex();
  const t = a ? a.currentTime || 0 : 0;
  const dur = a && Number.isFinite(a.duration) ? a.duration : 0;
  const playing = !!(a && !a.paused);
  // Cabecera
  $('[data-ref="title"]').textContent = song ? song.title : 'Sin canción cargada';
  $('[data-ref="meta"]').textContent = song ? [getEffectiveKey(song) || song.key, song.bpm ? `${song.bpm} BPM` : ''].filter(Boolean).join(' · ') : 'Elige una canción en la lista o en el servicio';
  const prev = svc.length > 1 && idx > 0 ? svc[idx - 1] : null;
  const next = svc.length > 1 ? peekNextServiceSong() : null;
  $('[data-act="prev"]').disabled = !prev;
  $('[data-act="next"]').disabled = !next;
  $('[data-ref="prev"]').textContent = prev ? prev.title : '';
  $('[data-ref="next"]').textContent = next ? next.title : '';
  // Secciones
  const ms = sections();
  let cur = -1; ms.forEach((m, k) => { if (m.t <= t + 0.05) cur = k; });
  const pend = getPendingJump();
  const sig = ms.map((m) => `${m.label}@${m.t}`).join('|');
  const grid = $('[data-ref="grid"]');
  if (sig !== lastSecSig) {
    lastSecSig = sig;
    grid.innerHTML = ms.length
      ? ms.map((m, k) => `<button type="button" class="lt-sec" data-sec="${k}" style="--h:${sectionHue(m.label)}"><b>${esc(m.label)}</b><small>${fmt(m.t)}</small></button>`).join('')
      : '<p class="lt-empty">Esta pista no tiene secciones. Márcalas en el espectro o usa «Detectar automáticamente».</p>';
    fitGrid();
  }
  grid.querySelectorAll('[data-sec]').forEach((b) => {
    const k = Number(b.dataset.sec);
    b.classList.toggle('is-cur', k === cur);
    b.classList.toggle('is-pend', !!(pend && ms[k] && Math.abs(ms[k].t - pend.to) < 0.05));
  });
  const nx = ms[cur + 1];
  $('[data-ref="now"]').textContent = cur >= 0 ? ms[cur].label : (song ? '—' : '');
  $('[data-ref="then"]').textContent = pend ? `Preparado: ${pend.label}` : nx ? `Siguiente: ${nx.label} en ${fmt(nx.t - t)}` : '';
  $('[data-act="cancel"]').hidden = !pend;
  // Transporte
  const pb = $('[data-act="play"]');
  if (pb.classList.contains('is-on') !== playing || !pb.dataset.painted) {
    pb.dataset.painted = '1';
    pb.classList.toggle('is-on', playing);
    pb.querySelector('svg').innerHTML = playing ? '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>' : '<polygon points="6,4 20,12 6,20"/>';
    pb.querySelector('span').textContent = playing ? 'Pausa' : 'Play';
  }
  $('[data-ref="time"]').textContent = `${fmt(t)} / ${fmt(dur)}`;
  $('[data-ref="bar"]').style.width = dur ? `${Math.min(100, (100 * t) / dur)}%` : '0';
  const pbn = $('[data-act="planb"]');
  const on = !!(window.__lpPlanB && window.__lpPlanB.isOn());
  pbn.classList.toggle('is-on', on);
  pbn.querySelector('span').textContent = on ? 'Salir del Plan B' : 'Plan B';
  ov.querySelectorAll('[data-jm]').forEach((b) => b.classList.toggle('is-on', b.dataset.jm === jumpMode()));
}

// Columnas que dan los botones más grandes sin dejar media pantalla vacía (ni pasarse de alto).
function fitGrid() {
  if (!ov) return;
  const grid = ov.querySelector('[data-ref="grid"]');
  const n = grid.querySelectorAll('.lt-sec').length;
  if (!n) { grid.style.gridTemplateColumns = ''; grid.style.gridAutoRows = ''; return; }
  const W = grid.clientWidth, H = grid.clientHeight, gap = 10;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const w = (W - gap * (cols - 1)) / cols;
    if (w < 140 && cols > 1) break;
    const rows = Math.ceil(n / cols);
    const h = Math.min((H - gap * (rows - 1)) / rows, w / 1.15, 260);
    if (h < 72) continue;
    const score = w * h - (cols * rows - n) * 400;   // poco hueco al final
    if (!best || score > best.score) best = { cols, h, score };
  }
  if (!best) best = { cols: Math.max(1, Math.floor((W + gap) / (150 + gap))), h: 84 };
  grid.style.gridTemplateColumns = `repeat(${best.cols}, minmax(0, 1fr))`;
  grid.style.gridAutoRows = `${Math.floor(best.h)}px`;
  grid.style.setProperty('--lt-fs', `${Math.round(Math.max(17, Math.min(34, best.h / 4.2)))}px`);
}

export function closeLiveTouch() {
  if (!ov) return;
  if (off) off(); off = null;
  if (ro) { ro.disconnect(); ro = null; }
  if (pop) pop(); pop = null;
  ov.remove(); ov = null; lastSecSig = '';
  document.body.classList.remove('live-touch-open');
}

export function openLiveTouch() {
  if (ov) return;
  ov = document.createElement('div');
  ov.id = 'live-touch';
  ov.className = 'live-touch';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Vista de directo');
  ov.innerHTML = `
    <header class="lt-top">
      <button type="button" class="lt-btn lt-nav" data-act="prev"><span class="lt-arrow" aria-hidden="true">◀</span><span class="lt-navtxt"><em>Anterior</em><small data-ref="prev"></small></span></button>
      <div class="lt-song"><b data-ref="title"></b><span data-ref="meta"></span></div>
      <button type="button" class="lt-btn lt-nav lt-nav--next" data-act="next"><span class="lt-navtxt"><em>Siguiente</em><small data-ref="next"></small></span><span class="lt-arrow" aria-hidden="true">▶</span></button>
      <button type="button" class="lt-btn lt-exit" data-act="exit" title="Salir (Esc)">Salir</button>
    </header>
    <div class="lt-status"><span class="lt-now" data-ref="now"></span><span class="lt-then" data-ref="then"></span>
      <button type="button" class="lt-btn lt-cancel" data-act="cancel" hidden>Cancelar salto</button>
      <div class="ui-seg lt-modes" role="group" aria-label="Cuándo entra el salto">${Object.entries(JUMP_MODES).map(([k, l]) => `<button type="button" class="ui-seg-btn" data-jm="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="lt-grid" data-ref="grid"></div>
    <footer class="lt-bottom">
      <div class="lt-actions">
        <button type="button" class="lt-btn lt-big lt-play" data-act="play"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg><span>Play</span></button>
        <button type="button" class="lt-btn lt-big" data-act="repeat"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg><span>Repetir sección</span></button>
        <button type="button" class="lt-btn lt-big" data-act="soft"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M6 10.5h12M8.5 15h7M11 19.5h2"/></svg><span>Terminar suave</span></button>
        <button type="button" class="lt-btn lt-big lt-planb" data-act="planb"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/></svg><span>Plan B</span></button>
      </div>
      <div class="lt-progress"><div class="lt-bar"><i data-ref="bar"></i></div><span class="lt-time" data-ref="time"></span>
        <div class="vu lt-vu" role="meter" aria-label="Nivel de salida" title="Nivel de salida. «SAT»: la mezcla satura."><i class="vu-fill"></i><i class="vu-peak"></i><b class="vu-sat" hidden>SAT</b></div></div>
    </footer>`;
  document.body.appendChild(ov);
  document.body.classList.add('live-touch-open');
  pop = pushModal(closeLiveTouch, ov);
  attachVuMeter(ov.querySelector('.lt-vu'));
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const sec = b.dataset.sec;
    if (sec != null) { arrangeGoto(Number(sec)); paint(); return; }
    if (b.dataset.jm) { setJumpMode(b.dataset.jm); paint(); return; }
    switch (b.dataset.act) {
      case 'exit': closeLiveTouch(); return;
      case 'prev': servicePrevSong(); break;
      case 'next': serviceNextSong(); break;
      case 'play': click('#tp-play-btn'); break;
      case 'repeat': arrange('repeat'); break;
      case 'cancel': arrangeCancel(); break;
      case 'soft': click('#tp-softend-btn'); break;
      case 'planb': click('#tp-planb-btn'); break;
      default: return;
    }
    setTimeout(paint, 80);
  });
  off = whilePlaying(paint, 250, { idleMs: 1000 });
  try { let raf = 0; ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitGrid); }); ro.observe(ov.querySelector('[data-ref="grid"]')); } catch (_) {}
  window.addEventListener('livepads:planb', paint);
  paint();
}

export function toggleLiveTouch() { if (ov) closeLiveTouch(); else openLiveTouch(); }
