// ─────────────────────────────────────────────────────────────────────────
// Importar multitracks — lógica pura (probada en tests/multitrack.test.mjs).
//  · parsePackName('Way Maker - Leeland - 68 BPM - E') → { title, artist, bpm, key }
//  · seqSide(kind): a qué lado va cada pista en la secuencia de Pads
//    (click y guía → izquierda/in-ears; todo lo demás → derecha/sala)
// ─────────────────────────────────────────────────────────────────────────

const NOISE = /\b(multi\s*tracks?|multitracks?\.com|loop\s*community|prime|stems?|wav|mp3|split\s*tracks?|tracks?|master|original|full\s*mix)\b/gi;

export function parsePackName(raw, fileNames = []) {
  let s = String(raw || '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const all = [s, ...fileNames].join(' | ');
  const bpmM = all.match(/(\d{2,3}(?:[.,]\d)?)\s*bpm\b/i);
  const keyM = all.match(/\b(?:key(?:\s+of)?|tono|in)\s*[-:]?\s*([A-G](?:#|b|♯|♭)?m?)\b/i)
    || s.match(/(?:^|[\s\-(\[])([A-G](?:#|b|♯|♭)?m?)(?:\s*(?:maj|major|minor|min))?(?=[\s\-)\]]*$)/);
  let key = keyM ? keyM[1].replace('♯', '#').replace('♭', 'b') : '';
  // Quita lo que no es el nombre: BPM, tono, «MultiTracks», paréntesis de versión.
  s = s.replace(/\(?\s*\d{2,3}(?:[.,]\d)?\s*bpm\s*\)?/gi, ' ')
    .replace(/\b(?:key(?:\s+of)?|tono)\s*[-:]?\s*[A-G](?:#|b|♯|♭)?m?\b/gi, ' ')
    .replace(NOISE, ' ')
    .replace(/[\[(]\s*[\])]/g, ' ');
  if (key && !/\b(?:key|tono)\b/i.test(raw || '')) s = s.replace(new RegExp(`[\\s\\-(\\[]${key.replace('#', '\\#')}m?\\s*[)\\]]?\\s*$`), ' ');
  const parts = s.split(/\s+[-–—|]\s+|\s*[-–—]{1}\s*(?=[A-ZÁÉÍÓÚÑ])/).map((x) => x.replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, '').trim()).filter(Boolean);
  const title = parts[0] || String(raw || 'Multitrack').trim();
  const artist = parts.length > 1 ? parts[1] : '';
  return { title, artist, bpm: bpmM ? String(Math.round(parseFloat(bpmM[1].replace(',', '.')))) : '', key };
}

/** Lado de cada pista en la secuencia: 'L' (click y guía, a los in-ears) o 'R' (la banda). */
export function seqSide(kind) {
  return kind === 'click' || kind === 'guide' ? 'L' : 'R';
}

/** Ganancia para dejar el pico en −1 dBFS (sin subir más de 4×). */
export function normGain(peak) {
  if (!(peak > 0)) return 1;
  return Math.min(4, 0.891 / peak);
}
