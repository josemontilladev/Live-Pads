// ─────────────────────────────────────────────────────────────────────────
// Interruptores con perilla: todos los selectores de opciones (Librería /
// Servicio, Mayor / Menor, 1x / 2x, Secuencia / Click / Original, filtros…)
// se ven y se mueven como el de Pads / Stems: un riel y una perilla que se
// desliza suave bajo la opción elegida.
//
// No cambia cómo funciona cada selector: cada uno sigue marcando su opción con
// su propia clase (.is-on, .active, .on…). Aquí solo se añade la perilla
// (.seg-knob) y se coloca bajo la opción marcada. Se vigila el DOM para los
// selectores que se crean después (paneles, ventanas) y para los cambios de
// opción, sin recorrer nada mientras no cambie un selector.
// ─────────────────────────────────────────────────────────────────────────

const HOSTS = [
  '.ui-seg', '.setlist-tabs-toggle', '.metro-mult-row', '.source-seg', '.stems-click-mult',
  '.ssl-slot', '.pl-seg', '.chd-seg', '.sam-slot',
].join(',');
const OPTION = ':scope > button, :scope > [role="tab"]';
const isOn = (b) => b.matches('.is-on, .active, .on, .is-active, [aria-pressed="true"], [aria-selected="true"]');

const known = new Set();
const pending = new Map();   // host → ¿animar? (cambio de opción sí; tamaño o aparición no)
let raf = 0;
let ro = null;

function knobOf(host) {
  let k = host.querySelector(':scope > .seg-knob');
  if (!k) {
    k = document.createElement('span');
    k.className = 'seg-knob';
    k.setAttribute('aria-hidden', 'true');
    host.prepend(k);
  }
  return k;
}

function place(host, animate) {
  if (!host.isConnected) { known.delete(host); ro && ro.unobserve(host); return; }
  const opts = [...host.querySelectorAll(OPTION)];
  const on = opts.find(isOn);
  for (const b of opts) if (b.classList.contains('seg-on') !== (b === on)) b.classList.toggle('seg-on', b === on);
  const k = knobOf(host);
  if (!on || !on.offsetWidth) { host.classList.remove('has-knob'); return; }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const first = !host.classList.contains('has-knob');
  k.classList.toggle('no-anim', first || !animate);
  k.style.width = `${on.offsetWidth}px`;
  k.style.height = `${on.offsetHeight}px`;
  k.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  if (first) host.classList.add('has-knob');
}

function flush() {
  raf = 0;
  const list = [...pending];
  pending.clear();
  for (const [host, animate] of list) place(host, animate);
}
function schedule(host, animate) {
  if (!known.has(host)) { known.add(host); if (ro) ro.observe(host); animate = false; }
  pending.set(host, (pending.get(host) || false) || animate);
  if (!raf) raf = requestAnimationFrame(flush);
}

export function initSegKnobs() {
  if (initSegKnobs.done) return;
  initSegKnobs.done = true;
  ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { for (const e of entries) schedule(e.target, false); }) : null;
  document.querySelectorAll(HOSTS).forEach((h) => schedule(h, false));
  new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target;
      if (t.nodeType !== 1 || t.classList.contains('seg-knob')) continue;
      if (m.type === 'attributes') {
        if (t.matches(HOSTS)) {
          if (m.attributeName === 'class' && (m.oldValue || '').replace(/\s*has-knob/, '') === t.className.replace(/\s*has-knob/, '')) continue;
          schedule(t, false);
        } else if (t.parentElement && t.parentElement.matches(HOSTS)) {
          if (m.attributeName === 'class' && (m.oldValue || '').replace(/\s*seg-on/, '') === t.className.replace(/\s*seg-on/, '')) continue;
          schedule(t.parentElement, true);
        }
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.classList.contains('seg-knob')) continue;
        if (n.matches(HOSTS)) schedule(n, false);
        else if (n.firstElementChild) n.querySelectorAll(HOSTS).forEach((h) => schedule(h, false));
        if (t.matches && t.matches(HOSTS)) schedule(t, false);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'hidden'] });
  window.addEventListener('resize', () => known.forEach((h) => schedule(h, false)));
}
