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
  arr_repeat:  { sel: '#arr-pop [data-arr="repeat"]',        label: 'Arreglo: repetir esta sección' },
  arr_next:    { sel: '#arr-pop [data-arr="next"]',          label: 'Arreglo: saltar a la siguiente sección' },
  arr_chorus:  { sel: '#arr-pop [data-arr="chorus"]',        label: 'Arreglo: ir al coro' },
  arr_bridge:  { sel: '#arr-pop [data-arr="bridge"]',        label: 'Arreglo: ir al puente' },
  arr_end:     { sel: '#arr-pop [data-arr="end"]',           label: 'Arreglo: ir al final' },
  arr_cancel:  { sel: '#arr-pop [data-arr="cancel"]',        label: 'Arreglo: cancelar el salto' },
  soft_end:    { sel: '#tp-softend-btn',                    label: 'Terminar suave (bajar todo y parar)' },
  plan_b:      { sel: '#tp-planb-btn',                      label: 'Plan B: pad + click al instante (si la secuencia falla)' },
  groove_play: { sel: '#gt-play',                           label: 'Caja de ritmos: tocar / parar' },
  groove_intro:{ sel: '#gt-sections [data-part="intro"]',  label: 'Caja de ritmos: intro' },
  groove_a:    { sel: '#gt-sections [data-part="A"]',      label: 'Caja de ritmos: verso' },
  groove_b:    { sel: '#gt-sections [data-part="B"]',      label: 'Caja de ritmos: coro' },
  groove_fill: { sel: '#gt-sections [data-part="fill"]',   label: 'Caja de ritmos: redoble' },
  groove_c:    { sel: '#gt-sections [data-part="C"]',      label: 'Caja de ritmos: puente' },
  groove_end:  { sel: '#gt-sections [data-part="end"]',    label: 'Caja de ritmos: final' },
  talkback:    { sel: '.tb-btn, .tb-pill',                   label: 'Talkback: hablar a la banda (in-ears)' },
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
  if (id === 'talkback') {
    // Funciona con la paleta cerrada: abre o cierra el micrófono hacia los in-ears.
    import('../live/talkback.js').then((m) => m.toggleTalkback()).catch(() => {});
    return true;
  }
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
