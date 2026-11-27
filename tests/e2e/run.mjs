// Recorrido completo de extremo a extremo, en UNA sola sesión de la app (como en vivo:
// lo pesado primero y el medley al final, cuando ya hay análisis hechos en memoria).
//
//   npm run test:e2e
//
// Usa copias de canciones de la biblioteca instalada (%APPDATA%/LivePads) en un perfil
// temporal; los modelos de IA se guardan en %LOCALAPPDATA%/LivePads-e2e-models.
// Cada escenario también se puede lanzar solo: node tests/e2e/<escenario>.e2e.mjs
import { launch, findSong, reporter } from './harness.mjs';
import * as lyrics from './lyricsAi.e2e.mjs';
import * as drums from './drumRecording.e2e.mjs';
import * as songMap from './songMap.e2e.mjs';
import * as medley from './medley.e2e.mjs';

const titles = [...new Set([lyrics.SONG, drums.SONG, ...medley.SONGS])];
const h = await launch({ songs: titles.map(findSong), timeoutMs: 45 * 60000 });
const r = reporter();
try {
  await lyrics.run(h, r);
  await drums.run(h, r);
  await songMap.run(h, r);
  await medley.run(h, r);
  if (h.exceptions.length) console.log(`\nExcepciones en la app (${h.exceptions.length}):\n  ${h.exceptions.slice(0, 8).join('\n  ')}`);
} finally { await h.close(); }
process.exit(r.summary() ? 1 : 0);
