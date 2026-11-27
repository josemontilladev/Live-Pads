// ─────────────────────────────────────────────────────────────────────────
// Monitor de escenario: lo que la BANDA necesita ver (no la congregación).
// Publica en el Companion, unas veces por segundo y solo si cambió:
//   canción (tono de hoy, BPM) · sección en curso y la siguiente (de las marcas
//   de la onda) · acorde actual y siguiente (del análisis de acordes, en el tono
//   que suena) · tiempo restante · canción siguiente del servicio.
// Cualquier pantalla del escenario con navegador lo abre en la dirección del
// Companion con «?escenario» (TV, tablet, portátil o móvil).
// ─────────────────────────────────────────────────────────────────────────

import { isStandby } from './standby.js';
import { whilePlaying } from '../audio/playClock.js';
import { getTrackAudio, getCurrentSong, getCurrentType, getTrackPitch } from '../audio/trackPlayer.js';
import { getEffectiveKey, peekNextServiceSong, getServiceSongs } from '../data/service.js';
import { cacheGet, trackChordId } from '../chords/trackChords.js';
import { chordName } from '../chords/chordEngine.js';

import { markersFor } from '../data/markers.js';
import { notesOf } from './bandNotes.js';
import { createSectionCounter } from './sectionCountCore.js';
const stageCounter = createSectionCounter();
import { notesForSection, noteLine } from './bandNotesCore.js';
import { getCurrentType as gctStage } from '../audio/trackPlayer.js';
let last = '';
let timer = null;

function at(list, t) {
  let i = -1;
  for (let k = 0; k < list.length; k++) { if (list[k].s <= t + 0.05) i = k; else break; }
  return i;
}

export function stageState() {
  const song = getCurrentSong();
  const audio = getTrackAudio();
  if (!song) return { song: null };
  const t = audio ? (audio.currentTime || 0) : 0;
  const dur = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
  // Secciones (marcas de la onda)
  const ms = markersFor(song, gctStage()).filter((m) => m && Number.isFinite(m.t)).slice().sort((a, b) => a.t - b.t).map((m) => ({ s: m.t, label: m.label }));
  const si = at(ms, t);
  const cnt = stageCounter.update(ms.map((m) => ({ t: m.s, label: m.label })), t, `${song.id || song.title}|${gctStage()}`);
  // Acordes (si la pista ya se analizó)
  let chord = '', nextChord = '';
  if (audio && audio.buffer) {
    const a = cacheGet(trackChordId(song, getCurrentType(), audio.buffer));
    if (a && Array.isArray(a.seg)) {
      const segs = a.seg.filter((x) => x.r >= 0);
      const ci = at(segs, t);
      const shift = getTrackPitch() || 0;
      const name = (x) => (x ? chordName(x, { basic: true, shift, key: { k: a.k + shift, m: a.m } }) : '');
      if (ci >= 0 && segs[ci].e > t) chord = name(segs[ci]);
      nextChord = name(segs[ci + 1]);
    }
  }
  const next = getServiceSongs().length > 1 ? peekNextServiceSong() : null;
  return {
    song: { title: song.title || '', artist: song.artist || '', key: getEffectiveKey(song) || song.key || '', bpm: song.bpm || '' },
    section: si >= 0 ? ms[si].label : '',
    count: cnt && cnt.show ? `${cnt.n}/${cnt.total}` : '',
    notes: si >= 0 ? notesForSection(notesOf(song), ms[si].label).map(noteLine).slice(0, 3) : [],
    nextSection: ms[si + 1] ? ms[si + 1].label : '',
    sectionLeft: ms[si + 1] ? Math.max(0, Math.round(ms[si + 1].s - t)) : null,
    chord, nextChord,
    pos: Math.round(t), dur: Math.round(dur),
    playing: !!(audio && !audio.paused),
    next: next ? { title: next.title || '', key: getEffectiveKey(next) || next.key || '' } : null,
  };
}

function tick() {
  if (isStandby()) return;   // respaldo en silencio: el escenario lo publica el principal
  if (!window.electronAPI?.companionPublishStage) return;
  let s;
  try { s = stageState(); } catch (_) { return; }
  const sig = JSON.stringify(s);
  if (sig === last) return;
  last = sig;
  window.electronAPI.companionPublishStage(s).catch(() => {});
}

export function initStagePublish() {
  if (typeof timer === 'function') timer();
  // Sonando: 400 ms (sección, compás…). Parado: lo que cambie (canción, tono) en ≤ 1 s.
  timer = whilePlaying(() => { if (!document.hidden) tick(); }, 400, { idleMs: 1000 });
}
