// ─────────────────────────────────────────────────────────────────────────
// Respaldo entre dos PCs (interfaz). Ajustes → Audio → «Respaldo entre 2 PCs».
//
//   PRINCIPAL  manda por la red local qué canción suena, en qué segundo y si va o
//              está parada, cada 200 ms (ese mensaje es también el latido).
//   RESPALDO   carga la misma canción y la reproduce EN SILENCIO total (la salida de
//              audio va a «ninguna»), siempre en el mismo punto. Si el principal deja
//              de responder mientras sonaba (se cuelga, se apaga, se corta el cable),
//              en ~1 s el respaldo se pone su salida de audio y sigue sonando.
//              También se puede tomar el control a mano.
//
// En la mesa: cada PC a su par de canales; el del respaldo puede quedarse abierto
// porque está en silencio hasta que toma el relevo. Ver redundancyCore.js y
// redundancy.js (proceso principal).
// ─────────────────────────────────────────────────────────────────────────

import { followStep, shouldTakeOver, principalState } from './redundancyCore.js';
import { setStandbyFlag } from './standby.js';
import { getSavedOutput, setOutput } from '../audio/audioOutput.js';
import { getSongs } from '../state/store.js';
import { getActiveServiceIndex } from '../data/service.js';
import { findInLibrary } from '../data/servicePackCore.js';
import { pushModal } from '../ui/modalStack.js';

const KEY = 'livepads-redundancy';
const TP = () => import('../audio/trackPlayer.js');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = () => window.electronAPI;

let deps = { getEngine: () => null };
let cfg = { role: 'off', host: '', port: 47833, pin: '' };
let net = { role: 'off', pin: '', clients: [], linked: false, found: [] };
// Respaldo
let remote = null, lastSeenAt = 0, inControl = false, standby = false, lastSeekAt = 0;
let loading = { key: '', at: 0 }, missingKey = '';
let loopTimer = 0, pubTimer = 0, pubCount = 0, pubErr = "";
let listeners = [];

function loadCfg() { try { cfg = { ...cfg, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch (_) {} }
function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {} }
const emit = () => { for (const fn of listeners) { try { fn(); } catch (_) {} } window.dispatchEvent(new CustomEvent('livepads:redundancy')); };
export function onRedundancyChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn); }; }

/** Resumen para la tarjeta de Ajustes y el indicador. */
export function redundancyInfo() {
  if (cfg.role === 'principal') {
    const n = net.clients.length;
    return { role: 'principal', tone: n ? 'ok' : 'warn', text: n ? `Principal · respaldo conectado (${net.clients.join(', ')})` : `Principal · esperando al respaldo (código ${net.pin || cfg.pin || '…'})` };
  }
  if (cfg.role === 'respaldo') {
    if (inControl) return { role: 'respaldo', tone: 'live', text: 'Respaldo AL MANDO · este PC está sonando' };
    if (!net.linked) return { role: 'respaldo', tone: 'warn', text: cfg.host ? `Respaldo · buscando al principal (${cfg.host})…` : 'Respaldo · elige el PC principal' };
    return { role: 'respaldo', tone: 'ok', text: `Respaldo · siguiendo en silencio${remote && remote.title ? ` «${remote.title}»` : ''}` };
  }
  return { role: 'off', tone: 'off', text: 'Desactivado' };
}

// ── Silencio total del respaldo ────────────────────────────────────────────
async function setSilent(on) {
  standby = on;
  setStandbyFlag(on);
  const engine = deps.getEngine();
  const ctx = engine && engine.ctx;
  try {
    if (on) {
      if (!ctx || typeof ctx.setSinkId !== 'function') throw new Error('sin setSinkId');
      await ctx.setSinkId({ type: 'none' });
    } else if (ctx && typeof ctx.setSinkId === 'function') {
      const s = getSavedOutput();
      try { await setOutput(engine, s.id || '', s.label || ''); } catch (_) { await ctx.setSinkId(''); }
    }
  } catch (_) {
    if (on) window.showToast?.('Este equipo no permite silenciar la salida: baja el canal del respaldo en la mesa.', 'warning', { ttl: 9000 });
  }
  emit();
}

// ── Principal: publicar el estado ──────────────────────────────────────────
async function publishTick() {
  if (cfg.role !== 'principal') return;
  const tp = await TP();
  const st = principalState({ song: tp.getCurrentSong(), type: tp.getCurrentType(), audio: tp.getTrackAudio(), pitch: tp.getTrackPitch(), serviceIndex: getActiveServiceIndex() });
  // Siempre, cada 200 ms: el estado hace también de latido. Lo manda ESTA interfaz (la que
  // reproduce), así que si se cuelga deja de llegar y el respaldo toma el relevo.
  try { api()?.redPublish?.(st); pubCount++; } catch (e) { pubErr = String((e && e.message) || e); }
}

