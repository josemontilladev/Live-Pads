// ─────────────────────────────────────────────────────────────────────────
// «Letra sincronizada»: la IA escucha la voz y pone cada línea de la letra en su momento
// (lyricsAlign.js en el proceso principal); aquí se revisa y se retoca a mano.
//   · Línea de tiempo con la onda: cada línea es una marca que se arrastra. Clic = escuchar
//     desde ahí. Las marcas en ámbar son las que la IA no tenía claras (revísalas).
//   · Lista: tiempo, texto, ±0,05 s, «aquí» (a la posición que suena), ▶ (escuchar), ✕.
//   · Teclado: Espacio reproduce · ←/→ línea anterior/siguiente · [ ] mueven 0,05 s
//     (con Mayús 0,01 s) · Intro = la línea a donde suena · T = «toque»: la línea a donde
//     suena y pasa a la siguiente (para marcar mientras suena).
// Guarda en la canción por pista (live/lyricSyncStore.js).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { getSongs } from '../state/store.js';
import { lyricLines, getLyricSync, setLyricSync, syncState } from './lyricSyncStore.js';
import { vocalOf, to16kMono } from './autoLyrics.js';
import { confirmDialogAsync } from '../ui/dialog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const singable = (t) => /\p{L}{2}/u.test(t);
const VIEW = 14;   // segundos visibles en la línea de tiempo

async function readBuffer(ctx, url) {
  const arr = /^(livepads:|file:)/i.test(url) && window.electronAPI?.readAudioFile ? await window.electronAPI.readAudioFile(url) : await (await fetch(url)).arrayBuffer();
  return ctx.decodeAudioData(arr.slice ? arr.slice(0) : arr);
}

/** Picos por bloque de 10 ms (para pintar la onda rápido). */
function peaksOf(buf) {
  const hop = Math.round(buf.sampleRate / 100), n = Math.ceil(buf.length / hop);
  const out = new Float32Array(n);
  const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  for (let f = 0; f < n; f++) {
    let p = 0;
    for (const d of chs) for (let i = f * hop, e = Math.min(d.length, i + hop); i < e; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > p) p = v; }
    out[f] = p;
  }
  return out;
}

