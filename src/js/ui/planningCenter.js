// ─────────────────────────────────────────────────────────────────────────
// Importar un servicio de Planning Center (menú «⋯» del servicio y Buscador).
//   1) Conectar una vez con un «Personal Access Token» (ID + secreto).
//   2) Elegir el tipo de servicio y una de las próximas fechas.
//   3) Ver las canciones (cuáles ya están en la librería) e importarlo como servicio
//      de LivePads con los tonos del día. Las que faltan se crean con su letra y
//      acordes; las que ya están no se pisan (solo se rellena lo que les falte).
// La API la llama el proceso principal (planningCenter.js): solo lectura.
// ─────────────────────────────────────────────────────────────────────────

import { serviceTypes, plansList, planFromItems, matchSongs } from '../cloud/planningCenterCore.js';
import { getSongs } from '../state/store.js';
import { createNewSetlist, setKeyOverride } from '../data/service.js';
import { requireRoom } from '../billing/license.js';
import { renderGiList } from './giList.js';
import { pushModal } from './modalStack.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS_TYPE = 'livepads-pco-type';
const TOKENS_URL = 'https://api.planningcenteronline.com/oauth/applications';

async function pcoGet(path) {
  const r = await window.electronAPI.pcoGet({ path });
  if (!r || !r.ok) { const e = new Error((r && r.error) || 'Error de Planning Center'); e.code = r && r.code; throw e; }
  return r.json;
}

