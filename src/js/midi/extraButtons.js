// Botones de Pads que se pueden asignar a un controlador MIDI o a una tecla sin
// lógica propia: la asignación solo «pulsa» el botón, así hace exactamente lo
// mismo que un clic (y hereda sus protecciones, p. ej. las del modo en vivo).
//
// Para añadir uno nuevo basta una línea aquí: Learn lo reconoce al hacer clic
// sobre él, y la lista de mapeos muestra su nombre.

export const EXTRA_BUTTONS = {
  bpm_minus:   { sel: '#bpm-minus',                         label: 'Tempo −1' },
  bpm_plus:    { sel: '#bpm-plus',                          label: 'Tempo +1' },
  tap:         { sel: '#tap-tempo',                         label: 'Tap tempo' },
  master_mute: { sel: '.master-mute-btn--mx',               label: 'Silenciar maestro' },
  live_mode:   { sel: '#btn-live-mode',                     label: 'Modo en vivo' },
  lyrics:      { sel: '#sw-lyrics, .action-btn.btn-lyrics', label: 'Abrir / cerrar la letra' },
  lyrics_up:   { sel: '.lyp-panel [data-do="up"]',          label: 'Letra: subir' },
  lyrics_down: { sel: '.lyp-panel [data-do="down"]',        label: 'Letra: bajar' },
  mode_major:  { sel: '.pad-mode-btn[data-mode="major"]',   label: 'Pads en mayor' },
  mode_minor:  { sel: '.pad-mode-btn[data-mode="minor"]',   label: 'Pads en menor' },
};

/** ¿El elemento pulsado en modo Learn es uno de estos botones? → su id, o null. */
export function extraButtonFor(el) {
  if (!el || !el.closest) return null;
  for (const [id, b] of Object.entries(EXTRA_BUTTONS)) if (el.closest(b.sel)) return id;
  return null;
}

export function clickExtraButton(id) {
  const b = EXTRA_BUTTONS[id];
  if (!b) return false;
  if (id === 'lyrics') {
    // Con la letra abierta, la cierra; si no, abre la de la canción cargada.
    const close = document.querySelector('.lyp-panel [data-do="close"]');
    if (close) { close.click(); return true; }
    const open = document.querySelector('#sw-lyrics') || document.querySelector('.gi-song-item.active-song .action-btn.btn-lyrics');
    if (open) open.click();
    return !!open;
  }
  const el = document.querySelector(b.sel);
  if (el) el.click();
  return !!el;
}

// Acciones que ya existían para MIDI y que con una TECLA no hacían nada: todas
// equivalen a pulsar un botón de la pantalla.
const CLICK_ACTIONS = {
  toggle_seq_only: () => '#tp-seqonly-btn',
  restart_seq:     () => '#tp-restart-btn',
  autoadvance_seq: () => '#tp-autoadvance-btn',
  close_seq:       () => '#tp-close-btn',
  toggle_piano:    () => '#btn-piano-pads',
  toggle_metronome: () => '#btn-metro-pads',
  pitch_up:        () => '#tp-pitch-up',
  pitch_down:      () => '#tp-pitch-down',
  metro_mult:      (m) => `#btn-mult-${m.id === '2' ? '2' : '1'}`,
  source:          (m) => `.source-seg-btn[data-source="${String(m.id || '').replace(/[^a-z]/gi, '')}"]`,
};

/** Ejecuta una asignación que consiste en pulsar un botón. Devuelve si la manejó. */
export function runClickAction(mapping) {
  if (!mapping) return false;
  if (mapping.action === 'button') return clickExtraButton(mapping.id);
  const sel = CLICK_ACTIONS[mapping.action];
  if (!sel) return false;
  const el = document.querySelector(sel(mapping));
  if (el) el.click();
  return true;
}

/** Nombre legible de una asignación de botón (para Learn y la lista de mapeos). */
export function extraButtonLabel(id) {
  return (EXTRA_BUTTONS[id] && EXTRA_BUTTONS[id].label) || id;
}