// ── Respaldo: seguir y relevar ─────────────────────────────────────────────
function onRemote(m) {
  if (!m || cfg.role !== 'respaldo') return;
  if (m.type === 'linked') { window.showToast?.(`✓ Conectado al principal «${m.name}». Este PC lo sigue en silencio.`, 'success'); lastSeenAt = Date.now(); emit(); return; }
  if (m.type === 'denied') { window.showToast?.('El principal no aceptó el código. Revísalo en el PC principal.', 'error', { ttl: 8000 }); emit(); return; }
  if (m.type === 'lost') { if (!inControl && shouldTakeOver(remote, 1, 1e15)) takeOver('el principal se desconectó'); emit(); return; }
  if (m.type === 'state') lastSeenAt = Date.now();   // el estado ES el latido: lo manda la interfaz del principal (si se cuelga, deja de llegar)
  if (m.type === 'state' && !inControl) remote = m;
}

async function takeOver(reason) {
  if (inControl) return;
  inControl = true;
  await setSilent(false);
  // Si el principal sigue vivo (relevo a mano), que se pare para no sonar los dos.
  try { await api()?.redTook?.(); } catch (_) {}
  const tp = await TP();
  const a = tp.getTrackAudio();
  if (remote && remote.playing && a && a.paused) { try { await a.play(); } catch (_) {} }
  const sounding = !!(a && !a.paused);
  window.showToast?.(sounding ? `Respaldo AL MANDO: ${reason}. Este PC sigue sonando.` : `Respaldo AL MANDO: ${reason}. Este PC no tenía la canción sonando: pulsa Play.`, 'warning', { ttl: 12000 });
  try { window.electronAPI?.appLog?.('warn', `[respaldo] relevo: ${reason}`); } catch (_) {}
  emit();
}

/** Volver a seguir al principal (tras un relevo). */
export async function followAgain() {
  if (cfg.role !== 'respaldo') return;
  inControl = false; remote = null; lastSeenAt = 0;
  await setSilent(true);
  emit();
}
/** Tomar el control a mano (desde el panel o el indicador). */
export function takeControlNow() { if (cfg.role === 'respaldo') takeOver('se tomó el control a mano'); }

let following = false;
async function followTick() {
  if (cfg.role !== 'respaldo' || following) return;
  following = true;
  try { await followStepNow(); } finally { following = false; }
}
async function followStepNow() {
  const now = Date.now();
  if (!inControl && shouldTakeOver(remote, lastSeenAt, now)) { takeOver('el principal dejó de responder'); return; }
  if (inControl || !remote) return;
  const tp = await TP();
  const a = tp.getTrackAudio();
  const local = { song: tp.getCurrentSong(), type: tp.getCurrentType(), playing: !!(a && !a.paused), t: a ? a.currentTime : 0, pitch: tp.getTrackPitch(), lastSeekAt };
  const step = followStep(remote, local, now);
  if (step.action === 'load') {
    const key = `${remote.songId}|${remote.slot}`;
    if (loading.key === key && now - loading.at < 8000) return;
    const song = findInLibrary(getSongs(), { id: remote.songId, title: remote.title, artist: remote.artist });
    const type = remote.slot || 'sequence';
    if (!song || !(song.audio && song.audio[type])) {
      if (missingKey !== key) { missingKey = key; window.showToast?.(`Respaldo: falta ${song ? `el audio (${type === 'original' ? 'original' : 'secuencia'}) de` : 'la canción'} «${remote.title}» en este PC.`, 'error', { ttl: 9000 }); }
      return;
    }
    loading = { key, at: now }; missingKey = '';
    try { document.querySelector(`.gi-song-item[data-song-id="${CSS.escape(String(song.id))}"]`)?.click(); } catch (_) {}
    tp.loadAndPlayTrack(song, type);
    return;
  }
  if (!a || !(a.duration > 0)) return;           // todavía cargando
  try {
    if (step.action === 'pitch') { tp.setLiveKeyOffset(tp.getLiveKeyOffset() + (step.pitch - local.pitch)); return; }
    if (remote.rate && Math.abs((a.playbackRate || 1) - remote.rate) > 0.001) { try { a.playbackRate = remote.rate; } catch (_) {} }
    if (step.action === 'play') { a.currentTime = step.t; lastSeekAt = now; await a.play(); }
    else if (step.action === 'pause') { a.pause(); a.currentTime = step.t; lastSeekAt = now; }
    else if (step.action === 'seek') { a.currentTime = step.t; lastSeekAt = now; }
  } catch (_) {}
}

