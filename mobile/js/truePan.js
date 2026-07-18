// ─────────────────────────────────────────────────────────────────────────
// Paneo REAL (balance) que AÍSLA canales.
//
// PROBLEMA que resuelve: `StereoPannerNode` NO aísla. Con una fuente ESTÉREO,
// al panear a tope PLIEGA el canal contrario encima. Según la spec de Web Audio,
// con pan = +1:   outL = 0 ;  outR = inR + inL
// En los multitracks de iglesia (click/guía en un canal y música en el otro)
// eso hacía que, al mandar la secuencia a la derecha, el CLICK grabado en el
// canal izquierdo se sumara al oído derecho a volumen completo → "el click se
// oye en ambos lados" aunque estuviera paneado.
//
// Aquí usamos: splitter → ganancia por canal → merger. Cada canal del archivo
// va SOLO a su salida, así que a tope el canal contrario se DESCARTA de verdad.
// En el centro se comporta igual que antes (L→L, R→R a ganancia 1).
//
// Devuelve { input, output, setPan(-1..1) } para insertarlo en el grafo.
// ─────────────────────────────────────────────────────────────────────────

export function createTruePan(ctx) {
  const input = ctx.createGain();
  // Sube MONO a dual-mono ANTES de separar: sin esto, el splitter (que es
  // "discrete") dejaría el canal derecho en silencio con fuentes mono.
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';

  const splitter = ctx.createChannelSplitter(2);
  const gL = ctx.createGain();
  const gR = ctx.createGain();
  const merger = ctx.createChannelMerger(2);

  input.connect(splitter);
  splitter.connect(gL, 0);      // canal izquierdo del archivo
  splitter.connect(gR, 1);      // canal derecho del archivo
  gL.connect(merger, 0, 0);     // → salida izquierda
  gR.connect(merger, 0, 1);     // → salida derecha

  let value = 0;
  function setPan(p) {
    const v = Math.max(-1, Math.min(1, Number(p) || 0));
    value = v;
    // Balance: panear a un lado ATENÚA el canal contrario (no lo pliega).
    gL.gain.value = v <= 0 ? 1 : 1 - v;
    gR.gain.value = v >= 0 ? 1 : 1 + v;
  }
  setPan(0);

  return {
    input,
    output: merger,
    setPan,
    get pan() { return value; },
    connect: (dest) => merger.connect(dest),
    disconnect: () => { try { merger.disconnect(); } catch (_) {} },
  };
}
