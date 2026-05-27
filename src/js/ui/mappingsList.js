// MIDI / keyboard mappings list overlay. Shows every active mapping with
// a × to delete it individually — useful for cleaning up stale entries
// without going through Learn mode for each one.
//
// Open from the hamburger menu ("Mapeos…") or from `?` cheat sheet.
// The data lives in midiMap.js; this module only renders + dispatches
// deletes. Re-renders itself after each deletion so the row count and
// "no mappings" empty state stay accurate.

import { getMidiMap, getAllMidiMaps, deleteMapping, clearAllMappings, importMidiMaps } from '../midi/midiMap.js';

let mounted = null;

const ACTION_LABELS = {
  pad:       'Pad',
  drum:      'Drum',
  metro:     'Metrónomo Play/Stop',
  play_seq:  'Master Play/Pause',
  stop_seq:  'Master Stop',
  loop_seq:  'Loop Track',
  restart_seq: 'Reiniciar pista',
  autoadvance_seq: 'Auto-avance',
  close_seq: 'Cerrar pista',
  prev_song: 'Canción anterior',
  next_song: 'Canción siguiente',
  slider:    'Slider',
  // Stems workspace (independent map)
  st_play:       'Stems · Play/Pausa',
  st_stop:       'Stems · Stop',
  st_master_vol: 'Stems · Volumen maestro',
  st_vol:        'Stems · Volumen pista',
  st_pan:        'Stems · Paneo pista',
  st_mute:       'Stems · Mute pista',
  st_solo:       'Stems · Solo pista',
  st_marker:     'Stems · Añadir marcador',
  st_genclick:   'Stems · Generar click',
  st_detectbpm:  'Stems · Detectar BPM',
  st_detectsec:  'Stems · Detectar secciones',
  st_guide:      'Stems · Generar guía',
};

function prettyKey(mapKey) {
  if (mapKey.startsWith('kbd_')) {
    return mapKey.replace('kbd_', '').replace('Key', '').replace('Digit', '');
  }
  if (mapKey.startsWith('note_')) {
    const n = parseInt(mapKey.slice(5), 10);
    if (Number.isFinite(n)) return `Nota ${n}`;
  }
  if (mapKey.startsWith('cc_')) {
    const n = parseInt(mapKey.slice(3), 10);
    if (Number.isFinite(n)) return `CC ${n}`;
  }
  return mapKey;
}

function prettyTarget(target) {
  if (!target) return '?';
  const action = ACTION_LABELS[target.action] || target.action;
  if (target.id) return `${action} · ${target.id}`;
  return action;
}

function rowsHtml() {
  const map = getMidiMap();
  const entries = Object.entries(map);
  if (entries.length === 0) {
    return `
      <div class="mp-empty">
        <p>No hay mapeos activos.</p>
        <p class="mp-empty-hint">Usa <strong>Menú → Mapeo MIDI / Teclado</strong> para crear uno.</p>
      </div>
    `;
  }
  // Sort by category: keyboard first, then MIDI notes, then CC
  const sorted = entries.sort(([a], [b]) => {
    const rank = (k) => k.startsWith('kbd_') ? 0 : k.startsWith('note_') ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return `
    <ul class="mp-list">
      ${sorted.map(([key, target]) => `
        <li class="mp-row" data-mapkey="${key}">
          <span class="mp-key-kind ${key.startsWith('kbd_') ? 'kbd' : 'midi'}">
            ${key.startsWith('kbd_') ? 'TECLADO' : 'MIDI'}
          </span>
          <kbd class="mp-key">${prettyKey(key)}</kbd>
          <span class="mp-arrow" aria-hidden="true">→</span>
          <span class="mp-target">${prettyTarget(target)}</span>
          <button class="mp-clear" data-clear="${key}" type="button" aria-label="Quitar este mapeo" title="Quitar este mapeo">×</button>
        </li>
      `).join('')}
    </ul>
  `;
}

function rerender() {
  if (!mounted) return;
  mounted.querySelector('.mp-body').innerHTML = rowsHtml();
}

export function openMappingsList() {
  if (mounted) return;

  const overlay = document.createElement('div');
  overlay.id = 'mappings-overlay';
  overlay.innerHTML = `
    <div class="mp-panel" role="dialog" aria-modal="true" aria-labelledby="mp-title">
      <div class="mp-header">
        <h3 id="mp-title">Mapeos activos</h3>
        <button class="mp-close" type="button" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p class="mp-subtitle">Cada fila muestra una asignación (MIDI o teclado) a un control. Pulsa × para quitar individualmente.</p>
      <div class="mp-body">${rowsHtml()}</div>
      <div class="mp-footer">
        <button class="mp-io" data-io="import" type="button">Importar…</button>
        <button class="mp-io" data-io="export" type="button">Exportar…</button>
        <span style="flex:1"></span>
        <button class="mp-clear-all" type="button">Borrar todos los mapeos</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  mounted = overlay;
  if (!window.__escMappings) { window.__escMappings = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mounted) closeMappingsList(); }); }

  overlay.onclick = (e) => {
    if (e.target === overlay) { closeMappingsList(); return; }
    const clearBtn = e.target.closest('[data-clear]');
    if (clearBtn) {
      deleteMapping(clearBtn.dataset.clear);
      rerender();
      document.dispatchEvent(new CustomEvent('livepads:mappings-changed'));
      return;
    }
    const ioBtn = e.target.closest('[data-io]');
    if (ioBtn) {
      const api = window.electronAPI;
      if (ioBtn.dataset.io === 'export' && api?.exportMidiMap) {
        api.exportMidiMap(getAllMidiMaps());
      } else if (ioBtn.dataset.io === 'import' && api?.importMidiMap) {
        api.importMidiMap().then(loaded => {
          if (!loaded) return;
          importMidiMaps(loaded);
          rerender();
          document.dispatchEvent(new CustomEvent('livepads:mappings-changed'));
        });
      }
      return;
    }
    if (e.target.closest('.mp-clear-all')) {
      if (confirm('¿Borrar TODOS los mapeos MIDI y de teclado? Tendrás que volver a asignarlos.')) {
        clearAllMappings();
        rerender();
        document.dispatchEvent(new CustomEvent('livepads:mappings-changed'));
      }
      return;
    }
  };
  overlay.querySelector('.mp-close').onclick = closeMappingsList;

  requestAnimationFrame(() => overlay.classList.add('open'));
}

export function closeMappingsList() {
  if (!mounted) return;
  mounted.classList.remove('open');
  const node = mounted;
  mounted = null;
  setTimeout(() => node.remove(), 200);
}

export function isMappingsListOpen() { return mounted !== null; }
