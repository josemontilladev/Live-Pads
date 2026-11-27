// ─────────────────────────────────────────────────────────────────────────
// Avisos entre canciones. En los últimos 20 s de la canción (y tras terminar, hasta
// que entra la siguiente) aparece un aviso grande con lo que viene: siguiente canción,
// tono del día, BPM, cejilla para la guitarra y las notas para la banda de su comienzo.
// También va al monitor de escenario del Companion (stagePublish → nextCue).
// Se cierra con ✕ (solo para esa canción). Ajuste: localStorage «livepads.nextCue» = '0'.
// ─────────────────────────────────────────────────────────────────────────

import { cueVisible, cueContent } from './nextCueCore.js';
import { whilePlaying } from '../audio/playClock.js';
import { getCurrentSong, getTrackAudio, getCurrentType } from '../audio/trackPlayer.js';
import { getServiceSongs, peekNextServiceSong, getEffectiveKey } from '../data/service.js';
import { bestCapo } from '../utils/capo.js';
import { notesOf } from './bandNotes.js';
import { notesForSection, generalNotes, noteLine } from './bandNotesCore.js';
import { markersFor } from '../data/markers.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const nextCueOn = () => { try { return localStorage.getItem('livepads.nextCue') !== '0'; } catch (_) { return true; } };

let el = null, endedAt = 0, endedSong = null, dismissed = '', last = null;   // last: lo último pintado (null = repintar)

/** Lo que viene, para la app y el monitor de escenario. null = nada que avisar. */
export function currentCue() {
  if (!nextCueOn()) return null;
  const song = getCurrentSong();
  const svc = getServiceSongs();
  if (!song || svc.length < 2) return null;
  const next = peekNextServiceSong();
  if (!next || String(next.id) === String(song.id)) return null;
  const a = getTrackAudio();
  const playing = !!(a && !a.paused);
  const dur = a && Number.isFinite(a.duration) ? a.duration : 0;
  const remaining = dur ? dur - (a.currentTime || 0) : null;
  const key = `${song.id}>${next.id}`;
  if (endedSong && String(endedSong) !== String(song.id)) { endedAt = 0; endedSong = null; }
  if (!cueVisible({ remaining, playing, endedAt, now: Date.now(), dismissedFor: dismissed, key })) return null;
  const tone = getEffectiveKey(next) || next.key || '';
  let notes = [];
  try {
    const all = notesOf(next);
    const first = (markersFor(next, getCurrentType()) || []).slice().sort((x, y) => x.t - y.t)[0];
    notes = [...generalNotes(all), ...(first ? notesForSection(all, first.label) : [])].map(noteLine);
  } catch (_) {}
  const c = cueContent({ next, key: tone, capo: bestCapo(tone), notes, remaining, playing });
  return c ? { ...c, key } : null;
}

function paint() {
  const c = currentCue();
  const sig = c ? JSON.stringify(c) : '';
  if (sig === last) return;
  last = sig;
  if (!c) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'next-cue'; el.className = 'next-cue'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="x"]')) { dismissed = (currentCue() || {}).key || ''; last = null; paint(); } });
    document.body.appendChild(el);
  }
  el.hidden = false;
  el.innerHTML = `<div class="nc-head"><span class="nc-k">Siguiente</span><b class="nc-title">${esc(c.title)}</b>${c.meta ? `<span class="nc-meta">${esc(c.meta)}</span>` : ''}${c.inSec != null ? `<span class="nc-in">en ${c.inSec} s</span>` : ''}<button type="button" class="nc-x" data-act="x" aria-label="Cerrar el aviso" title="Cerrar este aviso">✕</button></div>${c.lines.length ? `<ul class="nc-lines">${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`;
}

export function initNextCue() {
  // Mientras suena, cada medio segundo; parado, al momento de cada cambio (playClock).
  whilePlaying(paint, 500, { idleMs: 3000 });
  window.addEventListener('livepads:track-loaded', (e) => {
    endedAt = 0; endedSong = null; dismissed = ''; last = null;
    // Al terminar la pista: el aviso se queda hasta que entra la siguiente.
    const a = e.detail && e.detail.audio;
    if (a && a.addEventListener) a.addEventListener('ended', () => { endedAt = Date.now(); endedSong = getCurrentSong() && getCurrentSong().id; last = null; paint(); });
    paint();
  });
  window.addEventListener('livepads:track-cleared', () => { last = null; paint(); });
  window.addEventListener('livepads:service-changed', () => { last = null; paint(); });
}
