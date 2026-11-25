// Ventana «Sonido del teclado (MIDI)» de una canción: salida y canal (de este equipo), el sonido de
// la canción y, si se quiere, uno por sección marcada. La lógica vive en midi/midiOut.js.
import { esc } from '../utils/dom.js';
import { listOutputs, deviceSettings, setDeviceSettings, songPatch, setSongPatch, sendProgram } from '../midi/midiOut.js';

const num = (v, lo, hi) => { const n = parseInt(String(v).trim(), 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

export async function openMidiOutDialog(song) {
  if (!song) return;
  const outs = await listOutputs();
  const dev = deviceSettings();
  const p = songPatch(song.id) || {};
  const labels = [...new Set((Array.isArray(song.markers) ? song.markers : []).slice().sort((a, b) => a.t - b.t).map((m) => m && m.label).filter(Boolean))];
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box mo-box" role="dialog" aria-modal="true" aria-label="Sonido del teclado">
      <div class="vn-head"><b>Sonido del teclado (MIDI)</b><span>${esc(song.title || '')}</span></div>
      <p class="vn-why">Al preparar la canción, LivePads cambia el sonido de tu teclado; y al llegar a cada sección marcada, el de esa sección. Se guarda en este equipo (los números son de tu teclado).</p>
      <div class="mo-grid">
        <label class="vn-field">Salida MIDI
          <select data-ref="out">${outs.length ? outs.map((o) => `<option value="${esc(o.id)}" ${o.id === dev.outputId || (!dev.outputId && o.name === dev.outputName) ? 'selected' : ''}>${esc(o.name)}</option>`).join('') : '<option value="">No hay salidas MIDI conectadas</option>'}</select></label>
        <label class="vn-field mo-narrow">Canal
          <select data-ref="ch">${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}" ${i + 1 === dev.channel ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      </div>
      <div class="mo-grid">
        <label class="vn-field">Sonido de la canción (1–128)<input data-ref="pc" inputmode="numeric" placeholder="Ej. 5" value="${p.pc ?? ''}"></label>
        <label class="vn-field mo-narrow">Banco MSB<input data-ref="msb" inputmode="numeric" placeholder="—" value="${p.msb ?? ''}"></label>
        <label class="vn-field mo-narrow">LSB<input data-ref="lsb" inputmode="numeric" placeholder="—" value="${p.lsb ?? ''}"></label>
      </div>
      ${labels.length ? `<div class="mo-secs"><div class="mo-k">Por sección (vacío = el de la canción)</div>${labels.map((l) => `<label class="mo-sec"><span>${esc(l)}</span><input data-sec="${esc(l)}" inputmode="numeric" placeholder="—" value="${(p.sections && p.sections[l]) ?? ''}"></label>`).join('')}</div>`
        : '<p class="vn-why">Para cambiar de sonido por sección, marca las secciones en la onda de la canción (Verso, Coro…).</p>'}
      <label class="mo-auto"><input type="checkbox" data-ref="on" ${dev.enabled ? 'checked' : ''}> Enviar los sonidos automáticamente (todas las canciones)</label>
      <div class="vn-actions">
        ${songPatch(song.id) ? '<button type="button" class="vn-btn" data-act="clear">Quitar</button>' : ''}
        <button type="button" class="vn-btn" data-act="test">Probar</button>
        <button type="button" class="vn-btn" data-act="cancel">Cancelar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="save">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const saveDevice = () => {
    const sel = $('[data-ref="out"]');
    const name = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    setDeviceSettings({ outputId: sel.value, outputName: sel.value ? name : '', channel: num($('[data-ref="ch"]').value, 1, 16) || 1, enabled: $('[data-ref="on"]').checked });
  };
  const patch = () => {
    const pc = num($('[data-ref="pc"]').value, 1, 128);
    const sections = {};
    ov.querySelectorAll('[data-sec]').forEach((i) => { const v = num(i.value, 1, 128); if (v) sections[i.dataset.sec] = v; });
    if (!pc && !Object.keys(sections).length) return null;
    return { pc, msb: num($('[data-ref="msb"]').value, 0, 127), lsb: num($('[data-ref="lsb"]').value, 0, 127), sections };
  };
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close();
    else if (act === 'test') {
      saveDevice();
      const pt = patch();
      const ok = pt && pt.pc ? await sendProgram(pt) : false;
      window.showToast?.(ok ? `Sonido ${pt.pc} enviado al teclado.` : (pt && pt.pc ? 'No se encontró la salida MIDI: conecta el teclado y elígela arriba.' : 'Escribe el número de programa.'), ok ? 'success' : 'error');
    } else if (act === 'clear') { setSongPatch(song.id, null); close(); window.showToast?.('Sonido del teclado quitado de esta canción.', 'info'); }
    else if (act === 'save') {
      saveDevice();
      const pt = patch();
      if (!pt) { window.showToast?.('Escribe al menos un número de programa.', 'error'); return; }
      setSongPatch(song.id, pt);
      close();
      window.showToast?.('Guardado: al preparar la canción tu teclado cambiará de sonido solo.', 'success');
    }
  });
}
