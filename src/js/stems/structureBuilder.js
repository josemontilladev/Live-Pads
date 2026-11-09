// Ventana "Armar por secciones": eliges la estructura (Intro 4 · Verso 8…) y
// los instrumentos; cada celda propone un loop (loopStructure.js) que se puede
// cambiar. Las secciones del mismo tipo comparten loop: cambiar el del Coro
// cambia todos los coros. Al confirmar llama a onBuild con el plan; el armado
// (render + pistas + marcadores) lo hace workspace.js.
//
//   openStructureBuilder({ loops, packs, packId, project, hasTracks, labels, onBuild, preset? })

import { SECTION_TYPES, STRUCTURE_PRESETS, sectionLabel, suggestStructure, rankCandidates, sectionStarts } from './loopStructure.js';
import { esc } from '../utils/dom.js';

const INSTRUMENT_ORDER = ['drums', 'perc', 'bass', 'keys', 'pad', 'synth', 'guitar', 'strings', 'vocals', 'guide', 'click', 'fx', 'other'];
const BAR_OPTIONS = [2, 4, 8, 12, 16];

export function openStructureBuilder({ loops, packs, packId = '', project, hasTracks, labels, onBuild, preset = 'estandar' }) {
  document.getElementById('stb-overlay')?.remove();
  const state = {
    packId,
    sections: (STRUCTURE_PRESETS[preset] || STRUCTURE_PRESETS.estandar).map(([type, bars]) => ({ type, bars })),
    instruments: null,          // se inicializa con los disponibles
    overrides: new Map(),       // `${type}|${inst}` → loopId | '' (silencio)
  };

  const overlay = document.createElement('div');
  overlay.id = 'stb-overlay';
  overlay.className = 'stb-overlay';
  overlay.innerHTML = `
    <div class="stb-modal" role="dialog" aria-modal="true" aria-label="Armar por secciones">
      <header class="stb-head">
        <h3>Armar por secciones</h3>
        <button type="button" class="stl-x stb-x ui-close" data-act="close" aria-label="Cerrar">×</button>
      </header>
      <p class="stb-hint">Elige la estructura y los instrumentos. Te sugerimos un loop para cada sección, ajustado a <b>${Math.round(project.bpm * 100) / 100} BPM</b>${project.key ? ` en <b>${esc(project.key)}</b>` : ''}; cámbialo si quieres.</p>
      <div class="stb-bar">
        <label>Pack
          <select data-ref="pack">
            <option value="">Todos</option>
            ${packs.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}
          </select>
        </label>
        <span class="stb-presets">Plantilla:
          <button type="button" data-preset="estandar">Estándar</button>
          <button type="button" data-preset="corta">Corta</button>
          <button type="button" data-preset="adoracion">Adoración</button>
        </span>
      </div>
      <div class="stb-instruments" data-ref="instruments"></div>
      <div class="stb-grid-wrap"><table class="stb-grid" data-ref="grid"></table></div>
      <footer class="stb-foot">
        <label><input type="checkbox" data-ref="markers" checked> Poner marcadores de sección</label>
        <label>Empezar en
          <select data-ref="start">
            <option value="start">el compás 1</option>
            <option value="cursor">el compás del cursor</option>
            <option value="end"${hasTracks ? ' selected' : ''}>después de lo que ya hay</option>
          </select>
        </label>
        <span class="stb-total" data-ref="total"></span>
        <button type="button" class="stb-btn" data-act="close">Cancelar</button>
        <button type="button" class="stb-btn stb-btn--primary" data-act="build">Crear secuencia</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  const ref = (n) => overlay.querySelector(`[data-ref="${n}"]`);
  ref('pack').value = packId;

  const eligible = () => (state.packId ? loops.filter((l) => l.pack_id === state.packId) : loops);
  const available = () => INSTRUMENT_ORDER.filter((i) => eligible().some((l) => l.instrument === i));
  const byId = new Map(loops.map((l) => [l.id, l]));

  function pickFor(type, inst, suggested) {
    const k = `${type}|${inst}`;
    if (state.overrides.has(k)) return state.overrides.get(k) || null;
    return suggested;
  }

  function renderInstruments() {
    const avail = available();
    if (!state.instruments) state.instruments = avail.slice();
    state.instruments = state.instruments.filter((i) => avail.includes(i));
    ref('instruments').innerHTML = avail.length
      ? avail.map((i) => `<label class="stb-chip${state.instruments.includes(i) ? ' is-on' : ''}">
          <input type="checkbox" data-inst="${i}"${state.instruments.includes(i) ? ' checked' : ''}> ${esc(labels(i))}</label>`).join('')
      : '<span class="stb-empty">Este pack no tiene loops que puedas usar.</span>';
  }

  function renderGrid() {
    const insts = state.instruments;
    const { picks } = suggestStructure({ sections: state.sections, instruments: insts, loops: eligible(), project });
    const typeOptions = (sel) => SECTION_TYPES.map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${t.label}</option>`).join('');
    const barOptions = (sel) => BAR_OPTIONS.map((b) => `<option value="${b}"${b === sel ? ' selected' : ''}>${b}</option>`).join('');
    const cell = (sec, inst, suggested) => {
      const chosen = pickFor(sec.type, inst, suggested);
      const cands = rankCandidates(eligible(), inst, sec.type, project);
      return `<select data-cell="${sec.type}|${inst}" aria-label="${esc(labels(inst))} en ${esc(sectionLabel(sec.type))}">
        <option value=""${chosen ? '' : ' selected'}>— silencio —</option>
        ${cands.map((l) => `<option value="${esc(l.id)}"${l.id === chosen ? ' selected' : ''}>${esc(l.title)} · ${Number(l.bpm)} BPM${l.musical_key ? ' · ' + esc(l.musical_key) : ''}</option>`).join('')}
      </select>`;
    };
    ref('grid').innerHTML = `
      <thead><tr><th>Sección</th><th>Compases</th>${insts.map((i) => `<th>${esc(labels(i))}</th>`).join('')}<th></th></tr></thead>
      <tbody>${state.sections.map((sec, r) => `<tr data-row="${r}">
        <td><select data-type="${r}" aria-label="Sección">${typeOptions(sec.type)}</select></td>
        <td><select data-bars="${r}" aria-label="Compases">${barOptions(sec.bars)}</select></td>
        ${insts.map((i) => `<td>${cell(sec, i, picks[r][i])}</td>`).join('')}
        <td><button type="button" class="stb-del ui-remove" data-del="${r}" title="Quitar sección" aria-label="Quitar sección">×</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="${insts.length + 3}"><button type="button" class="stb-add" data-act="add">+ Añadir sección</button></td></tr></tfoot>`;
    const { totalBars } = sectionStarts(state.sections);
    const secs = totalBars * project.beatsPerBar * 60 / project.bpm;
    ref('total').textContent = `${totalBars} compases · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
    overlay.querySelector('[data-act="build"]').disabled = !insts.length || !state.sections.length;
  }

  const render = () => { renderInstruments(); renderGrid(); };
  render();

  const close = () => { window.removeEventListener('keydown', onKey, true); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const preset = e.target.closest('[data-preset]')?.dataset.preset;
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (act === 'close') { close(); return; }
    if (preset) { state.sections = STRUCTURE_PRESETS[preset].map(([type, bars]) => ({ type, bars })); renderGrid(); return; }
    if (del != null) { state.sections.splice(Number(del), 1); renderGrid(); return; }
    if (act === 'add') { state.sections.push({ type: 'chorus', bars: 8 }); renderGrid(); return; }
    if (act === 'build') {
      const btn = e.target.closest('[data-act="build"]');
      btn.disabled = true; btn.textContent = 'Armando…';
      const { picks } = suggestStructure({ sections: state.sections, instruments: state.instruments, loops: eligible(), project });
      const plan = {
        sections: state.sections.map((s) => ({ ...s })),
        instruments: state.instruments.slice(),
        pick: (r, inst) => byId.get(pickFor(state.sections[r].type, inst, picks[r][inst])) || null,
        start: ref('start').value,
        addMarkers: ref('markers').checked,
      };
      try {
        const ok = await onBuild(plan);
        if (ok !== false) close();
      } finally {
        if (overlay.isConnected) { btn.disabled = false; btn.textContent = 'Crear secuencia'; }
      }
    }
  });

  overlay.addEventListener('change', (e) => {
    const t = e.target;
    if (t === ref('pack')) { state.packId = t.value; state.instruments = null; state.overrides.clear(); render(); return; }
    if (t.dataset.inst) {
      const inst = t.dataset.inst;
      state.instruments = t.checked
        ? INSTRUMENT_ORDER.filter((i) => i === inst || state.instruments.includes(i))
        : state.instruments.filter((i) => i !== inst);
      render();
      return;
    }
    if (t.dataset.type != null) { state.sections[Number(t.dataset.type)].type = t.value; renderGrid(); return; }
    if (t.dataset.bars != null) { state.sections[Number(t.dataset.bars)].bars = Number(t.value); renderGrid(); return; }
    if (t.dataset.cell) { state.overrides.set(t.dataset.cell, t.value); renderGrid(); }
  });
}
