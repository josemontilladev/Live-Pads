// ─────────────────────────────────────────────────────────────────────────
// Prueba de rango vocal (cabecera → «Voces» → «Prueba de rango vocal…»).
// Con el micrófono: la nota más grave cómoda y la más aguda cómoda (cada una se
// fija sola al sostenerla un segundo). Se guarda por cantante y sirve para sugerir
// el tono de las canciones que no tienen uno guardado para esa persona
// (servicio → «Quién dirige»). Guardado en este equipo: «livepads.voiceRanges».
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { autoCorrelate } from '../audio/pitchDetector.js';
import { freqToMidi, noteName, stableNote, voiceType, suggestKey } from './vocalRangeCore.js';

const KEY = 'livepads.voiceRanges';
export const voiceRanges = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } };
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Rango guardado de un cantante (sin distinguir mayúsculas ni acentos) o null. */
export function rangeOf(name) {
  const all = voiceRanges(), k = Object.keys(all).find((x) => fold(x) === fold(name));
  return k ? all[k] : null;
}
/** Tono sugerido para un cantante con rango guardado (o null). */
export function suggestFor(name, originalKey) {
  const r = rangeOf(name);
  return r ? suggestKey(r.low, r.high, originalKey) : null;
}

let ov = null, mic = null, raf = 0;

function stopMic() {
  cancelAnimationFrame(raf); raf = 0;
  if (mic) { try { mic.stream.getTracks().forEach((t) => t.stop()); mic.ctx.close(); } catch (_) {} mic = null; }
}

export async function openVocalRange(defaultName = '') {
  if (ov) return;
  const st = { step: 'name', low: null, high: null, samples: [] };
  ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box vr-box" role="dialog" aria-modal="true" aria-label="Prueba de rango vocal">
      <div class="vn-head"><b>Prueba de rango vocal</b><span>Con el micrófono: tu nota más grave y tu nota más aguda, cómodas (sin forzar). LivePads sugiere después el tono de cada canción para tu voz.</span></div>
      <label class="vn-field">¿Quién canta?<input data-ref="name" maxlength="40" placeholder="Nombre (p. ej. María)" value="${esc(defaultName)}"></label>
      <div class="vr-stage">
        <div class="vr-step" data-ref="step">Escribe tu nombre y pulsa Empezar.</div>
        <div class="vr-note"><b data-ref="note">—</b><span data-ref="hint"></span></div>
        <div class="vr-meter"><i data-ref="bar"></i></div>
        <div class="vr-res" data-ref="res"></div>
      </div>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="close">Cerrar</button>
        <button type="button" class="vn-btn" data-act="use" hidden>Usar esta nota</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="go">Empezar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const R = (k) => ov.querySelector(`[data-ref="${k}"]`);
  const close = () => { stopMic(); ov.remove(); ov = null; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  let current = null;

  const setStep = (s) => {
    st.step = s; st.samples = [];
    const go = ov.querySelector('[data-act="go"]'), use = ov.querySelector('[data-act="use"]');
    use.hidden = !(s === 'low' || s === 'high');
    if (s === 'low') { R('step').innerHTML = '<b>1 de 2 ·</b> Canta tu nota <b>más grave</b> cómoda con «aaa» y sostenla.'; go.textContent = 'Reiniciar'; }
    if (s === 'high') { R('step').innerHTML = '<b>2 de 2 ·</b> Ahora tu nota <b>más aguda</b> cómoda (sin forzar) y sostenla.'; }
    if (s === 'done') {
      stopMic(); use.hidden = true; go.textContent = 'Repetir';
      const lo = Math.min(st.low, st.high), hi = Math.max(st.low, st.high);
      const name = R('name').value.trim();
      const all = voiceRanges(); all[name] = { low: lo, high: hi, at: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (_) {}
      R('step').innerHTML = `<b>¡Listo, ${esc(name)}!</b> Tu rango cómodo: <b>${noteName(lo)} – ${noteName(hi)}</b> · voz de <b>${voiceType(lo, hi).toLowerCase()}</b>.`;
      R('note').textContent = '✓'; R('hint').textContent = 'Guardado. En el Servicio, elige «Quién dirige» y las canciones sin tono para ti tendrán uno sugerido.';
      import('../data/service.js').then(({ getServiceSongs, getEffectiveKey }) => {
        const rows = getServiceSongs().slice(0, 12).map((s) => { const sg = suggestKey(lo, hi, s.key); return sg ? `<li><span>${esc(s.title)}</span><b>${esc(s.key)} → ${esc(sg.key)}</b><small>${sg.shift ? (sg.shift > 0 ? `sube ${sg.shift}` : `baja ${-sg.shift}`) + ' semitonos' : 'igual'}</small></li>` : ''; }).join('');
        R('res').innerHTML = rows ? `<div class="vr-k">Tonos sugeridos para el servicio de hoy</div><ul>${rows}</ul>` : '';
      });
    }
  };

  async function startMic() {
    stopMic();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: true } }); }
    catch (_) { R('step').textContent = 'No se pudo abrir el micrófono. Revisa los permisos de Windows.'; return false; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(an);
    mic = { stream, ctx, an, buf: new Float32Array(an.fftSize) };
    const loop = () => {
      if (!mic || !ov) return;
      mic.an.getFloatTimeDomainData(mic.buf);
      let rms = 0; for (let i = 0; i < mic.buf.length; i += 4) rms += mic.buf[i] * mic.buf[i];
      rms = Math.sqrt(rms / (mic.buf.length / 4));
      R('bar').style.width = Math.min(100, rms * 400) + '%';
      const f = rms > 0.01 ? autoCorrelate(mic.buf, mic.ctx.sampleRate) : -1;
      const now = performance.now() / 1000;
      if (f > 60 && f < 1400) {
        const m = freqToMidi(f);
        current = Math.round(m);
        st.samples.push({ t: now, m }); if (st.samples.length > 120) st.samples.shift();
        R('note').textContent = noteName(current);
        const hold = stableNote(st.samples, now);
        R('hint').textContent = hold != null ? 'Perfecto, la guardo…' : 'Sostenla un segundo';
        if (hold != null && (st.step === 'low' || st.step === 'high')) {
          if (st.step === 'low') { st.low = hold; setStep('high'); }
          else { st.high = hold; setStep('done'); return; }
        }
      } else { R('hint').textContent = rms > 0.01 ? 'Canta una vocal abierta («aaa»)' : 'Te escucho cuando cantes…'; }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return true;
  }

  ov.addEventListener('click', async (e) => {
    if (e.target === ov) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'go') {
      if (!R('name').value.trim()) { R('name').focus(); R('step').textContent = 'Primero escribe quién canta.'; return; }
      st.low = st.high = null; R('res').innerHTML = '';
      if (await startMic()) setStep('low');
    } else if (act === 'use' && current != null) {
      if (st.step === 'low') { st.low = current; setStep('high'); }
      else if (st.step === 'high') { st.high = current; setStep('done'); }
    }
  });
  R('name').focus();
}
