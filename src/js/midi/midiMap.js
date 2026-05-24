// MIDI / Keyboard mapping store — NAMESPACED by workspace.
//
// There are two completely independent maps: one for the Pads workspace and
// one for the Stems workspace. The active map follows the current workspace
// (set via setMidiScope), so a control mapped in Pads never fires in Stems
// and vice-versa. All the getters/setters below operate on the ACTIVE scope,
// so callers don't change.

const maps = { pads: {}, stems: {} };
let scope = 'pads';

export function setMidiScope(s) { if (s === 'pads' || s === 'stems') scope = s; }
export function getMidiScope() { return scope; }
const cur = () => maps[scope];

export const getMidiMap = () => cur();
export const getAllMidiMaps = () => maps;

export function setMidiMap(loaded) {
  if (loaded && (loaded.pads || loaded.stems)) {
    maps.pads = loaded.pads || {};
    maps.stems = loaded.stems || {};
  } else {
    // Legacy flat map (pre-namespacing) → treat the whole thing as Pads.
    maps.pads = loaded || {};
    maps.stems = {};
  }
}

// Look up the action mapped to a given MIDI key (e.g. "note_60" or "cc_7")
// or keyboard key (e.g. "kbd_KeyA") in the ACTIVE scope.
export function getMapping(mapKey, fallbackKey) {
  const m = cur();
  if (m[mapKey]) return m[mapKey];
  if (fallbackKey != null && m[fallbackKey]) return m[fallbackKey];
  return undefined;
}

export function addMapping(mapKey, target) {
  cur()[mapKey] = target;
  persistAsync();
}

// Remove any existing mapping (MIDI or keyboard, depending on `isKeyboard`)
// pointing to the same target — keeps only one mapping per target per kind.
export function clearMappingForTarget(target, isKeyboard) {
  const m = cur();
  Object.keys(m).forEach(key => {
    const isKbd = key.startsWith('kbd_');
    if (isKbd !== isKeyboard) return;
    const e = m[key];
    if (e && e.action === target.action && e.id === target.id) delete m[key];
  });
}

export function findKeyboardMappingFor(action, id) {
  const m = cur();
  const k = Object.keys(m).find(key =>
    key.startsWith('kbd_') && m[key].action === action && m[key].id === id
  );
  return k ? { key: k, target: m[k] } : null;
}

export function deleteMapping(mapKey) {
  const m = cur();
  if (mapKey in m) {
    delete m[mapKey];
    persistAsync();
  }
}

// Wipe every mapping in the ACTIVE scope (clears Pads OR Stems, not both).
export function clearAllMappings() {
  maps[scope] = {};
  persistAsync();
}

function persistAsync() {
  if (window.electronAPI && window.electronAPI.saveMidiMap) {
    window.electronAPI.saveMidiMap(maps);
  }
}

// Synchronous flush (used on window close) — writes BOTH scopes.
export function flushMidiSync() {
  try { window.electronAPI?.saveMidiMapSync?.(maps); } catch (e) {}
}
