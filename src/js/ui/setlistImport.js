// ─────────────────────────────────────────────────────────────────────────
// Importar un setlist desde una foto, un PDF o texto (menú ⋯ del servicio y Buscador).
//   1) Arrastras la foto de WhatsApp o el PDF, lo pegas (Ctrl+V) o pegas el texto.
//   2) Se lee EN ESTE PC: texto del PDF con pdf.js; fotos (y PDF escaneados) con
//      Tesseract. El idioma (español + inglés) se descarga una vez (~10 MB) y queda guardado.
//   3) Revisas la lista: cada canción con su tono y si está en tu librería (o se crea).
//   4) «Crear servicio»: con la fecha y el nombre del mensaje y los tonos del día.
// La interpretación del texto está en data/setlistImportCore.js.
// ─────────────────────────────────────────────────────────────────────────

import { parseSetlistText, matchEntries } from '../data/setlistImportCore.js';
import { getSongs } from '../state/store.js';
import { createNewSetlist, setKeyOverride } from '../data/service.js';
import { requireRoom } from '../billing/license.js';
import { renderGiList } from './giList.js';
import { pushModal } from './modalStack.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NM = (p) => new URL('../../../node_modules/' + p, import.meta.url).href;

// ── Leer archivos ──────────────────────────────────────────────────────────
async function ocr(images, onProgress) {
  const mod = await import(NM('tesseract.js/dist/tesseract.esm.min.js'));
  const T = mod.createWorker ? mod : mod.default;
  const worker = await T.createWorker(['spa', 'eng'], 1, {
    workerPath: NM('tesseract.js/dist/worker.min.js'),
    corePath: NM('tesseract.js-core/'),
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(`Leyendo el texto… ${Math.round(m.progress * 100)} %`);
      else if (/loading language|downloading/i.test(m.status)) onProgress('Preparando el idioma (solo la primera vez, ~10 MB)…');
      else if (/initializ/i.test(m.status)) onProgress('Preparando el lector…');
    },
  });
  try {
    let text = '';
    for (const img of images) { const r = await worker.recognize(img); text += (r && r.data && r.data.text ? r.data.text : '') + '\n'; }
    return text;
  } finally { try { await worker.terminate(); } catch (_) {} }
}

