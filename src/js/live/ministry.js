// ─────────────────────────────────────────────────────────────────────────
// Modo ministración (adoración espontánea / oración): una progresión que se
// repite sin fin con el pad, al BPM del metrónomo, hasta que el líder la para.
// Muestra el acorde actual y el siguiente en grande; la banda recibe la
// progresión en sus móviles. Botón «Ministración» junto a «Sigue acordes».
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { PROGRESSIONS, progressionChords } from './ministryCore.js';
import { sendText } from './directorCues.js';

const PREF = 'livepads.ministry';
const prefs = () => { try { return { prog: 'pop', bars: 2, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch (_) { return { prog: 'pop', bars: 2 }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (_) {} };

let deps = { playPadChord: () => {}, bpm: () => 0, currentKey: () => '', stopPad: () => {}, prefetchChord: () => {} };
let panel = null, run = null;

function stop(silent = false) {
  if (run) { clearTimeout(run.t); run = null; }
  paint();
  if (!silent) window.showToast?.('Ministración detenida: el pad sigue en el último acorde.', 'info');
}

function startLoop() {
  const p = prefs();
  const key = panel.querySelector('[data-ref="key"]').value.trim() || deps.currentKey();
  const chords = progressionChords(key, p.prog);
  if (!chords.length) { window.showToast?.('Escribe un tono (G, Am, Bb…) para empezar.', 'error'); return; }
  const barS = (4 * 60) / (Number(deps.bpm()) || 72);
  run = { chords, i: 0, t: null, stepS: Math.max(1.5, barS * p.bars), key };
  // Todos los acordes de la progresión, a memoria desde ya (cambios sin cortes).
  chords.forEach((c) => { try { deps.prefetchChord(c.pc, c.minor); } catch (_) {} });
  sendText('Ministración: ' + chords.map((c) => c.name).join(' – '), 'Pad');
  const step = () => {
    if (!run) return;
    const c = run.chords[run.i % run.chords.length];
    try { deps.playPadChord(c.pc, c.minor); } catch (_) {}
    paint();
    run.i++;
    run.t = setTimeout(step, run.stepS * 1000);
  };
  step();
}

function paint() {
  if (!panel) return;
  const on = !!run;
  panel.querySelector('[data-act="go"]').textContent = on ? 'Parar' : 'Empezar';
  panel.querySelector('[data-act="go"]').classList.toggle('is-on', on);
  const now = panel.querySelector('[data-ref="now"]'), nx = panel.querySelector('[data-ref="next"]');
  if (on) {
    const n = run.chords.length, cur = run.chords[(run.i) % n], nxt = run.chords[(run.i + 1) % n];
    now.textContent = cur ? cur.name : '—';
    nx.textContent = n > 1 && nxt ? 'Sigue: ' + nxt.name : '';
  } else { now.textContent = ''; nx.textContent = 'Elige la progresión y pulsa Empezar.'; }
}

function close() { if (panel) { panel.remove(); panel = null; } }

export function toggleMinistryPanel(anchor) {
  if (panel) { close(); return; }
  const p = prefs();
  panel = document.createElement('div');
  panel.className = 'dc-pal mi-pal';
  panel.innerHTML = `
    <div class="dc-head"><b>Modo ministración</b><span>Para la oración o la adoración espontánea: el pad repite la progresión sin fin hasta que la pares.</span></div>
    <div class="mi-row"><label>Tono <input data-ref="key" value="${esc(deps.currentKey() || '')}" placeholder="G, Am…" maxlength="4"></label>
      <label>Cada acorde <select data-ref="bars">${[1, 2, 4].map((b) => `<option value="${b}" ${p.bars === b ? 'selected' : ''}>${b} compás${b > 1 ? 'es' : ''}</option>`).join('')}</select></label></div>
    <div class="mi-progs">${PROGRESSIONS.map((x) => `<button type="button" data-prog="${x.id}" class="${x.id === p.prog ? 'is-on' : ''}">${esc(x.label)}</button>`).join('')}</div>
    <div class="mi-now"><b data-ref="now"></b><span data-ref="next"></span></div>
    <div class="mi-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button><button type="button" class="vn-btn vn-btn--primary" data-act="go">Empezar</button></div>`;
  document.body.appendChild(panel);
  const r = anchor.getBoundingClientRect();
  const place = () => {
    panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 8)) + 'px';
    panel.style.left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, r.right - panel.offsetWidth)) + 'px';
  };
  place(); requestAnimationFrame(place);   // otra vez ya pintado (la altura final cambia al cargar las fuentes)
  panel.addEventListener('click', (e) => {
    const pr = e.target.closest('[data-prog]');
    if (pr) {
      const q = { ...prefs(), prog: pr.dataset.prog }; savePrefs(q);
      panel.querySelectorAll('[data-prog]').forEach((b) => b.classList.toggle('is-on', b === pr));
      if (run) { stop(true); startLoop(); }
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'go') { if (run) stop(); else startLoop(); }
    else if (act === 'close') close();
  });
  panel.querySelector('[data-ref="bars"]').addEventListener('change', (e) => { savePrefs({ ...prefs(), bars: Number(e.target.value) || 2 }); if (run) { stop(true); startLoop(); } });
  paint();
}

export function initMinistry(d) {
  deps = { ...deps, ...d };
  document.getElementById('pad-ministry')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMinistryPanel(e.currentTarget); });
}
