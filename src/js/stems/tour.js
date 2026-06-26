// Guided first-run tour engine. Renders a sequence of spotlight cards that
// point at key controls. Generic: pass your own steps + a localStorage key
// so different workspaces (Stems, Pads) each get their own one-time tour.
// The default steps/key drive the Stems tour (kept for existing callers).

const STORAGE_KEY = 'livepads-stems-tour-seen-v2';

const STEPS = [
  {
    target: '#stems-bpm',
    title: 'BPM y compás',
    body: 'Define el tempo y la métrica de la canción. El botón <b>Detectar</b> deduce el BPM y el compás desde el primer stem importado.'
  },
  {
    target: '#stems-import',
    title: 'Importar stems',
    body: 'Arrastra archivos de audio (WAV, MP3, OGG, AAC) o usa este botón. Cada uno se añade como una pista nueva con su waveform.'
  },
  {
    target: '#stems-arrange',
    title: 'Recorte, fades y consola',
    body: 'Sobre cada pista de la línea de tiempo: las asas de los <b>bordes</b> recortan inicio/fin y las de las <b>esquinas</b> hacen <b>fade in/out</b> (no destructivo, respetado al exportar). Abajo, la <b>consola</b> mezcla volumen, paneo, mute y solo de cada stem.'
  },
  {
    target: '#stems-add-click',
    title: 'Click inteligente',
    body: 'Genera una pista de click al BPM/compás actuales que se <b>alinea sola</b> al pulso de la canción. Elige el sonido en el dropdown.'
  },
  {
    target: '#stems-section-select',
    title: 'Marcadores de sección',
    body: 'Selecciona el tipo (Verso, Coro, Puente…), reproduce y pulsa <b>M</b> o <b>Añadir marcador</b> en el momento exacto. <b>Generar Guía</b> arma una pista vocal con las secciones.'
  },
  {
    target: '#stems-loop-toggle',
    title: 'Loop entre marcadores',
    body: 'Click derecho en dos marcadores → "Marcar como inicio/fin de loop". Activa este botón para repetir esa sección durante el ensayo.'
  },
  {
    target: '#stems-export',
    title: 'Exportar a MP3',
    body: 'Cuando la mezcla esté lista, exporta a MP3 para asignarla como secuencia en una canción del setlist de Pads.'
  }
];

export function maybeStartTour(storageKey = STORAGE_KEY, steps = STEPS) {
  if (localStorage.getItem(storageKey) === '1') return;
  // Defer one frame to ensure layout is settled.
  requestAnimationFrame(() => startTour(steps, storageKey));
}

export function startTour(steps = STEPS, storageKey = STORAGE_KEY) {
  let idx = 0;
  const overlay = document.createElement('div');
  overlay.className = 'stems-tour';
  overlay.innerHTML = `
    <div class="stems-tour-spot" id="stems-tour-spot" aria-hidden="true"></div>
    <div class="stems-tour-card" id="stems-tour-card">
      <span class="stems-tour-step" id="stems-tour-step"></span>
      <h3 id="stems-tour-title"></h3>
      <p id="stems-tour-body"></p>
      <div class="stems-tour-actions">
        <button class="stems-btn stems-btn--subtle" id="stems-tour-skip">Saltar</button>
        <button class="stems-btn" id="stems-tour-prev">Atrás</button>
        <button class="stems-btn stems-btn--accent" id="stems-tour-next">Siguiente</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const render = () => {
    // Skip steps whose target isn't on screen (e.g. a button that only
    // exists once a track is loaded) so the tour never points at nothing.
    let guard = 0;
    while (idx < steps.length && !document.querySelector(steps[idx].target) && guard++ < steps.length) idx++;
    if (idx >= steps.length) { close(); return; }
    const step = steps[idx];
    const target = document.querySelector(step.target);
    if (!target) { close(); return; }
    const rect = target.getBoundingClientRect();
    const spot = overlay.querySelector('#stems-tour-spot');
    const pad = 8;
    spot.style.left   = `${rect.left - pad}px`;
    spot.style.top    = `${rect.top - pad}px`;
    spot.style.width  = `${rect.width + pad * 2}px`;
    spot.style.height = `${rect.height + pad * 2}px`;
    overlay.querySelector('#stems-tour-step').textContent  = `Paso ${idx + 1} de ${steps.length}`;
    overlay.querySelector('#stems-tour-title').textContent = step.title;
    overlay.querySelector('#stems-tour-body').innerHTML    = step.body;
    overlay.querySelector('#stems-tour-prev').disabled     = idx === 0;
    overlay.querySelector('#stems-tour-next').textContent  = idx === steps.length - 1 ? 'Listo' : 'Siguiente';

    // Position the card near the target without falling off-screen.
    const card = overlay.querySelector('#stems-tour-card');
    requestAnimationFrame(() => {
      const cr = card.getBoundingClientRect();
      let left = rect.left;
      let top  = rect.bottom + 16;
      if (top + cr.height > window.innerHeight - 16) top = rect.top - cr.height - 16;
      if (top < 16) top = 16;
      if (left + cr.width > window.innerWidth - 16) left = window.innerWidth - cr.width - 16;
      if (left < 16) left = 16;
      card.style.left = `${left}px`;
      card.style.top  = `${top}px`;
    });
  };

  const close = (markSeen = true) => {
    if (markSeen) try { localStorage.setItem(storageKey, '1'); } catch (e) {}
    overlay.remove();
    window.removeEventListener('resize', render);
  };

  overlay.querySelector('#stems-tour-skip').onclick = () => close(true);
  overlay.querySelector('#stems-tour-prev').onclick = () => { if (idx > 0) { idx--; render(); } };
  overlay.querySelector('#stems-tour-next').onclick = () => {
    if (idx < steps.length - 1) { idx++; render(); }
    else close(true);
  };

  window.addEventListener('resize', render);
  render();
}

export function resetTour(storageKey = STORAGE_KEY) {
  try { localStorage.removeItem(storageKey); } catch (e) {}
}
