// ─────────────────────────────────────────────────────────────────────────
// «Armar el servicio con ayuda» (menú ⋯ del servicio y Buscador).
//   · Ordenar el servicio abierto para que fluya (de celebración a adoración, tonos
//     cercanos), con una nota por cada transición. «Aplicar» conserva los tonos del día.
//   · Sugerir canciones de tu librería: por tema (opcional), sin las tocadas en las
//     últimas semanas (según tus servicios guardados), mejor las que ya tienen audio,
//     con tempos variados. Las marcadas se añaden al servicio, ya en orden.
// La lógica está en data/setlistSuggestCore.js.
// ─────────────────────────────────────────────────────────────────────────

import { orderForFlow, suggestSongs, lastPlayedMap } from '../data/setlistSuggestCore.js';
import { getServiceSongs, setServiceSongs, getEffectiveKey, listSavedSetlists, addToService } from '../data/service.js';
import { getSongs } from '../state/store.js';
import { pushModal } from './modalStack.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const keyOf = (s) => getEffectiveKey(s) || s.key || '';
const meta = (s) => [keyOf(s), s.bpm ? `${s.bpm} BPM` : ''].filter(Boolean).join(' · ');

export function openSetlistSuggest() {
  if (document.getElementById('sgs-box')) return;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `<div class="vn-box sgs-box" id="sgs-box" role="dialog" aria-modal="true" aria-label="Armar el servicio con ayuda">
    <div class="vn-head"><b>Armar el servicio con ayuda</b><span>Ordena el servicio para que fluya o deja que LivePads te sugiera canciones de tu librería.</span></div>
    <div class="ui-seg sgs-tabs" role="tablist"><button type="button" class="ui-seg-btn" data-tab="order">Ordenar el servicio</button><button type="button" class="ui-seg-btn" data-tab="suggest">Sugerir canciones</button></div>
    <div class="sgs-body" data-ref="body"></div>
    <div class="vn-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button><button type="button" class="vn-btn vn-btn--primary" data-act="apply" hidden></button></div>
  </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => { pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  const S = { tab: getServiceSongs().length >= 3 ? 'order' : 'suggest', theme: '', count: 5, results: null, picked: new Set() };

  function paintOrder() {
    const svc = getServiceSongs();
    if (svc.length < 3) { $('[data-ref="body"]').innerHTML = '<p class="red-none">Hacen falta al menos 3 canciones en el servicio para proponer un orden. Prueba «Sugerir canciones».</p>'; return null; }
    const { order, notes } = orderForFlow(svc, keyOf);
    const same = order.every((s, i) => s === svc[i]);
    $('[data-ref="body"]').innerHTML = `<p class="proj-hint">${same ? '✓ El servicio ya va en un buen orden: de la más movida a la más tranquila y con tonos cercanos.' : 'Orden propuesto: empieza por la más movida y va bajando hacia la adoración, con los tonos lo más cerca posible.'}</p>
      <ol class="sgs-list">${order.map((s, i) => `<li><span class="sgs-n">${i + 1}</span><span class="sgs-t"><b>${esc(s.title)}</b><small>${esc(meta(s))}</small></span>${svc.indexOf(s) !== i ? `<span class="sgs-was">antes ${svc.indexOf(s) + 1}.º</span>` : ''}</li>${notes[i] ? `<li class="sgs-tr">↓ ${esc(notes[i])}</li>` : ''}`).join('')}</ol>`;
    return same ? null : order;
  }

  function paintSuggest() {
    const r = S.results;
    $('[data-ref="body"]').innerHTML = `<div class="sgs-form">
        <label class="vn-field">Tema (opcional) <input data-f="theme" value="${esc(S.theme)}" placeholder="gracia, cruz, Espíritu Santo…" spellcheck="false"></label>
        <label class="vn-field sgs-count">Cuántas <input data-f="count" type="number" min="2" max="10" value="${S.count}"></label>
        <button type="button" class="vn-btn" data-act="suggest">Sugerir</button>
      </div>
      ${r == null ? '<p class="proj-hint">Usa tus servicios guardados para no repetir lo de las últimas 3 semanas y prioriza las canciones que ya tienen secuencia u original.</p>'
        : !r.length ? '<p class="red-none">No encontré canciones con ese tema que no se hayan tocado en las últimas 3 semanas. Prueba con otra palabra o sin tema.</p>'
        : `<ul class="sgs-list sgs-pick">${r.map((x, i) => `<li><label><input type="checkbox" data-pick="${i}" ${S.picked.has(i) ? 'checked' : ''}><span class="sgs-t"><b>${esc(x.song.title)}</b><small>${esc(meta(x.song))}</small><small class="sgs-why">${esc(x.reasons.join(' · '))}</small></span></label></li>`).join('')}</ul>`}`;
  }

  let proposed = null;
  function paint() {
    ov.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === S.tab));
    const ap = $('[data-act="apply"]');
    if (S.tab === 'order') { proposed = paintOrder(); ap.hidden = !proposed; ap.textContent = 'Aplicar este orden'; }
    else { paintSuggest(); ap.hidden = !(S.results && S.picked.size); ap.textContent = `Añadir ${S.picked.size} al servicio`; }
  }

  function runSuggest() {
    const inService = getServiceSongs().map((s) => s.id);
    S.results = suggestSongs(getSongs(), { count: S.count, theme: S.theme, lastPlayed: lastPlayedMap(listSavedSetlists()), exclude: inService });
    S.picked = new Set(S.results.map((_, i) => i));
    paint();
  }

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const t = e.target.closest('[data-tab]');
    if (t) { S.tab = t.dataset.tab; paint(); return; }
    if (e.target.closest('[data-act="suggest"]')) { runSuggest(); return; }
    if (e.target.closest('[data-act="apply"]')) {
      if (S.tab === 'order' && proposed) {
        setServiceSongs(proposed);
        window.showToast?.('✓ Servicio reordenado. Los tonos del día se mantienen.', 'success');
        paint();
      } else if (S.tab === 'suggest' && S.results) {
        const add = S.results.filter((_, i) => S.picked.has(i)).map((x) => x.song);
        for (const s of add) addToService(s);
        window.showToast?.(`✓ ${add.length} ${add.length === 1 ? 'canción añadida' : 'canciones añadidas'} al servicio.`, 'success');
        S.results = null; S.picked.clear();
        S.tab = getServiceSongs().length >= 3 ? 'order' : 'suggest';
        paint();
      }
    }
  });
  ov.addEventListener('change', (e) => { const i = e.target.dataset.pick; if (i != null) { if (e.target.checked) S.picked.add(+i); else S.picked.delete(+i); paint(); } });
  ov.addEventListener('input', (e) => { const f = e.target.dataset.f; if (f === 'theme') S.theme = e.target.value; if (f === 'count') S.count = Math.max(2, Math.min(10, +e.target.value || 5)); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.f) { e.preventDefault(); runSuggest(); } });
  paint();
}
