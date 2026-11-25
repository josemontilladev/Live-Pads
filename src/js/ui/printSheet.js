// ─────────────────────────────────────────────────────────────────────────
// Imprimir / guardar en PDF: la hoja de acordes de una canción o el setlist del
// servicio (lista con tonos y BPM + la hoja de cada canción, cada una en su
// página). Se usa el diálogo de impresión del sistema, que también trae
// «Microsoft Print to PDF», así sirve para papel y para PDF.
//
// Hoja limpia en blanco y negro (acordes en dorado oscuro), A4, en el tono del
// servicio y con los acordes como grados (1·4·5) si esa opción está activa.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { formatLyrics } from './lyricsFormat.js';
import { transposeAll } from './chordTransposer.js';
import { keyDelta, prefersFlats } from '../utils/musicKeys.js';
import { getEffectiveKey } from '../data/service.js';
import { chordNumbersOn } from '../utils/chordNumbers.js';
import { notesOf, decorateSections } from '../live/bandNotes.js';
import { bestCapo, capoLabel } from '../utils/capo.js';

const CSS = `
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  /* Arial: con Segoe UI algunos visores de PDF pintaban las «l» más gruesas. */
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  h1 { font-size: 24px; margin: 0; }
  .artist { color: #666; font-size: 13px; margin-top: 2px; }
  .info { color: #8a5d00; font-weight: 700; font-size: 13px; margin: 8px 0 10px; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 0 0 12px; }
  .lyrics { font-size: 14px; line-height: 1.45; columns: var(--cols, 1); column-gap: 28px; }
  .section-header-line { display: inline-block; margin: 10px 0 4px; padding: 2px 8px; border-radius: 4px; background: #f1ede2; font-size: 10.5px; font-weight: 800; letter-spacing: .04em; break-after: avoid; }
  .chord-line { font-weight: 800; color: #8a5d00; white-space: pre-wrap; }
  .lyric-line { break-inside: avoid; }
  .lyric-line.has-inline-chords { padding-top: 1.05em; }
  .chw { position: relative; display: inline-block; white-space: nowrap; }
  .inline-chord { position: absolute; left: 0; bottom: 100%; font-weight: 800; color: #8a5d00; font-size: .86em; white-space: nowrap; }
  /* Acordes sueltos, sin letra debajo (intro «[Dm] [C] [Gm]…»): uno detrás de otro, como en la app. */
  .chw--bare { display: inline-flex; flex-direction: column; vertical-align: bottom; }
  .chw--bare > .inline-chord { position: static; padding-right: .6em; font-size: 1em; }
  .lyric-line.has-inline-chords:not(:has(.chw:not(.chw--bare))) { padding-top: 0; }
  .lyrics-spacer { height: 8px; }
  .cn-num { display: none; }
  body.nums .cn-num { display: inline; }
  body.nums .cn-name { display: none; }
  .church { color: #8a5d00; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
  th { text-align: left; color: #777; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; padding: 6px 4px; border-bottom: 1px solid #ccc; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; }
  td.key { color: #8a5d00; font-weight: 800; }
  .foot { margin-top: 18px; color: #999; font-size: 10px; }
  .capo { color: #555; font-size: 12px; margin: -4px 0 10px; }
  .bn-general, .bn-inline { margin: 2px 0 8px; break-inside: avoid; }
  .bn-note { font-size: 12px; line-height: 1.35; padding: 3px 8px; border-left: 3px solid #8a5d00; background: #faf6ec; margin-bottom: 3px; }
  .bn-note b { margin-right: 6px; color: #8a5d00; }
  .bn-note i { margin-left: 8px; color: #888; font-style: normal; font-size: 10.5px; }
`;

/** Letra de la canción en el tono de hoy (el del servicio si lo tiene). */
function songSheetHtml(song, { note = '' } = {}) {
  const base = song.key || '';
  const live = getEffectiveKey(song) || base;
  const semis = base && live && base !== live ? keyDelta(base, live) : 0;
  const text = song.lyrics ? (semis ? transposeAll(song.lyrics, semis, prefersFlats(live)) : song.lyrics) : '';
  const info = [live && `Tono ${live}`, song.bpm && `${song.bpm} BPM`, song.timeSig, note].filter(Boolean).join('  ·  ');
  const long = text.split('\n').length > 46;
  // Notas para la banda bajo cada sección (las mismas que en la app y el Companion).
  let lyricsHtml = text.trim() ? formatLyrics(text, live || null) : '';
  const notes = notesOf(song);
  if (lyricsHtml && notes.length) { const d = document.createElement('div'); d.innerHTML = lyricsHtml; decorateSections(d, notes); lyricsHtml = d.innerHTML; }
  const capo = bestCapo(live);
  return `<section class="sheet">
    <h1>${esc(song.title || 'Sin título')}</h1>
    ${song.artist ? `<div class="artist">${esc(song.artist)}</div>` : ''}
    ${info ? `<div class="info">${esc(info)}</div>` : ''}
    ${capo && capo.capo ? `<div class="capo">Guitarra: ${esc(capoLabel(capo))}</div>` : ''}
    <hr>
    <div class="lyrics" style="--cols:${long ? 2 : 1}">${lyricsHtml || '<p style="color:#888">Esta canción aún no tiene letra.</p>'}</div>
  </section>`;
}

function printHtml(title, body) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body class="${chordNumbersOn() ? 'nums' : ''}">${body}</body></html>`);
  doc.close();
  const go = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    finally { setTimeout(() => frame.remove(), 1500); }
  };
  // Las fuentes y el maquetado listos antes de abrir el diálogo.
  setTimeout(go, 150);
}

/** Hoja de acordes de una canción (en el tono del servicio si lo tiene). */
export function printSong(song) {
  if (!song) return;
  printHtml(song.title || 'Hoja de acordes', songSheetHtml(song));
}

/** Setlist: portada con la lista (tono, BPM) y, si se pide, la hoja de cada canción. */
export function printService(songs, { name = 'Servicio', date = '', withSheets = true } = {}) {
  const list = (songs || []).filter(Boolean);
  if (!list.length) { window.showToast?.('Este servicio no tiene canciones.', 'info'); return; }
  const rows = list.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.title || '')}</b>${s.artist ? `<br><span style="color:#777">${esc(s.artist)}</span>` : ''}</td><td class="key">${esc(getEffectiveKey(s) || s.key || '')}</td><td>${esc(s.bpm ? String(s.bpm) : '')}</td></tr>`).join('');
  const cover = `<section class="sheet">
    <div class="church">LivePads</div>
    <h1>${esc(name)}</h1>
    ${date ? `<div class="artist">${esc(date)}</div>` : ''}
    <table><thead><tr><th>#</th><th>Canción</th><th>Tono</th><th>BPM</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">${list.length} ${list.length === 1 ? 'canción' : 'canciones'}</div>
  </section>`;
  const sheets = withSheets ? list.map((s) => songSheetHtml(s)).join('') : '';
  printHtml(name, cover + sheets);
}
