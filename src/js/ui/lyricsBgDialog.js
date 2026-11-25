// Ventana «Fondo de la pantalla (TV)»: elegir fondo animado, imagen o video, y cuánto se oscurece.
// Se ve al instante en la ventana de la letra (ui/lyricsBackground.js).
import { esc } from '../utils/dom.js';
import { PRESETS, bgPrefs, setBgPrefs } from './lyricsBackground.js';

export function openLyricsBgDialog() {
  const p = bgPrefs();
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box bg-box" role="dialog" aria-modal="true" aria-label="Fondo de la pantalla">
      <div class="vn-head"><b>Fondo de la pantalla (TV)</b><span>Detrás de la letra que se proyecta. Se ve al instante en la ventana de la letra.</span></div>
      <div class="bg-grid">
        <button type="button" data-bg="none" class="bg-tile bg-tile--none ${p.type === 'none' ? 'is-on' : ''}">Ninguno</button>
        ${PRESETS.map((x) => `<button type="button" data-bg="${x.id}" class="bg-tile ${p.type === 'preset' && p.id === x.id ? 'is-on' : ''}" style="background-image:${x.css}"><span>${esc(x.label)}</span></button>`).join('')}
        <button type="button" data-bg="file" class="bg-tile bg-tile--file ${p.type === 'file' ? 'is-on' : ''}">${p.type === 'file' && p.path ? esc(p.path.split(/[\\/]/).pop()) : 'Imagen o video…'}</button>
      </div>
      <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden data-ref="file">
      <label class="vn-field">Oscurecer el fondo (para leer la letra) <input type="range" min="0" max="0.85" step="0.05" value="${p.dim}" data-ref="dim"></label>
      <div class="vn-actions"><button type="button" class="vn-btn vn-btn--primary" data-act="close">Listo</button></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const mark = (el) => ov.querySelectorAll('.bg-tile').forEach((t) => t.classList.toggle('is-on', t === el));
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const t = e.target.closest('[data-bg]');
    if (!t) return;
    const v = t.dataset.bg;
    if (v === 'file') { ov.querySelector('[data-ref="file"]').click(); return; }
    setBgPrefs(v === 'none' ? { type: 'none' } : { type: 'preset', id: v });
    mark(t);
  });
  ov.querySelector('[data-ref="file"]').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const path = window.electronAPI?.pathForFile?.(f) || '';
    if (!path) { window.showToast?.('No se pudo usar ese archivo.', 'error'); return; }
    setBgPrefs({ type: 'file', path, kind: f.type.startsWith('video') ? 'video' : 'image' });
    const tile = ov.querySelector('[data-bg="file"]');
    tile.textContent = path.split(/[\\/]/).pop();
    mark(tile);
  });
  ov.querySelector('[data-ref="dim"]').addEventListener('input', (e) => setBgPrefs({ dim: Number(e.target.value) }));
}
