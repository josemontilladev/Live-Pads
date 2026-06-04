// Popover de "..." para las tarjetas de canción.
// Muestra acciones secundarias (editar, eliminar) sin saturar la fila visible.
//
// API:
//   openCardMoreMenu(anchorBtn, items)
//   items: [{ label, icon?, danger?, onSelect }]
//
// Solo un menú abierto a la vez. Se cierra con Escape, click fuera, scroll
// del contenedor o resize. Posicionado debajo del botón ancla; si no cabe,
// se voltea arriba.

let currentMenu = null;
let currentAnchor = null;

function close() {
  if (currentMenu) {
    currentMenu.remove();
    currentMenu = null;
  }
  if (currentAnchor) {
    currentAnchor.setAttribute('aria-expanded', 'false');
    currentAnchor = null;
  }
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('mousedown', onDocDown, true);
  window.removeEventListener('resize', close, true);
  window.removeEventListener('scroll', onScroll, true);
}

function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); }
}

function onDocDown(e) {
  if (!currentMenu) return;
  if (currentMenu.contains(e.target)) return;
  if (currentAnchor && currentAnchor.contains(e.target)) return;
  close();
}

function onScroll(e) {
  if (!currentMenu) return;
  if (currentMenu.contains(e.target)) return;
  // Cerrar solo si el contenedor que scrollea CONTIENE al ancla (el menú se
  // despega de su botón). Un scroll de otro panel —p. ej. el timeline de Stems
  // auto-siguiendo el playhead en reproducción— no debe cerrar un menú anclado
  // en la consola. Sin esto, el menú se cerraba al instante durante el play.
  const t = e.target;
  const scrolledHoldsAnchor = !!(currentAnchor && t && typeof t.contains === 'function' && t !== document && t.contains(currentAnchor));
  const isDocScroll = !t || typeof t.contains !== 'function' || t === document;
  if (scrolledHoldsAnchor || isDocScroll) close();
}

export function openCardMoreMenu(anchorBtn, items) {
  // Toggle si se vuelve a clickear el mismo ancla.
  if (currentAnchor === anchorBtn) { close(); return; }
  close();

  const menu = document.createElement('div');
  menu.className = 'card-more-menu';
  menu.setAttribute('role', 'menu');

  items.forEach(it => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-more-item' + (it.danger ? ' danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = `<span class="cmm-ico">${it.icon || ''}</span><span class="cmm-label">${it.label}</span>`;
    btn.onclick = (e) => {
      e.stopPropagation();
      close();
      try { it.onSelect(); } catch (_) {}
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  const r = anchorBtn.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = Math.min(Math.max(8, r.right - mw), vw - mw - 8);
  let top = r.bottom + 4;
  if (top + mh + 8 > vh) top = Math.max(8, r.top - mh - 4);

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  currentMenu = menu;
  currentAnchor = anchorBtn;
  anchorBtn.setAttribute('aria-expanded', 'true');

  // Suscripciones; scroll en capture para detectar cualquier ancestro.
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onDocDown, true);
  window.addEventListener('resize', close, true);
  window.addEventListener('scroll', onScroll, true);
}

export function closeCardMoreMenu() { close(); }
