// ─────────────────────────────────────────────────────────────────────────
// Cuenta atrás en la TV (lado de la app): ventana para empezarla y un chip en la
// barra superior con lo que falta (tocarlo la abre para cambiarla o pararla).
// La pantalla de la TV la pinta tvCountdownCore.js (mountTvCountdown).
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { pushModal } from './modalStack.js';
import { cdState, setCdState, cdLeft, fmtLeft, CD_KEY } from './tvCountdownCore.js';

const LAST_KEY = 'livepads.tvCountdown.last';   // lo último que se usó (título, anuncio, minutos)
function lastPrefs() {
  const p = { min: 5, title: 'El servicio empieza en', msg: '' };
  try { Object.assign(p, JSON.parse(localStorage.getItem(LAST_KEY) || '{}')); } catch (_) {}
  return p;
}

export function openTvCountdown() {
  const st = cdState(), active = cdLeft(st) > 0, p = lastPrefs();
  let min = p.min;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box cd-box" role="dialog" aria-modal="true" aria-label="Cuenta atrás en la TV">
      <div class="vn-head"><b>Cuenta atrás en la TV</b><span>Se ve en la pantalla de la letra, sobre el fondo. Al llegar a cero desaparece sola.</span></div>
      <div class="cd-mins" role="group" aria-label="Duración">
        ${[2, 5, 10, 15, 20].map((m) => `<button type="button" data-min="${m}" class="${m === min ? 'is-on' : ''}">${m} min</button>`).join('')}
      </div>
      <label class="vn-field">…o hasta una hora <input type="time" data-ref="at" step="60"></label>
      <label class="vn-field">Texto de arriba <input data-ref="title" maxlength="60" value="${esc(active ? st.title : p.title)}"></label>
      <label class="vn-field">Anuncio (opcional) <input data-ref="msg" maxlength="120" value="${esc(active ? st.msg : p.msg)}" placeholder="Ej. Bienvenidos · Silencia tu teléfono"></label>
      ${active ? `<p class="cd-now">En pantalla ahora: <b data-ref="left">${fmtLeft(cdLeft(st))}</b></p>` : ''}
      <div class="vn-actions">
        ${active ? '<button type="button" class="vn-btn" data-act="stop">Quitar de la TV</button>' : '<button type="button" class="vn-btn" data-act="cancel">Cancelar</button>'}
        <button type="button" class="vn-btn vn-btn--primary" data-act="go">${active ? 'Empezar de nuevo' : 'Mostrar en la TV'}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const popModal = pushModal(() => close(), ov);
  let tick = null;
  const close = () => { clearInterval(tick); popModal(); ov.remove(); };
  if (active) tick = setInterval(() => { const el = $('[data-ref="left"]'); const l = cdLeft(); if (el) el.textContent = l ? fmtLeft(l) : '—'; }, 500);

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="cancel"]')) { close(); return; }
    const mb = e.target.closest('[data-min]');
    if (mb) { min = Number(mb.dataset.min); $('[data-ref="at"]').value = ''; ov.querySelectorAll('[data-min]').forEach((b) => b.classList.toggle('is-on', b === mb)); return; }
    if (e.target.closest('[data-act="stop"]')) { setCdState(null); close(); window.showToast?.('Cuenta atrás quitada de la TV.', 'info'); return; }
    if (e.target.closest('[data-act="go"]')) {
      let until = Date.now() + min * 60000;
      const at = $('[data-ref="at"]').value;
      if (at) {
        const [h, m] = at.split(':').map(Number);
        const d = new Date(); d.setHours(h, m, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);   // ya pasó hoy: mañana
        until = d.getTime();
      }
      const title = $('[data-ref="title"]').value.trim(), msg = $('[data-ref="msg"]').value.trim();
      try { localStorage.setItem(LAST_KEY, JSON.stringify({ min, title, msg })); } catch (_) {}
      setCdState({ until, title, msg });
      // La pantalla de la TV se abre (o se trae al frente) con la letra que ya tenía.
      try { window.electronAPI?.lyricsWindowShow?.({ keepCurrent: true }); } catch (_) {}
      close();
      window.showToast?.(`Cuenta atrás en la TV: ${fmtLeft(cdLeft())}.`, 'success');
    }
  });
  ov.querySelector('[data-ref="at"]').addEventListener('input', () => ov.querySelectorAll('[data-min]').forEach((b) => b.classList.remove('is-on')));
}

// ── Chip en la barra superior mientras hay cuenta atrás ──
let chip = null, chipTimer = null;
function paintChip() {
  const left = cdLeft();
  if (!left) {
    if (cdState()) setCdState(null);   // terminó: se limpia
    if (chip) chip.hidden = true;
    clearInterval(chipTimer); chipTimer = null;
    return;
  }
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'tv-cd-chip';
    chip.className = 'tv-cd-chip';
    chip.title = 'Cuenta atrás en la TV — tocar para cambiarla o quitarla';
    chip.addEventListener('click', () => openTvCountdown());
    const clock = document.getElementById('topbar-clock');
    if (clock && clock.parentNode) clock.parentNode.insertBefore(chip, clock); else document.body.appendChild(chip);
  }
  chip.hidden = false;
  chip.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg><span>TV ${fmtLeft(left)}</span>`;
  if (!chipTimer) chipTimer = setInterval(paintChip, 1000);
}

export function initTvCountdown() {
  window.addEventListener('livepads:tv-countdown', paintChip);
  window.addEventListener('storage', (e) => { if (e.key === CD_KEY) paintChip(); });
  paintChip();
}
