// ─────────────────────────────────────────────────────────────────────────
// Ventana «Mapa de la canción»: arreglos guardados (versión corta, larga, con dos
// coros al final…). Arriba, las secciones de la pista (clic = añadir al final);
// abajo, el orden del arreglo como bloques proporcionales a su duración
// (arrastrar para reordenar, × para quitar). Se guardan en la canción y viajan al
// equipo; el activo es el que sigue la pista al tocar (live/songMap.js).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from './modalStack.js';
import { markersFor } from '../data/markers.js';
import { getSongs } from '../state/store.js';
import { libSongFor } from '../live/bandNotes.js';
import { sectionsOf, resolve, naturalOrder, mapDuration, cleanArrangements } from '../live/songMapCore.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hue = (label) => { let h = 0; for (const ch of String(label).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

/** song: canción; opts.type: 'sequence' | 'original' (la pista cargada); opts.duration. */
export function openSongMap(song, { type = '', duration = 0 } = {}) {
  const lib = libSongFor(song);
  if (!lib) return;
  const t = type || (markersFor(lib, 'sequence').length ? 'sequence' : 'original');
  const ms = markersFor(lib, t);
  const dur = duration || (ms.length ? ms[ms.length - 1].t + 20 : 0);
  const S = sectionsOf(ms, dur);
  if (!S.length) { window.showToast?.('Esta pista no tiene secciones: márcalas en la onda o usa «Detectar automáticamente» y vuelve aquí.', 'info'); return; }
  let A = cleanArrangements(lib.arrangements);
  let cur = A.list.find((x) => x.id === A.active) || A.list[0] || null;
  const fresh = new Set();   // arreglos creados en esta ventana y aún sin tocar

  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box sm-box" role="dialog" aria-modal="true" aria-label="Mapa de la canción">
      <div class="vn-head"><b>Mapa de la canción</b><span>${esc(lib.title || '')} · ${t === 'original' ? 'Original' : 'Secuencia'}</span></div>
      <p class="vn-why">Arma el orden de las secciones (versión corta, coros de más, sin puente…). Al tocar, la pista salta sola en el límite de cada sección, sin cortes.</p>
      <div class="sm-row">
        <select data-ref="pick" aria-label="Arreglo"></select>
        <input data-ref="name" maxlength="40" placeholder="Nombre del arreglo" aria-label="Nombre del arreglo">
        <button type="button" class="vn-btn" data-act="new" title="Nuevo arreglo">+ Nuevo</button>
        <button type="button" class="vn-btn sm-del" data-act="del" title="Borrar este arreglo">Borrar</button>
      </div>
      <div class="sm-label">Secciones de la pista <small>clic para añadirla al final</small></div>
      <div class="sm-src" data-ref="src"></div>
      <div class="sm-label">El arreglo <small>arrastra para cambiar el orden · × para quitar</small></div>
      <div class="sm-order" data-ref="order"></div>
      <div class="sm-sum" data-ref="sum"></div>
      <label class="sm-use"><input type="checkbox" class="mo-switch" data-ref="use"> <span><b>Tocar con este arreglo</b><small>La pista sigue este orden sola. Desactivado, suena como está grabada.</small></span></label>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="natural">Como está grabada</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="close">Listo</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const pop = pushModal(() => close(), ov);
  const close = () => { pop(); ov.remove(); };

  const save = () => {
    const curId = cur && cur.id;
    A = cleanArrangements(A);
    lib.arrangements = A;
    // La limpieza crea objetos nuevos: el editor sigue trabajando sobre el guardado
    // (antes seguía con la copia vieja y solo quedaba guardada la primera sección).
    cur = curId ? A.list.find((x) => x.id === curId) || null : null;
    try { window.electronAPI?.saveGiSetlist?.(getSongs()); } catch (_) {}
    window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
    window.dispatchEvent(new CustomEvent('livepads:song-map', { detail: { songId: lib.id } }));
  };
  const ensure = () => {
    if (cur) return cur;
    // Recién creado: tiene el orden original; la primera sección que se pulse empieza un orden nuevo.
    cur = { id: `a${Date.now().toString(36)}`, name: A.list.length ? `Arreglo ${A.list.length + 1}` : 'Versión del domingo', order: naturalOrder(S) };
    A.list.push(cur);
    fresh.add(cur.id);
    return cur;
  };

  const paint = () => {
    $('[data-ref="pick"]').innerHTML = A.list.length ? A.list.map((x) => `<option value="${esc(x.id)}" ${cur && x.id === cur.id ? 'selected' : ''}>${esc(x.name)}${x.id === A.active ? ' · en uso' : ''}</option>`).join('') : '<option value="">(sin arreglos todavía)</option>';
    $('[data-ref="pick"]').disabled = !A.list.length;
    $('[data-ref="name"]').value = cur ? cur.name : '';
    $('[data-ref="name"]').disabled = !cur;
    $('[data-act="del"]').disabled = !cur;
    $('[data-ref="use"]').checked = !!(cur && A.active === cur.id);
    $('[data-ref="use"]').disabled = !cur;
    $('[data-ref="src"]').innerHTML = S.map((x, i) => `<button type="button" class="sm-chip" data-add="${i}" style="--h:${hue(x.label)}">${esc(x.label)}${S.filter((y) => y.label.toLowerCase() === x.label.toLowerCase()).length > 1 ? ` <small>${x.n}</small>` : ''}<i>${fmt(x.e - x.s)}</i></button>`).join('');
    const order = cur ? cur.order : naturalOrder(S);
    const total = order.reduce((a, r) => { const x = resolve(S, r); return a + (x ? x.e - x.s : 0); }, 0) || 1;
    $('[data-ref="order"]').innerHTML = order.length ? order.map((r, i) => {
      const x = resolve(S, r);
      const w = x ? Math.max(5, ((x.e - x.s) / total) * 100) : 5;
      return `<div class="sm-block${x ? '' : ' is-missing'}" draggable="${cur ? 'true' : 'false'}" data-i="${i}" style="--h:${hue(r.label)};flex:${w} 1 0" title="${esc(r.label)} ${r.n}${x ? ' · ' + fmt(x.e - x.s) : ' · no está en esta pista'}">
        <span>${esc(r.label)}${S.filter((y) => y.label.toLowerCase() === r.label.toLowerCase()).length > 1 ? ` <small>${r.n}</small>` : ''}</span>
        ${cur ? `<button type="button" data-rm="${i}" aria-label="Quitar ${esc(r.label)}">×</button>` : ''}</div>`;
    }).join('') : '<p class="sm-empty">Vacío: añade secciones de arriba.</p>';
    const d = mapDuration(S, order, dur);
    const orig = mapDuration(S, naturalOrder(S), dur);
    $('[data-ref="sum"]').innerHTML = cur
      ? `Duración: <b>${fmt(d)}</b> · grabada ${fmt(orig)} <span class="${d < orig ? 'is-less' : d > orig ? 'is-more' : ''}">${d === orig ? '' : (d < orig ? '−' : '+') + fmt(Math.abs(d - orig))}</span>`
      : 'Sin arreglo: la pista suena tal como está grabada. Pulsa «+ Nuevo» o una sección para empezar.';
  };

  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const add = e.target.closest('[data-add]');
    if (add) { const x = S[Number(add.dataset.add)]; const c = ensure(); if (fresh.has(c.id)) { c.order = []; fresh.delete(c.id); } c.order.push({ label: x.label, n: x.n }); save(); paint(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm && cur) { cur.order.splice(Number(rm.dataset.rm), 1); save(); paint(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'new') { cur = null; ensure(); save(); paint(); $('[data-ref="name"]').select(); }
    else if (act === 'del' && cur) { A.list = A.list.filter((x) => x !== cur); if (A.active === cur.id) A.active = null; cur = A.list[0] || null; save(); paint(); }
    else if (act === 'natural') { if (cur) { A.active = null; save(); paint(); window.showToast?.('La pista suena tal como está grabada (el arreglo queda guardado).', 'info'); } else close(); }
  });
  $('[data-ref="pick"]').addEventListener('change', (e) => { cur = A.list.find((x) => x.id === e.target.value) || cur; paint(); });
  $('[data-ref="name"]').addEventListener('input', (e) => { if (cur) { cur.name = e.target.value || 'Arreglo'; save(); } });
  $('[data-ref="name"]').addEventListener('change', paint);
  $('[data-ref="use"]').addEventListener('change', (e) => { if (!cur) return; A.active = e.target.checked ? cur.id : null; save(); paint(); window.showToast?.(e.target.checked ? `Se toca con «${cur.name}».` : 'La pista suena tal como está grabada.', 'success'); });
  // Arrastrar bloques para reordenar.
  let from = -1;
  const orderEl = $('[data-ref="order"]');
  orderEl.addEventListener('dragstart', (e) => { const b = e.target.closest('.sm-block'); if (!b) return; from = Number(b.dataset.i); e.dataTransfer.effectAllowed = 'move'; b.classList.add('is-drag'); });
  orderEl.addEventListener('dragover', (e) => { if (from >= 0) { e.preventDefault(); orderEl.querySelectorAll('.sm-block').forEach((x) => x.classList.toggle('is-over', x === e.target.closest('.sm-block'))); } });
  orderEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const b = e.target.closest('.sm-block');
    if (!cur || from < 0) return;
    const to = b ? Number(b.dataset.i) : cur.order.length - 1;
    const [it] = cur.order.splice(from, 1);
    cur.order.splice(to, 0, it);
    from = -1; save(); paint();
  });
  orderEl.addEventListener('dragend', () => { from = -1; orderEl.querySelectorAll('.is-drag, .is-over').forEach((x) => x.classList.remove('is-drag', 'is-over')); });
  paint();
}
