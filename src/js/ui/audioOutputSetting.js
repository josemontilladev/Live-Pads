// Ajustes → Audio → «Salida de audio»: elegir el dispositivo y enviar el click y
// la guía por las salidas 3-4. La lógica vive en audio/audioOutput.js.
import { q } from '../utils/dom.js';
import { listOutputs, getSavedOutput, getClickAlt, setOutput, setClickAlt, outputChannels } from '../audio/audioOutput.js';
import { IN_EAR_KINDS, inEarLevels, setInEarLevel } from '../audio/inEarMix.js';
import { stableAudioOn, setStableAudio, dropoutStats, onDropout } from '../audio/dropoutMonitor.js';

export function initAudioOutputSetting(getEngine) {
  const sel = q('#audio-out-select'), alt = q('#audio-out-alt'), hint = q('#audio-out-hint');
  if (!sel || !alt) return;

  const paintAlt = () => {
    const engine = getEngine();
    const ch = engine && engine.ctx ? outputChannels(engine) : 2;
    const can = ch >= 4;
    alt.disabled = !can;
    alt.checked = can && getClickAlt();
    alt.closest('.audio-out-alt')?.classList.toggle('is-disabled', !can);
    if (hint) hint.textContent = can
      ? `Esta salida tiene ${ch} canales: el click y la guía irán por 3-4 y el resto por 1-2.`
      : 'Esta salida solo tiene 2 canales. Conecta una interfaz de 4 o más salidas y elígela arriba.';
  };

  const fill = async () => {
    const outs = await listOutputs();
    const saved = getSavedOutput();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    sel.innerHTML = '<option value="">Predeterminada del sistema</option>'
      + outs.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')
      // La elegida ya no está conectada: se muestra igual para que se entienda por qué suena por otra.
      + (saved.id && !outs.some((o) => o.id === saved.id) ? `<option value="${esc(saved.id)}" disabled>${esc(saved.label || 'Salida guardada')} (desconectada)</option>` : '');
    sel.value = saved.id && outs.some((o) => o.id === saved.id) ? saved.id : '';
    paintAlt();
  };

  sel.addEventListener('change', async () => {
    const engine = getEngine();
    const label = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    try {
      await setOutput(engine, sel.value, sel.value ? label : '');
      window.showToast?.(sel.value ? `Sonando por «${label}».` : 'Sonando por la salida predeterminada del sistema.', 'success');
    } catch (err) {
      window.showToast?.('No se pudo cambiar la salida: ' + ((err && err.message) || err), 'error');
      await fill();
    }
    paintAlt();
  });
  alt.addEventListener('change', () => {
    const on = setClickAlt(getEngine(), alt.checked);
    if (alt.checked && !on) window.showToast?.('Esta salida no admite 4 canales.', 'error');
    paintAlt();
    paintInEar();
  });
  // Mezcla de los in-ears (audio/inEarMix.js): solo con 3-4 activo.
  const ie = q('#inear-mix'), ieRows = q('#inear-mix-rows');
  const paintInEar = () => {
    if (!ie || !ieRows) return;
    ie.hidden = !alt.checked;
    const lv = inEarLevels();
    if (!ieRows.childElementCount) {
      ieRows.innerHTML = Object.entries(IN_EAR_KINDS).map(([k, l]) => `<label class="inear-row"><span>${l}</span><input type="range" min="0" max="150" step="1" data-ie="${k}" aria-label="${l} en los in-ears"><b data-iev="${k}"></b></label>`).join('');
      ieRows.addEventListener('input', (e) => {
        const k = e.target.dataset.ie;
        if (!k) return;
        setInEarLevel(k, Number(e.target.value) / 100);
        const out = ieRows.querySelector(`[data-iev="${k}"]`); if (out) out.textContent = `${e.target.value}%`;
      });
    }
    for (const k of Object.keys(IN_EAR_KINDS)) {
      const r = ieRows.querySelector(`[data-ie="${k}"]`), o = ieRows.querySelector(`[data-iev="${k}"]`);
      if (r) r.value = String(Math.round(lv[k] * 100));
      if (o) o.textContent = `${Math.round(lv[k] * 100)}%`;
    }
  };
  paintInEar();
  // Cambio de tono de alta calidad (audio/pitchAudio.js).
  const hq = q('#pitch-hq');
  if (hq) {
    import('../audio/pitchAudio.js').then(({ pitchHQOn, PITCH_HQ_KEY }) => {
      hq.checked = pitchHQOn();
      hq.addEventListener('change', () => {
        try { localStorage.setItem(PITCH_HQ_KEY, hq.checked ? '1' : '0'); } catch (_) {}
        window.showToast?.(hq.checked ? 'Cambio de tono de alta calidad activado (se nota en la próxima canción que transpongas).' : 'Cambio de tono clásico (menos proceso).', 'info');
      });
    });
  }
  // Audio estable + cortes de esta sesión (audio/dropoutMonitor.js).
  const stable = q('#audio-stable'), dHint = q('#audio-dropout-hint');
  if (stable) {
    const startedStable = stableAudioOn();
    stable.checked = startedStable;
    const paintDrops = () => {
      if (!dHint) return;
      const s = dropoutStats(), engine = getEngine();
      const ms = engine && engine.ctx ? Math.round(((engine.ctx.baseLatency || 0) + (engine.ctx.outputLatency || 0)) * 1000) : 0;
      const lat = ms ? ` · latencia ${ms} ms` : '';
      if (stable.checked !== startedStable) { dHint.textContent = 'Se aplica al reiniciar LivePads.'; return; }
      if (!s.supported) { dHint.textContent = 'Menos cortes en equipos justos, a cambio de algo más de retraso.' + lat; return; }
      dHint.textContent = s.total
        ? `${s.total === 1 ? '1 corte' : s.total + ' cortes'} de audio en esta sesión${lat}. Si se repiten, actívalo.`
        : `Sin cortes de audio en esta sesión${lat}.`;
      dHint.classList.toggle('is-warn', !!s.total);
    };
    stable.addEventListener('change', () => {
      setStableAudio(stable.checked);
      window.showToast?.(stable.checked ? 'Audio estable activado: se aplica al reiniciar LivePads.' : 'Audio estable desactivado: se aplica al reiniciar LivePads.', 'info');
      paintDrops();
    });
    onDropout(paintDrops);
    q('#sidebar')?.addEventListener('transitionend', (e) => { if (e.target.id === 'sidebar' && e.target.classList.contains('open')) paintDrops(); });
    paintDrops();
  }
  // Enchufar o desenchufar una interfaz actualiza la lista sola.
  try { navigator.mediaDevices.addEventListener('devicechange', fill); } catch (_) {}
  // La lista se rellena al abrir Ajustes (no en el arranque).
  q('#sidebar')?.addEventListener('transitionend', (e) => { if (e.target.id === 'sidebar' && e.target.classList.contains('open')) fill(); });
  fill();
}
