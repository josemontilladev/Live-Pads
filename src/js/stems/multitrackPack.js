// ─────────────────────────────────────────────────────────────────────────
// Importar un multitrack comprado (MultiTracks.com, Loop Community / Prime…).
// Eliges la CARPETA o el ZIP tal cual lo descargaste; LivePads:
//   1. reconoce cada pista por su nombre (Click, Guide, Drums, Bass, Keys, AG, EG,
//      BGVs, Pad…) — se puede corregir antes de importar;
//   2. crea la canción (título, artista, BPM y tono deducidos del nombre);
//   3. guarda cada pista en MP3 (pistas separadas de la canción, para Stems);
//   4. arma la SECUENCIA para tocar en Pads: click y guía a la izquierda (in-ears),
//      la banda a la derecha (sala), como el resto de secuencias de LivePads.
// El archivo lo abre y lee el proceso principal (multitrackImport.js).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { getSongs } from '../state/store.js';
import { requireRoom } from '../billing/license.js';
import { detectStemRole, STEM_KIND_BADGE } from './stemRole.js';
import { parsePackName, seqSide, normGain } from './multitrackCore.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KINDS = ['click', 'guide', 'drums', 'bass', 'guitar', 'keys', 'vocals', 'other', 'skip'];
const KIND_LABEL = { ...STEM_KIND_BADGE, skip: 'NO IMPORTAR' };
const mb = (b) => `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;

export async function importMultitrack(kind = 'folder') {
  const api = window.electronAPI;
  if (!api?.multitrackPick) { window.showToast?.('Esta versión no puede importar multitracks.', 'error'); return; }
  if (!requireRoom('songs', getSongs().length, 1)) return;
  let pk;
  try { pk = await api.multitrackPick({ kind }); } catch (e) { window.showToast?.('No se pudo abrir: ' + ((e && e.message) || e), 'error'); return; }
  if (!pk) return;
  openDialog(pk);
}

function openDialog(pk) {
  const base = (n) => n.split(/[\\/]/).pop();
  const guess = parsePackName(pk.source.name, pk.files.map((f) => base(f.name)));
  const rows = pk.files.map((f) => {
    const r = detectStemRole(base(f.name));
    return { ...f, kind: r.kind || 'other', label: r.name || base(f.name).replace(/\.[^.]+$/, '') };
  });
  const hasClick = rows.some((r) => r.kind === 'click');
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box mt-box" role="dialog" aria-modal="true" aria-label="Importar multitrack">
      <div class="vn-head"><b>Importar multitrack</b><span>${esc(pk.source.name)} · ${rows.length} pistas</span></div>
      <div class="mt-grid">
        <label class="vn-field">Título <input data-ref="title" value="${esc(guess.title)}" maxlength="120"></label>
        <label class="vn-field">Artista <input data-ref="artist" value="${esc(guess.artist)}" maxlength="120"></label>
        <label class="vn-field mt-narrow">BPM <input data-ref="bpm" value="${esc(guess.bpm)}" inputmode="numeric" maxlength="6"></label>
        <label class="vn-field mt-narrow">Tono <input data-ref="key" value="${esc(guess.key)}" maxlength="4" placeholder="E"></label>
      </div>
      <div class="mt-list" data-ref="list">${rows.map((r) => `
        <div class="mt-row" data-id="${r.id}">
          <span class="mt-name" title="${esc(r.name)}">${esc(base(r.name))}</span>
          <span class="mt-size">${mb(r.size)}</span>
          <select aria-label="Qué es ${esc(base(r.name))}">${KINDS.map((k) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${esc(KIND_LABEL[k] || k)}</option>`).join('')}</select>
        </div>`).join('')}</div>
      <label class="sm-use"><input type="checkbox" class="mo-switch" data-ref="seq" ${hasClick ? 'checked' : ''}> <span><b>Crear la secuencia para tocar en Pads</b><small>Click y guía a la izquierda (in-ears) y la banda a la derecha (sala).${hasClick ? '' : ' Este paquete no trae click: la izquierda quedaría en silencio.'}</small></span></label>
      <div class="mt-progress" data-ref="prog" hidden><div class="vs-bar"><i data-ref="bar"></i></div><small data-ref="step"></small></div>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cancelar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="go">Importar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let busy = false;
  const pop = pushModal(() => { if (!busy) close(); }, ov);
  const close = () => { pop(); ov.remove(); window.electronAPI.multitrackClose?.(); };
  ov.addEventListener('change', (e) => {
    const sel = e.target.closest('.mt-row select');
    if (sel) rows.find((r) => String(r.id) === sel.closest('.mt-row').dataset.id).kind = sel.value;
  });
  ov.addEventListener('click', async (e) => {
    if ((e.target === ov || e.target.closest('[data-act="cancel"]')) && !busy) { close(); return; }
    if (!e.target.closest('[data-act="go"]') || busy) return;
    busy = true;
    ov.querySelectorAll('input, select, button').forEach((x) => { x.disabled = true; });
    $('[data-ref="prog"]').hidden = false;
    const step = (frac, txt) => { $('[data-ref="bar"]').style.width = `${Math.round(frac * 100)}%`; $('[data-ref="step"]').textContent = txt; };
    try {
      const song = await runImport(pk, rows, {
        title: $('[data-ref="title"]').value.trim() || guess.title,
        artist: $('[data-ref="artist"]').value.trim(),
        bpm: $('[data-ref="bpm"]').value.trim(),
        key: $('[data-ref="key"]').value.trim(),
        makeSeq: $('[data-ref="seq"]').checked,
      }, step);
      busy = false; close();
      window.showToast?.(`✓ «${song.title}» importada: ${song.audio.stems.length} pistas${song.audio.sequence ? ' y su secuencia para Pads' : ''}.`, 'success', {
        ttl: 9000, action: { label: 'Abrir en Stems', onClick: () => window.dispatchEvent(new CustomEvent('livepads:practice-song-stems', { detail: { song, stems: song.audio.stems } })) },
      });
    } catch (err) {
      busy = false;
      ov.querySelectorAll('input, select, button').forEach((x) => { x.disabled = false; });
      step(0, 'No se pudo importar: ' + ((err && err.message) || err));
    }
  });
}

