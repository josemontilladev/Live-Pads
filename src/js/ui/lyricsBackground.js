// ─────────────────────────────────────────────────────────────────────────
// Fondos en movimiento para la letra proyectada (ventana de la TV):
//   · Fondos animados incluidos (CSS puro, sin archivos): Aurora, Atardecer,
//     Océano, Brasas, Cielo nocturno.
//   · Una imagen o un video de este equipo (en bucle y sin sonido).
//   · Oscurecido ajustable para que la letra se lea siempre.
// Preferencia «livepads.lyricsBg» = { type: 'none'|'preset'|'file', id, path, kind, dim }.
// La ventana de la letra la aplica y cambia al instante (evento 'storage').
// ─────────────────────────────────────────────────────────────────────────

export const BG_KEY = 'livepads.lyricsBg';
export const PRESETS = [
  { id: 'aurora', label: 'Aurora', css: 'linear-gradient(120deg,#0b1d3a,#1b6b74,#3b2a6b,#0b1d3a)' },
  { id: 'sunset', label: 'Atardecer', css: 'linear-gradient(120deg,#2b0f2e,#8a2e3b,#d9822b,#2b0f2e)' },
  { id: 'ocean', label: 'Océano', css: 'linear-gradient(120deg,#021526,#03396c,#005b96,#021526)' },
  { id: 'embers', label: 'Brasas', css: 'linear-gradient(120deg,#1a0500,#5c1a00,#a33b00,#1a0500)' },
  { id: 'night', label: 'Cielo nocturno', css: 'linear-gradient(120deg,#05060f,#141a3a,#2b1f4f,#05060f)' },
];

export function bgPrefs() {
  try { return { type: 'none', dim: 0.45, ...JSON.parse(localStorage.getItem(BG_KEY) || '{}') }; } catch (_) { return { type: 'none', dim: 0.45 }; }
}
export function setBgPrefs(p) {
  try { localStorage.setItem(BG_KEY, JSON.stringify({ ...bgPrefs(), ...p })); } catch (_) {}
}

const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');

/** Pinta (o quita) el fondo en un documento (la ventana de la letra). */
export function applyLyricsBackground(doc = document) {
  const p = bgPrefs();
  let layer = doc.getElementById('lw-bg');
  if (p.type === 'none' || (p.type === 'preset' && !PRESETS.some((x) => x.id === p.id)) || (p.type === 'file' && !p.path)) {
    if (layer) layer.remove();
    doc.body.classList.remove('has-lw-bg');
    return;
  }
  if (!layer) {
    layer = doc.createElement('div');
    layer.id = 'lw-bg';
    doc.body.prepend(layer);
  }
  doc.body.classList.add('has-lw-bg');
  layer.style.setProperty('--lw-dim', String(Math.max(0, Math.min(0.85, Number(p.dim) || 0))));
  if (p.type === 'preset') {
    const pr = PRESETS.find((x) => x.id === p.id);
    layer.innerHTML = `<div class="lw-bg-anim" style="background-image:${pr.css}"></div><i class="lw-bg-dim"></i>`;
  } else {
    const src = fileUrl(p.path);
    layer.innerHTML = (p.kind === 'video'
      ? `<video class="lw-bg-media" src="${src}" autoplay muted loop playsinline></video>`
      : `<div class="lw-bg-media" style="background-image:url('${src}')"></div>`) + '<i class="lw-bg-dim"></i>';
  }
}
