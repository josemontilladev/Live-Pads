// Modal popup para crear una canción nueva. Mismo look y comportamiento en
// Pads y en Stems (antes Pads abría el form inline en el sidebar y se "perdía").
// Llama onSaved(newSong) cuando el usuario guarda con un título válido.
//
//   openNewSongModal({ onSaved, defaults })
//     defaults?: { genre?, favorite?, libraryId? } — preconfigura la canción.
//
// Dar de alta una canción era un viaje de tres paradas: crear aquí, abrir el
// editor de letra para pegarla, y volver a entrar para el audio. Ahora la letra
// se pega en este mismo modal, y con el enlace de la cifra se rellena todo solo.

import { songEditFormHTML, applyLibrarySelection } from './songEditForm.js';
import { pushModal } from './modalStack.js';
import { cleanPastedLyrics, repairLyrics } from './lyricsFormat.js';
import { parseChordPage } from '../data/chordImporter.js';
import { confirmDialogAsync } from './dialog.js';

// Fuentes soportadas por el importador (la lista blanca real vive en main.js,
// que es quien hace la petición; esto es solo el texto de ayuda).
const FUENTES = 'cifraclub.com · lacuerda.net';

export function openNewSongModal({ onSaved, defaults = {} } = {}) {
  const newSong = {
    id: 'song_' + Date.now(),
    addedAt: Date.now(),
    title: 'Nueva Canción',
    artist: '', bpm: '', key: '',
    genre: defaults.genre || 'adoracion',
    tags: [],
    audio: { sequence: null, original: null },
  };
  if (defaults.favorite) newSong.favorite = true;
  if (defaults.libraryId) newSong.libraryId = defaults.libraryId;

  const headerHTML = `
    <div class="newsong-head">
      <span class="newsong-head-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </span>
      <span class="newsong-head-text">
        <h3 class="newsong-head-title">Nueva canción</h3>
        <span class="newsong-head-sub">Tono, BPM y compás se aplican al lanzarla.</span>
      </span>
    </div>`;

  // Camino rápido: pegar el enlace de la cifra y que se rellene todo. Va ARRIBA
  // porque es lo que resuelve el caso en un gesto; el formulario de abajo queda
  // para retocar o para las canciones que no están en ninguna web.
  const importHTML = `
    <div class="newsong-import">
      <label class="newsong-import-label" for="ns-url">Importar desde un enlace</label>
      <div class="newsong-import-row">
        <input type="url" id="ns-url" class="gi-edit-input newsong-import-input"
               placeholder="Pega el enlace de la cifra…" spellcheck="false">
        <button type="button" class="gi-edit-btn save newsong-import-btn" data-action="import-url">Importar</button>
      </div>
      <span class="newsong-import-hint">${FUENTES} — trae título, artista, tono y la letra con los acordes ya alineados.</span>
    </div>`;

  const overlay = document.createElement('div');
  overlay.className = 'stems-newsong-overlay';
  overlay.innerHTML = `<div class="stems-newsong-modal">${headerHTML}${importHTML}${songEditFormHTML(newSong, { placeholderForNewSong: true, showLyrics: true })}</div>`;
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.stems-newsong-modal');

  const pop = pushModal(() => close(), modal);
  const close = () => { try { pop(); } catch (_) {} overlay.remove(); };

  setTimeout(() => { try { modal.querySelector('.edit-title').focus(); } catch (_) {} }, 40);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Pegar letra aquí la limpia igual que en el editor grande: invisibles,
  // homoglifos cirílicos de las webs de letras, espacios raros y basura de
  // cabecera. No reordena nada — eso solo pasa al importar por enlace.
  const lyricsEl = modal.querySelector('.edit-lyrics');
  if (lyricsEl) {
    lyricsEl.addEventListener('paste', (e) => {
      const crudo = e.clipboardData?.getData('text/plain');
      if (!crudo) return;
      const limpio = cleanPastedLyrics(crudo);
      if (limpio === crudo) return;
      e.preventDefault();
      const a = lyricsEl.selectionStart, b = lyricsEl.selectionEnd;
      lyricsEl.value = lyricsEl.value.slice(0, a) + limpio + lyricsEl.value.slice(b);
      lyricsEl.selectionStart = lyricsEl.selectionEnd = a + limpio.length;
    });
  }

  // ── Importar por enlace ──────────────────────────────────────────────────
  const urlEl = modal.querySelector('#ns-url');
  const importBtn = modal.querySelector('[data-action="import-url"]');

  // Rellena un campo SOLO si está vacío: lo que el usuario ya escribió manda
  // sobre lo que traiga la web.
  const rellenar = (sel, valor) => {
    const el = modal.querySelector(sel);
    if (!el || !valor) return;
    if (String(el.value || '').trim()) return;
    el.value = valor;
  };

  async function importar() {
    const url = String(urlEl.value || '').trim();
    if (!url) { urlEl.focus(); return; }
    const etiqueta = importBtn.textContent;
    importBtn.textContent = 'Importando…';
    importBtn.disabled = true;
    try {
      if (!window.electronAPI?.fetchChordUrl) throw new Error('No disponible en modo navegador');
      const html = await window.electronAPI.fetchChordUrl(url);
      const p = parseChordPage(url, html);
      if (!p.lyrics || !p.lyrics.trim()) throw new Error('No se encontró la letra en esa página');

      rellenar('.edit-title', p.title);
      rellenar('.edit-artist', p.artist);
      // El tono solo se aplica si el <select> tiene esa opción exacta.
      if (p.key) {
        const keyEl = modal.querySelector('.edit-key');
        if (keyEl && !keyEl.value && [...keyEl.options].some(o => o.value === p.key)) keyEl.value = p.key;
      }
      // Al importar SÍ se repara entera: el enlace trae la alineación intacta,
      // así que cada acorde se puede anclar a su sílaba con certeza. Es la
      // diferencia con copiar y pegar de la página, donde esa información ya
      // viene destruida.
      if (lyricsEl) {
        const reparada = repairLyrics(p.lyrics);
        if (lyricsEl.value.trim() && lyricsEl.value.trim() !== reparada.trim()) {
          const ok = await confirmDialogAsync({
            title: 'Reemplazar la letra',
            message: 'Ya hay letra escrita en el formulario. ¿La reemplazo con la importada del enlace?',
            confirmLabel: 'Reemplazar',
            danger: false,
          });
          if (!ok) return;
        }
        lyricsEl.value = reparada;
      }
      window.showToast?.(`✓ «${p.title || 'Canción'}» importada de ${new URL(url).hostname}.`, 'success');
    } catch (err) {
      window.showToast?.('No se pudo importar: ' + (err?.message || err), 'error');
    } finally {
      importBtn.textContent = etiqueta;
      importBtn.disabled = false;
    }
  }

  if (urlEl) urlEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); importar(); }
  });

  modal.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'import-url') { importar(); return; }
    if (action === 'edit-cancel') { close(); return; }
    if (action !== 'edit-save') return;
    const titleEl = modal.querySelector('.edit-title');
    const t = titleEl.value.trim();
    if (!t) { titleEl.focus(); return; }
    newSong.title = t;
    newSong.artist = modal.querySelector('.edit-artist').value.trim();
    newSong.bpm = modal.querySelector('.edit-bpm').value.trim();
    newSong.key = modal.querySelector('.edit-key').value;
    newSong.timeSig = modal.querySelector('.edit-timesig')?.value || '4/4';
    newSong.genre = modal.querySelector('.edit-genre').value;
    const tagsEl = modal.querySelector('.edit-tags');
    newSong.tags = tagsEl ? tagsEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
    const letra = lyricsEl ? lyricsEl.value.trim() : '';
    if (letra) newSong.lyrics = letra;
    applyLibrarySelection(modal, newSong);
    try { onSaved && onSaved(newSong); } catch (err) { console.error('onSaved del modal de canción falló:', err); }
    close();
  });
}
