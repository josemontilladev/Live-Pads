// Perillas planas para el paneo del mezclador (tema «Consola»).
//
// No reemplazan nada: cada perilla es un mando alternativo para el MISMO
// <input type="range"> de paneo, que sigue en el DOM (oculto por CSS solo con
// el tema plano). Al girar se escribe el valor en el input y se lanza su evento
// 'input', de modo que el audio, el guardado y MIDI Learn funcionan igual.
//
// Solo se crean la primera vez que se activa un tema plano: los demás temas no
// pagan nada.

const SWEEP = 135;          // grados a cada lado del centro
const DRAG_PX = 160;        // píxeles de arrastre para recorrer todo el rango

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function paint(knob, input) {
  const min = +input.min, max = +input.max;
  const v = +nativeValue.get.call(input);
  const t = (v - min) / (max - min || 1);              // 0..1
  knob.style.setProperty('--knob-rot', ((t * 2 - 1) * SWEEP).toFixed(1) + 'deg');
  knob.setAttribute('aria-valuenow', String(v));
}

function setValue(input, v) {
  const min = +input.min, max = +input.max;
  const step = +input.step || 1;
  let n = Math.round(v / step) * step;
  n = Math.max(min, Math.min(max, n));
  // Imán en el centro: es fácil soltar «casi» en el centro con el dedo.
  if (Math.abs(n) <= 4 && min < 0 && max > 0) n = 0;
  if (n === +nativeValue.get.call(input)) return;
  input.value = String(n);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enhance(input) {
  if (input._flatKnob) return;
  const knob = document.createElement('div');
  knob.className = 'flat-knob';
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', input.getAttribute('aria-label') || 'Pan');
  knob.setAttribute('aria-valuemin', input.min);
  knob.setAttribute('aria-valuemax', input.max);
  knob.title = 'Arrastra para panear · doble toque: centro';
  input.after(knob);
  input._flatKnob = knob;

  // Cualquier cambio del input (arrastre, MIDI, carga de ajustes) mueve la perilla.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(v) { nativeValue.set.call(this, v); paint(knob, this); },
  });
  input.addEventListener('input', () => paint(knob, input));

  let startX = 0, startY = 0, startV = 0, dragging = false, lastTap = 0;
  knob.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const now = e.timeStamp;
    if (now - lastTap < 320) { setValue(input, 0); lastTap = 0; return; }   // doble toque → centro
    lastTap = now;
    dragging = true;
    startX = e.clientX; startY = e.clientY; startV = +nativeValue.get.call(input);
    knob.setPointerCapture(e.pointerId);
    knob.classList.add('is-dragging');
    e.preventDefault();
  });
  knob.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // Hacia la derecha o hacia arriba sube; lo que más se haya movido manda.
    const dx = e.clientX - startX, dy = startY - e.clientY;
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(d) > 3) lastTap = 0;
    const range = (+input.max) - (+input.min);
    setValue(input, startV + (d / DRAG_PX) * range);
  });
  const end = () => { dragging = false; knob.classList.remove('is-dragging'); };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
  knob.addEventListener('keydown', (e) => {
    const cur = +nativeValue.get.call(input);
    const big = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setValue(input, cur + big);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setValue(input, cur - big);
    else if (e.key === 'Home' || e.key === '0') setValue(input, 0);
    else return;
    e.preventDefault();
  });
  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    setValue(input, +nativeValue.get.call(input) + (e.deltaY < 0 ? 5 : -5));
  }, { passive: false });

  paint(knob, input);
}

const SELECTOR = '#mixer-bar input[type="range"].pan-slider, #stems-console-strips input[type="range"].stems-console-pan';
let watching = false;

export function ensureFlatKnobs() {
  document.querySelectorAll(SELECTOR).forEach(enhance);
  // La consola de Stems crea y borra tiras al añadir o quitar pistas: se vigila
  // solo ese contenedor (no el documento) y solo desde que se usa un tema plano.
  if (watching) return;
  const strips = document.getElementById('stems-console-strips');
  if (!strips) return;
  watching = true;
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (document.documentElement.dataset.themeStyle !== 'flat') return;
      strips.querySelectorAll('input[type="range"].stems-console-pan').forEach(enhance);
    });
  }).observe(strips, { childList: true, subtree: true });
}
