// ─────────────────────────────────────────────────────────────────────────
// Importar multitracks — lógica pura (probada en tests/multitrack.test.mjs).
//  · parsePackName('Way Maker - Leeland - 68 BPM - E') → { title, artist, bpm, key }
//  · seqSide(kind): a qué lado va cada pista en la secuencia de Pads
//    (click y guía → izquierda/in-ears; todo lo demás → derecha/sala)
// ─────────────────────────────────────────────────────────────────────────

const NOISE = /\b(secuencia\s+multitracks?|multi\s*tracks?|multitracks?\.com|loop\s*community|prime|stems?|wav|mp3|split\s*tracks?|tracks?|master|original|full\s*mix|mt)\b/gi;
const KEY_PART = /^([A-G](?:#|b|♯|♭)?)(m|min|minor|maj|major)?$/i;
const normKeyPart = (k, q) => { const base = k[0].toUpperCase() + k.slice(1).replace('♯', '#').replace('♭', 'b'); return /^m(in(or)?)?$/i.test(q || '') ? base + 'm' : base; };
const BPM_RE = /(\d{2,3}(?:[.,]\d{1,3})?)\s*bpm\b|(\d{2,3}[.,]\d{1,2})\s*pm\b/i;

/**
 * Nombre de un paquete → { title, artist, bpm, key }. Formatos vistos de verdad:
 *   «Way Maker - Leeland - 68 BPM - E»     (separado por « - »)
 *   «ADIOS AL AYER-Algo Nuevo Viene-Ab-150.00bpm»   (guiones sin espacios, BPM con decimales)
 *   «Agnus dei + Santo por siempre - Secuencia multitrack - [TPMCristiana]»
 *   «Phenomena (Da Da)-RecursosA&A (Da Da)-F#-132», «Gracias, Dios ( C) - Essential worship 130.00BPM»
 *   «Holy Forever (Español)[with Miel San Marcos]», «Sana Nuestra Tierra- Multitrack -121bpm-4_4-G.rar»
 *   «Glorioso Día - Passion (Español)-20260604T145702Z-3-001» (descarga de Google Drive)
 */
export function parsePackName(raw, fileNames = []) {
  let s = String(raw || '').replace(/\.(zip|rar|7z)$/i, '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/-\d{8}T\d{6}Z(?:-\d+)*$/, '');   // sufijo de las descargas de Google Drive
  // « - » (espaciado) o guiones pegados (A-B-C): se decide con el nombre original, porque al
  // limpiarlo (quitar «Multitrack», el BPM…) aparecen « - » que no estaban.
  const spaced = /\s[-–—|]\s/.test(s);
  const all = [s, ...fileNames].join(' | ');
  const bpmM = all.match(BPM_RE);
  let bpm = bpmM ? String(Math.round(parseFloat((bpmM[1] || bpmM[2]).replace(',', '.')))) : '';
  // «[with X]» / «[con X]»: el artista.
  let withArtist = '';
  const w = s.match(/\[\s*(?:with|con|feat\.?|ft\.?)\s+([^\]]+)\]/i);
  if (w) withArtist = w[1].trim();
  // Quita lo que no es el nombre: BPM, etiquetas [entre corchetes], «MultiTracks»…
  s = s.replace(/\(?\s*\d{2,3}(?:[.,]\d{1,3})?\s*bpm\s*\)?/gi, ' ')
    .replace(/\d{2,3}[.,]\d{1,2}\s*pm\b/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[\[(]\s*[\])]/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
  let key = '';
  const keyM = s.match(/\b(?:key(?:\s+of)?|tono|in)\s*[-:]?\s*([A-G](?:#|b|♯|♭)?m?)\b/i) || s.match(/\(\s*([A-G](?:#|b|♯|♭)?m?)\s*\)/);
  if (keyM) { key = normKeyPart(keyM[1].replace(/m$/i, ''), /m$/i.test(keyM[1]) ? 'm' : ''); s = s.replace(keyM[0], ' ').replace(/[\[(]\s*[\])]/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
  // Partes: con « - » (espaciado) se separa por ahí; si no, por guiones pegados (A-B-C).
  let parts = s.split(spaced ? /\s+[-–—|]\s+/ : /\s*[-–—|]\s*/).map((x) => x.replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, '').trim()).filter(Boolean);
  parts = parts.filter((x, i) => {
    if (i === 0) return true;
    const m = x.match(KEY_PART);
    if (m) { if (!key) key = normKeyPart(m[1], m[2]); return false; }               // «Ab», «F#m»: el tono
    if (/^\d{1,2}\s*[\/ ]\s*\d{1,2}$/.test(x)) return false;                         // «4 4», «6/8»: el compás
    if (/^\d{2,3}$/.test(x) && +x >= 40 && +x <= 250) { if (!bpm) bpm = x; return false; }   // «132»: el BPM
    if (/^\(.*\)$/.test(x)) return false;                                           // «(TPMCristiana)»: etiqueta de quien lo sube
    return true;
  });
  // «… (G)» / «… G» al final del título.
  if (!key && parts.length) {
    const m = parts[parts.length - 1].match(/^(.*?)[\s(]+([A-G](?:#|b|♯|♭)?)(m|min|minor|maj|major)?\)?$/);
    if (m && m[1].trim()) { key = normKeyPart(m[2], m[3]); parts[parts.length - 1] = m[1].trim(); }
  }
  const title = parts[0] || String(raw || 'Multitrack').trim();
  const artist = parts.length > 1 ? parts[1] : withArtist;
  return { title, artist, bpm, key };
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