async function runImport(pk, rows, meta, step) {
  const api = window.electronAPI;
  const { decodeAudio } = await import('./engine.js');
  const { encodeMp3Async } = await import('../audio/mp3Pool.js');
  const { songSlug, attachStem } = await import('./songStems.js');
  const use = rows.filter((r) => r.kind !== 'skip');
  if (!use.length) throw new Error('No hay pistas para importar.');
  const song = { id: `song_mt_${Date.now()}`, title: meta.title, artist: meta.artist, bpm: meta.bpm, key: meta.key, lyrics: '', genre: 'adoracion', tags: ['multitrack'], addedAt: Date.now(), markers: [], audio: { sequence: null, original: null, stems: [] } };
  // Secuencia: dos sumas en mono (izquierda: click + guía; derecha: la banda).
  let L = null, R = null, sr = 0;
  for (let i = 0; i < use.length; i++) {
    const r = use[i];
    const name = r.label;
    step(i / (use.length + 1), `${i + 1} de ${use.length}: ${name}`);
    const bytes = await api.multitrackRead({ token: pk.token, id: r.id });
    const buf = await decodeAudio(bytes);
    if (meta.makeSeq) {
      if (!L) { sr = buf.sampleRate; L = new Float32Array(buf.length); R = new Float32Array(buf.length); }
      if (buf.length > L.length) { const nl = new Float32Array(buf.length); nl.set(L); L = nl; const nr = new Float32Array(buf.length); nr.set(R); R = nr; }
      const dst = seqSide(r.kind) === 'L' ? L : R;
      const step2 = buf.sampleRate / sr;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c), g = 1 / buf.numberOfChannels;
        if (step2 === 1) { for (let k = 0; k < d.length; k++) dst[k] += d[k] * g; }
        else { const n = Math.min(dst.length, Math.floor(d.length / step2)); for (let k = 0; k < n; k++) dst[k] += d[Math.floor(k * step2)] * g; }
      }
    }
    // La pista, en MP3 (en hilos aparte), guardada en la carpeta de la canción.
    const l = buf.getChannelData(0).slice(), rr = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : null;
    const mp3 = await encodeMp3Async(l, rr, buf.sampleRate, 192);
    const url = await api.saveSongStem({ buffer: mp3, songSlug: songSlug(song), name, ext: 'mp3' });
    attachStem(song, { url, name, kind: r.kind === 'skip' ? 'other' : r.kind });
  }
  if (meta.makeSeq && L) {
    step(use.length / (use.length + 1), 'Creando la secuencia (click a la izquierda, banda a la derecha)…');
    let pl = 0, pr = 0;
    for (let k = 0; k < L.length; k++) { const a = Math.abs(L[k]), b = Math.abs(R[k]); if (a > pl) pl = a; if (b > pr) pr = b; }
    const gl = normGain(pl), gr = normGain(pr);
    for (let k = 0; k < L.length; k++) { L[k] *= gl; R[k] *= gr; }
    const mp3 = await encodeMp3Async(L, R, sr, 192);
    song.audio.sequence = await api.assignStemsMix({ buffer: mp3, type: 'sequence', name: song.title });
  }
  step(1, 'Guardando la canción…');
  const lib = getSongs();
  lib.push(song);
  api.saveGiSetlist?.(lib);
  try { const m = await import('../ui/giList.js'); m.renderGiList(document.getElementById('gi-search')?.value || ''); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:songs-changed', { detail: { songId: song.id, stems: true } }));
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  return song;
}
