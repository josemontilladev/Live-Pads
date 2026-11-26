// ─────────────────────────────────────────────────────────────────────────
// Caja de ritmos — herramienta aparte (botón en la cabecera, como el piano,
// el metrónomo y el afinador). Panel flotante y movible, no tapa la app.
//
//  · Ritmos incluidos por género y «Mis ritmos». Cambiar un incluido guarda
//    una copia «(mío)»: el original queda igual.
//  · Pistas con color, sonido (cualquier pad de los kits del drum pad,
//    incluidos los kits propios), volumen y silencio.
//  · Secciones: clic = editar esa sección y, si está sonando, pasar a ella al
//    terminar el compás. Redoble y Final, de un compás.
//  · Tempo del metrónomo de LivePads (−/+/TAP aquí mueven ese mismo tempo).
// Guardado: «livepads.grooves.v2» (mis ritmos) y «livepads.groove» (elección,
// volumen y mezcla de cada ritmo: kit, volumen y silencio de sus pistas).
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { pushModal } from '../ui/modalStack.js';
import { closeButton } from '../ui/components.js';
import { KIT_BANKS } from '../data/banks.js';
import {
  GROOVES, GROOVE_KITS, PARTS, EXTRA_PARTS, PART_LABEL, SIGS, TRACK_COLORS, steps, partOf, isWritten, nextCell, withTracks, applyKit,
  emptyGroove, addTrack, removeTrack, resizeGroove, validGroove, sigOf, kitFromPads,
} from './grooveCore.js';
import { GroovePlayer } from './groovePlayer.js';
import { followStep, nearestIdx, firstAtOrAfter } from './grooveFollowCore.js';
import { markersFor } from '../data/markers.js';

const PREF = 'livepads.groove', USER = 'livepads.grooves.v2', OLD_USER = 'livepads.grooves.user', POS = 'livepads.groove.pos';
const ld = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } };
const sv = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const prefs = () => ({ id: 'pop', vol: 0.8, mix: {}, ...ld(PREF, {}) });
const setPrefs = (p) => sv(PREF, { ...prefs(), ...p });

function userGrooves() {
  let list = ld(USER, null);
  if (!list) { list = (ld(OLD_USER, []) || []).map((g) => withTracks(g)); if (list.length) sv(USER, list); }
  return (list || []).filter(validGroove);
}
const saveUser = (list) => sv(USER, list);
const all = () => [...GROOVES, ...userGrooves()];

// Kits: primero los propios del drum pad (reconocidos por el nombre de cada pad), luego los incluidos.
const allKits = () => [...KIT_BANKS.filter((k) => k.isCustom).map(kitFromPads).filter(Boolean), ...GROOVE_KITS];
const findKit = (id) => (id && allKits().find((k) => k.id === id)) || null;

/** El ritmo tal cual suena: con sus pistas y la mezcla guardada (kit, volumen y silencio).
 *  Los incluidos suenan por defecto con tu kit del drum pad, si tienes uno de batería. */
function effective(id) {
  const base = all().find((g) => g.id === id) || GROOVES[0];
  const mix = prefs().mix[base.id] || {};
  const own = allKits().find((k) => k.own);
  const kit = findKit(mix.kit) || (!base.tracks && own) || findKit(base.kit) || base.kit;
  let g = withTracks(JSON.parse(JSON.stringify(base)), kit);
  if (mix.kit && base.tracks && findKit(mix.kit)) g = applyKit(g, findKit(mix.kit));
  g.tracks = g.tracks.map((t) => ({ ...t, ...(mix.tracks && mix.tracks[t.id]) }));
  return g;
}
function saveMix(g) {
  const p = prefs();
  p.mix[g.id] = { kit: g.kit, tracks: Object.fromEntries(g.tracks.map((t) => [t.id, { vol: t.vol, mute: !!t.mute }])) };
  setPrefs({ mix: p.mix });
}

let deps = { getEngine: () => null, getMetro: () => null, applyBpm: () => {} };
let player = null, overlay = null, popModal = null, raf = 0;
let g = null, edit = 'A';
const R = (k) => overlay.querySelector(`[data-ref="${k}"]`);

const PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';
const color = (i) => TRACK_COLORS[i % TRACK_COLORS.length];
// Nombre del sonido como en el drum pad: «Kick · Worship Acoustic».
function shortName(file) {
  for (const k of KIT_BANKS) { const p = (k.pads || []).find((x) => x.sample === file); if (p) return `${p.label} · ${k.name}`; }
  return decodeURIComponent(String(file || '').split('/').pop() || '').replace(/\.(wav|mp3|ogg|flac)$/i, '');
}