// ── Arranque / cambio de papel ─────────────────────────────────────────────
async function applyRole() {
  clearInterval(loopTimer); clearInterval(pubTimer); loopTimer = pubTimer = 0;
  remote = null; inControl = false; lastSeenAt = 0;
  const A = api();
  if (!A?.redStatus) return;
  if (cfg.role === 'principal') {
    if (standby) await setSilent(false);
    const r = await A.redPrincipal({ pin: cfg.pin });
    if (!r || !r.ok) { window.showToast?.('No se pudo activar el principal: ' + ((r && r.error) || '?'), 'error', { ttl: 9000 }); cfg.role = 'off'; saveCfg(); emit(); return; }
    if (r.pin && r.pin !== cfg.pin) { cfg.pin = r.pin; saveCfg(); }
    pubTimer = setInterval(publishTick, 200);
  } else if (cfg.role === 'respaldo') {
    await A.redBackup();
    if (cfg.host) await A.redConnect({ host: cfg.host, port: cfg.port, pin: cfg.pin });
    await setSilent(true);
    loopTimer = setInterval(followTick, 200);
  } else {
    await A.redStop();
    if (standby) await setSilent(false);
  }
  net = await A.redStatus();
  emit();
}

export function initRedundancy(d = {}) {
  deps = { ...deps, ...d };
  loadCfg();
  const A = api();
  if (!A?.onRedRemote) return;
  A.onRedRemote(onRemote);
  A.onRedStatus((s) => { net = s || net; emit(); });
  // El principal: si el respaldo tomó el control, este PC se para para no sonar a la vez.
  A.onRedRemote((m) => {
    if (m && m.type === 'took' && cfg.role === 'principal') {
      TP().then((tp) => { const a = tp.getTrackAudio(); if (a && !a.paused) a.pause(); });
      window.showToast?.(`El respaldo «${m.name}» tomó el control: este PC se ha pausado.`, 'warning', { ttl: 12000 });
    }
  });
  if (cfg.role !== 'off') applyRole();
}

export function getRedundancyConfig() { return { ...cfg }; }
/** Estado interno (diagnóstico y pruebas). */
export function redundancyDebug() { const e = deps.getEngine(); const sink = e && e.ctx ? e.ctx.sinkId : null; return { sink: sink && typeof sink === 'object' ? sink.type : sink, pubCount, pubErr, pubTimer: !!pubTimer, cfg: { ...cfg, pin: cfg.pin ? "****" : "" }, net, remote, lastSeenAt, inControl, standby, loading, missingKey }; }

