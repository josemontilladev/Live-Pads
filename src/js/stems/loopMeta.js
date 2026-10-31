// Datos de un loop deducidos al subirlo: título, instrumento y sección por el
// nombre del archivo, y BPM/compases exactos a partir de la duración.
// Módulo puro (sin DOM) para poder testearlo con node.

const INSTRUMENT_PATTERNS = [
  ['perc', /\b(perc(usi[oó]n|ussion)?|shaker|tamb(ourine|or)?|conga|bongo)\b/i],
  ['drums', /\b(drums?|bater[ií]a|kit|beat|groove)\b/i],
  ['bass', /\b(bass|bajo|sub)\b/i],
  ['pad', /\b(pads?|colch[oó]n|ambient|atm[oó]sfera|swell)\b/i],
  ['synth', /\b(synth|sintetizador|arp(egg?io)?|lead)\b/i],
  ['keys', /\b(keys?|piano|rhodes|teclas?|organ|[oó]rgano|wurli)\b/i],
  ['guitar', /\b(gtr|guitarra?|guitar|ac[uú]stica|el[eé]ctrica)\b/i],
  ['strings', /\b(strings?|cuerdas|violin|cello)\b/i],
  ['vocals', /\b(vox|vocals?|voz|voces|coro?s? vocal)\b/i],
  ['fx', /\b(fx|riser|impact|sweep|reverse|efecto)\b/i],
];
const SECTION_PATTERNS = [
  ['prechorus', /\b(pre[\s-]?(coro|chorus))\b/i],
  ['intro', /\bintro\b/i],
  ['verse', /\b(verso|verse)\b/i],
  ['chorus', /\b(coro|chorus)\b/i],
  ['bridge', /\b(puente|bridge)\b/i],
  ['build', /\b(build|subida|crescendo)\b/i],
  ['outro', /\b(outro|final|ending)\b/i],
];

/** "02_Bateria-Coro_72bpm.wav" → { title: "Bateria Coro", instrument: "drums", section: "chorus", bpmHint: 72 } */
export function guessFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const words = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const bpmMatch = words.match(/\b(\d{2,3})\s*bpm\b/i);
  const instrument = (INSTRUMENT_PATTERNS.find(([, re]) => re.test(words)) || ['other'])[0];
  const section = (SECTION_PATTERNS.find(([, re]) => re.test(words)) || ['any'])[0];
  const title = words
    .replace(/\b\d{2,3}\s*bpm\b/ig, '')
    .replace(/^\d+\s+/, '')          // "02 Bateria" → "Bateria"
    .replace(/\s+/g, ' ').trim() || base;
  return { title, instrument, section, bpmHint: bpmMatch ? Number(bpmMatch[1]) : null };
}

/**
 * Un loop dura exactamente N compases: con un BPM aproximado (detectado o del
 * nombre) se elige el N entero más cercano y de ahí el BPM exacto.
 * @returns {{ bpm:number, bars:number, error:number }} error = desvío relativo del BPM aproximado
 */
export function exactTempo(durationSec, approxBpm, beatsPerBar = 4) {
  const barsFloat = durationSec * approxBpm / 60 / beatsPerBar;
  const bars = Math.max(1, Math.round(barsFloat));
  const bpm = Math.round((bars * beatsPerBar * 60 / durationSec) * 100) / 100;
  return { bpm, bars, error: Math.abs(bpm - approxBpm) / approxBpm };
}

/** "Pack Adoración 2026" → "pack-adoracion-2026" */
export function slugify(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pack';
}

/** Nombre seguro para R2 y para la caché de cada PC. */
export function safeFileName(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-');
}

/** Instrumentos sin tono: no se les detecta ni se les pone tonalidad. */
export const UNPITCHED = new Set(['drums', 'perc', 'fx']);
