// ─────────────────────────────────────────────────────────────────────────
// Mis carpetas de multitracks → Biblioteca de stems.
// Las carpetas de tu disco (o disco externo) donde guardas lo que compras o
// descargas (MultiTracks, Loop Community, Prime…): cada subcarpeta o ZIP es una
// canción. Con un clic se SUBE a la Biblioteca de stems (el mismo subidor de
// packs: los WAV pesados se comprimen a MP3, y quedan en la nube y para bajar a
// cualquier equipo), o se crea una canción de la biblioteca con sus pistas y su
// secuencia para Pads. Las carpetas las guarda el proceso principal (main.js → mtlib-*).
// ─────────────────────────────────────────────────────────────────────────

import { pushModal } from '../ui/modalStack.js';
import { getSongs } from '../state/store.js';
import { parsePackName } from './multitrackCore.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const size = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`).replace('.', ',');
const base = (n) => String(n || '').split(/[\\/]/).pop();

let open = null;

/** Lo que se muestra de cada multitrack: título, y artista/tono/BPM solo si aportan algo. */
function describe(it) {
  const g = parsePackName(it.name, []);
  const title = g.title || it.name;
  const artist = g.artist && norm(g.artist) !== norm(title) ? g.artist : '';
  const bpm = Number(g.bpm) > 0 ? g.bpm : '';
  return { ...g, title, artist, bpm };
}

