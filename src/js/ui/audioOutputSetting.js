// Ajustes → Audio → «Salida de audio»: elegir el dispositivo y enviar el click y
// la guía por las salidas 3-4. La lógica vive en audio/audioOutput.js.
import { q } from '../utils/dom.js';
import { listOutputs, getSavedOutput, getClickAlt, setOutput, setClickAlt, outputChannels } from '../audio/audioOutput.js';

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
  });
  // Enchufar o desenchufar una interfaz actualiza la lista sola.
  try { navigator.mediaDevices.addEventListener('devicechange', fill); } catch (_) {}
  // La lista se rellena al abrir Ajustes (no en el arranque).
  q('#sidebar')?.addEventListener('transitionend', (e) => { if (e.target.id === 'sidebar' && e.target.classList.contains('open')) fill(); });
  fill();
}
