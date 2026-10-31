// "Armar una canción en 1 minuto": primer paso desde el editor vacío. Pide
// tempo, tono y plantilla, y deja el resto a "Armar por secciones" (que propone
// un loop por sección y arma pistas + marcadores).
//
//   openQuickStart({ bpm, key, keyOptionsHtml, onStart: ({ bpm, key, preset }) => {} })

import { esc } from '../utils/dom.js';

const PRESETS = {
  estandar: ['Estándar', 'Intro · Verso · Coro · Verso · Coro · Puente · Coro · Outro'],
  adoracion: ['Adoración', 'Más larga y con espacio para repetir el coro'],
  corta: ['Corta', 'Intro · Verso · Coro · Outro'],
};
// Tempos típicos para empezar rápido (el campo admite cualquiera).
const TEMPOS = [[68, 'Lenta'], [76, 'Media'], [92, 'Movida'], [120, 'Rápida']];

export function openQuickStart({ bpm = 76, key = '', keyOptionsHtml = '', onStart }) {
  document.getElementById('sqs-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'sqs-overlay';
  overlay.className = 'stb-overlay';
  overlay.innerHTML = `
    <div class="stb-modal sqs-modal" role="dialog" aria-modal="true" aria-label="Armar una canción">
      <header class="stb-head">
        <h3>Armar una canción en 1 minuto</h3>
        <button type="button" class="stl-x" data-act="close" aria-label="Cerrar">×</button>
      </header>
      <p class="stb-hint">Dinos el tempo y el tono. Después eliges los instrumentos y LivePads arma la secuencia con loops de la Biblioteca, ya ajustados.</p>
      <div class="sqs-field">
        <span class="sqs-label">Tempo</span>
        <div class="sqs-tempos">
          ${TEMPOS.map(([v, l]) => `<button type="button" data-bpm="${v}" class="${v === Math.round(bpm) ? 'is-on' : ''}"><b>${v}</b><span>${l}</span></button>`).join('')}
          <label class="sqs-custom"><input type="number" min="40" max="220" step="1" value="${Math.round(bpm)}" data-ref="bpm" aria-label="BPM"> BPM</label>
        </div>
      </div>
      <div class="sqs-field">
        <label class="sqs-label" for="sqs-key">Tono</label>
        <select id="sqs-key" data-ref="key">${keyOptionsHtml}</select>
      </div>
      <div class="sqs-field">
        <span class="sqs-label">Estructura</span>
        <div class="sqs-presets">
          ${Object.entries(PRESETS).map(([id, [t, d]], i) => `
            <label class="sqs-preset"><input type="radio" name="sqs-preset" value="${id}"${i === 0 ? ' checked' : ''}>
              <span><b>${esc(t)}</b><small>${esc(d)}</small></span></label>`).join('')}
        </div>
      </div>
      <footer class="stb-foot">
        <span class="stb-total"></span>
        <button type="button" class="stb-btn" data-act="close">Cancelar</button>
        <button type="button" class="stb-btn stb-btn--primary" data-act="go">Elegir instrumentos →</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  const ref = (n) => overlay.querySelector(`[data-ref="${n}"]`);
  ref('key').value = key || '';

  const close = () => { window.removeEventListener('keydown', onKey, true); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);

  const paintTempos = () => {
    const v = Number(ref('bpm').value);
    overlay.querySelectorAll('[data-bpm]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.bpm) === v));
  };
  ref('bpm').addEventListener('input', paintTempos);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const t = e.target.closest('[data-act],[data-bpm]');
    if (!t) return;
    if (t.dataset.bpm) { ref('bpm').value = t.dataset.bpm; paintTempos(); return; }
    if (t.dataset.act === 'close') close();
    else if (t.dataset.act === 'go') {
      const v = Math.round(Number(ref('bpm').value));
      if (!(v >= 40 && v <= 220)) { ref('bpm').focus(); return; }
      const preset = overlay.querySelector('input[name="sqs-preset"]:checked').value;
      close();
      onStart?.({ bpm: v, key: ref('key').value || null, preset });
    }
  });
  setTimeout(() => overlay.querySelector('[data-act="go"]').focus(), 30);
}
