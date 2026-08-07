// ─────────────────────────────────────────────────────────────────────────
// Tonalidades: parseo, transposición y distancia entre tonos.
//
// Acepta lo que la gente escribe de verdad en la app: "G", "Solm", "Bb", "Re",
// "F#m", "Mi bemol". Devuelve siempre el mismo modelo para que el pad, los
// acordes de la letra y el chip del servicio hablen el mismo idioma.
//
// Convive con ui/chordTransposer.js (que transpone los [acordes] DENTRO de la
// letra): aquí se calculan los SEMITONOS que aquel necesita.
// ─────────────────────────────────────────────────────────────────────────

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const NOTE_TO_SEMITONE = {
  'C': 0, 'B#': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4, 'F': 5, 'E#': 5, 'F#': 6, 'Gb': 6, 'G': 7,
  'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11, 'Cb': 11,
};

// Nombres latinos → cifrado americano. Orden importa: "Sol" antes que "Si" no
// hace falta (distinto prefijo), pero "Do" antes que nada evita líos con "D".
const LATIN = [
  ['sol', 'G'], ['do', 'C'], ['re', 'D'], ['mi', 'E'],
  ['fa', 'F'], ['la', 'A'], ['si', 'B'],
];

/**
 * Parsea un tono a { semitone, minor, flats, suffix }.
 * Devuelve null si no se reconoce (p. ej. "Em7b5" raro o texto libre).
 */
export function parseKey(raw) {
  let k = String(raw == null ? '' : raw).trim();
  if (!k) return null;

  // Nombre latino al principio ("Solm", "Re b", "MI") → cifrado americano.
  const lower = k.toLowerCase();
  for (const [es, en] of LATIN) {
    if (lower.startsWith(es)) { k = en + k.slice(es.length); break; }
  }

  // Raíz + alteración. La alteración acepta "b"/"#"/"bemol"/"sostenido".
  const m = k.match(/^([A-Ga-g])\s*(bemol|sostenido|[b#♭♯])?\s*(.*)$/);
  if (!m) return null;

  const accRaw = (m[2] || '').toLowerCase();
  const acc = (accRaw === 'b' || accRaw === 'bemol' || accRaw === '♭') ? 'b'
            : (accRaw === '#' || accRaw === 'sostenido' || accRaw === '♯') ? '#'
            : '';
  const root = m[1].toUpperCase() + acc;
  const semitone = NOTE_TO_SEMITONE[root];
  if (semitone === undefined) return null;

  // Sufijo: "m", "min", "menor" = menor. "maj"/"M" NO lo son.
  const suffix = (m[3] || '').trim();
  const minor = /^(m(?!aj)|min|menor)/i.test(suffix);

  return { semitone, minor, flats: acc === 'b', suffix };
}

/** ¿Es un tono que la app sabe interpretar? */
export function isKnownKey(raw) { return parseKey(raw) !== null; }

/**
 * Nombre canónico de un semitono. `flats` decide la grafía (Bb vs A#).
 */
export function noteName(semitone, flats) {
  const i = ((semitone % 12) + 12) % 12;
  return (flats ? FLAT_NAMES : SHARP_NAMES)[i];
}

/**
 * Transpone un tono N semitonos conservando el modo y la grafía original.
 * "Em" +3 → "Gm". "Bb" +2 → "Cb"? no: → "C" (la grafía solo elige entre
 * enarmónicos, nunca inventa dobles alteraciones).
 */
export function transposeKey(raw, semitones) {
  const p = parseKey(raw);
  if (!p) return raw;
  const n = ((semitones % 12) + 12) % 12;
  return noteName(p.semitone + n, p.flats) + p.suffix;
}

/**
 * Semitonos que hay que subir para pasar de `fromKey` a `toKey`, en el rango
 * [-6, +5] (el salto más corto: de C a B es -1, no +11). null si alguno no se
 * reconoce. Es lo que se le pasa a chordTransposer para la letra.
 */
export function keyDelta(fromKey, toKey) {
  const a = parseKey(fromKey), b = parseKey(toKey);
  if (!a || !b) return null;
  let d = (b.semitone - a.semitone) % 12;
  if (d > 5) d -= 12;
  if (d < -6) d += 12;
  return d;
}

/** ¿El tono destino se escribe con bemoles? (para la grafía de los acordes) */
export function prefersFlats(key) {
  const p = parseKey(key);
  return p ? p.flats : null;
}

/**
 * Las 12 opciones de tono relativas a un tono base, para el menú del servicio.
 * Devuelve [{ key, semitones, label }] donde `label` es "G  (+3)".
 * El modo (mayor/menor) se hereda del tono base: si la canción está en Em, las
 * opciones son Fm, F#m, Gm… no F, F#, G.
 */
export function keyChoices(baseKey) {
  const p = parseKey(baseKey);
  if (!p) return [];
  const out = [];
  for (let d = -5; d <= 6; d++) {
    const key = noteName(p.semitone + d, p.flats) + p.suffix;
    const sign = d > 0 ? `+${d}` : (d < 0 ? String(d) : '0');
    out.push({ key, semitones: d, label: d === 0 ? `${key} (original)` : `${key}  (${sign})` });
  }
  // Orden musical ascendente desde el original, que es como piensa un músico
  // al pedir "media arriba" o "un tono abajo".
  return out.sort((x, y) => x.semitones - y.semitones);
}
