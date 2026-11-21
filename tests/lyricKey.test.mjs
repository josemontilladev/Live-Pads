import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transposeAll, keyPrefersFlats } from '../src/js/ui/chordTransposer.js';
import { keyDelta } from '../src/js/utils/musicKeys.js';

// El editor usa estas piezas para «Llevar a…»: tono detectado de la letra → destino.
test('G → E: los acordes de la letra bajan 3 semitonos y quedan en E', () => {
  const letra = '[Verso]\n[G]Puedo ver tu [D]hermosura\n[Em]nada se [C]compara';
  const d = keyDelta('G', 'E');
  assert.equal(d, -3);
  const out = transposeAll(letra, d, keyPrefersFlats('E'));
  assert.equal(out, '[Verso]\n[E]Puedo ver tu [B]hermosura\n[C#m]nada se [A]compara');
});

test('a un tono con bemoles se escriben bemoles (G → F)', () => {
  const out = transposeAll('[G]Hola [D]mundo [Em]sí [C]no', keyDelta('G', 'F'), keyPrefersFlats('F'));
  assert.equal(out, '[F]Hola [C]mundo [Dm]sí [Bb]no');
});