/** Importa las canciones de un plan como servicio nuevo. Devuelve el resumen (o null si se canceló). */
export function importPlan({ name, date, pcoSongs }) {
  const lib = getSongs();
  const matched = matchSongs(lib, pcoSongs);
  const fresh = matched.filter((m) => m.isNew).map((m) => m.song);
  if (fresh.length && !requireRoom('songs', lib.length, fresh.length, `Este servicio trae ${fresh.length} ${fresh.length === 1 ? 'canción nueva' : 'canciones nuevas'} y el plan Gratis permite hasta 10 en la librería.`)) return null;
  let filled = 0;
  for (const m of matched) {
    if (m.isNew) { lib.push(m.song); continue; }
    // La librería manda: solo se rellena lo que le falta.
    let ch = false;
    if (!String(m.song.lyrics || '').trim() && m.pco.lyrics) { m.song.lyrics = m.pco.lyrics; ch = true; }
    if (!m.song.bpm && m.pco.bpm) { m.song.bpm = m.pco.bpm; ch = true; }
    if (!m.song.key && m.pco.key) { m.song.key = m.pco.key; ch = true; }
    if (!m.song.pcoSongId && m.pco.pcoSongId) { m.song.pcoSongId = m.pco.pcoSongId; ch = true; }
    if (ch) filled++;
  }
  const api = window.electronAPI;
  try { api?.saveGiSetlist?.(lib); } catch (_) {}
  try { renderGiList(document.getElementById('gi-search')?.value || ''); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  const songs = matched.map((m) => m.song);
  createNewSetlist(name || 'Servicio', date || null, songs);
  // El tono del día (si el de Planning Center es otro que el de la librería).
  matched.forEach((m) => { if (m.pco.key && m.song.key && m.pco.key !== m.song.key) setKeyOverride(m.song, m.pco.key); });
  document.querySelector('.s-toggle[data-target="service-setlist-list"]')?.click();
  return { total: songs.length, added: fresh.length, filled };
}

export function openPlanningCenter() {
  if (document.getElementById('pco-box')) return;
  const api = window.electronAPI;
  if (!api?.pcoStatus) { window.showToast?.('Esta versión no puede conectarse a Planning Center.', 'error'); return; }
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `<div class="vn-box pco-box" id="pco-box" role="dialog" aria-modal="true" aria-label="Planning Center">
    <div class="vn-head"><b>Importar de Planning Center</b><span>Trae las canciones de un servicio de Planning Center Services, con los tonos de ese día.</span></div>
    <div class="pco-body" data-ref="body"></div>
    <div class="vn-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button><button type="button" class="vn-btn vn-btn--primary" data-act="import" hidden>Importar servicio</button></div>
  </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const body = $('[data-ref="body"]');
  const close = () => { pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  const S = { connected: false, types: [], type: '', plans: [], plan: null, songs: null, busy: false, error: '' };
  try { S.type = localStorage.getItem(LS_TYPE) || ''; } catch (_) {}

  const fail = (e) => { S.busy = false; S.error = (e && e.message) || String(e); if (e && e.code === 'NOAUTH') S.connected = false; paint(); };

  function paintSetup() {
    body.innerHTML = `
      <ol class="pco-steps">
        <li>Entra en Planning Center con la cuenta de tu iglesia y abre <button type="button" class="pco-link" data-act="tokens">Developer → Personal Access Tokens</button>.</li>
        <li>Pulsa <b>New Personal Access Token</b>, ponle un nombre (p. ej. «LivePads») y marca <b>Services</b>.</li>
        <li>Copia aquí el <b>Application ID</b> y el <b>Secret</b>.</li>
      </ol>
      <div class="pco-grid">
        <label class="vn-field">Application ID <input data-f="appId" spellcheck="false" autocomplete="off"></label>
        <label class="vn-field">Secret <input data-f="secret" type="password" spellcheck="false" autocomplete="off"></label>
      </div>
      <p class="proj-hint">Se guarda cifrado solo en este equipo. LivePads solo LEE tus servicios: no cambia nada en Planning Center.</p>
      <div class="proj-test"><button type="button" class="vn-btn" data-act="connect">${S.busy ? 'Conectando…' : 'Conectar'}</button><span class="is-bad" aria-live="polite">${esc(S.error)}</span></div>`;
  }

  function paintMain() {
    const typeBtns = S.types.map((t) => `<button type="button" class="ui-seg-btn${t.id === S.type ? ' is-on' : ''}" data-type="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    const plans = S.plans.length
      ? S.plans.map((p) => `<button type="button" class="pco-plan${S.plan && S.plan.id === p.id ? ' is-on' : ''}" data-plan="${esc(p.id)}"><b>${esc(p.date ? new Date(p.date + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sin fecha')}</b><span>${esc(p.title || 'Servicio')}</span></button>`).join('')
      : `<span class="red-none">${S.busy ? 'Cargando…' : 'No hay servicios próximos en este tipo.'}</span>`;
    let songs = '';
    if (S.plan) {
      if (!S.songs) songs = `<p class="red-none">${S.busy ? 'Cargando canciones…' : ''}</p>`;
      else if (!S.songs.length) songs = '<p class="red-none">Este servicio no tiene canciones.</p>';
      else {
        const m = matchSongs(getSongs(), S.songs);
        songs = `<ul class="pco-songs">${m.map((x, i) => `<li><span class="pco-n">${i + 1}</span><span class="pco-t"><b>${esc(x.pco.title)}</b>${x.pco.artist ? `<small>${esc(x.pco.artist)}</small>` : ''}</span><span class="pco-k">${esc(x.pco.key || '—')}${x.pco.bpm ? ` · ${x.pco.bpm} BPM` : ''}</span><span class="pco-badge${x.isNew ? ' is-new' : ''}">${x.isNew ? 'Nueva' : 'En tu librería'}</span></li>`).join('')}</ul>
          <p class="proj-hint">Las nuevas se crean con su letra y acordes (sin audio: añádeselo después). Las de tu librería no se cambian; el tono del día queda solo para este servicio.</p>`;
      }
    }
    body.innerHTML = `
      <div class="pco-conn"><span>✓ Conectado${S.org ? ` · ${esc(S.org)}` : ''}</span><button type="button" class="pco-link" data-act="disconnect">Desconectar</button></div>
      ${S.types.length > 1 ? `<div class="ui-seg pco-types" role="group" aria-label="Tipo de servicio">${typeBtns}</div>` : ''}
      <div class="pco-plans">${plans}</div>
      ${songs}
      ${S.error ? `<p class="is-bad pco-err" aria-live="polite">${esc(S.error)}</p>` : ''}`;
  }

  function paint() {
    if (S.connected) paintMain(); else paintSetup();
    const imp = $('[data-act="import"]');
    imp.hidden = !(S.connected && S.songs && S.songs.length);
  }

  async function loadTypes() {
    S.busy = true; S.error = ''; paint();
    try {
      S.types = serviceTypes(await pcoGet('/services/v2/service_types?per_page=50'));
      if (!S.types.some((t) => t.id === S.type)) S.type = S.types[0] ? S.types[0].id : '';
      await loadPlans();
    } catch (e) { fail(e); }
  }
  async function loadPlans() {
    S.plans = []; S.plan = null; S.songs = null; S.busy = true; S.error = ''; paint();
    if (!S.type) { S.busy = false; paint(); return; }
    try {
      S.plans = plansList(await pcoGet(`/services/v2/service_types/${encodeURIComponent(S.type)}/plans?filter=future&order=sort_date&per_page=8`));
      S.busy = false;
      if (S.plans[0]) await loadPlan(S.plans[0]); else paint();
    } catch (e) { fail(e); }
  }
  async function loadPlan(p) {
    S.plan = p; S.songs = null; S.busy = true; S.error = ''; paint();
    try {
      const r = await window.electronAPI.pcoGet({ path: `/services/v2/service_types/${encodeURIComponent(S.type)}/plans/${encodeURIComponent(p.id)}/items?include=song,arrangement,key&per_page=100`, all: true });
      if (!r || !r.ok) throw Object.assign(new Error((r && r.error) || 'Error'), { code: r && r.code });
      if (S.plan !== p) return;
      S.songs = planFromItems(r.json); S.busy = false; paint();
    } catch (e) { fail(e); }
  }

  ov.addEventListener('click', async (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    if (e.target.closest('[data-act="tokens"]')) { api.openExternal?.(TOKENS_URL); return; }
    if (e.target.closest('[data-act="connect"]')) {
      if (S.busy) return;
      const appId = $('[data-f="appId"]').value, secret = $('[data-f="secret"]').value;
      S.busy = true; S.error = ''; paint();
      $('[data-f="appId"]').value = appId; $('[data-f="secret"]').value = secret;
      const r = await api.pcoConnect({ appId, secret });
      S.busy = false;
      if (!r || !r.ok) { S.error = (r && r.error) || 'No se pudo conectar'; paint(); $('[data-f="appId"]').value = appId; $('[data-f="secret"]').value = secret; return; }
      S.connected = true; S.org = r.org || ''; loadTypes(); return;
    }
    if (e.target.closest('[data-act="disconnect"]')) { await api.pcoDisconnect(); S.connected = false; S.types = []; S.plans = []; S.plan = null; S.songs = null; S.error = ''; paint(); return; }
    const t = e.target.closest('[data-type]');
    if (t) { S.type = t.dataset.type; try { localStorage.setItem(LS_TYPE, S.type); } catch (_) {} loadPlans(); return; }
    const pl = e.target.closest('[data-plan]');
    if (pl) { const p = S.plans.find((x) => x.id === pl.dataset.plan); if (p) loadPlan(p); return; }
    if (e.target.closest('[data-act="import"]')) {
      if (!S.plan || !S.songs || !S.songs.length) return;
      const name = S.plan.title || (S.types.find((x) => x.id === S.type) || {}).name || 'Servicio';
      const r = importPlan({ name, date: S.plan.date, pcoSongs: S.songs });
      if (!r) return;
      close();
      const parts = [`${r.total} ${r.total === 1 ? 'canción' : 'canciones'}`];
      if (r.added) parts.push(`${r.added} nueva${r.added === 1 ? '' : 's'} en la librería (sin audio)`);
      window.showToast?.(`✓ Servicio «${name}» importado de Planning Center: ${parts.join(' · ')}.`, 'success', { ttl: 9000 });
    }
  });

  paint();
  api.pcoStatus().then((s) => { S.connected = !!(s && s.connected); paint(); if (S.connected) loadTypes(); });
}