// ── Rueda (knob) ─────────────────────────────────────────────────────────
function knobHtml(key, value, { min = 0, max = 1, label = '', size = 'md' } = {}) {
  return `<div class="gt-knob gt-knob--${size}" data-knob="${key}" data-min="${min}" data-max="${max}" data-value="${value}" role="slider" aria-label="${esc(label)}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" tabindex="0">
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="k-bg" cx="20" cy="20" r="15"/><path class="k-arc" d=""/><line class="k-tick" x1="20" y1="20" x2="20" y2="8"/></svg>
    ${label ? `<span>${esc(label)}</span>` : ''}</div>`;
}
function paintKnob(el) {
  const min = +el.dataset.min, max = +el.dataset.max, v = +el.dataset.value, f = (v - min) / (max - min || 1);
  const a0 = -135, a = a0 + 270 * f, rad = (d) => ((d - 90) * Math.PI) / 180;
  const p = (d) => `${20 + 15 * Math.cos(rad(d))} ${20 + 15 * Math.sin(rad(d))}`;
  el.querySelector('.k-arc').setAttribute('d', f <= 0.001 ? '' : `M ${p(a0)} A 15 15 0 ${270 * f > 180 ? 1 : 0} 1 ${p(a)}`);
  el.querySelector('.k-tick').setAttribute('transform', `rotate(${a} 20 20)`);
  el.setAttribute('aria-valuenow', v.toFixed(2));
}
function bindKnobs(root, onInput) {
  root.querySelectorAll('.gt-knob').forEach(paintKnob);
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.gt-knob');
    if (!el) return;
    e.preventDefault();
    const min = +el.dataset.min, max = +el.dataset.max, y0 = e.clientY, v0 = +el.dataset.value;
    const move = (ev) => {
      const v = Math.max(min, Math.min(max, v0 + ((y0 - ev.clientY) / 140) * (max - min)));
      el.dataset.value = v; paintKnob(el); onInput(el.dataset.knob, v, false);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onInput(el.dataset.knob, +el.dataset.value, true); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  root.addEventListener('wheel', (e) => {
    const el = e.target.closest('.gt-knob');
    if (!el) return;
    e.preventDefault();
    const min = +el.dataset.min, max = +el.dataset.max;
    const v = Math.max(min, Math.min(max, +el.dataset.value - Math.sign(e.deltaY) * (max - min) / 40));
    el.dataset.value = v; paintKnob(el); onInput(el.dataset.knob, v, true);
  }, { passive: false });
}

// ── Guardar cambios ──────────────────────────────────────────────────────
// Cambios de la escritura (pasos, sonidos, pistas, compás, swing): copia «(mío)» si es incluido.
function ensureMine() {
  if (g.user) return false;
  g = { ...JSON.parse(JSON.stringify(g)), id: 'u' + Date.now().toString(36), name: g.name + ' (mío)', genre: 'Míos', user: true };
  setPrefs({ id: g.id });
  window.showToast?.('Guardado como «' + g.name + '» en Mis ritmos: el original queda igual.', 'info');
  return true;
}
function persist() {
  if (g.user) { const list = userGrooves().filter((x) => x.id !== g.id); list.push(g); saveUser(list); }
  else saveMix(g);
  player.groove = g;
  fillGrooveSelect();
}
const write = (fn) => { const copied = ensureMine(); fn(); persist(); if (copied) renderAll(); };

// ── Pintar ───────────────────────────────────────────────────────────────
// Estilo (Worship, Rock, Gospel, Latino, Mis ritmos) y, al lado, solo los ritmos de ese estilo.
const MINE = 'Mis ritmos';
function genres() {
  const list = [...new Set(GROOVES.map((x) => x.genre))];
  if (userGrooves().length) list.push(MINE);
  return list;
}
const genreOf = (x) => (x.user ? MINE : x.genre);
function fillGrooveSelect(genre = genreOf(g)) {
  const gs = genres();
  R('genre').innerHTML = gs.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  R('genre').value = gs.includes(genre) ? genre : gs[0];
  const list = all().filter((x) => genreOf(x) === R('genre').value);
  R('groove').innerHTML = list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  R('groove').value = list.some((x) => x.id === g.id) ? g.id : (list[0] && list[0].id) || '';
}

function renderTop() {
  fillGrooveSelect();
  const kits = allKits();
  R('kit').innerHTML = kits.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('') + '<option value="" disabled>Personalizado</option>';
  R('kit').value = kits.some((k) => k.id === g.kit) ? g.kit : '';
  const sig = sigOf(g);
  R('sig').querySelector('[data-tmp]')?.remove();
  if (!sig) R('sig').insertAdjacentHTML('beforeend', `<option value="" data-tmp>${g.beats % 4 === 0 && g.spb === 2 ? `4/4 ×${g.beats / 4}` : `${g.beats}/4`}</option>`);
  R('sig').value = sig;
  R('sig').disabled = !g.user;
  R('sig').title = g.user ? 'Compás del ritmo' : 'El compás se cambia en tus ritmos (Duplicar para hacer uno tuyo)';
  const sw = overlay.querySelector('[data-knob="swing"]'); sw.dataset.value = g.swing || 0; paintKnob(sw);
  sw.classList.toggle('is-off', g.spb === 3);
  const vo = overlay.querySelector('[data-knob="vol"]'); vo.dataset.value = prefs().vol; paintKnob(vo);
  overlay.querySelector('[data-act="del"]').hidden = !g.user;
  overlay.querySelector('[data-act="rename"]').hidden = !g.user;
}

function renderSections() {
  R('sections').innerHTML = PARTS.filter((p) => !EXTRA_PARTS.includes(p) || isWritten(g, p) || p === edit).map((p) => `<button type="button" data-part="${p}" class="${p === edit ? 'is-edit' : ''} ${isWritten(g, p) ? '' : 'is-auto'}" title="${p === 'fill' ? 'Redoble de un compás; luego vuelve a la sección que sonaba' : p === 'end' ? 'Final: un compás y se para' : 'Editar esta sección; si está sonando, pasa a ella al terminar el compás'}"><span>${PART_LABEL[p]}</span><i class="gt-prog"></i></button>`).join('');
  paintState();
}

function renderGrid() {
  const n = steps(g), p = partOf(g, edit), auto = !isWritten(g, edit);
  const grid = R('grid');
  grid.style.setProperty('--n', n);
  grid.classList.toggle('is-auto', auto);
  const head = `<div class="gt-row gt-row--head"><div class="gt-tname"></div><div class="gt-cells">${Array.from({ length: n }, (_, i) => `<span class="${i % g.spb === 0 ? 'is-beat' : ''}">${i % g.spb === 0 ? i / g.spb + 1 : ''}</span>`).join('')}</div><div class="gt-tctl"></div></div>`;
  grid.innerHTML = head + g.tracks.map((t, ti) => {
    const s = p[t.id] || '';
    return `<div class="gt-row ${t.mute ? 'is-muted' : ''}" style="--c:${color(ti)}" data-row="${t.id}">
      <button type="button" class="gt-tname" data-sound="${t.id}" title="Cambiar el sonido de esta pista"><i></i><b>${esc(t.label || 'Pista')}</b><small>${esc(shortName(t.file))}</small></button>
      <div class="gt-cells">${Array.from({ length: n }, (_, i) => {
        const c = s[i] || '-';
        return `<button type="button" class="gt-cell ${c === 'X' ? 'v-X' : c === 'x' ? 'v-x' : c === 'o' ? 'v-o' : ''} ${i % g.spb === 0 ? 'is-beat' : ''} ${Math.floor(i / g.spb) % 2 ? 'is-odd' : ''}" data-t="${t.id}" data-i="${i}" aria-label="${esc(t.label)} paso ${i + 1}"></button>`;
      }).join('')}</div>
      <div class="gt-tctl">${knobHtml('t:' + t.id, t.vol ?? 0.8, { min: 0, max: 1.2, label: '', size: 'sm' })}
        <button type="button" class="gt-mute ${t.mute ? 'is-on' : ''}" data-mute="${t.id}" title="Silenciar esta pista">M</button>
        <button type="button" class="gt-del" data-del="${t.id}" title="Quitar esta pista" aria-label="Quitar pista">×</button></div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.gt-knob').forEach(paintKnob);
  R('note').textContent = auto ? `«${PART_LABEL[edit]}» no está escrita: suena la versión automática (atenuada). Marca una casilla para escribirla.` : 'Clic: golpe · otra vez: acento · otra: suave · otra: borrar';
}

function renderAll() { renderTop(); renderSections(); renderGrid(); paintArr(); }
// Seguir el arreglo de la grabación (solo ritmos sacados de una grabación). Excluye «Seguir la canción».
const ARR_KEY = 'livepads.groove.arrangement';
function setArr(on) {
  try { localStorage.setItem(ARR_KEY, on ? '1' : '0'); } catch (_) {}
  if (player) player.followArrangement = !!on;
  if (on && R('followOn') && R('followOn').checked) { R('followOn').checked = false; R('followOn').dispatchEvent(new Event('change')); }
  paintArr();
}
function paintArr() {
  const has = !!(g && Array.isArray(g.arrangement) && g.arrangement.length);
  let on = false; try { on = localStorage.getItem(ARR_KEY) !== '0'; } catch (_) {}
  if (player) player.followArrangement = has && on;
  const row = R('arrRow'); if (!row) return;
  row.hidden = !has;
  R('arrOn').checked = has && on;
  if (has) row.title = `La caja toca las secciones en el orden de la grabación (${g.arrangement.map((a) => (PART_LABEL[a.part] || a.part) + ' ×' + a.bars).join(' → ')}) y cambia sola.`;
}

function paintState() {
  if (!overlay) return;
  const playing = player && player.playing;
  const pb = R('play');
  pb.innerHTML = playing ? STOP : PLAY;
  pb.classList.toggle('is-on', !!playing);
  pb.title = playing ? 'Parar ya (para terminar con un final, pulsa «Final»)' : 'Tocar desde la sección elegida';
  const part = playing ? player.part : null, q = playing ? player.queued : null;
  R('sections').querySelectorAll('[data-part]').forEach((b) => {
    b.classList.toggle('is-playing', b.dataset.part === part);
    b.classList.toggle('is-queued', !!q && b.dataset.part === q && q !== part);
  });
  document.getElementById('btn-grooves')?.classList.toggle('is-active', !!playing);
}

// Cursor: el paso que suena, en la sección que se está viendo.
function loop() {
  raf = 0;
  if (!overlay || overlay.hidden) return;
  const pos = player.playing ? player.position() : null;
  const grid = R('grid');
  const was = grid.querySelectorAll('.is-now');
  const n = steps(g);
  if (pos && pos.part === edit) {
    const cells = grid.querySelectorAll(`.gt-cell[data-i="${pos.step}"]`);
    if (!cells[0] || !cells[0].classList.contains('is-now')) { was.forEach((c) => c.classList.remove('is-now')); cells.forEach((c) => c.classList.add('is-now')); }
  } else was.forEach((c) => c.classList.remove('is-now'));
  R('sections').querySelectorAll('[data-part]').forEach((b) => {
    const on = pos && b.dataset.part === pos.part;
    b.querySelector('.gt-prog').style.width = on ? `${((pos.step + 1) / n) * 100}%` : '0';
  });
  const m = deps.getMetro();
  if (m) { const v = String(m.bpm); if (R('bpm').textContent !== v) R('bpm').textContent = v; }
  raf = requestAnimationFrame(loop);
}

// ── Selector de sonidos (pads de los kits del drum pad) ──────────────────
function soundPicker(anchor, onPick) {
  document.querySelector('.gt-picker')?.remove();
  const kits = KIT_BANKS.filter((k) => (k.pads || []).some((p) => p.sample));
  const pop = document.createElement('div');
  pop.className = 'gt-picker';
  pop.innerHTML = `<div class="gt-pk-head">Sonidos del drum pad <small>clic para oír y elegir</small></div><div class="gt-pk-body">${kits.map((k) => `<div class="gt-pk-kit"><b>${esc(k.name)}</b><div>${k.pads.filter((p) => p.sample).map((p) => `<button type="button" data-file="${esc(p.sample)}" data-label="${esc(p.label)}" data-type="${esc(p.type || '')}">${esc(p.label)}</button>`).join('')}</div></div>`).join('')}</div>`;
  overlay.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 6)) + 'px';
  const off = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-file]');
    if (!b) return;
    pop.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
    const TYPE_VOICE = { kick: 'kick', subkick: 'kick', snare: 'snare', clap: 'clap', hihatC: 'hhc', hihatO: 'hho', ride: 'ride', crash: 'crash', tomH: 'tomH', tomM: 'tomH', tomL: 'tomL', shaker: 'shaker', tamb: 'tamb' };
    player.preview({ file: b.dataset.file, vol: 0.9 });
    onPick({ file: b.dataset.file, label: b.dataset.label, voice: TYPE_VOICE[b.dataset.type] || null });
  });
}

// ── Construcción ─────────────────────────────────────────────────────────
function build() {
  overlay = document.createElement('div');
  overlay.id = 'groove-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="gt-panel" role="dialog" aria-label="Caja de ritmos">
      <div class="gt-head" data-drag>
        <span class="gt-dots" aria-hidden="true">⠿</span>
        <h3>Caja de ritmos</h3>
        <span class="gt-sub">al tempo del metrónomo (o de la pista, con «Seguir la canción») · sale por «Batería» del mezclador</span>
        ${closeButton({ cls: 'gt-close' })}
      </div>
      <div class="gt-top">
        <button type="button" class="gt-play" id="gt-play" data-ref="play" aria-label="Tocar o parar"></button>
        <div class="gt-field"><span>Tempo</span><div class="gt-bpm">
          <button type="button" data-act="bpm-" aria-label="Bajar tempo">−</button>
          <div><b data-ref="bpm">120</b><small>BPM</small></div>
          <button type="button" data-act="bpm+" aria-label="Subir tempo">+</button>
          <button type="button" class="gt-tap" data-act="tap">TAP</button>
        </div></div>
        <label class="gt-field"><span>Estilo</span><select data-ref="genre"></select></label>
        <label class="gt-field gt-field--groove"><span>Ritmo</span><select data-ref="groove"></select></label>
        <label class="gt-field"><span>Kit</span><select data-ref="kit"></select></label>
        <label class="gt-field gt-field--sig"><span>Compás</span><select data-ref="sig">${SIGS.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></label>
        <div class="gt-field gt-field--knob"><span>Swing</span>${knobHtml('swing', 0, { label: '' })}</div>
        <div class="gt-field gt-field--knob"><span>Volumen</span>${knobHtml('vol', 0.8, { max: 1.2, label: '' })}</div>
      </div>
      <div class="gt-follow" data-ref="follow">
        <label class="gt-switch"><input type="checkbox" class="mo-switch" data-ref="followOn"><span>Seguir la canción</span></label>
        <span class="gt-follow-txt" data-ref="followTxt"></span>
        <label class="gt-check"><input type="checkbox" data-ref="followFills"> Redoble antes de cada sección</label>
        <label class="gt-switch gt-arr" data-ref="arrRow" hidden title="La caja toca las secciones en el orden y con los compases de la grabación, y cambia sola (para ensayar sin baterista)"><input type="checkbox" class="mo-switch" data-ref="arrOn"><span>Seguir el orden de la grabación</span></label>
        <span class="gt-bass">
          <label class="gt-switch" title="El bajo toca la fundamental de cada acorde con el bombo: siguiendo la pista, sus acordes; a mano, la nota del pad"><input type="checkbox" class="mo-switch" data-ref="bassOn"><span>Bajo automático</span></label>
          <input type="range" min="0" max="1.2" step="0.05" data-ref="bassVol" aria-label="Volumen del bajo" title="Volumen del bajo">
        </span>
      </div>
      <div class="gt-secrow"><div class="gt-sections" id="gt-sections" data-ref="sections"></div><span class="gt-note" data-ref="note"></span></div>
      <div class="gt-grid" data-ref="grid"></div>
      <div class="gt-foot">
        <button type="button" class="gt-add" data-act="add">+ Pista</button>
        <label class="gt-copy"><span>Copiar de</span><select data-ref="copy"><option value="">…</option>${PARTS.map((p) => `<option value="${p}">${PART_LABEL[p]}</option>`).join('')}</select></label>
        <button type="button" data-act="clear">Vaciar sección</button>
        <label class="gt-check" title="Un golpe de platillo al entrar en cada sección nueva"><input type="checkbox" data-ref="crash"> Crash al cambiar de sección</label>
        <div class="gt-menu gt-menu--foot">
          <button type="button" data-act="fromrec" title="Graba la batería (o sube un audio) y LivePads saca el ritmo y el orden de sus secciones">Desde una grabación…</button>
          <button type="button" data-act="new" title="Ritmo nuevo vacío">Nuevo</button>
          <button type="button" data-act="dup" title="Hacer una copia en Mis ritmos">Duplicar</button>
          <button type="button" data-act="rename">Renombrar</button>
          <button type="button" data-act="del" class="is-danger">Eliminar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const panel = overlay.querySelector('.gt-panel');
  try { const p = ld(POS, null); if (p && p.x != null) { panel.style.left = Math.min(innerWidth - 200, Math.max(0, p.x)) + 'px'; panel.style.top = Math.min(innerHeight - 80, Math.max(0, p.y)) + 'px'; panel.style.transform = 'none'; if (p.w) panel.style.width = p.w + 'px'; } } catch (_) {}
  makeDraggable(panel, overlay.querySelector('[data-drag]'));
  overlay.querySelector('.gt-close').onclick = closeGrooveTool;

  bindKnobs(overlay, (key, v, done) => {
    if (key === 'vol') { player.setVolume(v); if (done) setPrefs({ vol: v }); return; }
    if (key === 'swing') { if (g.spb === 3) return; g.swing = Math.round(v * 100) / 100; player.groove = g; if (done) write(() => {}); return; }
    if (key.startsWith('t:')) {
      const t = g.tracks.find((x) => x.id === key.slice(2));
      if (t) { t.vol = Math.round(v * 100) / 100; player.groove = g; if (done) persist(); }
    }
  });

  overlay.addEventListener('click', async (e) => {
    const sec = e.target.closest('[data-part]');
    if (sec && sec.closest('.gt-sections')) {
      edit = sec.dataset.part;
      renderSections(); renderGrid();
      if (player.playing) player.queue(edit);
      return;
    }
    const cell = e.target.closest('.gt-cell');
    if (cell) {
      const tid = cell.dataset.t, i = +cell.dataset.i, n = steps(g);
      write(() => {
        g.parts ||= {};
        if (!isWritten(g, edit)) g.parts[edit] = JSON.parse(JSON.stringify(partOf(g, edit)));
        const s = (g.parts[edit][tid] || '').padEnd(n, '-').split('');
        s[i] = nextCell(s[i]);
        const str = s.join('');
        if (/[Xxo]/.test(str)) g.parts[edit][tid] = str; else delete g.parts[edit][tid];
        if (s[i] !== '-' && !player.playing) { const t = g.tracks.find((x) => x.id === tid); if (t) player.preview({ ...t, vol: (t.vol ?? 0.8) * (s[i] === 'o' ? 0.45 : s[i] === 'X' ? 1 : 0.75) }); }
      });
      renderSections(); renderGrid();
      return;
    }
    const snd = e.target.closest('[data-sound]');
    if (snd) {
      soundPicker(snd, (pick) => {
        write(() => { const t = g.tracks.find((x) => x.id === snd.dataset.sound); if (t) { t.file = pick.file; t.label = pick.label; if (pick.voice) t.voice = pick.voice; } });
        player.setGroove(g); renderTop(); renderGrid();
      });
      return;
    }
    const mute = e.target.closest('[data-mute]');
    if (mute) { const t = g.tracks.find((x) => x.id === mute.dataset.mute); if (t) { t.mute = !t.mute; persist(); renderGrid(); } return; }
    const del = e.target.closest('[data-del]');
    if (del) { if (g.tracks.length <= 1) return; write(() => { g = removeTrack(g, del.dataset.del); }); renderGrid(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const m = deps.getMetro();
    if (act === 'bpm-' && m) deps.applyBpm(m.bpm - 1);
    else if (act === 'bpm+' && m) deps.applyBpm(m.bpm + 1);
    else if (act === 'tap' && m) deps.applyBpm(m.tap());
    else if (act === 'add') {
      soundPicker(e.target.closest('[data-act]'), (pick) => {
        write(() => { g = addTrack(g, pick); });
        player.setGroove(g); renderGrid();
        document.querySelector('.gt-picker')?.remove();
      });
    } else if (act === 'clear') { write(() => { g.parts[edit] = {}; if (edit === 'A') g.parts.A = {}; }); renderSections(); renderGrid(); }
    else if (act === 'fromrec') {
      const { openDrumFromRecording } = await import('./drumFromRecording.js');
      openDrumFromRecording({
        onCreate: async (r) => {
          const kit = findKit(g.kit) || allKits()[0];
          let ng = withTracks({ id: 'u' + Date.now().toString(36), name: r.name, genre: 'Míos', user: true, beats: r.beats, spb: r.spb, swing: 0, parts: r.parts }, kit);
          if (!ng.tracks.some((t) => t.voice === 'crash') && kit.files && kit.files.crash) ng.tracks.push({ id: 'crash', voice: 'crash', label: 'Crash', file: kit.files.crash, vol: 0.5, mute: false });
          ng = { ...ng, arrangement: r.arrangement, bpm: r.bpm, source: r.source };
          g = ng; edit = 'A';
          persist(); setPrefs({ id: g.id });
          await player.setGroove(g);
          if (r.bpm) deps.applyBpm(r.bpm);
          setArr(true);
          renderAll();
          window.showToast?.(`Ritmo «${g.name}» creado: ${r.arrangement.length} tramos en el orden de la grabación. Pulsa ▶ para ensayar con él.`, 'success');
        },
      });
    }
    else if (act === 'new') { g = emptyGroove(findKit(g.kit) || allKits()[0]); edit = 'A'; persist(); setPrefs({ id: g.id }); await player.setGroove(g); renderAll(); }
    else if (act === 'dup') { g = { ...JSON.parse(JSON.stringify(g)), id: 'u' + Date.now().toString(36), name: g.name.replace(/ \((mío|copia)\)$/, '') + ' (copia)', genre: 'Míos', user: true }; persist(); setPrefs({ id: g.id }); renderAll(); }
    else if (act === 'rename') {
      if (!g.user) return;
      const h = R('groove').parentElement;
      const inp = document.createElement('input'); inp.className = 'gt-rename'; inp.value = g.name; inp.maxLength = 40;
      h.appendChild(inp); inp.focus(); inp.select();
      const done = (ok) => { if (ok && inp.value.trim()) { g.name = inp.value.trim(); persist(); } inp.remove(); fillGrooveSelect(); };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } });
      inp.addEventListener('blur', () => done(true));
    } else if (act === 'del') {
      if (!g.user) return;
      const gone = g.name;
      saveUser(userGrooves().filter((x) => x.id !== g.id));
      g = effective('pop'); setPrefs({ id: g.id }); await player.setGroove(g); renderAll();
      window.showToast?.(`«${gone}» eliminado.`, 'info');
    }
  });

  R('play').addEventListener('click', async () => {
    if (player.playing) { if (fol.active) { stopFollow(); fol.userStopped = true; } else player.stop(); return; }
    await player.setGroove(g);
    player.setVolume(prefs().vol);
    if (!fol.active) player.clock = null;   // a mano: al tempo del metrónomo
    player.play(edit === 'end' || edit === 'fill' ? 'A' : edit);
  });
  R('genre').addEventListener('change', async () => {
    fillGrooveSelect(R('genre').value);
    const id = R('groove').value;
    if (!id || id === g.id) return;
    g = effective(id); setPrefs({ id: g.id });
    rememberForSong();
    if (!isWritten(g, edit)) edit = 'A';
    await player.setGroove(g); renderAll();
  });
  R('arrOn').addEventListener('change', () => { setArr(R('arrOn').checked); });
  R('followOn').checked = followOn();
  R('followFills').checked = followFills();
  R('followOn').addEventListener('change', () => {
    try { localStorage.setItem(FOLLOW_KEY, R('followOn').checked ? '1' : '0'); } catch (_) {}
    followCache = R('followOn').checked;
    if (R('followOn').checked) rememberForSong(); else stopFollow();
    paintFollow();
  });
  R('followFills').addEventListener('change', () => { try { localStorage.setItem(FILLS_KEY, R('followFills').checked ? '1' : '0'); } catch (_) {} });
  const bp = bassPrefs();
  R('bassOn').checked = bp.on; R('bassVol').value = bp.vol;
  R('bassOn').addEventListener('change', () => { setBassPrefs({ on: R('bassOn').checked }); applyBass(); });
  R('bassVol').addEventListener('input', () => { setBassPrefs({ vol: Number(R('bassVol').value) }); applyBass(); });
  R('groove').addEventListener('change', async () => {
    g = effective(R('groove').value); setPrefs({ id: g.id });
    rememberForSong();
    if (!isWritten(g, edit)) edit = 'A';
    await player.setGroove(g); renderAll();
  });
  R('kit').addEventListener('change', async () => {
    if (!R('kit').value) return;
    const kit = findKit(R('kit').value);
    if (!kit) return;
    g = applyKit(g, kit);
    if (g.user) persist(); else saveMix(g);
    await player.setGroove(g); renderTop(); renderGrid();
  });
  R('sig').addEventListener('change', () => {
    const s = SIGS.find((x) => x.id === R('sig').value);
    if (!s || !g.user) return;
    g = resizeGroove(g, s.beats, s.spb); persist(); renderAll();
  });
  R('crash').checked = !!prefs().crash;
  R('crash').addEventListener('change', () => { setPrefs({ crash: R('crash').checked }); player.crashOnChange = R('crash').checked; });
  R('copy').addEventListener('change', () => {
    const from = R('copy').value; R('copy').value = '';
    if (!from || from === edit) return;
    write(() => { g.parts[edit] = JSON.parse(JSON.stringify(partOf(g, from))); });
    renderSections(); renderGrid();
  });
}

function makeDraggable(panel, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, label')) return;
    on = true;
    const r = panel.getBoundingClientRect();
    panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; panel.style.transform = 'none';
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!on) return;
    panel.style.left = Math.max(8 - panel.offsetWidth + 120, Math.min(innerWidth - 120, ox + e.clientX - sx)) + 'px';
    panel.style.top = Math.max(8, Math.min(innerHeight - 60, oy + e.clientY - sy)) + 'px';
  });
  const end = () => { if (!on) return; on = false; savePos(panel); };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
function savePos(panel) { const r = panel.getBoundingClientRect(); sv(POS, { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }); }

// ── Abrir / cerrar ───────────────────────────────────────────────────────
export async function openGrooveTool() {
  if (!overlay) build();
  if (!overlay.hidden) { closeGrooveTool(); return; }
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('open'));
  document.getElementById('btn-grooves')?.setAttribute('aria-pressed', 'true');
  popModal = pushModal(() => closeGrooveTool());
  if (!player.playing) { g = effective(prefs().id); if (!isWritten(g, edit)) edit = 'A'; await player.setGroove(g); }
  renderAll();
  if (!raf) raf = requestAnimationFrame(loop);
}
export function closeGrooveTool() {
  if (!overlay || overlay.hidden) return;
  savePos(overlay.querySelector('.gt-panel'));
  document.querySelector('.gt-picker')?.remove();
  overlay.classList.remove('open');
  overlay.hidden = true;
  document.getElementById('btn-grooves')?.setAttribute('aria-pressed', 'false');
  if (popModal) { try { popModal(); } catch (_) {} popModal = null; }
  // El ritmo sigue sonando al cerrar (como un pedal): se para con ▶ o con su botón MIDI.
}

export const groovePlaying = () => !!(player && player.playing);
export function stopGrooves() { if (player && player.playing) player.stop(); }

export function initGrooves(d) {
  deps = { ...deps, ...d };
  player = new GroovePlayer({ getEngine: deps.getEngine, getMetro: deps.getMetro, onState: paintState });
  window.__lpGroovePos = () => (player && player.playing ? player.position() : null);   // lectura (pruebas)
  player.setVolume(prefs().vol);
  player.crashOnChange = !!prefs().crash;
  g = effective(prefs().id);
  build(); // oculto: así los botones asignados a MIDI/pedal funcionan aunque la caja esté cerrada
  renderAll();
  initFollow();
  applyBass();
  document.getElementById('btn-grooves')?.addEventListener('click', () => openGrooveTool());
}


// ── La caja de ritmos sigue la canción ──────────────────────────────────
// Con «Seguir la canción»: cada canción recuerda su ritmo; al sonar su pista, el
// ritmo arranca en el primer tiempo, va pegado a los pulsos REALES de la pista
// (modelo de pulsos) y cambia de parte con las secciones del espectro, con un
// redoble en el compás anterior a cada cambio. Para con la pista.
const FOLLOW_KEY = 'livepads.grooveFollow', FILLS_KEY = 'livepads.grooveFollowFills', SONG_KEY = 'livepads.songGrooves';
let followCache = null;
const followOn = () => { if (followCache == null) { try { followCache = localStorage.getItem(FOLLOW_KEY) === '1'; } catch (_) { followCache = false; } } return followCache; };
const followFills = () => { try { return localStorage.getItem(FILLS_KEY) !== '0'; } catch (_) { return true; } };
const songKeyOf = (s) => String((s && (s.cloudId || s.id)) ?? '');
let songGroovesCache = null;
const songGrooves = () => { if (!songGroovesCache) { try { songGroovesCache = JSON.parse(localStorage.getItem(SONG_KEY) || '{}') || {}; } catch (_) { songGroovesCache = {}; } } return songGroovesCache; };
const fol = { audio: null, song: null, type: '', beats: null, downs: null, barSec: 2, done: new Set(), active: false, lastMt: 0, starting: false };

function rememberForSong() {
  if (!followOn() || !fol.song || !g) return;
  const all = songGrooves(); all[songKeyOf(fol.song)] = g.id;
  try { localStorage.setItem(SONG_KEY, JSON.stringify(all)); } catch (_) {}
  ensureFollowGrid();
  paintFollow();
}
function paintFollow() {
  if (!overlay) return;
  const t = R('followTxt');
  if (!t) return;
  const gid = fol.song && songGrooves()[songKeyOf(fol.song)];
  const gr = gid && all().find((x) => x.id === gid);
  t.textContent = !followOn() ? 'La batería arranca y cambia sola con la pista y sus secciones.'
    : !fol.song ? 'Carga una canción: el ritmo que elijas quedará guardado para ella.'
    : gr ? `«${fol.song.title}» → ${gr.name}${fol.beats ? '' : ' (analizando los pulsos…)'}`
    : `Elige el ritmo para «${fol.song.title}».`;
  R('follow').classList.toggle('is-on', followOn());
}
function stopFollow() {
  if (fol.active) { player.stop(); fol.active = false; }
  player.clock = null; fol.done = new Set();
}
function engineNow() { const c = player.ctx(); return c ? c.currentTime : 0; }
const clock = {
  toMedia(t) { const a = fol.audio; return a.currentTime + (t - engineNow()) * (a.playbackRate || 1); },
  toCtx(m) { const a = fol.audio; return engineNow() + (m - a.currentTime) / (a.playbackRate || 1); },
  beatAt(t) {
    const b = fol.beats, m = this.toMedia(t), i = nearestIdx(b, m);
    if (i < 0) return null;
    const len = (b[i + 1] ?? b[i] + (b[i] - (b[i - 1] ?? b[i] - 0.5))) - b[i];
    if (Math.abs(b[i] - m) > len * 0.35) return null;
    return { t: this.toCtx(b[i]), dur: len / (fol.audio.playbackRate || 1) };
  },
  nextDownbeat(t) { const d = firstAtOrAfter(fol.downs, this.toMedia(t)); return d == null ? null : this.toCtx(d); },
};
async function loadGrid(a, s, type) {
  fol.beats = fol.downs = null; paintFollow();
  if (!a || !a.buffer) return;
  try {
    const B = await import('../analysis/beatGrid.js');
    const r = await B.analyzeBeats(a.buffer, B.trackKey(s, type, a.buffer));
    if (fol.audio !== a || !r || !r.beats || r.beats.length < 8) return;
    fol.beats = r.beats; fol.downs = r.downbeats && r.downbeats.length ? r.downbeats : r.beats.filter((_, i) => i % (r.beatsPerBar || 4) === 0);
    const d = fol.downs.slice(1).map((x, i) => x - fol.downs[i]).sort((x, y) => x - y);
    fol.barSec = d.length ? d[d.length >> 1] : 2;
    paintFollow();
  } catch (_) {}
}
function ensureFollowGrid() {
  const a = fol.audio;
  if (!a || !a.buffer || fol.gridFor === a || !followOn() || !fol.song || !songGrooves()[songKeyOf(fol.song)]) return;
  fol.gridFor = a; loadGrid(a, fol.song, fol.type);
}
async function followTick() {
  const a = fol.audio;
  if (!followOn() || !a || !fol.song) { if (fol.active) stopFollow(); return; }
  if (!fol.beats) ensureFollowGrid();
  const gid = songGrooves()[songKeyOf(fol.song)];
  if (a.paused) fol.userStopped = false;               // al pausar la pista, vuelve a seguirla la próxima vez
  if (!gid || !fol.beats || a.paused || fol.userStopped) { if (fol.active) stopFollow(); return; }
  const mt = a.currentTime || 0;
  // Saltó en la pista (arreglo en vivo, clic en la onda): el reloj ya sigue la posición nueva;
  // solo hay que volver a calcular las secciones (la parte nueva entra al terminar el compás).
  if (fol.active && (mt < fol.lastMt - 0.5 || mt > fol.lastMt + 2)) fol.done = new Set();
  fol.lastMt = mt;
  const markers = markersFor(fol.song, fol.type);
  if (!fol.active) {
    if (fol.starting) return;
    fol.starting = true;
    try {
      if (!g || g.id !== gid) { g = effective(gid); if (overlay && !overlay.hidden) renderAll(); }
      await player.setGroove(g);
      if (fol.audio !== a || a.paused) return;
      const first = followStep(markers, mt, fol.barSec, { current: null, fills: false, done: new Set() });
      player.clock = clock;
      player.play((first && first.part) || 'A');
      fol.active = true;
    } finally { fol.starting = false; }
    return;
  }
  const r = followStep(markers, mt, fol.barSec, { current: player.queued || player.part, fills: followFills(), done: fol.done });
  if (!r) return;
  if (r.fillThen) { player.queue('fill'); player.queue(r.fillThen); }
  else if (r.part) player.queue(r.part);
}
function initFollow() {
  window.addEventListener('livepads:track-loaded', (e) => {
    stopFollow();
    const a = e.detail && e.detail.audio;
    fol.audio = a; fol.song = e.detail && e.detail.song; fol.type = (e.detail && e.detail.type) || ''; fol.lastMt = 0; fol.userStopped = false;
    fol.beats = fol.downs = null; fol.gridFor = null;
    // Los pulsos solo hacen falta si esta canción tiene ritmo y «Seguir la canción» está activo.
    if (a && a.buffer) ensureFollowGrid();
    else if (a) a.addEventListener('loadedmetadata', ensureFollowGrid, { once: true });
    paintFollow();
  });
  window.addEventListener('livepads:track-cleared', () => { stopFollow(); fol.audio = null; fol.song = null; paintFollow(); });
  setInterval(followTick, 80);
  paintFollow();
}


// ── Bajo automático ──────────────────────────────────────────────────────
// Siguiendo una pista: la fundamental de sus acordes detectados (con su cambio de tono).
// Tocando a mano: la nota del pad que suena (bajo pedal). Sin acordes ni pad: calla.
const BASS_KEY = 'livepads.grooveBass';
const bassPrefs = () => { try { return { on: false, vol: 0.8, ...JSON.parse(localStorage.getItem(BASS_KEY) || '{}') }; } catch (_) { return { on: false, vol: 0.8 }; } };
const setBassPrefs = (p) => { try { localStorage.setItem(BASS_KEY, JSON.stringify({ ...bassPrefs(), ...p })); } catch (_) {} };
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOfName = (k) => { const m = /^([A-G])([#b]?)/.exec(String(k || '')); return m ? ((NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)) % 12 + 12) % 12 : null; };
let chordCache = { key: null, segs: null }, trackApi = null;
async function trackChordSegs() {
  const a = fol.audio, s = fol.song;
  if (!a || !a.buffer || !s) return null;
  try {
    const T = await import('../chords/trackChords.js');
    const id = T.trackChordId(s, fol.type, a.buffer);
    if (chordCache.key !== id) { const c = T.cacheGet(id); chordCache = { key: id, segs: c && Array.isArray(c.seg) ? c.seg.filter((x) => x.r >= 0) : null }; }
    if (!trackApi) trackApi = await import('../audio/trackPlayer.js');
  } catch (_) {}
  return chordCache.segs;
}
function bassChordAt(t) {
  if (fol.active && fol.audio) {
    const segs = chordCache.segs;
    if (!segs) { trackChordSegs(); return null; }
    const mt = clock.toMedia(t);
    const c = segs.find((x) => x.s <= mt && x.e > mt);
    if (!c) return null;
    const shift = (trackApi && trackApi.getTrackPitch && trackApi.getTrackPitch()) || 0;
    return (((c.r + shift) % 12) + 12) % 12;
  }
  return deps.getPadKey ? pcOfName(deps.getPadKey()) : null;
}
function applyBass() {
  const p = bassPrefs();
  player.bass = { on: p.on, vol: p.vol, chordAt: bassChordAt };
  if (p.on) { player.loadBass(); trackChordSegs(); }
}
