// MIDI / Keyboard mapping store. State is module-private; the UI wiring
// (learn mode overlay, click-to-target, MIDI listener) lives in app.js
// because it's glued to many specific UI elements.

let map = {};

export const getMidiMap = () => map;

export function setMidiMap(m) {
  map = m || {};
}

// Look up the action mapped to a given MIDI key (e.g. "note_60" or "cc_7")
// or keyboard key (e.g. "kbd_KeyA"). Returns undefined if not mapped.
export function getMapping(mapKey, fallbackKey) {
  if (map[mapKey]) return map[mapKey];
  if (fallbackKey != null && map[fallbackKey]) return map[fallbackKey];
  return undefined;
}

export function addMapping(mapKey, target) {
  map[mapKey] = target;
  persistAsync();
}

// Remove any existing mapping (MIDI or keyboard, depending on `isKeyboard`)
// that points to the same target — keeps only one mapping per target per kind.
export function clearMappingForTarget(target, isKeyboard) {
  Object.keys(map).forEach(key => {
    const isKbd = key.startsWith('kbd_');
    if (isKbd !== isKeyboard) return;
    const m = map[key];
    if (m && m.action === target.action && m.id === target.id) {
      delete map[key];
    }
  });
}

// Find the keyboard mapping (if any) that points to a given pad/drum target.
// Used by `updateKeyHints` to show the keybinding chip on each button.
export function findKeyboardMappingFor(action, id) {
  const k = Object.keys(map).find(key =>
    key.startsWith('kbd_') && map[key].action === action && map[key].id === id
  );
  return k ? { key: k, target: map[k] } : null;
}

function persistAsync() {
  if (window.electronAPI && window.electronAPI.saveMidiMap) {
    window.electronAPI.saveMidiMap(map);
  }
}
