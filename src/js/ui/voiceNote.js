// ─────────────────────────────────────────────────────────────────────────
// Nota de voz del líder: 30–90 s explicando el arreglo («el puente va solo con
// piano, luego entra todo»), grabados desde LivePads con el micrófono. Se guarda
// como una voz de referencia más de la canción (song.audio.voices, carpeta
// «Voces/»): la banda la escucha en LivePads (botón «Voces» de la tarjeta) y en
// GI App, y viaja con la sincronización de audios.
// ─────────────────────────────────────────────────────────────────────────

import { esc } from '../utils/dom.js';
import { getUser } from '../cloud/supabase.js';

const MAX_SEC = 90;

export function recordVoiceNote(song, onSaved) {
  if (!song) return;
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    window.showToast?.('Este equipo no permite grabar audio.', 'error');
    return;
  }
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box" role="dialog" aria-modal="true" aria-label="Grabar nota de voz">
      <div class="vn-head"><b>Nota de voz para la banda</b><span>${esc(song.title || '')}</span></div>
      <p class="vn-why">Explica el arreglo en pocas palabras: quién entra en cada parte, dinámicas, finales… La banda la escucha en LivePads y en GI App.</p>
      <div class="vn-rec">
        <button type="button" class="vn-btn vn-btn--rec" data-act="rec"><i></i><span>Grabar</span></button>
        <div class="vn-time" data-ref="time">0:00 / 1:30</div>
      </div>
      <audio class="vn-audio" controls hidden></audio>
      <label class="vn-field">Título <input data-ref="label" maxlength="40" value="Nota del líder"></label>
      <label class="vn-field">Nota (opcional) <input data-ref="note" maxlength="120" placeholder="Ej. Puente solo piano; último coro a capela"></label>
      <div class="vn-actions">
        <button type="button" class="vn-btn" data-act="cancel">Cancelar</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="save" disabled>Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let stream = null, rec = null, chunks = [], blob = null, t0 = 0, tick = null, secs = 0;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const paintTime = () => { $('[data-ref="time"]').textContent = `${fmt(secs)} / ${fmt(MAX_SEC)}`; };
  const stopAll = () => {
    clearInterval(tick); tick = null;
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (_) {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    stream = null;
  };
  const close = () => { stopAll(); ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  async function start() {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (_) { window.showToast?.('No se pudo usar el micrófono. Revisa el permiso en Windows.', 'error'); return; }
    chunks = []; blob = null; secs = 0;
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : {});
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      blob = new Blob(chunks, { type: 'audio/webm' });
      const a = $('.vn-audio'); a.src = URL.createObjectURL(blob); a.hidden = false;
      $('[data-act="save"]').disabled = !blob.size;
      $('[data-act="rec"] span').textContent = 'Grabar de nuevo';
      $('[data-act="rec"]').classList.remove('is-on');
    };
    rec.start(250);
    t0 = Date.now();
    $('[data-act="rec"] span').textContent = 'Parar';
    $('[data-act="rec"]').classList.add('is-on');
    $('[data-act="save"]').disabled = true;
    $('.vn-audio').hidden = true;
    tick = setInterval(() => { secs = (Date.now() - t0) / 1000; paintTime(); if (secs >= MAX_SEC) stopAll(); }, 200);
  }

  async function save() {
    if (!blob || !blob.size) return;
    const btn = $('[data-act="save"]'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await window.electronAPI.saveVoiceNote({ buffer: await blob.arrayBuffer(), title: song.title || 'cancion', ext: 'webm' });
      const u = (() => { try { return getUser(); } catch (_) { return null; } })();
      const by = (u && (u.user_metadata?.full_name || u.user_metadata?.name || (u.email || '').split('@')[0])) || '';
      const voice = {
        id: r.id, label: $('[data-ref="label"]').value.trim() || 'Nota del líder', path: r.url,
        note: $('[data-ref="note"]').value.trim(), by, uid: (u && u.id) || '', at: new Date().toISOString(), sec: Math.round(secs),
      };
      song.audio = song.audio || {};
      const list = Array.isArray(song.audio.voices) ? song.audio.voices.filter((v) => v && v.id !== voice.id) : [];
      song.audio.voices = [...list, voice];
      onSaved?.(song);
      window.showToast?.('Nota de voz guardada: la banda la verá en «Voces» (aquí y en GI App) cuando se sincronicen los audios.', 'success');
      close();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Guardar';
      window.showToast?.('No se pudo guardar la nota: ' + ((e && e.message) || e), 'error');
    }
  }

  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rec') { if (tick) stopAll(); else start(); }
    else if (act === 'save') save();
    else if (act === 'cancel') close();
  });
  paintTime();
}
