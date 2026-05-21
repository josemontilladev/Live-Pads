// Stems workspace first-run tour. Renders a sequence of highlight cards
// pointing at the key controls so a new user immediately knows what each
// thing does. Stores a "seen" flag in localStorage so it only fires the
// first time, with a manual "Mostrar tutorial" entry point in the menu.

const STORAGE_KEY = 'livepads-stems-tour-seen-v1';

const STEPS = [
  {
    target: '#stems-bpm',
    title: 'BPM y compás',
    body: 'Define el tempo y la métrica de la canción. El botón <b>Detectar</b> intenta deducir el BPM desde el primer stem importado.'
  },
  {
    target: '#stems-import',
    title: 'Importar stems',
    body: 'Arrastra archivos de audio (WAV, MP3, OGG, AAC) o usa este botón. Cada uno se añade como una pista nueva con su waveform.'
  },
  {
    target: '#stems-add-click',
    title: 'Generar Click',
    body: 'Crea automáticamente una pista de click al BPM y compás actuales. Elige el sonido en el dropdown a la izquierda.'
  },
  {
    target: '#stems-section-select',
    title: 'Marcadores de sección',
    body: 'Selecciona el tipo (Verso, Coro, Puente…), reproduce la canción y pulsa <b>M</b> o <b>Añadir marcador</b> en el momento exacto. <b>Generar Guía</b> luego arma una pista vocal con todas las secciones.'
  },
  {
    target: '#stems-loop-toggle',
    title: 'Loop entre marcadores',
    body: 'Click derecho en dos marcadores → "Marcar como inicio/fin de loop". Activa este botón para repetir esa sección durante el ensayo.'
  },
  {
    target: '#stems-export',
    title: 'Exportar a MP3',
    body: 'Cuando la mezcla esté lista, exporta a un MP3 que podrás asignar como secuencia en una canción del setlist de Pads.'
  }
];

export function maybeStartTour() {
  if (localStorage.getItem(STORAGE_KEY) === '1') return;
  // Defer one frame to ensure layout is settled.
  requestAnimationFrame(() => startTour());
}
export function startTour() {
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
    const step = STEPS[idx];
    const target = document.querySelector(step.target);
    if (!target) { close(); return; }
    const rect = target.getBoundingClientRect();
    const spot = overlay.querySelector('#stems-tour-spot');
    const pad = 8;
    spot.style.left   = `${rect.left - pad}px`;
    spot.style.top    = `${rect.top - pad}px`;
    spot.style.width  = `${rect.width + pad * 2}px`;
    spot.style.height = `${rect.height + pad * 2}px`;
    overlay.querySelector('#stems-tour-step').textContent  = `Paso ${idx + 1} de ${STEPS.length}`;
    overlay.querySelector('#stems-tour-title').textContent = step.title;
    overlay.querySelector('#stems-tour-body').innerHTML    = step.body;
    overlay.querySelector('#stems-tour-prev').disabled     = idx === 0;
    overlay.querySelector('#stems-tour-next').textContent  = idx === STEPS.length - 1 ? 'Listo' : 'Siguiente';

    // Position the card near the target without falling off-screen.
    const card = overlay.querySelector('#stems-tour-card');
    requestAnimationFrame(() => {
      const cr = card.getBoundingClientRect();
      let left = rect.left;
      let top  = rect.bottom + 16;
      // Prefer below; fall back to above if the card would clip.
      if (top + cr.height > window.innerHeight - 16) top = rect.top - cr.height - 16;
      // Clamp horizontally
      if (left + cr.width > window.innerWidth - 16) left = window.innerWidth - cr.width - 16;
      if (left < 16) left = 16;
      card.style.left = `${left}px`;
      card.style.top  = `${top}px`;
    });
  };

  const close = (markSeen = true) => {
    if (markSeen) try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    overlay.remove();
    window.removeEventListener('resize', render);
  };

  overlay.querySelector('#stems-tour-skip').onclick = () => close(true);
  overlay.querySelector('#stems-tour-prev').onclick = () => { if (idx > 0) { idx--; render(); } };
  overlay.querySelector('#stems-tour-next').onclick = () => {
    if (idx < STEPS.length - 1) { idx++; render(); }
    else close(true);
  };

  window.addEventListener('resize', render);
  render();
}

export function resetTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}
