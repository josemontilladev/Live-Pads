// ─────────────────────────────────────────────────────────────────────────
// Calentamiento vocal guiado (menú ⋯ del servicio → «Calentamiento vocal…»).
// En el tono de la primera canción del servicio: el piano toca el acorde y la
// frase, el equipo de voces la canta, y cada vuelta sube medio tono (luego baja).
// La lógica de los ejercicios vive en warmupCore.js.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import * as piano from '../stems/pianoSampler.js';
import { EXERCISES, RANGES, tonicPc, buildPlan, noteName } from './warmupCore.js';

const PREF = 'livepads.warmup';
const prefs = () => { try { return { range: 'mid', speed: 1, steps: 4, ex: 'five', ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch (_) { return { range: 'mid', speed: 1, steps: 4, ex: 'five' }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREF, JSON.stringify({ ...prefs(), ...p })); } catch (_) {} };

let ov = null, timers = [], running = false;

function stop() {
  timers.forEach(clearTimeout); timers = [];
  try { piano.panic(); } catch (_) {}
  running = false;
  paint();
}
const at = (ms, fn) => timers.push(setTimeout(fn, ms));

function say(main, sub = '') {
  if (!ov) return;
  ov.querySelector('[data-ref="now"]').textContent = main;
  ov.querySelector('[data-ref="sub"]').textContent = sub;
}

async function start() {
  stop();
  const p = prefs();
  const ex = EXERCISES.find((e) => e.id === p.ex) || EXERCISES[0];
  running = true; paint();
  if (!ex.notes) { breathing(); return; }
  say('Cargando el piano…');
  try { await piano.loadSamples(); } catch (_) {}
  if (!running) return;
  const key = ov.querySelector('[data-ref="key"]').value.trim();
  const plan = buildPlan(ex.id, tonicPc(key), p.range, { steps: p.steps, speed: p.speed });
  const reps = plan.filter((e) => e.chord).length;
  for (const e of plan) {
    at(e.t * 1000, () => {
      if (e.chord) say(`Vuelta ${e.rep + 1} de ${reps}`, `${ex.how} · empieza en ${noteName(e.notes[0] + 12)}`);
      for (const n of e.notes) piano.noteOn(n, e.chord ? 62 : 88);
    });
    at((e.t + e.dur) * 1000, () => { for (const n of e.notes) piano.noteOff(n); });
  }
  const end = plan.length ? plan[plan.length - 1].t + 1.5 : 0;
  at(end * 1000, () => { running = false; paint(); say('¡Listo! Voces calientes.', 'Elige otro ejercicio o vuelve a empezar.'); });
}

// Respiración 4-4-8, cuatro veces, solo con la cuenta en pantalla.
function breathing() {
  const steps = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 1; i <= 4; i++) steps.push(['Inhala', i, 4, r]);
    for (let i = 1; i <= 4; i++) steps.push(['Sostén', i, 4, r]);
    for (let i = 1; i <= 8; i++) steps.push(['Suelta «sss»', i, 8, r]);
  }
  const beat = 1000 / (prefs().speed || 1);
  steps.forEach(([what, i, n, r], k) => at(k * beat, () => say(`${what} · ${i}`, `Vuelta ${r + 1} de 4 · ${n} tiempos`)));
  at(steps.length * beat, () => { running = false; paint(); say('¡Listo!', 'Ahora un ejercicio con el piano.'); });
}

function paint() {
  if (!ov) return;
  const b = ov.querySelector('[data-act="go"]');
  b.textContent = running ? 'Parar' : 'Empezar';
  b.classList.toggle('is-on', running);
  const p = prefs();
  ov.querySelectorAll('[data-ex]').forEach((x) => x.classList.toggle('is-on', x.dataset.ex === p.ex));
}

/** firstKey: tono de la primera canción del servicio (o el de la canción preparada). */
export function openWarmup(firstKey = '') {
  if (ov) return;
  const p = prefs();
  ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box wu-box" role="dialog" aria-modal="true" aria-label="Calentamiento vocal">
      <div class="vn-head"><b>Calentamiento vocal</b><span>Para el equipo de voces antes del servicio: el piano toca y ustedes cantan detrás. Cada vuelta sube medio tono.</span></div>
      <div class="mi-row">
        <label>Tono <input data-ref="key" value="${esc(firstKey || 'C')}" maxlength="4"></label>
        <label>Voces <select data-ref="range">${RANGES.map((r) => `<option value="${r.id}" ${r.id === p.range ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label>Velocidad <select data-ref="speed">${[[0.8, 'Lenta'], [1, 'Normal'], [1.2, 'Ágil']].map(([v, l]) => `<option value="${v}" ${Number(p.speed) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Subir <select data-ref="steps">${[3, 4, 6].map((n) => `<option value="${n}" ${Number(p.steps) === n ? 'selected' : ''}>${n} medios tonos</option>`).join('')}</select></label>
      </div>
      <div class="wu-list">${EXERCISES.map((e) => `<button type="button" data-ex="${e.id}"><b>${esc(e.name)}</b><small>${esc(e.how)}</small></button>`).join('')}</div>
      <div class="wu-now"><b data-ref="now">Elige un ejercicio y pulsa Empezar.</b><span data-ref="sub">${firstKey ? 'El tono es el de la primera canción del servicio (puedes cambiarlo).' : 'Escribe el tono de la primera canción que van a cantar.'}</span></div>
      <div class="mi-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button><button type="button" class="vn-btn vn-btn--primary" data-act="go">Empezar</button></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { stop(); ov.remove(); ov = null; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const exb = e.target.closest('[data-ex]');
    if (exb) { savePrefs({ ex: exb.dataset.ex }); paint(); if (running) start(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'go') { if (running) stop(); else start(); }
  });
  ov.querySelector('[data-ref="range"]').addEventListener('change', (e) => savePrefs({ range: e.target.value }));
  ov.querySelector('[data-ref="speed"]').addEventListener('change', (e) => savePrefs({ speed: Number(e.target.value) }));
  ov.querySelector('[data-ref="steps"]').addEventListener('change', (e) => savePrefs({ steps: Number(e.target.value) }));
  paint();
  piano.loadSamples().catch(() => {});
}