async function readPdf(file, onProgress) {
  const pdfjs = await import(NM('pdfjs-dist/build/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = NM('pdfjs-dist/build/pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  let text = '';
  const pages = Math.min(doc.numPages, 4);
  for (let i = 1; i <= pages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    // Rehacer las líneas: cada trozo con su altura; salto de línea al cambiar de altura.
    let lastY = null;
    for (const it of tc.items) { const y = it.transform ? Math.round(it.transform[5]) : null; if (lastY != null && y != null && Math.abs(y - lastY) > 2) text += '\n'; else if (text && !text.endsWith('\n')) text += ' '; text += it.str; lastY = y; }
    text += '\n';
  }
  if (text.replace(/\s+/g, '').length > 15) return text;
  // PDF escaneado (solo imagen): se pasa por el lector de fotos.
  onProgress('El PDF es una imagen: leyéndolo como foto…');
  const canvases = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    canvases.push(c);
  }
  return ocr(canvases, onProgress);
}

async function readFile(file, onProgress) {
  const name = String(file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return readPdf(file, onProgress);
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|gif|heic)$/.test(name)) return ocr([file], onProgress);
  if (/^text\//.test(file.type) || /\.(txt|md|csv)$/.test(name)) return file.text();
  throw new Error('Ese archivo no es una foto, un PDF ni un texto.');
}

// ── Crear el servicio ──────────────────────────────────────────────────────
export function createFromEntries({ name, date, entries }) {
  const lib = getSongs();
  const chosen = entries.filter((e) => e.include && e.title.trim());
  const fresh = chosen.filter((e) => !e.song);
  if (fresh.length && !requireRoom('songs', lib.length, fresh.length, `Esta lista trae ${fresh.length} ${fresh.length === 1 ? 'canción nueva' : 'canciones nuevas'} y el plan Gratis permite hasta 10 en la librería.`)) return null;
  const now = Date.now();
  const songs = chosen.map((e, i) => {
    if (e.song) return e.song;
    const s = { id: `song_list_${now}_${i}`, title: e.title.trim(), artist: (e.artist || '').trim(), key: e.key || '', bpm: '', genre: 'adoracion', tags: [], addedAt: now, timeSig: '4/4', audio: { sequence: null, original: null } };
    lib.push(s);
    return s;
  });
  try { window.electronAPI?.saveGiSetlist?.(lib); } catch (_) {}
  try { renderGiList(document.getElementById('gi-search')?.value || ''); } catch (_) {}
  window.dispatchEvent(new CustomEvent('livepads:songs-changed'));
  window.dispatchEvent(new CustomEvent('livepads:cloud-dirty'));
  createNewSetlist(name || 'Servicio', date || null, songs);
  chosen.forEach((e, i) => { const s = songs[i]; if (e.key && s.key && e.key !== s.key) setKeyOverride(s, e.key); });
  document.querySelector('.s-toggle[data-target="service-setlist-list"]')?.click();
  return { total: songs.length, added: fresh.length };
}

// ── Ventana ────────────────────────────────────────────────────────────────
export function openSetlistImport() {
  if (document.getElementById('sli-box')) return;
  const ov = document.createElement('div');
  ov.className = 'vn-overlay';
  ov.innerHTML = `<div class="vn-box sli-box" id="sli-box" role="dialog" aria-modal="true" aria-label="Importar un setlist">
    <div class="vn-head"><b>Importar un setlist</b><span>Desde la foto o el PDF que mandó el líder, o pegando el texto. Se lee en este equipo: no se envía a nadie.</span></div>
    <div class="sli-body" data-ref="body"></div>
    <div class="vn-actions"><button type="button" class="vn-btn" data-act="close">Cerrar</button><button type="button" class="vn-btn" data-act="back" hidden>Otra lista</button><button type="button" class="vn-btn vn-btn--primary" data-act="create" hidden>Crear servicio</button></div>
  </div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const close = () => { pop(); ov.remove(); };
  const pop = pushModal(close, ov);
  const S = { step: 'input', busy: '', error: '', text: '', name: '', date: '', entries: [] };

  function paint() {
    const body = $('[data-ref="body"]');
    $('[data-act="create"]').hidden = S.step !== 'review' || !S.entries.some((e) => e.include);
    $('[data-act="back"]').hidden = S.step !== 'review';
    if (S.step === 'input') {
      body.innerHTML = `<div class="sli-drop" data-ref="drop" tabindex="0">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>
          <b>${S.busy ? esc(S.busy) : 'Arrastra aquí la foto o el PDF, o pégala con Ctrl+V'}</b>
          ${S.busy ? '' : '<button type="button" class="vn-btn" data-act="pick">Elegir archivo…</button>'}
        </div>
        <label class="vn-field">O pega el texto de la lista<textarea data-ref="text" rows="7" placeholder="1. Adiós al ayer (Ab)&#10;2. Way Maker - G&#10;3. Cuán grande es Él en Sib">${esc(S.text)}</textarea></label>
        <div class="proj-test"><button type="button" class="vn-btn" data-act="readtext" ${S.busy ? 'disabled' : ''}>Leer la lista</button><span class="is-bad" aria-live="polite">${esc(S.error)}</span></div>
        <input type="file" data-ref="file" accept="image/*,.pdf,.txt" hidden>`;
      return;
    }
    const lib = S.entries;
    body.innerHTML = `<div class="sli-meta"><label class="vn-field">Servicio <input data-m="name" value="${esc(S.name)}" placeholder="Domingo"></label><label class="vn-field">Fecha <input data-m="date" type="date" value="${esc(S.date || '')}"></label></div>
      <p class="proj-hint">${lib.length} ${lib.length === 1 ? 'canción encontrada' : 'canciones encontradas'}. Corrige lo que se leyó mal; las que no están en tu librería se crearán (sin audio).</p>
      <ul class="sli-list">${lib.map((e, i) => `<li class="${e.include ? '' : 'is-off'}">
          <input type="checkbox" data-inc="${i}" ${e.include ? 'checked' : ''} aria-label="Incluir">
          <input class="sli-title" data-e="${i}" data-k="title" value="${esc(e.title)}" aria-label="Título">
          <input class="sli-key" data-e="${i}" data-k="key" value="${esc(e.key)}" placeholder="Tono" aria-label="Tono" maxlength="4">
          <span class="pco-badge${e.song ? '' : ' is-new'}" title="${e.song ? esc('En tu librería: ' + e.song.title) : 'Se creará en tu librería'}">${e.song ? 'En tu librería' : 'Nueva'}</span>
        </li>`).join('')}</ul>`;
  }

  function review(text) {
    const r = parseSetlistText(text);
    if (!r.items.length) { S.error = 'No encontré canciones en ese texto. Comprueba que se lea bien o pégalo a mano.'; S.busy = ''; paint(); return; }
    S.name = r.name || 'Servicio'; S.date = r.date || ''; S.error = ''; S.busy = '';
    S.entries = matchEntries(getSongs(), r.items).map((e) => ({ ...e, include: true }));
    S.step = 'review'; paint();
  }

  async function handleFile(file) {
    if (!file || S.busy) return;
    S.error = ''; S.busy = 'Abriendo el archivo…'; paint();
    try {
      const text = await readFile(file, (msg) => { S.busy = msg; const b = ov.querySelector('.sli-drop b'); if (b) b.textContent = msg; });
      S.text = text.trim();
      review(S.text);
    } catch (err) {
      S.busy = ''; S.error = /fetch|network|Failed to/i.test(String(err && err.message)) ? 'No se pudo descargar el idioma del lector (hace falta internet la primera vez).' : 'No se pudo leer: ' + ((err && err.message) || err);
      paint();
    }
  }

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) { close(); return; }
    if (e.target.closest('[data-act="pick"]')) { $('[data-ref="file"]').click(); return; }
    if (e.target.closest('[data-act="readtext"]')) { S.text = $('[data-ref="text"]').value; review(S.text); return; }
    if (e.target.closest('[data-act="back"]')) { S.step = 'input'; paint(); return; }
    if (e.target.closest('[data-act="create"]')) {
      const r = createFromEntries({ name: S.name, date: S.date, entries: S.entries });
      if (!r) return;
      close();
      window.showToast?.(`✓ Servicio «${S.name || 'Servicio'}» creado: ${r.total} ${r.total === 1 ? 'canción' : 'canciones'}${r.added ? ` · ${r.added} nueva${r.added === 1 ? '' : 's'} en la librería (sin audio)` : ''}.`, 'success', { ttl: 9000 });
    }
  });
  ov.addEventListener('change', (e) => {
    if (e.target.dataset.ref === 'file') { handleFile(e.target.files && e.target.files[0]); return; }
    const inc = e.target.dataset.inc;
    if (inc != null) { S.entries[+inc].include = e.target.checked; paint(); }
  });
  ov.addEventListener('input', (e) => {
    const i = e.target.dataset.e, k = e.target.dataset.k, m = e.target.dataset.m;
    if (m) { S[m] = e.target.value; return; }
    if (i == null) return;
    S.entries[+i][k] = e.target.value.trim();
    if (k === 'title') { const [re] = matchEntries(getSongs(), [S.entries[+i]]); S.entries[+i].song = re.song; const b = e.target.parentElement.querySelector('.pco-badge'); if (b) { b.textContent = re.song ? 'En tu librería' : 'Nueva'; b.classList.toggle('is-new', !re.song); } }
  });
  ov.addEventListener('dragover', (e) => { e.preventDefault(); ov.querySelector('.sli-drop')?.classList.add('is-over'); });
  ov.addEventListener('dragleave', () => ov.querySelector('.sli-drop')?.classList.remove('is-over'));
  ov.addEventListener('drop', (e) => { e.preventDefault(); ov.querySelector('.sli-drop')?.classList.remove('is-over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
  ov.addEventListener('paste', (e) => {
    if (S.step !== 'input') return;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const img = items.find((x) => x.kind === 'file');
    if (img) { e.preventDefault(); handleFile(img.getAsFile()); }
  });
  paint();
  setTimeout(() => ov.querySelector('.sli-drop')?.focus(), 50);
}
