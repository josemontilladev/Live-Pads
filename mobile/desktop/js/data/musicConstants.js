// Shared music + keyboard constants. Single source of truth so app.js,
// drumGrid.js, and any future modules don't redefine them.

// Twelve note names in flat (`Db`) and sharp (`C#`) notation. The active
// list flips when the user toggles "Notación" in the metronome panel.
export const KEYS_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const KEYS_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Default keyboard shortcuts for the 12 pad slots (top number row).
export const KEY_MAP_PADS  = ['1','2','3','4','5','6','7','8','9','0','-','='];

// Default keyboard shortcuts for the 8 drum pads.
export const KEY_MAP_DRUMS = ['Q','W','E','R','A','S','D','F'];
