// «Cambiar letra (conservar acordes)»: se pega la letra nueva SIN acordes y se ve
// al momento cómo queda con los acordes de la letra actual puestos encima
// (utils/lyricsReplace.js). Nada se cambia hasta pulsar «Usar esta letra»; luego,
// en el editor, se guarda como siempre (y Ctrl+Z lo deshace).
import { replaceLyricsKeepChords } from '../utils/lyricsReplace.js';
import { formatLyrics } from './lyricsFormat.js';
import { pushModal } from './modalStack.js';

export function openLyricsReplaceDialog({ currentText, onApply }) {
  const overlay = document.createElement('div');
  overlay.className = 'stems-newsong-overlay lrp-overlay';
  overlay.innerHTML = `
    <div class="stems-newsong-modal lrp-modal" role="dialog" aria-label="Cambiar la letra conservando los acordes">
      <div class="newsong-head">
        <span class="newsong-head-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>
        </span>
        <span class="newsong-head-text">
          <h3 class="newsong-head-title">Cambiar la letra, conservando los acordes</h3>
          <span class="newsong-head-sub">Pega la letra nueva <b>sin acordes</b>, con sus secciones (Verso 1, Coro…). Los acordes de la letra actual se colocan solos sobre la nueva.</span>
        </span>
      </div>
      <div class="lrp-cols">
        <label class="lrp-col">
          <span class="lrp-label">Letra nueva</span>
          <textarea class="gi-edit-input lrp-input" spellcheck="false" placeholder="Verso 1&#10;Mil generaciones&#10;Se postran a adorarle&#10;&#10;Coro&#10;…"></textarea>
        </label>
        <div class="lrp-col">
          <span class="lrp-label">Así quedará <small class="lrp-report"></small></span>
          <div class="lrp-preview lyrics-text-content"><p class="lrp-empty">Pega la letra a la izquierda y aquí verás los acordes puestos.</p></div>
        </div>
      </div>
      <p class="lrp-tip">Cada acorde va al principio de su palabra. Si la letra nueva tiene menos palabras, los acordes que no caben quedan en una línea aparte para que los pongas tú. Después puedes retocar cualquier acorde en el editor.</p>
      <div class="gi-edit-actions">
        <button type="button" class="gi-edit-btn save" data-act="apply" disabled>Usar esta letra</button>
        <button type="button" class="gi-edit-btn cancel" data-act="cancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('.lrp-input');
  const preview = overlay.querySelector('.lrp-preview');
  const report = overlay.querySelector('.lrp-report');
  const apply = overlay.querySelector('[data-act="apply"]');
  let result = null;

  const refresh = () => {
    const txt = input.value;
    if (!txt.trim()) {
      result = null; apply.disabled = true; report.textContent = '';
      preview.innerHTML = '<p class="lrp-empty">Pega la letra a la izquierda y aquí verás los acordes puestos.</p>';
      return;
    }
    result = replaceLyricsKeepChords(currentText || '', txt);
    preview.innerHTML = formatLyrics(result.text);
    const sin = result.report.filter((r) => !r.from).map((r) => r.section);
    report.textContent = sin.length ? `· sin acordes de antes: ${sin.join(', ')}` : '';
    report.title = result.report.map((r) => `${r.section} ← ${r.from || 'sin acordes'}`).join('\n');
    apply.disabled = false;
  };
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 120); });

  let popModal = null;
  const close = () => { if (popModal) { popModal(); popModal = null; } overlay.remove(); };
  popModal = pushModal(close, overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'cancel') close();
    else if (a.dataset.act === 'apply' && result) { const text = result.text; close(); onApply?.(text); }
  });
  setTimeout(() => input.focus(), 60);
  return { close };
}
