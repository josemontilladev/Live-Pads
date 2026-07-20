// Pure formatting helpers — no DOM, no app state.

export function panLabel(v) {
  v = parseInt(v);
  return v === 0 ? 'Centro' : v < 0 ? `Izq ${Math.abs(v)}` : `Der ${v}`;
}

export function panShort(v) {
  v = parseInt(v);
  return v === 0 ? 'C' : v < 0 ? `L${Math.abs(v)}` : `R${v}`;
}

// Strips the internal "c_kit_pad_timestamp_" prefix and extension from a
// sample filename so the UI shows a clean, human-readable label.
export function getCleanSampleName(path) {
  const filename = path.split('/').pop().split('\\').pop();
  let clean = filename.replace(/^c_[a-z0-9]+_[0-9]+_/i, '');
  clean = clean.replace(/\.[a-z0-9]+$/i, '');
  clean = clean.replace(/_/g, ' ');
  return clean || filename;
}