export function openLyricSync(song, { type: wantType = null } = {}) {
  if (!song || document.getElementById('lsy-box')) return;
  const api = window.electronAPI;
  if (!api?.lyricsAlign) { window.showToast?.('Esta versión no puede sincronizar la letra.', 'error'); return; }
  if (!String(song.lyrics || '').trim()) { window.showToast?.(`«${song.title}» no tiene letra todavía. Escríbela o sácala con IA y luego sincronízala.`, 'warning'); return; }
  const au = song.audio || {};
  const types = [au.original ? 'original' : null, au.sequence ? 'sequence' : null].filter(Boolean);
  if (!types.length) { window.showToast?.('Esta canción necesita su Original o su Secuencia para sincronizar la letra.', 'warning'); return; }
  let type = wantType && types.includes(wantType) ? wantType : types[0];

  const lines = lyricLines(song.lyrics);
  const S = { ev: [], sel: -1, buf: null, peaks: null, ctx: null, src: null, t0: 0, off: 0, playing: false, view0: 0, dirty: false, busy: false, drag: null, raf: 0, vocal: null };

  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box lsy-box" id="lsy-box" role="dialog" aria-modal="true" aria-label="Letra sincronizada">
      <div class="vn-head"><b>Letra sincronizada</b><span>«${esc(song.title)}»: cada línea entra justo cuando se canta (panel de letra, TV y programa de proyección). La IA lo hace en este equipo; tú solo retocas.</span></div>
      <div class="lsy-top">
        <div class="ui-seg lsy-type" role="group" aria-label="Pista"${types.length < 2 ? ' hidden' : ''}>
          ${types.map((t) => `<button type="button" class="ui-seg-btn" data-type="${t}">${t === 'original' ? 'Original' : 'Secuencia'}</button>`).join('')}
        </div>
        <span class="lsy-state" data-ref="state"></span>
        <button type="button" class="vn-btn" data-act="ai">Sincronizar con IA</button>
      </div>
      <div class="mt-progress" data-ref="prog" hidden><div class="vs-bar"><i data-ref="bar"></i></div><small data-ref="step"></small></div>
      <div class="lsy-tl" data-ref="tl" tabindex="0" aria-label="Línea de tiempo: arrastra una marca para moverla; clic para escuchar desde ahí">
        <canvas data-ref="cv"></canvas>
      </div>
      <div class="lsy-transport">
        <button type="button" class="vn-btn lsy-play" data-act="play" title="Reproducir / pausa (Espacio)">▶</button>
        <span class="lsy-time" data-ref="time">0:00.00</span>
        <span class="lsy-keys">Espacio ▶ · ←/→ línea · [ ] ±0,05 s · Intro = aquí · T = toque</span>
        <button type="button" class="vn-btn" data-act="add" title="Añadir una línea de la letra en la posición que suena (si falta alguna repetición)">+ Línea aquí</button>
      </div>
      <div class="lsy-list" data-ref="list" role="listbox" aria-label="Líneas sincronizadas"></div>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cerrar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="save" disabled>Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (q) => ov.querySelector(q);
  const cv = $('[data-ref="cv"]'), tl = $('[data-ref="tl"]'), list = $('[data-ref="list"]');

  // ── Audio ──
  const pos = () => (S.playing ? S.off + (S.ctx.currentTime - S.t0) : S.off);
  const stop = () => { if (S.src) { try { S.src.stop(); } catch (_) {} S.src.disconnect(); S.src = null; } if (S.playing) S.off = pos(); S.playing = false; $('[data-act="play"]').textContent = '▶'; };
  const play = (from = null) => {
    if (!S.buf) return;
    stop();
    if (from != null) S.off = Math.max(0, Math.min(S.buf.duration - 0.05, from));
    if (S.ctx.state === 'suspended') S.ctx.resume();
    const src = S.ctx.createBufferSource(); src.buffer = S.buf; src.connect(S.ctx.destination);
    src.start(0, S.off); S.t0 = S.ctx.currentTime; S.src = src; S.playing = true;
    src.onended = () => { if (S.src === src) { S.off = Math.min(S.buf.duration, pos()); S.src = null; S.playing = false; $('[data-act="play"]').textContent = '▶'; } };
    $('[data-act="play"]').textContent = '❚❚';
  };
  const seek = (t) => { if (S.playing) play(t); else { S.off = Math.max(0, Math.min(S.buf ? S.buf.duration : t, t)); draw(); } };

  async function loadTrack() {
    stop();
    S.buf = null; S.peaks = null; draw();
    if (!S.ctx) S.ctx = new AudioContext();
    const url = type === 'sequence' ? au.sequence : au.original;
    try { S.buf = await readBuffer(S.ctx, url); S.peaks = peaksOf(S.buf); } catch (e) { window.showToast?.('No se pudo cargar la pista para escucharla.', 'error'); }
    draw();
  }

  // ── Datos ──
  function loadEvents() {
    const s = getLyricSync(song, type);
    S.ev = s ? s.ev.map((e) => ({ t: e[0], i: e[1], check: e[2] === 0 })) : [];
    S.sel = S.ev.length ? 0 : -1;
    S.dirty = false;
    paintState(); paintList(); draw();
  }
  function paintState() {
    const st = syncState(song, type);
    const n = S.ev.length, chk = S.ev.filter((e) => e.check).length;
    $('[data-ref="state"]').textContent = n
      ? `${n} entradas${chk ? ` · ${chk} por revisar (en ámbar)` : ' · todo revisado'}${S.dirty ? ' · sin guardar' : ''}`
      : st === 'old' ? 'La letra cambió desde la última vez: vuelve a sincronizarla.' : 'Aún sin sincronizar.';
    $('[data-act="ai"]').textContent = n ? 'Volver a sincronizar con IA' : 'Sincronizar con IA';
    $('[data-act="save"]').disabled = !S.dirty;
    ov.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('is-on', b.dataset.type === type));
  }
  const touch = () => { S.dirty = true; paintState(); };
  function sortEv() { const cur = S.ev[S.sel]; S.ev.sort((a, b) => a.t - b.t); S.sel = cur ? S.ev.indexOf(cur) : -1; }
  function setTime(k, t) {
    const e = S.ev[k]; if (!e) return;
    e.t = Math.max(0, Math.round(t * 100) / 100); e.check = false;
    sortEv(); touch(); paintList(); draw();
  }

  function paintList() {
    list.innerHTML = S.ev.map((e, k) => {
      const L = lines[e.i] || { text: '?', label: '' };
      return `<div class="lsy-row${k === S.sel ? ' is-sel' : ''}${e.check ? ' is-check' : ''}" data-k="${k}" role="option" aria-selected="${k === S.sel}">
        <button type="button" class="lsy-b" data-row="play" title="Escuchar desde un poco antes">▶</button>
        <span class="lsy-t">${fmt(e.t)}</span>
        <span class="lsy-x"><small>${esc(L.label)}</small>${esc(L.text)}</span>
        <button type="button" class="lsy-b" data-row="minus" title="0,05 s antes">−</button>
        <button type="button" class="lsy-b" data-row="plus" title="0,05 s después">+</button>
        <button type="button" class="lsy-b" data-row="here" title="Poner donde suena ahora">aquí</button>
        <button type="button" class="lsy-b" data-row="del" title="Quitar esta entrada">✕</button>
      </div>`;
    }).join('') || '<p class="lsy-empty">Pulsa «Sincronizar con IA»: escucha la voz y pone cada línea en su sitio (unos minutos, en este equipo). Después puedes retocar aquí.</p>';
    const r = list.querySelector('.is-sel'); if (r) r.scrollIntoView({ block: 'nearest' });
  }

  // ── Línea de tiempo ──
  function draw() {
    const W = tl.clientWidth || 600, H = tl.clientHeight || 120, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(ov);
    const fg = css.getPropertyValue('--text').trim() || '#ddd', mute = css.getPropertyValue('--text-muted').trim() || '#888', acc = css.getPropertyValue('--accent').trim() || '#f5b301';
    g.clearRect(0, 0, W, H);
    const p = pos();
    // La vista sigue a lo que suena (o a la marca elegida).
    const focus = S.playing ? p : (S.ev[S.sel] ? S.ev[S.sel].t : p);
    if (focus < S.view0 + 1 || focus > S.view0 + VIEW - 2) S.view0 = Math.max(0, focus - VIEW * 0.3);
    const x = (t) => ((t - S.view0) / VIEW) * W;
    const wave = H - 34;
    if (S.peaks) {
      g.fillStyle = mute; g.globalAlpha = 0.55;
      const f0 = Math.floor(S.view0 * 100), f1 = Math.ceil((S.view0 + VIEW) * 100), per = (f1 - f0) / W;
      for (let px = 0; px < W; px++) {
        let m = 0; const a = Math.floor(f0 + px * per), b = Math.floor(f0 + (px + 1) * per);
        for (let f = a; f <= b && f < S.peaks.length; f++) if (S.peaks[f] > m) m = S.peaks[f];
        const h = Math.min(1, m * 1.3) * (wave - 6);
        g.fillRect(px, 22 + (wave - h) / 2, 1, Math.max(1, h));
      }
      g.globalAlpha = 1;
    } else { g.fillStyle = mute; g.font = '12px system-ui'; g.fillText('Cargando la pista…', 10, H / 2); }
    // Segundos
    g.fillStyle = mute; g.font = '10px system-ui';
    for (let s = Math.ceil(S.view0); s < S.view0 + VIEW; s++) { g.fillRect(x(s), H - 10, 1, 4); if (s % 2 === 0) g.fillText(fmt(s).replace(/\.\d+$/, ''), x(s) + 2, H - 1); }
    // Marcas
    S.ev.forEach((e, k) => {
      if (e.t < S.view0 - 4 || e.t > S.view0 + VIEW) return;
      const X = x(e.t), col = e.check ? '#f59e0b' : (k === S.sel ? acc : fg);
      g.fillStyle = col; g.globalAlpha = k === S.sel ? 1 : 0.8;
      g.fillRect(X - (k === S.sel ? 1 : 0.5), 18, k === S.sel ? 2 : 1, wave + 4);
      g.beginPath(); g.moveTo(X - 5, 18); g.lineTo(X + 5, 18); g.lineTo(X, 25); g.fill();
      g.globalAlpha = 1;
      const txt = (lines[e.i] || {}).text || '';
      g.font = `${k === S.sel ? 600 : 400} 11px system-ui`;
      const next = S.ev[k + 1], room = next ? x(next.t) - X - 8 : W;
      let s = txt; while (s.length > 3 && g.measureText(s).width > room) s = s.slice(0, -2);
      if (s !== txt) s = s.replace(/.$/, '…');
      if (room > 18) g.fillText(s, X + 4, 13);
    });
    // Cabezal
    g.fillStyle = '#ef4444'; g.fillRect(x(p), 16, 2, wave + 8);
    $('[data-ref="time"]').textContent = fmt(p);
  }
  const loop = () => { if (!ov.isConnected) return; if (S.playing) draw(); S.raf = requestAnimationFrame(loop); };

  const tAt = (clientX) => { const r = tl.getBoundingClientRect(); return S.view0 + ((clientX - r.left) / r.width) * VIEW; };
  tl.addEventListener('pointerdown', (e) => {
    const t = tAt(e.clientX), r = tl.getBoundingClientRect();
    const px = (tt) => ((tt - S.view0) / VIEW) * r.width;
    let hit = -1, best = 7;
    S.ev.forEach((ev, k) => { const d = Math.abs(px(ev.t) - (e.clientX - r.left)); if (d < best) { best = d; hit = k; } });
    if (hit >= 0) { S.sel = hit; S.drag = { k: hit, moved: false }; tl.setPointerCapture(e.pointerId); paintList(); draw(); }
    else seek(t);
  });
  tl.addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    const ev = S.ev[S.drag.k]; if (!ev) return;
    ev.t = Math.max(0, Math.round(tAt(e.clientX) * 100) / 100); ev.check = false; S.drag.moved = true; draw();
  });
  tl.addEventListener('pointerup', () => {
    if (!S.drag) return;
    const d = S.drag; S.drag = null;
    if (d.moved) { sortEv(); touch(); paintList(); draw(); const e = S.ev[S.sel]; if (e) play(e.t - 0.6); }
  });
  tl.addEventListener('wheel', (e) => { e.preventDefault(); S.view0 = Math.max(0, S.view0 + (e.deltaY + e.deltaX) / 100); draw(); }, { passive: false });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.lsy-row'); if (!row) return;
    const k = +row.dataset.k; S.sel = k;
    const act = e.target.closest('[data-row]')?.dataset.row;
    const ev = S.ev[k];
    if (act === 'play') play(ev.t - 1);
    else if (act === 'minus') setTime(k, ev.t - 0.05);
    else if (act === 'plus') setTime(k, ev.t + 0.05);
    else if (act === 'here') setTime(k, pos());
    else if (act === 'del') { S.ev.splice(k, 1); S.sel = Math.min(k, S.ev.length - 1); touch(); }
    else if (!S.playing) S.off = ev.t;
    paintList(); draw();
  });

  // ── Sincronizar con IA ──
  const step = (f, txt) => { $('[data-ref="prog"]').hidden = false; $('[data-ref="bar"]').style.width = `${Math.round(f * 100)}%`; $('[data-ref="step"]').textContent = txt; };
  async function runAi() {
    if (S.busy) return;
    if (S.ev.length && S.ev.some((e) => !e.check)) {
      const ok = await confirmDialogAsync({ title: 'Volver a sincronizar', message: 'Se rehace la sincronización de esta pista con la IA y se pierden los retoques a mano. ¿Seguir?', confirmLabel: 'Sincronizar' });
      if (!ok) return;
    }
    S.busy = true; stop();
    ov.querySelectorAll('[data-act="ai"], [data-type]').forEach((b) => { b.disabled = true; });
    const offP = api.onLyricsProgress?.((d) => step(0.35 + 0.65 * (d.frac || 0), d.label || 'Escuchando la letra…'));
    try {
      const vocal = await vocalOf(song, (f, t) => step(0.3 * f, t), type);
      step(0.32, 'Preparando la voz…');
      const pcm = await to16kMono(vocal);
      const idx = lines.map((l, i) => i).filter((i) => singable(lines[i].text));
      const r = await api.lyricsAlign({ pcm, lines: idx.map((i) => lines[i]), size: 'small' });
      if (r && r.cancelled) throw new Error('Cancelado.');
      const evs = (r && r.events) || [];
      if (!evs.length) throw new Error('No se reconoció la letra en la voz. ¿Es la letra de esta canción y la pista tiene voz?');
      S.ev = evs.map((e) => ({ t: e.t, i: idx[e.line], check: e.conf !== 'exact' }));
      S.sel = 0; S.dirty = true;
      $('[data-ref="prog"]').hidden = true;
      paintState(); paintList(); draw();
      window.__lpLyricSync = { events: S.ev.length, check: S.ev.filter((e) => e.check).length };
    } catch (e) {
      step(0, String((e && e.message) || e));
    } finally {
      S.busy = false;
      ov.querySelectorAll('[data-act="ai"], [data-type]').forEach((b) => { b.disabled = false; });
      try { offP && offP(); } catch (_) {}
    }
  }

  function save() {
    setLyricSync(song, type, S.ev.map((e) => (e.check ? [e.t, e.i, 0] : [e.t, e.i])), { auto: true, edited: true });
    api.saveGiSetlist?.(getSongs());
    window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id } }));
    S.dirty = false; paintState();
    window.dispatchEvent(new CustomEvent('livepads:lyricsync-saved', { detail: { songId: song.id, type } }));
    window.showToast?.(`Letra de «${song.title}» sincronizada (${type === 'sequence' ? 'secuencia' : 'original'}).`, 'success');
  }

  function addHere() {
    const t = pos();
    const opts = lines.map((l, i) => ({ l, i })).filter((o) => singable(o.l.text));
    const menu = document.createElement('div');
    menu.className = 'lsy-pick';
    menu.innerHTML = `<b>¿Qué línea empieza en ${fmt(t)}?</b>${opts.map((o) => `<button type="button" data-i="${o.i}"><small>${esc(o.l.label)}</small> ${esc(o.l.text)}</button>`).join('')}`;
    $('#lsy-box').appendChild(menu);
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { S.ev.push({ t: Math.round(t * 100) / 100, i: +b.dataset.i, check: false }); S.sel = S.ev.length - 1; sortEv(); touch(); paintList(); draw(); }
      menu.remove();
    });
  }

  // ── Teclado ──
  const onKey = (e) => {
    const tg = e.target;
    if (!ov.isConnected || (tg && tg.closest && tg.closest('input, textarea, select'))) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); S.playing ? (stop(), draw()) : play(); }
    else if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); if (S.ev.length) { S.sel = Math.max(0, Math.min(S.ev.length - 1, S.sel + (k === 'ArrowRight' ? 1 : -1))); if (!S.playing) S.off = S.ev[S.sel].t; paintList(); draw(); } }
    else if ((k === '[' || k === ']') && S.ev[S.sel]) { e.preventDefault(); setTime(S.sel, S.ev[S.sel].t + (k === ']' ? 1 : -1) * (e.shiftKey ? 0.01 : 0.05)); }
    else if (k === 'Enter' && S.ev[S.sel]) { e.preventDefault(); setTime(S.sel, pos()); }
    else if ((k === 't' || k === 'T') && S.ev[S.sel]) { e.preventDefault(); const cur = S.ev[S.sel]; setTime(S.sel, pos() - 0.08); S.sel = Math.min(S.ev.length - 1, S.ev.indexOf(cur) + 1); paintList(); draw(); }
  };
  document.addEventListener('keydown', onKey, true);

  const close = async () => {
    if (S.dirty && S.ev.length) {
      const ok = await confirmDialogAsync({ title: 'Sin guardar', message: 'Hay cambios en la sincronización sin guardar. ¿Cerrar y perderlos?', confirmLabel: 'Cerrar sin guardar', danger: true });
      if (!ok) return;
    }
    if (S.busy) api.lyricsTranscribeCancel?.();
    stop(); cancelAnimationFrame(S.raf);
    document.removeEventListener('keydown', onKey, true);
    try { S.ctx && S.ctx.close(); } catch (_) {}
    pop(); ov.remove();
  };
  const pop = pushModal(close, ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const ty = e.target.closest('[data-type]');
    if (ty && !S.busy && ty.dataset.type !== type) {
      if (S.dirty) { window.showToast?.('Guarda antes de cambiar de pista.', 'warning'); return; }
      type = ty.dataset.type; loadEvents(); loadTrack(); return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') close();
    else if (act === 'ai') runAi();
    else if (act === 'save') save();
    else if (act === 'play') { S.playing ? (stop(), draw()) : play(); }
    else if (act === 'add') addHere();
  });
  new ResizeObserver(() => draw()).observe(tl);
  loadEvents(); loadTrack(); loop();
  window.__lpLyricSyncEditor = { S, save, runAi, setTime, play, stop, pos, type: () => type };
}
