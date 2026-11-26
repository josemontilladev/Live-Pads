// ─────────────────────────────────────────────────────────────────────────
// Plantillas de mezcla de Stems (guardadas en este equipo). La lógica de qué
// pista corresponde a cuál está en mixScenesCore.js; aquí, guardarlas y las
// ventanas para nombrarlas y elegirlas.
//   · «Usar siempre al cargar pistas de una canción»: la plantilla por defecto
//     se aplica sola al abrir en Stems las pistas de una canción (p. ej. un
//     multitrack recién importado), y queda ruteado como todos los demás.
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';

const KEY = 'livepads.stems.mixTemplates';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function loadTemplates() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter((t) => t && Array.isArray(t.slots)) : []; } catch (_) { return []; }
}
function saveTemplates(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))); } catch (_) {} }
export function defaultTemplate() { return loadTemplates().find((t) => t.isDefault) || null; }

/** Guarda (o reemplaza por nombre) una plantilla. */
export function storeTemplate(tpl, asDefault) {
  const list = loadTemplates().filter((t) => t.name.toLowerCase() !== tpl.name.toLowerCase());
  if (asDefault) list.forEach((t) => { delete t.isDefault; });
  list.unshift({ ...tpl, isDefault: !!asDefault || undefined });
  saveTemplates(list);
}

function box(title, sub, body, actions) {
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `<div class="vn-box mtpl-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="vn-head"><b>${esc(title)}</b><span>${esc(sub)}</span></div>${body}
    <div class="vn-actions">${actions}</div></div>`;
  document.body.appendChild(ov);
  const pop = pushModal(() => close(), ov);
  const close = () => { pop(); ov.remove(); };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-act="cancel"]')) close(); });
  return { ov, close };
}

/** Pide nombre para la plantilla → onSave(name, asDefault). */
export function openSaveTemplate(trackCount, onSave) {
  const { ov, close } = box('Guardar mezcla como plantilla',
    `Se guardan volumen, paneo, silencio, color y orden de ${trackCount} ${trackCount === 1 ? 'pista' : 'pistas'}, por tipo de pista (click, guía, batería, bajo…).`,
    `<label class="vn-field">Nombre <input data-ref="name" maxlength="60" placeholder="Domingo · in-ears"></label>
     <label class="sm-use"><input type="checkbox" class="mo-switch" data-ref="def"> <span><b>Usar siempre al cargar pistas de una canción</b><small>Cada multitrack que abras en Stems queda con esta mezcla y este orden.</small></span></label>`,
    '<button type="button" class="vn-btn" data-act="cancel">Cancelar</button><button type="button" class="vn-btn vn-btn--primary" data-act="ok">Guardar</button>');
  const name = ov.querySelector('[data-ref="name"]');
  setTimeout(() => name.focus(), 30);
  const go = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    onSave(n, ov.querySelector('[data-ref="def"]').checked);
    close();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  ov.querySelector('[data-act="ok"]').addEventListener('click', go);
}

/** Lista de plantillas → onApply(tpl). */
export function openTemplatePicker(onApply) {
  const render = () => {
    const list = loadTemplates();
    return list.length ? list.map((t, i) => `<div class="mtpl-row" data-i="${i}">
        <span class="mtpl-name"><b>${esc(t.name)}</b><small>${t.slots.length} ${t.slots.length === 1 ? 'pista' : 'pistas'}: ${esc(t.slots.map((s) => s.label).filter(Boolean).slice(0, 6).join(', '))}${t.slots.length > 6 ? '…' : ''}</small></span>
        <button type="button" class="mtl-link ${t.isDefault ? 'is-on' : ''}" data-act="def" title="Se aplica sola al cargar las pistas de una canción">${t.isDefault ? '★ Por defecto' : '☆ Por defecto'}</button>
        <button type="button" class="mtl-link mtl-link--danger" data-act="del">Borrar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="apply">Aplicar</button>
      </div>`).join('')
      : '<div class="mtl-empty">Todavía no hay plantillas. Deja una mezcla como te gusta y usa «Guardar mezcla como plantilla…».</div>';
  };
  const { ov, close } = box('Plantillas de mezcla', 'Aplica a este proyecto la mezcla, los colores y el orden de pistas que guardaste.',
    `<div class="mtpl-list" data-ref="list">${render()}</div>`, '<button type="button" class="vn-btn" data-act="cancel">Cerrar</button>');
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const row = e.target.closest('.mtpl-row');
    if (!b || !row) return;
    const list = loadTemplates();
    const i = Number(row.dataset.i), t = list[i];
    if (!t) return;
    if (b.dataset.act === 'apply') { close(); onApply(t); return; }
    if (b.dataset.act === 'del') list.splice(i, 1);
    if (b.dataset.act === 'def') { const on = !t.isDefault; list.forEach((x) => { delete x.isDefault; }); if (on) t.isDefault = true; }
    saveTemplates(list);
    ov.querySelector('[data-ref="list"]').innerHTML = render();
  });
}
