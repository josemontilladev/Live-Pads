// Explorar la app a mano: node tests/e2e/probe.mjs "Título" "expr1" "expr2"…
import { launch, findSong, sleep } from './harness.mjs';
const [title, ...exprs] = process.argv.slice(2);
const songs = title ? title.split('|').map(findSong) : [];
const h = await launch({ songs });
try {
  for (const e of exprs) {
    if (/^sleep:\d+$/.test(e)) { await sleep(+e.slice(6)); continue; }
    try { console.log('»', e.slice(0, 80), '\n ', JSON.stringify(await h.evaluate(e))?.slice(0, 2500)); }
    catch (err) { console.log('»', e.slice(0, 80), '\n  ERROR', err.message.slice(0, 500)); }
  }
  if (h.exceptions.length) console.log('excepciones:', h.exceptions.slice(0, 5));
  if (h.consoleErrors.length) console.log('console.error:', h.consoleErrors.slice(0, 5));
} finally { await h.close(); }