export async function openMultitrackLibrary({ onUploaded, lib: libOverride = null } = {}) {
  const api = window.electronAPI;
  if (!api?.mtlibList) { window.showToast?.('Esta versión no tiene la biblioteca de multitracks.', 'error'); return; }
  if (open && open.el && open.el.isConnected) return;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `
    <div class="vn-box mtl-box" role="dialog" aria-modal="true" aria-label="Mis carpetas de multitracks">
      <div class="vn-head"><b>Mis carpetas de multitracks</b><span>Cada subcarpeta o ZIP es una canción. Súbela a la Biblioteca de stems (los WAV se comprimen a MP3) o créala como canción.</span></div>
      <div class="mtl-tools">
        <input type="search" class="mtl-search" data-ref="q" placeholder="Buscar canción…" aria-label="Buscar en mis carpetas">
        <button type="button" class="vn-btn" data-act="add">+ Añadir carpeta</button>
      </div>
      <div class="mtl-batch" data-ref="batch" hidden>
        <span data-ref="selcount">Ninguno marcado</span>
        <button type="button" class="mtl-link" data-act="sel-missing" title="Marca los que todavía no están en la Biblioteca (de lo que se ve con la búsqueda)">Marcar los que faltan</button>
        <button type="button" class="mtl-link" data-act="sel-none">Quitar marcas</button>
        <button type="button" class="vn-btn vn-btn--primary" data-act="batch" disabled>Revisar y subir</button>
      </div>
      <div class="mtl-body" data-ref="body"><div class="mtl-empty">Cargando…</div></div>
      <div class="vn-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button></div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let data = [];
  let admin = false;
  let packTitles = new Set();
  const selected = new Set();   // rutas marcadas para la subida por lotes
  const paintBatch = () => {
    const bar = $('[data-ref="batch"]');
    bar.hidden = !admin || !data.length;
    $('[data-ref="selcount"]').textContent = selected.size ? `${selected.size} marcado${selected.size === 1 ? '' : 's'}` : 'Marca varios para subirlos de una vez';
    const b = $('[data-act="batch"]');
    b.disabled = !selected.size;
    b.textContent = selected.size ? `Revisar y subir ${selected.size}` : 'Revisar y subir';
  };
  const close = () => { pop(); ov.remove(); open = null; };
  const pop = pushModal(close, ov);
  open = { close, el: ov };

  // ¿Quién puede subir a la Biblioteca de stems? (el administrador) y qué packs ya hay.
  const loadLibrary = async (refresh = false) => {
    try {
      // libOverride: solo para las pruebas (biblioteca de mentira, sin nube).
      const lib = libOverride || await import('../cloud/stemLibrary.js');
      admin = await lib.isLibraryAdmin().catch(() => false);
      const packs = await lib.listPacks({ refresh }).catch(() => []);
      packTitles = new Set((packs || []).map((p) => norm(p.title)));
    } catch (_) {}
  };

  const paint = () => {
    const q = norm($('[data-ref="q"]').value);
    const songs = new Set(getSongs().map((s) => norm(s.title)));
    if (!data.length) {
      $('[data-ref="body"]').innerHTML = `<div class="mtl-empty"><b>Añade la carpeta donde guardas tus multitracks.</b><br>Por ejemplo la del disco externo con tus ZIP. Cada subcarpeta con audios (o cada ZIP) aparecerá aquí como una canción.</div>`;
      return;
    }
    $('[data-ref="body"]').innerHTML = data.map((r) => {
      const items = r.items.filter((it) => !q || norm(it.name).includes(q));
      const rows = items.map((it) => {
        const d = describe(it);
        const inPacks = packTitles.has(norm(d.title));
        const inSongs = songs.has(norm(d.title));
        const tags = [inPacks && '<span class="mtl-have" title="Ya hay un pack con este nombre en la Biblioteca de stems">En la Biblioteca</span>',
          inSongs && '<span class="mtl-have mtl-have--song" title="Ya hay una canción con este título">Canción</span>'].filter(Boolean).join('');
        const meta = [d.artist, d.key, d.bpm && `${d.bpm} BPM`, it.kind === 'zip' ? 'ZIP' : `${it.files} pistas`, size(it.size)].filter(Boolean).join(' · ');
        return `<div class="mtl-row${admin ? ' has-check' : ''}" data-path="${esc(it.path)}">
          ${admin ? `<input type="checkbox" class="mtl-check" data-act="check" ${selected.has(it.path) ? 'checked' : ''} aria-label="Marcar ${esc(d.title)} para subir por lotes">` : ''}
          <span class="mtl-kind" aria-hidden="true" title="${it.kind === 'zip' ? 'Archivo ZIP' : `${it.files} pistas`}">${it.kind === 'zip' ? 'ZIP' : `${it.files}`}</span>
          <span class="mtl-name"><b title="${esc(it.name)}">${esc(d.title)}</b><small>${esc(meta)}</small></span>
          <span class="mtl-tags">${tags}</span>
          <span class="mtl-acts">
            <button type="button" class="vn-btn mtl-go" data-act="song" title="Crea una canción de tu biblioteca con estas pistas y su secuencia para Pads">Crear canción</button>
            ${admin ? `<button type="button" class="vn-btn mtl-go ${inPacks ? '' : 'vn-btn--primary'}" data-act="pack" title="Sube las pistas a la Biblioteca de stems (los WAV se comprimen a MP3)">${inPacks ? 'Subir otra vez' : 'Subir a la Biblioteca'}</button>` : ''}
          </span>
        </div>`;
      }).join('');
      return `<section class="mtl-root">
        <header><b title="${esc(r.root)}">${esc(r.name)}</b><small>${r.exists ? `${r.items.length} ${r.items.length === 1 ? 'multitrack' : 'multitracks'}` : 'La carpeta no está disponible (¿disco externo desconectado?)'}</small>
          <button type="button" class="mtl-link" data-act="reveal" data-path="${esc(r.root)}">Abrir carpeta</button>
          <button type="button" class="mtl-link mtl-link--danger" data-act="remove" data-root="${esc(r.root)}">Quitar</button></header>
        ${rows || `<div class="mtl-empty">${q ? 'Nada coincide con la búsqueda.' : 'No hay multitracks (subcarpetas con audios o ZIP) en esta carpeta.'}</div>`}
      </section>`;
    }).join('');
    paintBatch();
  };
  const load = async (p) => { try { data = (await p) || data; } catch (e) { window.showToast?.('No se pudo leer la carpeta: ' + ((e && e.message) || e), 'error'); } if (open) paint(); };

  async function uploadPack(target, it) {
    const pk = await api.mtlibOpen({ target });
    const d = describe(it || { name: pk.source.name });
    // Las pistas se leen del disco (o de dentro del ZIP) una a una al analizarlas.
    const files = pk.files.map((f) => ({ name: base(f.name), size: f.size, arrayBuffer: () => api.multitrackRead({ token: pk.token, id: f.id }) }));
    const { openPackUploader } = await import('./packUploader.js');
    openPackUploader({
      prefill: { title: d.title, artist: d.artist, bpm: d.bpm, key: d.key, files },
      onChanged: async () => { await loadLibrary(true); if (open) paint(); try { onUploaded && onUploaded(); } catch (_) {} },
    });
  }

  $('[data-ref="q"]').addEventListener('input', paint);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add') { const r = await api.mtlibAdd(); if (r) { data = r; paint(); } return; }
    if (act === 'remove') { load(api.mtlibRemove({ root: b.dataset.root })); return; }
    if (act === 'reveal') { api.mtlibReveal({ target: b.dataset.path }); return; }
    if (act === 'check') { const pth = b.closest('.mtl-row').dataset.path; if (b.checked) selected.add(pth); else selected.delete(pth); paintBatch(); return; }
    if (act === 'sel-none') { selected.clear(); paint(); return; }
    if (act === 'sel-missing') {
      const q = norm($('[data-ref="q"]').value);
      for (const it of data.flatMap((r) => r.items)) if ((!q || norm(it.name).includes(q)) && !packTitles.has(norm(describe(it).title))) selected.add(it.path);
      paint(); return;
    }
    if (act === 'batch') {
      const all = data.flatMap((r) => r.items);
      const targets = [...selected].map((pth) => all.find((x) => x.path === pth)).filter(Boolean).map((x) => ({ path: x.path, name: x.name, size: x.size }));
      const { openBatchUpload } = await import('./batchUpload.js');
      openBatchUpload(targets, { lib: libOverride || undefined, onDone: async () => { selected.clear(); await loadLibrary(true); if (open) paint(); try { onUploaded && onUploaded(); } catch (_) {} } });
      return;
    }
    if (act !== 'song' && act !== 'pack') return;
    const target = b.closest('.mtl-row').dataset.path;
    const it = data.flatMap((r) => r.items).find((x) => x.path === target);
    b.disabled = true;
    try {
      if (act === 'pack') { await uploadPack(target, it); return; }
      const pk = await api.mtlibOpen({ target });
      const { openPackDialog } = await import('./multitrackPack.js');
      openPackDialog(pk, { onDone: () => { if (open) paint(); } });
    } catch (err) {
      window.showToast?.('No se pudo abrir: ' + ((err && err.message) || err), 'error');
    } finally { b.disabled = false; }
  });
  await Promise.all([load(api.mtlibList()), loadLibrary()]);
  if (open) paint();
}
