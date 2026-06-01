import { esc } from '../utils/dom.js';
import { wrapTextareaSelection, insertTextAtCursor } from '../utils/text.js';
import { formatLyrics, highlightSyntax } from './lyricsFormat.js';
import { transposeAll, keyPrefersFlats } from './chordTransposer.js';
import { parseChordPage } from '../data/chordImporter.js';
import { showDialog, confirmDialog, confirmDialogAsync } from './dialog.js';
import { pushModal } from './modalStack.js';

// Section dropdown -> bracket tag inserted into the textarea. Verso auto-
// increments based on existing [VERSO N] tokens to save keystrokes when
// drafting multi-verse songs.
const SECTION_INSERTS = {
  intro:        () => '[INTRO]',
  verso:        null, // dynamic — assigned per call site
  'pre-coro':   () => '[PRE-CORO]',
  coro:         () => '[CORO]',
  puente:       () => '[PUENTE]',
  instrumental: () => '[INSTRUMENTAL]',
  solo:         () => '[SOLO]',
  final:        () => '[FINAL]'
};

function modalHTML(song) {
  const keyBadge = song.key
    ? `<span class="lyrics-key-badge">Tono: ${esc(song.key)}</span>`
    : '';

  return `
    <div class="lyrics-modal-header">
      <div>
        <h3 class="lyrics-modal-title">Editar Letra y Acordes</h3>
        <p class="lyrics-modal-subtitle">${esc(song.title)} — ${esc(song.artist) || 'Sin artista'} ${keyBadge}</p>
      </div>
      <button class="modal-close-btn lyrics-modal-close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div class="lyrics-modal-body">
      <div class="lyrics-editor-toolbar">
        <select class="format-select lyrics-section-select">
          <option value="normal" class="opt-placeholder">+ SECCIÓN</option>
          <option value="intro">Intro</option>
          <option value="verso">Verso</option>
          <option value="pre-coro">Pre-Coro</option>
          <option value="coro">Coro</option>
          <option value="puente">Puente</option>
          <option value="instrumental">Instrumental</option>
          <option value="solo">Solo</option>
          <option value="final">Final</option>
        </select>
        <div class="toolbar-sep"></div>
        <button type="button" class="format-tool-btn chord-btn" data-action="chord" title="Envolver selección en [ ]   ·   Ctrl+[">[ ]</button>
        <button type="button" class="format-tool-btn" data-action="clear" title="Limpiar formato de selección">Tx</button>
        <div class="toolbar-sep"></div>
        <div class="transpose-group" title="Transponer todos los acordes ±1 semitono">
          <button type="button" class="format-tool-btn transpose-btn" data-action="transpose-down" title="Bajar medio tono">▼</button>
          <span class="transpose-counter" data-shift="0">0</span>
          <button type="button" class="format-tool-btn transpose-btn" data-action="transpose-up" title="Subir medio tono">▲</button>
        </div>
        <div class="toolbar-sep"></div>
        <button type="button" class="format-tool-btn import-url-btn icon-only" data-action="import-url" title="Importar letra+acordes desde URL (LaCuerda.net)" aria-label="Importar URL">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
        <div class="lyrics-preview-spacer"></div>
        <button class="btn-preview-toggle lyrics-preview-btn icon-only" title="Vista previa" aria-label="Vista previa">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>

      <div class="editor-workspace">
        <div class="editor-container">
          <div class="editor-highlight"></div>
          <textarea class="editor-textarea" placeholder="[Intro]\n[C#m] [B] [A]\n\n[Verso 1]\n[C#m]              [B]\nMi Dios todo lo puede hacer..." spellcheck="false"></textarea>
        </div>
        <div class="modal-preview-panel lyrics-preview-panel">
          <div class="lyrics-text-content"></div>
        </div>
      </div>
    </div>

    <div class="lyrics-modal-footer">
      <span class="lyrics-shortcut-hint">Ctrl+S guardar · Ctrl+[ acorde · Esc cerrar</span>
      <span class="lyrics-autosave-indicator" data-state="idle">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="12" height="12" class="lai-icon-saved"><polyline points="20 6 9 17 4 12"/></svg>
        <span class="lai-text"></span>
      </span>
      <div class="lyrics-modal-actions">
        <button class="modal-btn cancel-btn lyrics-modal-cancel" title="Cerrar (Esc)">Cerrar</button>
        <button class="modal-btn save-btn lyrics-modal-save" title="Guardar y cerrar (Ctrl+S)">Guardar</button>
      </div>
    </div>
  `;
}

