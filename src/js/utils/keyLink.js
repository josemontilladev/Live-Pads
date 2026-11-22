// ─────────────────────────────────────────────────────────────────────────
// «Tono ligado»: el tono de la tarjeta, los acordes de la letra, el pad y el
// transporte del audio (▼ ▲) se mueven juntos.
//
// Modelo:
//  - La grabación (secuencia / original) está en un tono fijo.
//  - song.audio.pitch = semitonos que se transporta el audio (ajuste manual).
//  - song.audio.keyPitch = cuántos de esos semitonos ya están «metidos» en el tono
//    de la tarjeta (los que se aplicaron estando ligado). Así:
//        tono de la grabación = tono de la tarjeta − keyPitch
//    y el pad (grabación + transporte) nunca se cuenta dos veces, aunque se ligue
//    o desligue a mitad de camino.
// Funciones puras (salvo la preferencia), probadas en tests/keyLink.test.mjs.
// ─────────────────────────────────────────────────────────────────────────
import { parseKey, noteName, keyDelta } from './musicKeys.js';
import { transposeAll, keyPrefersFlats } from '../ui/chordTransposer.js';

const LS = 'livepads-key-link';
/** Ligado por defecto: es lo que se espera al cambiar el tono de una canción. */
export function isKeyLinked() { try { return localStorage.getItem(LS) !== '0'; } catch (_) { return true; } }
export function setKeyLinked(on) { try { localStorage.setItem(LS, on ? '1' : '0'); } catch (_) {} }

const clamp = (v) => Math.max(-12, Math.min(12, Math.round(v)));
export const keyPitchOf = (song) => Number(song && song.audio && song.audio.keyPitch) || 0;
export const manualPitchOf = (song) => Number(song && song.audio && song.audio.pitch) || 0;

/** Semitono (0-11) de la GRABACIÓN: tono de la tarjeta menos lo transportado ligado. */
export function recordingSemitone(song) {
  const p = parseKey(song && song.key);
  if (!p) return null;
  return (((p.semitone - keyPitchOf(song)) % 12) + 12) % 12;
}

/** Nombre habitual de un tono (Eb antes que D#, F# antes que Gb…). */
export function spellKey(semitone, minor, suffix = '') {
  const sfx = suffix || (minor ? 'm' : '');
  const s = ((semitone % 12) + 12) % 12;
  const flat = noteName(s, true) + sfx, sharp = noteName(s, false) + sfx;
  if (s === 6) return sharp;                       // F# / F#m, no Gb
  if (minor && (s === 1 || s === 8)) return sharp; // C#m, G#m
  return keyPrefersFlats(flat) ? flat : sharp;
}

/** El tono `key` movido `d` semitonos, con su nombre habitual. */
export function shiftKey(key, d) {
  const p = parseKey(key);
  if (!p) return key;
  return spellKey(p.semitone + d, p.minor, p.suffix);
}

/**
 * Cambio ligado del tono de la tarjeta (oldKey → newKey): la letra se transporta y
 * el audio también (la grabación sigue en su tono). null si no hay cambio de altura.
 */
export function linkedKeyChange(song, oldKey, newKey) {
  const d = keyDelta(oldKey, newKey);
  if (d == null || d === 0) return null;
  return {
    delta: d,
    key: newKey,
    lyrics: song.lyrics ? transposeAll(song.lyrics, d, keyPrefersFlats(newKey)) : song.lyrics,
    pitch: clamp(manualPitchOf(song) + d),
    keyPitch: clamp(keyPitchOf(song) + d),
  };
}

/**
 * ▼ ▲ estando ligado: el audio ya se movió `delta`; la tarjeta y la letra le siguen.
 * (pitch lo pone el reproductor; aquí solo tono, letra y keyPitch.)
 */
export function linkedPitchStep(song, delta) {
  if (!delta) return null;
  const key = song.key ? shiftKey(song.key, delta) : song.key;
  return {
    delta,
    key,
    lyrics: song.lyrics ? transposeAll(song.lyrics, delta, keyPrefersFlats(key)) : song.lyrics,
    keyPitch: clamp(keyPitchOf(song) + delta),
  };
}

/**
 * Pone de acuerdo lo guardado con el tono ligado (la tarjeta manda):
 *  - Canción de antes del tono ligado (sin keyPitch): el ajuste que tenía es un
 *    resto de versiones pasadas (en vivo sonaba en un tono que ya no iba). Se
 *    descarta: suena en el tono de la tarjeta (pitch = keyPitch = 0).
 *  - Con keyPitch: un ajuste que no está en la tarjeta (▼ ▲ con el 🔗 apagado) se
 *    descarta: pitch = keyPitch.
 * Devuelve { pitch, keyPitch, changed }.
 */
export function reconcileLinkedPitch(audio) {
  const a = audio || {};
  const pitch = Number(a.pitch) || 0;
  if (a.keyPitch === undefined || a.keyPitch === null || a.keyPitch === '') {
    return { pitch: 0, keyPitch: 0, changed: true };
  }
  const kp = Number(a.keyPitch) || 0;
  return { pitch: kp, keyPitch: kp, changed: pitch !== kp };
}

/**
 * Limpieza única del repertorio: semitonos guardados que NO vienen de un cambio
 * hecho con el tono ligado (sin la marca keyPitchSet) se ponen a 0. Devuelve
 * cuántas canciones cambió. Pura sobre la lista.
 */
export function resetStrayPitches(songs) {
  let n = 0;
  for (const s of songs || []) {
    const a = s && s.audio;
    if (!a || a.keyPitchSet) continue;
    if ((Number(a.pitch) || 0) !== 0 || (Number(a.keyPitch) || 0) !== 0 || a.keyPitch === undefined) {
      const had = (Number(a.pitch) || 0) !== 0 || (Number(a.keyPitch) || 0) !== 0;
      a.pitch = 0; a.keyPitch = 0;
      if (had) n++;
    }
  }
  return n;
}
