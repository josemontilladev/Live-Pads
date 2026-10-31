// Fusionar un loop en una pista existente (la pista "de su instrumento").
// Módulo puro (Float32Array, sin Web Audio) para poder testearlo con node.
//
// La pista tiene un buffer que empieza en `offsetSec` del timeline y del que se
// oye solo el tramo [trimStart, trimEnd]. El resultado es UN buffer nuevo que
// cubre lo audible de la pista + el loop; en el tramo del loop manda el loop
// (reemplaza, no mezcla: igual que soltar un clip encima de otro en un DAW).
// El recorte se "hornea": el buffer nuevo ya no necesita trim.

/**
 * @param {object} cur   { offsetSec, trimStartSec, trimEndSec, sampleRate }
 * @param {number} atSec   dónde empieza el loop en el timeline
 * @param {number} loopLen muestras del loop
 * @returns {{ offsetSec:number, length:number, curFrom:number, curTo:number, curAt:number, loopAt:number }}
 */
export function planMerge(cur, atSec, loopLen) {
  const sr = cur.sampleRate;
  const visStart = cur.offsetSec + (cur.trimStartSec || 0);
  const visEnd = cur.offsetSec + cur.trimEndSec;
  const loopEnd = atSec + loopLen / sr;
  const startSec = Math.min(visStart, atSec);
  const endSec = Math.max(visEnd, loopEnd);
  return {
    offsetSec: startSec,
    length: Math.round((endSec - startSec) * sr),
    curFrom: Math.round((cur.trimStartSec || 0) * sr),
    curTo: Math.round(cur.trimEndSec * sr),
    curAt: Math.round((visStart - startSec) * sr),
    loopAt: Math.round((atSec - startSec) * sr),
  };
}

/**
 * Escribe en `out` (canal destino ya creado, de plan.length muestras) lo audible
 * de la pista y encima el loop.
 */
export function mergeChannel(out, curData, loopData, plan) {
  const cur = curData.subarray(plan.curFrom, plan.curTo);
  out.set(cur.subarray(0, Math.max(0, Math.min(cur.length, out.length - plan.curAt))), plan.curAt);
  const n = Math.max(0, Math.min(loopData.length, out.length - plan.loopAt));
  out.fill(0, plan.loopAt, plan.loopAt + n);
  out.set(loopData.subarray(0, n), plan.loopAt);
}