export function openLyricsEditorModal(song, onSaveCallback) {
  const overlay = document.createElement('div');
  overlay.id = 'gi-lyrics-modal';
  overlay.className = 'lyrics-modal-overlay';

  const content = document.createElement('div');
  content.className = 'lyrics-modal-panel';
  content.innerHTML = modalHTML(song);

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  const textarea = overlay.querySelector('.editor-textarea');
  const highlight = overlay.querySelector('.editor-highlight');

  // Set value after attaching to avoid cursor reset issues
  let savedLyrics = song.lyrics || '';
  textarea.value = savedLyrics;
  const isDirty = () => textarea.value !== savedLyrics;

  // Accidental preference: flat-leaning keys (F, Bb, Eb, ...) get flat names
  // on transposition; sharp keys get sharps. Null = preserve original per chord.
  const preferFlats = keyPrefersFlats(song.key);

  setTimeout(() => {
    overlay.style.opacity = '1';
    content.style.transform = 'translateX(0)';
  }, 10);

  let popModal = null;
  // Guarda mientras un confirmDialog está visible: Escape doble-tap no
  // debe cerrar el editor por encima del propio confirmDialog.
  let closeInFlight = false;
  const closeModal = (force = false) => {
    const animateOut = () => {
      if (popModal) { popModal(); popModal = null; }
      overlay.style.opacity = '0';
      content.style.transform = 'translateX(100%)';
      setTimeout(() => overlay.remove(), 300);
    };
    if (force || !isDirty()) { animateOut(); return; }
    if (closeInFlight) return;
    closeInFlight = true;
    confirmDialog({
      title: 'Cambios sin guardar',
      message: '¿Descartar los cambios y cerrar el editor?',
      confirmLabel: 'Descartar',
      danger: true,
      onConfirm: () => { closeInFlight = false; animateOut(); },
      onCancel:  () => { closeInFlight = false; },
    });
  };
  popModal = pushModal(() => closeModal());

  overlay.querySelector('.modal-close-btn').onclick = () => closeModal();
  overlay.querySelector('.cancel-btn').onclick = () => closeModal();

  const previewPanel = overlay.querySelector('.modal-preview-panel');
  const previewBtn = overlay.querySelector('.btn-preview-toggle');

  highlight.innerHTML = highlightSyntax(textarea.value);

  const refreshHighlight = () => {
    highlight.innerHTML = highlightSyntax(textarea.value);
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  };

  textarea.oninput = refreshHighlight;
  textarea.onscroll = () => {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  };

  overlay.querySelectorAll('.format-tool-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      if (action === 'chord') {
        wrapTextareaSelection(textarea, '[', ']');
      } else if (action === 'clear') {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);
        const cleaned = selected.replace(/[\*_\[\]]/g, '');

        const savedScrollTop = textarea.scrollTop;
        textarea.value = text.substring(0, start) + cleaned + text.substring(end);
        textarea.focus();
        textarea.selectionStart = start;
        textarea.selectionEnd = start + cleaned.length;
        textarea.scrollTop = savedScrollTop;
        textarea.dispatchEvent(new Event('input'));
      }
    };
  });

  /* ── Transposition controls ── */
  const transposeCounter = overlay.querySelector('.transpose-counter');
  const applyTranspose = (delta) => {
    if (!textarea.value) return;
    const currentShift = parseInt(transposeCounter.dataset.shift || '0', 10);
    const newShift = currentShift + delta;

    const savedScrollTop = textarea.scrollTop;
    const savedSelStart = textarea.selectionStart;
    const savedSelEnd = textarea.selectionEnd;

    textarea.value = transposeAll(textarea.value, delta, preferFlats);

    transposeCounter.dataset.shift = String(newShift);
    transposeCounter.textContent = newShift > 0 ? `+${newShift}` : String(newShift);
    transposeCounter.classList.toggle('shifted', newShift !== 0);

    textarea.scrollTop = savedScrollTop;
    // Best-effort cursor restore — chord widths can change slightly so the
    // exact selection may drift by a char, but the scroll position stays.
    textarea.selectionStart = Math.min(savedSelStart, textarea.value.length);
    textarea.selectionEnd = Math.min(savedSelEnd, textarea.value.length);
    refreshHighlight();
  };

  overlay.querySelector('[data-action="transpose-up"]').onclick = (e) => {
    e.stopPropagation();
    applyTranspose(1);
  };
  overlay.querySelector('[data-action="transpose-down"]').onclick = (e) => {
    e.stopPropagation();
    applyTranspose(-1);
  };

  /* ── Import letra+acordes desde URL ──
     Pide la URL, descarga el HTML vía IPC (whitelist en main), parsea y
     llena el textarea. Si la canción no tenía título/tono, también los
     ofrece como sugerencia (sin sobrescribir si ya hay valor). */
  // Note: window.prompt is disabled in Electron — we use the app's own
  // showDialog() inline prompt instead.
  const runImport = async (url) => {
    if (!url) return;
    const originalLabel = importBtn.innerHTML;
    importBtn.innerHTML = '<span>Importando…</span>';
    importBtn.disabled = true;
    try {
      if (!window.electronAPI || !window.electronAPI.fetchChordUrl) {
        throw new Error('IPC no disponible (modo navegador)');
      }
      const html = await window.electronAPI.fetchChordUrl(url);
      const parsed = parseChordPage(url, html);
      if (!parsed.lyrics || !parsed.lyrics.trim()) {
        throw new Error('No se encontró letra en esa página');
      }
      if (textarea.value.trim()) {
        const ok = await confirmDialogAsync({
          title: 'Reemplazar letra',
          message: 'El editor ya tiene contenido. ¿Reemplazar con la letra importada de la URL?',
          confirmLabel: 'Reemplazar',
          danger: false,
        });
        if (!ok) return;
      }
      textarea.value = parsed.lyrics;
      refreshHighlight();
      textarea.dispatchEvent(new Event('input'));
      // Autocompletar metadata si la canción aún no la tiene.
      if (parsed.title  && (!song.title  || song.title === 'Nueva Canción')) song.title  = parsed.title;
      if (parsed.artist && !song.artist) song.artist = parsed.artist;
      if (parsed.key    && !song.key)    song.key    = parsed.key;
      if (typeof window.showToast === 'function') {
        window.showToast('Letra importada desde ' + new URL(url).hostname, 'success');
      }
    } catch (err) {
      console.error('Import error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('No se pudo importar: ' + err.message, 'error');
      }
    } finally {
      importBtn.innerHTML = originalLabel;
      importBtn.disabled = false;
    }
  };

  const importBtn = overlay.querySelector('[data-action="import-url"]');
  if (importBtn) importBtn.onclick = (e) => {
    e.stopPropagation();
    showDialog('Importar desde URL', 'https://acordes.lacuerda.net/...', runImport);
  };

  /* ── Section dropdown with auto-numbering for Verso ── */
  const nextVersoNumber = () => {
    const matches = textarea.value.matchAll(/\[\s*VERSO\s+(\d+)\s*\]/gi);
    let max = 0;
    for (const m of matches) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return max + 1;
  };

  const inserters = { ...SECTION_INSERTS, verso: () => `[VERSO ${nextVersoNumber()}]` };
  const formatSelect = overlay.querySelector('.format-select');
  formatSelect.onchange = () => {
    const val = formatSelect.value;
    const makeTag = inserters[val];
    if (makeTag) insertTextAtCursor(textarea, makeTag());
    formatSelect.value = 'normal';
    textarea.dispatchEvent(new Event('input'));
  };

  let isPreview = false;
  previewBtn.onclick = () => {
    isPreview = !isPreview;
    previewBtn.classList.toggle('active', isPreview);
    previewBtn.title = isPreview ? 'Editar letra' : 'Vista previa';
    previewBtn.setAttribute('aria-label', previewBtn.title);
    const workspace = overlay.querySelector('.editor-workspace');
    workspace.classList.toggle('is-preview', isPreview);
    if (isPreview) {
      previewPanel.querySelector('.lyrics-text-content').innerHTML = formatLyrics(textarea.value);
    } else {
      refreshHighlight();
    }
  };

  // Autosave: silent persist (no close) used by debounced typing + blur.
  // Keeps savedLyrics in sync so isDirty() reflects truth and the close
  // confirmation only fires for genuinely unsaved edits.
  const indicator = overlay.querySelector('.lyrics-autosave-indicator');
  const indicatorText = indicator?.querySelector('.lai-text');
  let savingTimer = null;
  const setIndicator = (state, label) => {
    if (!indicator) return;
    indicator.dataset.state = state;
    if (indicatorText) indicatorText.textContent = label;
    if (state === 'saved' && savingTimer == null) {
      // Fade away after 2s of stillness so it doesn't feel "stuck".
      savingTimer = setTimeout(() => {
        if (indicator.dataset.state === 'saved') {
          indicator.dataset.state = 'idle';
          if (indicatorText) indicatorText.textContent = '';
        }
        savingTimer = null;
      }, 2000);
    }
  };

  const autosaveLyrics = () => {
    if (!isDirty()) return;
    setIndicator('saving', 'Guardando…');
    onSaveCallback(textarea.value);
    savedLyrics = textarea.value;
    setIndicator('saved', 'Guardado');
  };

  // Debounced autosave: 1.5s after the last keystroke. Also fires on blur
  // so users who tab away mid-edit don't lose work either.
  let autosaveDebounce = null;
  const scheduleAutosave = () => {
    if (autosaveDebounce) clearTimeout(autosaveDebounce);
    autosaveDebounce = setTimeout(() => {
      autosaveDebounce = null;
      autosaveLyrics();
    }, 1500);
  };
  textarea.addEventListener('input', scheduleAutosave);
  textarea.addEventListener('blur', () => {
    if (autosaveDebounce) { clearTimeout(autosaveDebounce); autosaveDebounce = null; }
    autosaveLyrics();
  });

  const saveLyrics = () => {
    if (autosaveDebounce) { clearTimeout(autosaveDebounce); autosaveDebounce = null; }
    autosaveLyrics();
    closeModal(true); // force close — we just saved, so dirty=false
  };

  overlay.querySelector('.save-btn').onclick = saveLyrics;

  // Click on the dimmed backdrop closes (with dirty-check)
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };

  /* ── Keyboard shortcuts inside the modal ── */
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      saveLyrics();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '[') {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement === textarea) {
        wrapTextareaSelection(textarea, '[', ']');
      }
      return;
    }
    // Escape ahora lo gestiona modalStack (push en open / pop en close).
  };
  overlay.addEventListener('keydown', onKey);
  overlay.tabIndex = -1;
  setTimeout(() => textarea.focus(), 50);
}
