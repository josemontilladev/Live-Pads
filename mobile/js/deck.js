// Aspecto de la app de Android en el reproductor web:
//  · Consola con pestañas (Pads · Click · Mezcla): una a la vez, sin scroll largo.
//  · Relleno ámbar de la barra de posición (variable CSS --p).
// Solo envuelve los elementos existentes; la lógica de audio (app.js) no cambia.

(function () {
  const wrap = document.querySelector('.pl-panels');
  if (wrap && !wrap.querySelector('.deck-tabs')) {
    // Orden del DOM: 0 = Mezcla, 1 = Metrónomo, 2 = Pads.
    const panels = [...wrap.querySelectorAll(':scope > .panel')];
    if (panels.length === 3) {
      const defs = [['Pads', 2], ['Click', 1], ['Mezcla', 0]];
      const bar = document.createElement('div');
      bar.className = 'deck-tabs';
      bar.setAttribute('role', 'tablist');
      let current = 0;
      try { current = Math.min(2, Math.max(0, Number(sessionStorage.getItem('lpm-deck')) || 0)); } catch (_) {}
      const show = (i) => {
        current = i;
        try { sessionStorage.setItem('lpm-deck', String(i)); } catch (_) {}
        defs.forEach(([, p], k) => {
          panels[p].classList.toggle('deck-hidden', k !== i);
          bar.children[k].classList.toggle('active', k === i);
          bar.children[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
        });
      };
      defs.forEach(([label], k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'deck-tab';
        b.setAttribute('role', 'tab');
        b.textContent = label;
        b.addEventListener('click', () => show(k));
        bar.appendChild(b);
      });
      wrap.insertBefore(bar, wrap.firstChild);
      show(current);
    }
  }

  // Relleno de la barra de posición (el navegador no lo pinta solo en WebKit/Blink).
  const seek = document.getElementById('pl-seek');
  if (seek) {
    const paint = () => {
      const max = Number(seek.max) || 1000;
      seek.style.setProperty('--p', `${(Number(seek.value) / max) * 100}%`);
    };
    seek.addEventListener('input', paint);
    setInterval(paint, 250);
    paint();
  }
})();
