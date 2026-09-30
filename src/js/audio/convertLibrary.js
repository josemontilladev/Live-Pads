// Convierte a MP3 los audios de la librería que están en formatos que NO sirven
// para cambiar de tono en los móviles (.m4a de YouTube, .aac, .webm, .opus…).
//
// Por qué: el motor de audio del teléfono solo transpone MP3/WAV/OGG/FLAC. Un
// .m4a suena, pero sin poder subir ni bajar el tono. Aquí se decodifica una vez
// en el escritorio y se guarda como MP3: todas las apps (escritorio, móvil y
// web) usan el mismo archivo y el tono funciona igual en secuencia y original.
//
// Seguro de repetir: lo ya convertido deja de ser candidato. El archivo antiguo
// NO se borra de tu carpeta (por si quieres volver atrás).

import { getSongs } from '../state/store.js';
import { compressToMp3, needsMp3, baseName, fmtMB } from './mp3Encode.js';
import { persistSong, songSlug } from '../stems/songStems.js';
import { urlToRelPath } from '../cloud/fileSync.js';

/** Lista de audios a convertir: { song, slot: 'original'|'sequence'|'stem', stem?, url }. */
export function listConvertible(songs = getSongs()) {
  const out = [];
  for (const song of songs || []) {
    const a = song?.audio;
    if (!a) continue;
    if (a.original && needsMp3(a.original)) out.push({ song, slot: 'original', url: a.original });
    if (a.sequence && needsMp3(a.sequence)) out.push({ song, slot: 'sequence', url: a.sequence });
    for (const st of Array.isArray(a.stems) ? a.stems : []) {
      if (st && st.url && needsMp3(st.url)) out.push({ song, slot: 'stem', stem: st, url: st.url });
    }
  }
  return out;
}

/**
 * Convierte todos los candidatos. `onProgress({done,total,name})`.
 * Devuelve { converted, failed, before, after, errors[] }.
 */
export async function convertLibraryToMp3(onProgress = () => {}) {
  const items = listConvertible();
  const res = { converted: 0, failed: 0, before: 0, after: 0, errors: [] };
  const touched = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const label = `${it.song.title || 'Canción'} · ${it.slot === 'stem' ? (it.stem.name || 'pista') : it.slot === 'original' ? 'original' : 'secuencia'}`;
    onProgress({ done: i, total: items.length, name: label });
    try {
      // Si este equipo aún no tiene el archivo, se baja de la nube primero.
      const rel = urlToRelPath(it.url);
      if (rel) {
        const { missing } = await window.electronAPI.libraryFilesStat([rel]);
        if (missing?.length) {
          const { bajarRutas } = await import('../cloud/fileSync.js');
          await bajarRutas([rel]);
        }
      }
      const ab = await window.electronAPI.readAudioFile(it.url);
      if (!ab || !ab.byteLength) throw new Error('archivo vacío o no disponible en este equipo');
      const { buffer, before, after } = await compressToMp3(ab);
      let newUrl;
      if (it.slot === 'stem') {
        newUrl = await window.electronAPI.saveSongStem({ buffer, songSlug: songSlug(it.song), name: it.stem.name || baseName(rel || 'pista'), ext: 'mp3' });
        it.stem.url = newUrl;
      } else {
        newUrl = await window.electronAPI.assignStemsMix({ buffer, type: it.slot, name: it.song.title || baseName(rel || 'audio') });
        it.song.audio[it.slot] = newUrl;
      }
      touched.add(it.song);
      res.converted++;
      res.before += before;
      res.after += after;
    } catch (e) {
      res.failed++;
      res.errors.push(`${label}: ${e?.message || e}`);
    }
  }
  onProgress({ done: items.length, total: items.length, name: '' });
  // Guarda la librería una sola vez; eso dispara la subida automática a la nube.
  if (touched.size) persistSong([...touched][0]);
  return res;
}

export { fmtMB };
