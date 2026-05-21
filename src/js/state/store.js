// Centralized shared state.
//
// Before this module existed, every UI module that needed to read or
// mutate a piece of app-wide state received it via an `initX(deps)`
// call with a fat getter/setter object. That worked, but the deps
// objects were growing to 6-10 entries each and any new state needed
// plumbing through `app.js` to every consumer.
//
// What lives here vs. in `app.js`:
//
//   HERE — state that's read or written by 2+ modules outside of app.js:
//     - The GI library array + filter + active-song pointer
//     - The cross-list accordion exclusivity pointers
//
//   STILL IN app.js — state that only `app.js`'s own bind* functions
//   touch (engine, metro, kitBankIdx, useFlats, MIDI learn, etc.).
//   These will move here only when their consumers get extracted.
//
// The mutation model is intentionally simple: plain getter/setter
// functions, no pub/sub. Re-renders are still triggered explicitly by
// callers — this module exists to break the deps-soup, not to add
// reactivity. If/when subscriptions become valuable we can layer them
// on without changing the call sites that just read.

// ── GI library ───────────────────────────────────────────────────────

let _songs = [];
let _currentGenre = 'all';
let _activeSongId = null;

export function getSongs() { return _songs; }
export function setSongs(arr) { _songs = arr; }

export function getCurrentGenre() { return _currentGenre; }
export function setCurrentGenre(g) { _currentGenre = g; }

// "Recientes" filter: a song counts as recent if it was added within this
// many days.
export const RECENT_WINDOW_DAYS = 21;

// Best-effort creation timestamp (ms). Prefers an explicit `addedAt`, else
// recovers it from the id, which encodes Date.now() for synced/imported/new
// songs (`song_<ts>`, `song_sync_<ts>_x`, `song_imp_<idx>_<ts>`). Returns 0
// for legacy songs that predate this field — they're treated as "not recent".
export function songAddedAt(song) {
  if (!song) return 0;
  if (Number.isFinite(song.addedAt)) return song.addedAt;
  let best = 0;
  for (const part of String(song.id || '').split('_')) {
    const n = parseInt(part, 10);
    if (Number.isFinite(n) && n > 1e12 && n > best) best = n;
  }
  return best;
}

export function isRecentSong(song, now = Date.now()) {
  const ts = songAddedAt(song);
  return ts > 0 && (now - ts) <= RECENT_WINDOW_DAYS * 86400000;
}

export function getActiveSongId() { return _activeSongId; }
export function setActiveSongId(id) { _activeSongId = id; }

// ── Accordion exclusivity (only one open at a time, across both lists)

let _openAccordionSongId = null;
let _openAccordionServiceId = null;

export function getOpenAccordionSongId() { return _openAccordionSongId; }
export function setOpenAccordionSongId(id) { _openAccordionSongId = id; }

export function getOpenAccordionServiceId() { return _openAccordionServiceId; }
export function setOpenAccordionServiceId(id) { _openAccordionServiceId = id; }

// ── Banks ────────────────────────────────────────────────────────────

let _padBankIdx = 0;
let _kitBankIdx = 0;

export function getPadBankIdx() { return _padBankIdx; }
export function setPadBankIdx(i) { _padBankIdx = i; }

export function getKitBankIdx() { return _kitBankIdx; }
export function setKitBankIdx(i) { _kitBankIdx = i; }

// ── Audio / metronome ────────────────────────────────────────────────

let _activeKey = null;
let _preparedPadKey = null;
let _useFlats = false;
let _metroRunning = false;

export function getActiveKey() { return _activeKey; }
export function setActiveKey(k) { _activeKey = k; }

export function getPreparedPadKey() { return _preparedPadKey; }
export function setPreparedPadKey(k) { _preparedPadKey = k; }

export function getUseFlats() { return _useFlats; }
export function setUseFlats(v) { _useFlats = v; }

export function getMetroRunning() { return _metroRunning; }
export function setMetroRunning(v) { _metroRunning = v; }

// ── UI modes ─────────────────────────────────────────────────────────

let _isEditKitMode = false;
let _isMidiLearnMode = false;
let _midiLearnTarget = null;

export function getIsEditKitMode() { return _isEditKitMode; }
export function setIsEditKitMode(v) { _isEditKitMode = v; }

export function getIsMidiLearnMode() { return _isMidiLearnMode; }
export function setIsMidiLearnMode(v) { _isMidiLearnMode = v; }

export function getMidiLearnTarget() { return _midiLearnTarget; }
export function setMidiLearnTarget(t) { _midiLearnTarget = t; }
