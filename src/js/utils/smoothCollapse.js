// ─────────────────────────────────────────────────────────────────────────
// Plegar / desplegar con animación suave del alto (misma curva y duración que la
// barra lateral de Stems: 0,32 s · cubic-bezier(0.22, 1, 0.36, 1)).
//
// smoothToggle(el, apply, collapse)
//   el       el panel que cambia de alto
//   apply(c) pone o quita el estado plegado (clases)
//   collapse true = plegar, false = desplegar
// Al plegar, el contenido sigue visible mientras se cierra y el estado se aplica
// al final; al desplegar, se aplica al principio y el panel crece hasta su alto.
// Con «reducir animaciones» del sistema, cambia al instante.
// ─────────────────────────────────────────────────────────────────────────

const DURATION = 320;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const running = new WeakMap();

const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

export function smoothToggle(el, apply, collapse, { onDone } = {}) {
  if (!el || typeof el.animate !== 'function' || reduced() || !el.offsetParent) { apply(collapse); onDone && onDone(); return; }
  const prev = running.get(el);
  if (prev) { prev.cancel(); }
  const from = el.getBoundingClientRect().height;
  // Alto final: se mide aplicando el estado un instante (sin pintar).
  apply(collapse);
  const to = el.getBoundingClientRect().height;
  if (collapse) apply(false);           // el contenido sigue a la vista mientras se cierra
  if (Math.abs(to - from) < 1) { apply(collapse); onDone && onDone(); return; }
  const oldOverflow = el.style.overflow;
  el.style.overflow = 'hidden';
  const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: EASING });
  running.set(el, anim);
  const end = (finished) => {
    if (running.get(el) !== anim) return;
    running.delete(el);
    el.style.overflow = oldOverflow;
    if (collapse && finished) apply(true);
    onDone && onDone();
  };
  anim.onfinish = () => end(true);
  anim.oncancel = () => { el.style.overflow = oldOverflow; if (running.get(el) === anim) running.delete(el); };
}
