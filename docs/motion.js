// Capa de movimiento de la landing: scroll suave (Lenis) + animaciones ligadas al scroll
// (GSAP + ScrollTrigger). Es opcional: sin librerías, sin JS o con "reducir movimiento"
// la página queda exactamente como antes (la aparición básica vive en site.js).
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !window.gsap || !window.ScrollTrigger) return;

  var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  var html = document.documentElement;
  html.classList.add('gsap');                       // desactiva la transición CSS de .rv
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var narrow = window.matchMedia('(max-width: 760px)').matches;

  // ── Scroll suave ────────────────────────────────────────────────────────
  var lenis = null;
  if (window.Lenis) {
    lenis = new window.Lenis({ duration: 1.15, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id.length < 2) return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -70, duration: 1.4 });
      });
    });
  }

  // ── Barra de progreso de lectura ────────────────────────────────────────
  var bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);
  gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.2 } });

  // ── Nav: se esconde al bajar y vuelve al subir ──────────────────────────
  var nav = document.getElementById('nav');
  if (nav) {
    ScrollTrigger.create({
      start: 120,
      end: 'max',
      onUpdate: function (self) {
        gsap.to(nav, { yPercent: self.direction === 1 && self.scroll() > 240 ? -110 : 0, duration: 0.35, ease: 'power2.out', overwrite: true });
      },
    });
  }

  // ── Hero: titular palabra por palabra + entrada escalonada ─────────────
  var h1 = document.querySelector('.hero h1');
  if (h1) {
    var words = [];
    (function split(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var o = document.createElement('span'); o.className = 'w-o';
            var i = document.createElement('span'); i.className = 'w-i'; i.textContent = part;
            o.appendChild(i); frag.appendChild(o); words.push(i);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) { split(n); }
      });
    })(h1);
    h1.classList.add('split-ready');
    gsap.set(h1, { opacity: 1, y: 0, clearProps: 'transform' });
    gsap.from(words, { yPercent: 115, rotate: 4, opacity: 0, duration: 1, ease: 'power4.out', stagger: 0.07, delay: 0.1 });
  }
  gsap.from('.hero .pill, .hero .lede, .hero .cta-row, .hero .fine', { y: 28, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, delay: 0.45 });

  // Escenario del hero: la ventana "se asienta" al bajar y el teléfono flota a otra velocidad.
  var stage = document.querySelector('.hero .stage');
  if (stage) {
    var win = stage.querySelector('.win'), ph = stage.querySelector('.phone');
    gsap.set(stage, { opacity: 1, y: 0 });
    gsap.fromTo(win, { rotateX: 9, scale: 0.94, y: 40, transformPerspective: 1200 }, {
      rotateX: 0, scale: 1, y: 0, ease: 'none',
      scrollTrigger: { trigger: stage, start: 'top 95%', end: 'top 35%', scrub: 0.6 },
    });
    if (ph) gsap.to(ph, { y: narrow ? -20 : -70, ease: 'none', scrollTrigger: { trigger: stage, start: 'top 80%', end: 'bottom top', scrub: 0.8 } });
    gsap.to('.hero', { '--glow-y': '-80px', ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  }

  // ── Revelado general (reemplaza el de CSS) ──────────────────────────────
  var seen = new Set();
  ScrollTrigger.batch('.rv', {
    start: 'top 90%',
    once: true,
    onEnter: function (els) {
      els = els.filter(function (el) { return !el.closest('.hero'); });
      els.forEach(function (el) { el.classList.add('in'); seen.add(el); });
      gsap.fromTo(els, { y: 46, opacity: 0, scale: 0.985 }, { y: 0, opacity: 1, scale: 1, duration: 1, ease: 'power3.out', stagger: 0.09, overwrite: true, clearProps: 'transform,opacity' });
    },
  });
  // Lo que ya está dentro del hero no debe quedar oculto por CSS.
  document.querySelectorAll('.hero .rv').forEach(function (el) { el.classList.add('in'); });

  // ── Cabeceras de sección: etiqueta, título y subtítulo en cascada ──────
  gsap.utils.toArray('.head-c, .split-copy').forEach(function (box) {
    var parts = box.querySelectorAll('.eyebrow, h2, .sub');
    if (!parts.length) return;
    gsap.from(parts, { y: 30, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: box, start: 'top 82%', once: true } });
  });

  // ── Barras de secciones y de stems: crecen al entrar ────────────────────
  gsap.utils.toArray('.secbar, .secnames').forEach(function (el) {
    gsap.from(el.children, { scaleX: 0, transformOrigin: 'left center', opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });
  gsap.utils.toArray('.stemrow i').forEach(function (el, i) {
    gsap.from(el, { scaleX: 0, transformOrigin: 'left center', duration: 1.1, ease: 'power3.out', delay: (i % 5) * 0.08, scrollTrigger: { trigger: el, start: 'top 92%', once: true } });
  });
  gsap.utils.toArray('.keys .key').forEach(function (el, i) {
    gsap.from(el, { y: 14, opacity: 0, duration: 0.5, ease: 'back.out(2)', delay: i * 0.03, scrollTrigger: { trigger: el.parentNode, start: 'top 92%', once: true } });
  });

  // ── Capturas en ventana: acercamiento suave ligado al scroll ────────────
  gsap.utils.toArray('#stems .win').forEach(function (w) {
    gsap.fromTo(w, { scale: 0.93, y: 30 }, { scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: w, start: 'top 95%', end: 'top 40%', scrub: 0.6 } });
  });

  // ── Teléfonos de la app móvil: se abren en abanico y suben a distinto ritmo ──
  var phones = gsap.utils.toArray('.phones .phone');
  if (phones.length === 3 && !narrow) {
    var tl = gsap.timeline({ scrollTrigger: { trigger: '.phones', start: 'top 88%', end: 'top 25%', scrub: 0.8 } });
    tl.from(phones[0], { x: 150, rotation: 4, opacity: 0.4, ease: 'none' }, 0)
      .from(phones[2], { x: -150, rotation: -4, opacity: 0.4, ease: 'none' }, 0)
      .from(phones[1], { y: 90, ease: 'none' }, 0);
    gsap.to(phones[0], { y: -34, ease: 'none', scrollTrigger: { trigger: '.mobile', start: 'top bottom', end: 'bottom top', scrub: 1 } });
    gsap.to(phones[2], { y: -56, ease: 'none', scrollTrigger: { trigger: '.mobile', start: 'top bottom', end: 'bottom top', scrub: 1.2 } });
  } else if (phones.length) {
    gsap.from(phones, { y: 60, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.15, scrollTrigger: { trigger: '.phones', start: 'top 88%', once: true } });
  }

  // ── Flujo: la línea de tiempo se llena con el scroll y enciende cada paso ──
  var track = document.querySelector('.steps-track');
  if (track) {
    var fill = track.querySelector('i'), dots = track.querySelectorAll('b'), cards = document.querySelectorAll('.steps .step');
    ScrollTrigger.create({
      trigger: '.steps', start: 'top 80%', end: 'bottom 55%', scrub: 0.4,
      onUpdate: function (self) {
        gsap.set(fill, { scaleX: self.progress });
        [0.1, 0.5, 0.9].forEach(function (th, i) {
          var on = self.progress >= th * 0.9;
          if (dots[i]) dots[i].classList.toggle('on', on);
          if (cards[i]) cards[i].classList.toggle('on', on);
        });
      },
    });
  }

  // ── Cifras: cuentan hasta su valor al entrar ───────────────────────────
  gsap.utils.toArray('.stat b[data-count]').forEach(function (el) {
    var end = parseInt(el.dataset.count, 10) || 0, o = { v: 0 };
    el.textContent = '0';
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: function () { gsap.to(o, { v: end, duration: 1.4, ease: 'power2.out', onUpdate: function () { el.textContent = Math.round(o.v); } }); },
    });
  });

  // ── Menú: marca la sección que estás viendo ─────────────────────────────
  var links = document.querySelectorAll('.nav-links a[href^="#"]');
  links.forEach(function (a) {
    var sec = document.querySelector(a.getAttribute('href'));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec, start: 'top 45%', end: 'bottom 45%',
      onToggle: function (self) { a.classList.toggle('active', self.isActive); },
    });
  });

  // ── Títulos de sección: se revelan palabra por palabra ─────────────────
  gsap.utils.toArray('.head-c h2, .split-copy h2, .final-card h2').forEach(function (h) {
    if (h.dataset.split) return;
    h.dataset.split = '1';
    var ws = [];
    (function split(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var o = document.createElement('span'); o.className = 'w-o';
            var i = document.createElement('span'); i.className = 'w-i'; i.textContent = part;
            o.appendChild(i); frag.appendChild(o); ws.push(i);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) { split(n); }
      });
    })(h);
    gsap.from(ws, { yPercent: 110, opacity: 0, duration: 0.9, ease: 'power4.out', stagger: 0.05, scrollTrigger: { trigger: h, start: 'top 88%', once: true } });
  });

  // ── Preguntas frecuentes: apertura con altura animada ──────────────────
  document.querySelectorAll('.faq details').forEach(function (d) {
    var sum = d.querySelector('summary'), body = d.querySelector('p');
    if (!sum || !body) return;
    sum.addEventListener('click', function (e) {
      e.preventDefault();
      if (d.open) {
        gsap.to(body, { height: 0, opacity: 0, duration: 0.3, ease: 'power2.inOut', onComplete: function () { d.open = false; gsap.set(body, { clearProps: 'height,opacity' }); } });
      } else {
        d.open = true;
        gsap.fromTo(body, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.4, ease: 'power2.out', onComplete: function () { gsap.set(body, { clearProps: 'height' }); } });
      }
    });
  });

  // ── Tarjeta final: entra con escala y el brillo sigue al scroll ─────────
  var fin = document.querySelector('.final-card');
  if (fin) {
    gsap.fromTo(fin, { scale: 0.92, y: 50 }, { scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: fin, start: 'top 95%', end: 'top 50%', scrub: 0.6 } });
    var lg = fin.querySelector('.lg');
    if (lg) gsap.to(lg, { rotation: 360, ease: 'none', scrollTrigger: { trigger: fin, start: 'top bottom', end: 'bottom top', scrub: 1 } });
  }

  // ── Interacción con el cursor (solo con ratón) ──────────────────────────
  if (fine) {
    // Resplandor que sigue al cursor dentro de cada tarjeta.
    document.querySelectorAll('.card, .plat, .mini').forEach(function (c) {
      c.classList.add('spot');
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
    // El escenario del hero se inclina un poco con el ratón.
    if (stage) {
      var win2 = stage.querySelector('.win');
      var rx = gsap.quickTo(stage, 'rotationY', { duration: 0.8, ease: 'power3' });
      var ry = gsap.quickTo(stage, 'rotationX', { duration: 0.8, ease: 'power3' });
      gsap.set(stage, { transformPerspective: 1400 });
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect();
        rx(((e.clientX - r.left) / r.width - 0.5) * 6);
        ry(-((e.clientY - r.top) / r.height - 0.5) * 4);
      });
      stage.addEventListener('pointerleave', function () { rx(0); ry(0); });
      void win2;
    }
  }

  // Recalcula posiciones cuando cargan las imágenes (cambian las alturas).
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
