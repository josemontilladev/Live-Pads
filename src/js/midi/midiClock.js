// ─────────────────────────────────────────────────────────────────────────
// Reloj MIDI: tempo compartido con otros equipos (Ableton, Logic, cajas de
// ritmos, loopers, pedaleras…), sin licencias (es el estándar MIDI).
//   · Enviar: LivePads manda el tempo de su metrónomo (24 pulsos por negra,
//     con marca de tiempo exacta, programados por adelantado) y Start/Stop al
//     empezar o parar la pista o el metrónomo.
//   · Recibir: el tempo lo pone otro equipo; LivePads lo mide y ajusta su BPM
//     (y, si se quiere, arranca/para el metrónomo con su Start/Stop).
// Se guarda por equipo: livepads.midiClock → { mode: ''|'send'|'receive', outId, inId, transport }
// El puente con el metrónomo lo pone app.js: window.__lpTempo = { get(), set(bpm), running(), toggle() }.
// ─────────────────────────────────────────────────────────────────────────

import { CLOCK, START, STOP, scheduleTicks, bpmFromTicks } from './midiClockCore.js';
import { pushModal } from '../ui/modalStack.js';

const KEY = 'livepads.midiClock';
const DEF = { mode: '', outId: '', inId: '', transport: true };
export const clockSettings = () => { try { return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (_) { return { ...DEF }; } };
const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) {} };
const tempo = () => window.__lpTempo || null;

let access = null, timer = 0, next = 0, wasRunning = false, out = null, inp = null, stamps = [], lastSet = 0;
export const clockState = { sent: 0, starts: 0, stops: 0, received: null };

async function midi() {
  if (access) return access;
  if (!navigator.requestMIDIAccess) return null;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch (_) { access = null; }
  return access;
}
export async function listPorts() {
  const a = await midi();
  return { outputs: a ? [...a.outputs.values()].map((o) => ({ id: o.id, name: o.name })) : [], inputs: a ? [...a.inputs.values()].map((o) => ({ id: o.id, name: o.name })) : [] };
}

function stopAll() {
  clearInterval(timer); timer = 0;
  if (out && wasRunning) { try { out.send([STOP]); clockState.stops++; } catch (_) {} }
  wasRunning = false;
  if (inp) { inp.onmidimessage = null; inp = null; }
  out = null; stamps = [];
}

function sendLoop() {
  const T = tempo();
  if (!out || !T) return;
  const now = performance.now();
  const running = !!T.running();
  const c = clockSettings();
  if (c.transport && running !== wasRunning) {
    try { out.send([running ? START : STOP], now); running ? clockState.starts++ : clockState.stops++; } catch (_) {}
    if (running) next = now;   // el primer pulso, junto con el Start
  }
  wasRunning = running;
  const r = scheduleTicks(next || now, now, now + 100, T.get());
  for (const ts of r.times) { try { out.send([CLOCK], ts); clockState.sent++; } catch (_) {} }
  next = r.next;
}

function onMessage(e) {
  const st = e.data && e.data[0];
  const c = clockSettings();
  const T = tempo();
  if (st === CLOCK) {
    stamps.push(e.timeStamp || performance.now());
    if (stamps.length > 48) stamps.shift();
    const bpm = bpmFromTicks(stamps);
    if (bpm && T && performance.now() - lastSet > 500) {
      clockState.received = bpm;
      const target = Math.round(bpm);
      if (Math.abs(target - T.get()) >= 1) { T.set(target); lastSet = performance.now(); }
    }
  } else if (c.transport && T && (st === START || st === STOP)) {
    const running = !!T.running();
    if ((st === START) !== running) T.toggle();
    if (st === STOP) stamps = [];
  }
}

export async function applyClock() {
  stopAll();
  const c = clockSettings();
  if (!c.mode) return { ok: true };
  const a = await midi();
  if (!a) return { ok: false, error: 'Este equipo no tiene MIDI disponible.' };
  if (c.mode === 'send') {
    out = [...a.outputs.values()].find((o) => o.id === c.outId) || null;
    if (!out) return { ok: false, error: 'Elige la salida MIDI.' };
    next = 0; timer = setInterval(sendLoop, 25);
  } else {
    inp = [...a.inputs.values()].find((o) => o.id === c.inId) || null;
    if (!inp) return { ok: false, error: 'Elige la entrada MIDI.' };
    inp.onmidimessage = onMessage;
  }
  return { ok: true };
}