// Chip en la cabecera (junto al reloj) mientras está activo: de un vistazo, quién manda.
let chip = null;
function paintChip() {
  const info = redundancyInfo();
  if (info.role === 'off') { if (chip) chip.hidden = true; return; }
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button'; chip.id = 'red-chip'; chip.className = 'tv-cd-chip red-chip';
    chip.addEventListener('click', () => openRedundancyPanel());
    const clock = document.getElementById('topbar-clock');
    if (clock && clock.parentNode) clock.parentNode.insertBefore(chip, clock); else document.body.appendChild(chip);
  }
  chip.hidden = false;
  chip.dataset.tone = info.tone;
  chip.title = info.text + ' — tocar para ver el respaldo';
  const label = info.role === 'principal' ? (net.clients.length ? 'Principal ✓' : 'Principal') : (inControl ? 'AL MANDO' : net.linked ? 'Respaldo ✓' : 'Respaldo…');
  chip.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="9" height="7" rx="1.5"/><rect x="13" y="13" width="9" height="7" rx="1.5"/><path d="M6.5 11v4.5H13M17.5 13V8.5H11"/></svg><span>${label}</span>`;
}
onRedundancyChange(paintChip);

// ── Panel ──────────────────────────────────────────────────────────────────
export function openRedundancyPanel() {
  if (document.getElementById('red-box')) return;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box red-box" id="red-box" role="dialog" aria-modal="true" aria-label="Respaldo entre 2 PCs">
      <div class="vn-head"><b>Respaldo entre 2 PCs</b><span>Un segundo PC sigue al principal en silencio, en el mismo punto de la canción. Si el principal se cuelga o se apaga, el respaldo empieza a sonar en ~1 s.</span></div>
      <div class="ui-seg red-roles" role="group" aria-label="Papel de este PC">
        <button type="button" class="ui-seg-btn" data-role="off">Desactivado</button>
        <button type="button" class="ui-seg-btn" data-role="principal">Principal</button>
        <button type="button" class="ui-seg-btn" data-role="respaldo">Respaldo</button>
      </div>
      <p class="red-status" data-ref="status" aria-live="polite"></p>
      <div class="red-sec" data-ref="principal">
        <p class="proj-hint">En el PC de respaldo elige «Respaldo», escoge este PC y escribe el código:</p>
        <div class="red-pin" data-ref="pin"></div>
        <button type="button" class="vn-btn" data-act="newpin">Cambiar el código</button>
      </div>
      <div class="red-sec" data-ref="respaldo">
        <p class="proj-hint" data-ref="foundhint">PCs principales en esta red:</p>
        <div class="red-found" data-ref="found"></div>
        <div class="proj-grid">
          <label class="vn-field">PC principal (IP) <input data-f="host" placeholder="192.168.1.20" spellcheck="false"></label>
          <label class="vn-field">Código <input data-f="pin" inputmode="numeric" maxlength="4" placeholder="1234"></label>
        </div>
        <div class="proj-test"><button type="button" class="vn-btn" data-act="connect">Conectar</button>
          <button type="button" class="vn-btn" data-act="take">Tomar el control ahora</button>
          <button type="button" class="vn-btn" data-act="follow">Volver a seguir al principal</button></div>
        <p class="proj-hint">Necesita las mismas canciones y audios en los dos PCs (usa el paquete del servicio o la nube). Sigue la pista (secuencia u original); pads y batería se tocan en el PC al mando.</p>
      </div>
      <div class="vn-actions"><button type="button" class="vn-btn vn-btn--primary" data-act="close">Listo</button></div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => { off(); pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  const paint = () => {
    ov.querySelectorAll('[data-role]').forEach((b) => b.classList.toggle('is-on', b.dataset.role === cfg.role));
    $('[data-ref="principal"]').hidden = cfg.role !== 'principal';
    $('[data-ref="respaldo"]').hidden = cfg.role !== 'respaldo';
    const info = redundancyInfo();
    const st = $('[data-ref="status"]');
    st.textContent = info.text; st.dataset.tone = info.tone;
    $('[data-ref="pin"]').textContent = net.pin || cfg.pin || '····';
    const found = net.found || [];
    $('[data-ref="found"]').innerHTML = found.length ? found.map((f) => `<button type="button" class="vn-btn red-pc${f.ip === cfg.host ? ' is-on' : ''}" data-ip="${esc(f.ip)}" data-port="${esc(f.port)}">${esc(f.name)} <small>${esc(f.ip)}</small></button>`).join('') : '<span class="red-none">Ninguno todavía (¿el principal está en «Principal» y en la misma red?). También puedes escribir su IP.</span>';
    const h = $('[data-f="host"]'), p = $('[data-f="pin"]');
    if (document.activeElement !== h) h.value = cfg.host || '';
    if (document.activeElement !== p) p.value = cfg.pin || '';
    $('[data-act="take"]').hidden = inControl;
    $('[data-act="follow"]').hidden = !inControl;
  };
  const off = onRedundancyChange(paint);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const r = e.target.closest('[data-role]');
    if (r && r.dataset.role !== cfg.role) {
      cfg.role = r.dataset.role;
      if (cfg.role === 'principal' && !/^\d{4}$/.test(cfg.pin)) cfg.pin = '';
      saveCfg(); paint(); await applyRole(); return;
    }
    const pc = e.target.closest('[data-ip]');
    if (pc) { cfg.host = pc.dataset.ip; cfg.port = Number(pc.dataset.port) || 47833; saveCfg(); paint(); $('[data-f="pin"]').focus(); return; }
    if (e.target.closest('[data-act="newpin"]')) { cfg.pin = String(Math.floor(1000 + Math.random() * 9000)); saveCfg(); await applyRole(); return; }
    if (e.target.closest('[data-act="connect"]')) {
      if (!cfg.host || !/^\d{4}$/.test(cfg.pin)) { window.showToast?.('Escribe la IP del PC principal y su código de 4 cifras.', 'info'); return; }
      await api()?.redConnect?.({ host: cfg.host, port: cfg.port, pin: cfg.pin });
      return;
    }
    if (e.target.closest('[data-act="take"]')) { takeControlNow(); return; }
    if (e.target.closest('[data-act="follow"]')) { followAgain(); }
  });
  ov.addEventListener('input', (e) => { const f = e.target.dataset.f; if (f) { cfg[f] = f === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 4) : e.target.value.trim(); saveCfg(); } });
  api()?.redStatus?.().then((s) => { if (s) net = s; paint(); });
  paint();
}
