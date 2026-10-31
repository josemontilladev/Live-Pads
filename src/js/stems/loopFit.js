// Ajuste de un loop de la biblioteca al proyecto: cuánto estirar el tempo,
// cuántos semitonos mover y cuántas muestras exactas debe durar cada vuelta.
// Módulo puro (sin DOM ni Web Audio) para poder testearlo con node; el render
// de audio vive en loopRender.js.
//
//   fitLoop({ loopBpm, loopKey, bars, beatsPerBar }, { bpm, key, beatsPerBar })
//     → { ratio, semitones, stPitch, bars, effectiveBpm, quality, warnings }
//
// Decisiones musicales:
//   · Medio tiempo / doble tiempo: un loop de 140 en un proyecto a 72 se lee
//     como 70 (ratio 1.03) en vez de comprimirlo a la mitad (ratio 0.51), que
//     destrozaría el audio. Sus compases se reinterpretan en consecuencia.
//   · Relativas: un loop en Em dentro de un proyecto en G no se transpone
//     (mismas notas). Se compara siempre contra la mayor relativa.
//   · Salto más corto: de C a B es -1, no +11 (igual que keyDelta).
//   · Varispeed para loops sin tono: corregir la afinación con SoundTouch mueve
//     los ataques hasta ~10 ms (medido), y en una batería contra el click eso
//     se oye. Si el loop no tiene tono y el cambio de tempo es pequeño, se
//     acelera/frena tal cual (tiempo exacto al sample) y se acepta el leve
//     cambio de afinación, que en batería/percusión apenas se percibe.

import { parseKey } from '../utils/musicKeys.js';

const TEMPO_FACTORS = [0.5, 1, 2];
const VARISPEED_MAX_ST = 1.5;   // ≈ ±9 % de tempo

// Semitono de la mayor relativa: Em → G (4 + 3 = 7).
function majorEquivalent(raw) {
  const p = parseKey(raw);
  if (!p) return null;
  return (p.semitone + (p.minor ? 3 : 0)) % 12;
}

/** Semitonos para llevar `loopKey` a `projectKey`, en [-6, +5]. 0 si alguno falta. */
export function loopSemitones(loopKey, projectKey) {
  const a = majorEquivalent(loopKey);
  const b = majorEquivalent(projectKey);
  if (a == null || b == null) return 0;
  let d = (b - a) % 12;
  if (d > 5) d -= 12;
  if (d < -6) d += 12;
  return d;
}

/** Elige medio/doble tiempo para que el estiramiento sea el mínimo posible. */
export function pickTempoFactor(loopBpm, projectBpm) {
  let best = 1, bestDist = Infinity;
  for (const f of TEMPO_FACTORS) {
    const dist = Math.abs(Math.log(projectBpm / (loopBpm * f)));
    if (dist < bestDist - 1e-9) { best = f; bestDist = dist; }
  }
  return best;
}

/** Muestras exactas de N compases a un tempo dado (la rejilla del proyecto). */
export function barsToSamples(bars, beatsPerBar, bpm, sampleRate) {
  return Math.round(bars * beatsPerBar * (60 / bpm) * sampleRate);
}

export function fitLoop(loop, project) {
  const loopBpm = Number(loop.loopBpm);
  const projectBpm = Number(project.bpm);
  if (!(loopBpm > 0) || !(projectBpm > 0)) throw new Error('BPM inválido');

  const factor = pickTempoFactor(loopBpm, projectBpm);
  const effectiveBpm = loopBpm * factor;
  const ratio = projectBpm / effectiveBpm;
  const semitones = loopSemitones(loop.loopKey, project.key);
  // El render acelera la fuente con playbackRate = ratio (eso sube el tono
  // 12·log2(ratio)) y SoundTouch lo devuelve a su sitio + la transposición.
  // En varispeed no hay SoundTouch: el tono se mueve con el tempo.
  const speedSt = 12 * Math.log2(ratio);
  const varispeed = !parseKey(loop.loopKey) && Math.abs(speedSt) <= VARISPEED_MAX_ST;
  const stPitch = varispeed ? 0 : semitones - speedSt;
  const bars = loop.bars * factor;

  const warnings = [];
  const loopMeter = loop.beatsPerBar || 4;
  const projectMeter = project.beatsPerBar || 4;
  if (loopMeter !== projectMeter) warnings.push('meter');
  if (!Number.isInteger(bars)) warnings.push('partial_bar');

  const stretch = Math.abs(ratio - 1);
  const quality = (stretch > 0.25 || Math.abs(semitones) > 5) ? 'extreme'
                : (stretch > 0.12 || Math.abs(semitones) > 3) ? 'stretched'
                : 'ok';

  return { ratio, semitones, stPitch, varispeed, bars, effectiveBpm, factor, quality, warnings };
}

/**
 * ¿Suena natural en el proyecto? Poco estiramiento (≤ 8 %, contando medio o
 * doble tiempo), poca transposición (≤ 2 semitonos) y el mismo compás. Es el
 * filtro "Compatibles" de la Biblioteca.
 */
export function isCompatible(fit) {
  return Math.abs(fit.ratio - 1) <= 0.08 && Math.abs(fit.semitones) <= 2 && !fit.warnings.includes('meter');
}

/** ¿Hace falta procesar el audio, o se puede usar tal cual? */
export function needsProcessing(fit) {
  return Math.abs(fit.ratio - 1) > 1e-4 || fit.semitones !== 0;
}
