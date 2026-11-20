// Voces de referencia de una canción (melodía, 2.ª voz, 3.ª voz…): se graban desde
// GI App en el móvil y aquí se pueden ESCUCHAR. Viven en song.audio.voices
// ([{ id, label, path, by, note, sec }]); los archivos se bajan con el resto del
// audio de la librería (carpeta «Voces»).
import { openCardMoreMenu } from './cardMoreMenu.js';
import { getSavedOutput } from '../audio/audioOutput.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

let audio = null;        // un solo reproductor para todas las voces
let playingId = null;    // `${songId}:${voiceId}` de la que suena

export function voicesOf(song) {
  const v = song && song.audio && Array.isArray(song.audio.voices) ? song.audio.voices : [];
  return v.filter((x) => x && x.path && x.label);
}

const fmtSec = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

function stop() {
  if (audio) { try { audio.pause(); } catch (_) {} }
  playingId = null;
}

async function play(song, v) {
  const key = `${song.id}:${v.id}`;
  if (playingId === key) { stop(); return; }
  stop();
  // ¿Ya está el archivo en este equipo? (se baja con la sincronización de audios)
  const rel = decodeURIComponent(String(v.path).replace(/^livepads:\/\/app\//i, ''));
  try {
    const st = await window.electronAPI.libraryFilesStat([rel]);
    const have = (st && st.present || []).some((p) => (typeof p === 'string' ? p : p.path) === rel);
    if (!have) {
      window.showToast?.(`«${v.label}» todavía no se ha descargado a este equipo. Se baja sola con la sincronización de audios; inténtalo en un momento.`, 'info');
      window.dispatchEvent(new CustomEvent('livepads:files-wanted'));
      return;
    }
  } catch (_) { /* sin comprobación: se intenta reproducir igual */ }
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('ended', () => { playingId = null; });
    audio.addEventListener('error', () => { playingId = null; window.showToast?.('No se pudo reproducir esa voz.', 'error'); });
  }
  // Por la misma salida de audio elegida en Ajustes.
  try { const out = getSavedOutput(); if (out.id && audio.setSinkId) await audio.setSinkId(out.id); } catch (_) {}
  audio.src = v.path;
  playingId = key;
  try { await audio.play(); window.showToast?.(`▶ ${v.label}${v.by ? ' · ' + v.by : ''} — vuelve a pulsarla para detener`, 'info'); }
  catch (_) { playingId = null; }
}

/** Menú con las voces de la canción, anclado al botón «Voces» de su tarjeta. */
export function openVoicesMenu(anchor, song) {
  const list = voicesOf(song);
  if (!list.length) return;
  openCardMoreMenu(anchor, list.map((v) => {
    const on = playingId === `${song.id}:${v.id}`;
    const extra = [v.by, fmtSec(Number(v.sec) || 0)].filter(Boolean).join(' · ');
    return {
      icon: on ? ICON_STOP : ICON_PLAY,
      label: `<b>${esc(v.label)}</b>${extra ? ` <span style="opacity:.65">· ${esc(extra)}</span>` : ''}${v.note ? `<br><span style="opacity:.6;font-size:11.5px">${esc(v.note)}</span>` : ''}`,
      onSelect: () => play(song, v),
    };
  }));
}

/** Botón para la línea de datos de la tarjeta (cadena vacía si la canción no tiene voces). */
export function voicesChipHtml(song) {
  const n = voicesOf(song).length;
  if (!n) return '';
  return `<button type="button" class="gi-voices-chip" data-action="voices" title="Voces de referencia grabadas desde GI App (${n}). Clic para escucharlas.">`
    + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>'
    + `Voces ${n}</button>`;
}
