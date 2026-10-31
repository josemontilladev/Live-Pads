// Armado por secciones: a partir de una estructura (Intro 4 · Verso 8 · Coro 8…)
// sugiere qué loop usar en cada sección para cada instrumento.
// Módulo puro (sin DOM) para poder testearlo con node.
//
// Criterios de la sugerencia, en orden de peso:
//   1. Sección: un loop marcado para esa sección gana a uno "cualquiera", y
//      este a uno de otra sección.
//   2. Mismo pack que el resto: una canción suena coherente si batería, bajo
//      y pad vienen del mismo pack. Se elige un pack principal (el que más
//      loops aporta a los instrumentos pedidos) y sus loops reciben ventaja.
//   3. Menos estiramiento de tempo y menos transposición.
// Las secciones del mismo tipo (Coro y Coro) reciben el MISMO loop.

import { fitLoop } from './loopFit.js';

export const SECTION_TYPES = [
  { id: 'intro', label: 'Intro', cue: 'intro' },
  { id: 'verse', label: 'Verso', cue: 'verso' },
  { id: 'prechorus', label: 'Pre-coro', cue: 'pre-coro' },
  { id: 'chorus', label: 'Coro', cue: 'coro' },
  { id: 'bridge', label: 'Puente', cue: 'puente' },
  { id: 'build', label: 'Build', cue: 'build' },
  { id: 'outro', label: 'Outro', cue: 'outro' },
];

export const STRUCTURE_PRESETS = {
  estandar: [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['bridge', 8], ['chorus', 8], ['outro', 4]],
  corta: [['intro', 4], ['verse', 8], ['chorus', 8], ['chorus', 8], ['outro', 4]],
  adoracion: [['intro', 8], ['verse', 8], ['prechorus', 4], ['chorus', 8], ['bridge', 8], ['build', 4], ['chorus', 8], ['outro', 8]],
};

export const sectionLabel = (id) => SECTION_TYPES.find((s) => s.id === id)?.label || id;

function score(loop, sectionId, project, mainPack) {
  let s = 0;
  if (loop.section === sectionId) s += 0;
  else if (!loop.section || loop.section === 'any') s += 1;
  else s += 4;
  if (mainPack && loop.pack_id !== mainPack) s += 1.5;
  const fit = fitLoop({ loopBpm: Number(loop.bpm), loopKey: loop.musical_key, bars: loop.bars, beatsPerBar: loop.beats_per_bar }, project);
  s += Math.abs(Math.log(fit.ratio)) * 6;   // 10 % de estiramiento ≈ 0.57
  s += Math.abs(fit.semitones) * 0.15;
  return s;
}

// Pack que más instrumentos cubre (y, a igualdad, más loops tiene).
function pickMainPack(loops, instruments) {
  const byPack = new Map();
  for (const l of loops) {
    if (!instruments.includes(l.instrument)) continue;
    const p = byPack.get(l.pack_id) || { inst: new Set(), n: 0 };
    p.inst.add(l.instrument); p.n++;
    byPack.set(l.pack_id, p);
  }
  let best = null, bestKey = -1;
  for (const [id, p] of byPack) {
    const key = p.inst.size * 1000 + p.n;
    if (key > bestKey) { best = id; bestKey = key; }
  }
  return best;
}

/** Loops válidos para un instrumento, del mejor al peor para esa sección. */
export function rankCandidates(loops, instrument, sectionId, project, mainPack = null) {
  return loops
    .filter((l) => l.instrument === instrument)
    .map((l) => ({ loop: l, s: score(l, sectionId, project, mainPack) }))
    .sort((a, b) => a.s - b.s || String(a.loop.title).localeCompare(String(b.loop.title)))
    .map((x) => x.loop);
}

/**
 * @param {object} o
 *   sections:    [{ type, bars }]
 *   instruments: ['drums', 'bass', …]
 *   loops:       loops elegibles (ya filtrados por plan/pack)
 *   project:     { bpm, key, beatsPerBar }
 * @returns {{ mainPack: string|null, picks: Array<Record<string, string|null>> }}
 *   picks[i][instrument] = id del loop (o null si no hay ninguno)
 */
export function suggestStructure({ sections, instruments, loops, project }) {
  const mainPack = pickMainPack(loops, instruments);
  const byType = new Map(); // `${type}|${instrument}` → loopId
  const picks = sections.map((sec) => {
    const row = {};
    for (const inst of instruments) {
      const key = `${sec.type}|${inst}`;
      if (!byType.has(key)) {
        const best = rankCandidates(loops, inst, sec.type, project, mainPack)[0];
        byType.set(key, best ? best.id : null);
      }
      row[inst] = byType.get(key);
    }
    return row;
  });
  return { mainPack, picks };
}

/** Compás inicial (0-based) de cada sección y total de compases. */
export function sectionStarts(sections) {
  const starts = [];
  let bar = 0;
  for (const s of sections) { starts.push(bar); bar += s.bars; }
  return { starts, totalBars: bar };
}