export function initMidiClock() { if (clockSettings().mode) applyClock(); }

// ── Ventana ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export async function openMidiClockSettings() {
  if (document.getElementById('mclk-box')) return;
  const c = clockSettings();
  const ports = await listPorts();
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box mclk-box" id="mclk-box" role="dialog" aria-modal="true" aria-label="Reloj MIDI">
      <div class="vn-head"><b>Reloj MIDI (tempo con otros equipos)</b><span>Comparte el tempo con Ableton, Logic, cajas de ritmos, loopers o pedaleras por un cable o puerto MIDI.</span></div>
      <div class="ui-seg mclk-modes" role="group" aria-label="Reloj MIDI">
        <button type="button" class="ui-seg-btn" data-mode="">Apagado</button>
        <button type="button" class="ui-seg-btn" data-mode="send">Enviar el tempo</button>
        <button type="button" class="ui-seg-btn" data-mode="receive">Recibir el tempo</button>
      </div>
      <p class="proj-hint" data-ref="hint"></p>
      <label class="vn-field" data-ref="outf">Salida MIDI <select data-f="outId"><option value="">— Elige —</option>${ports.outputs.map((o) => `<option value="${esc(o.id)}" ${o.id === c.outId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <label class="vn-field" data-ref="inf">Entrada MIDI <select data-f="inId"><option value="">— Elige —</option>${ports.inputs.map((o) => `<option value="${esc(o.id)}" ${o.id === c.inId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <label class="sm-use" data-ref="trf"><input type="checkbox" class="mo-switch" data-f="transport" ${c.transport ? 'checked' : ''}> <span><b data-ref="trl"></b><small data-ref="trs"></small></span></label>
      <div class="proj-test"><span data-ref="status" aria-live="polite"></span></div>
      <div class="vn-actions"><button type="button" class="vn-btn vn-btn--primary" data-act="close">Listo</button></div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let poll = 0;
  const close = () => { clearInterval(poll); pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  const cur = clockSettings();
  const paint = async () => {
    const k = clockSettings();
    ov.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === k.mode));
    $('[data-ref="outf"]').hidden = k.mode !== 'send';
    $('[data-ref="inf"]').hidden = k.mode !== 'receive';
    $('[data-ref="trf"]').hidden = !k.mode;
    $('[data-ref="trl"]').textContent = k.mode === 'receive' ? 'Seguir su Start / Stop' : 'Enviar Start / Stop';
    $('[data-ref="trs"]').textContent = k.mode === 'receive' ? 'El metrónomo arranca y para con el otro equipo.' : 'El otro equipo arranca y para con la pista o el metrónomo de LivePads.';
    $('[data-ref="hint"]').textContent = !k.mode ? 'El reloj MIDI está apagado.'
      : k.mode === 'send' ? 'LivePads marca el tempo (el de su metrónomo y sus canciones). En el otro equipo, pon la sincronización en «MIDI Clock externo».'
      : 'El tempo lo marca el otro equipo; LivePads lo mide y ajusta su BPM.';
    if (!ports.outputs.length && !ports.inputs.length) $('[data-ref="hint"]').textContent += ' No se ve ningún dispositivo MIDI: conecta la interfaz o activa un puerto virtual (loopMIDI).';
    const r = await applyClock();
    $('[data-ref="status"]').textContent = r.ok ? '' : r.error;
    $('[data-ref="status"]').className = r.ok ? '' : 'is-bad';
  };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const m = e.target.closest('[data-mode]');
    if (m) { save({ ...clockSettings(), mode: m.dataset.mode }); paint(); }
  });
  ov.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    save({ ...clockSettings(), [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    paint();
  });
  poll = setInterval(() => {
    const k = clockSettings(), st = $('[data-ref="status"]');
    if (!k.mode || st.classList.contains('is-bad')) return;
    st.className = 'is-ok';
    st.textContent = k.mode === 'send' ? `Enviando ${tempo() ? tempo().get() : '—'} BPM · ${clockState.sent} pulsos` : (clockState.received ? `Recibiendo ${clockState.received} BPM` : 'Esperando pulsos del otro equipo…');
  }, 500);
  void cur;
  paint();
}
