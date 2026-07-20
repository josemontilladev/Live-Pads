// ─────────────────────────────────────────────────────────────────────────
// Salida SIEMPRE en estéreo.
//
// Por defecto, el destino de un AudioContext usa el número de canales que
// declara el dispositivo y en modo 'max': si el equipo se presenta como mono
// (altavoz único de un portátil o de un móvil, o el interruptor "Audio mono"
// de accesibilidad de Windows/Android), TODO se pliega a un canal. Ahí el
// paneo deja de existir: el click que mandaste a la izquierda se suma con la
// música de la derecha y suena por ambos lados. En la PC del músico se oye
// perfecto y en la del compañero no — mismo archivo, misma app.
//
// Aquí forzamos el destino a 2 canales explícitos siempre que el hardware lo
// permita, y si NO lo permite lo reportamos para poder avisar: es un dato que
// el usuario necesita ANTES del servicio, no en medio.
// ─────────────────────────────────────────────────────────────────────────

// Aplica estéreo explícito al destino. Devuelve el diagnóstico:
//   { stereo: boolean, maxChannels: number }
// stereo:false significa que la SALIDA del equipo es mono y no hay paneo posible.
export function forceStereoOutput(ctx) {
  if (!ctx || !ctx.destination) return { stereo: true, maxChannels: 2 };
  const dest = ctx.destination;
  const max = Number(dest.maxChannelCount) || 0;
  try {
    if (max >= 2) {
      dest.channelCount = 2;
      dest.channelCountMode = 'explicit';   // 'max' dejaría que el equipo lo baje a 1
      dest.channelInterpretation = 'speakers';
      return { stereo: true, maxChannels: max };
    }
  } catch (_) {
    // Algunos navegadores no dejan escribir channelCount del destino: no es
    // fatal (el valor por defecto ya suele ser estéreo), seguimos.
    return { stereo: max !== 1, maxChannels: max || 2 };
  }
  return { stereo: false, maxChannels: max || 1 };
}

// Marca un nodo como estéreo explícito, para que nada de la cadena colapse a
// mono por herencia (p. ej. una fuente mono aguas arriba).
export function keepStereo(node) {
  if (!node) return node;
  try {
    node.channelCount = 2;
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'speakers';
  } catch (_) {}
  return node;
}
