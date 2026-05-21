// Minimal landing page script.
// - Adds .scrolled class to the nav once the user scrolls past 12px so
//   the bar gets a backdrop blur + bottom border (premium glass effect).
// - Intersection-observer-based reveal-on-scroll for sections, so cards
//   fade in as they enter the viewport instead of appearing all at once.
//
// No frameworks, no build step. Works directly on GitHub Pages.

(() => {
  const nav = document.getElementById('nav');
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Reveal-on-scroll. Honour prefers-reduced-motion: skip animation
  // entirely so the content is visible from the start.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          observer.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

    document.querySelectorAll('.feature-card, .persona-card, .shortcut-card, .tour-row, .faq-item')
      .forEach(el => {
        el.classList.add('reveal');
        observer.observe(el);
      });
  } else {
    // Reduced motion or unsupported → mark everything visible immediately.
    document.querySelectorAll('.feature-card, .persona-card, .shortcut-card, .tour-row, .faq-item')
      .forEach(el => el.classList.add('is-visible'));
  }

  // Live release wiring — read the latest published GitHub release and:
  //   • update every [data-app-version] label to the real version,
  //   • point [data-download] links at the actual .exe and drop their
  //     "Próximamente" interception so they download directly,
  //   • point [data-github] links at the repo.
  // Fails silently (offline / API limit) → links keep the "soon" fallback.
  const REPO = 'josemontilladev/Live-Pads';
  document.querySelectorAll('[data-github]').forEach(a => {
    a.href = `https://github.com/${REPO}`;
    a.target = '_blank'; a.rel = 'noopener';
    a.removeAttribute('data-soon');
  });
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then(r => (r.ok ? r.json() : null))
    .then(rel => {
      if (!rel) return;
      const ver = (rel.tag_name || '').replace(/^v/, '');
      if (ver) document.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = `v${ver}`; });
      const exe = (rel.assets || []).find(a => /\.exe$/i.test(a.name));
      if (exe) {
        document.querySelectorAll('[data-download]').forEach(a => {
          a.href = exe.browser_download_url;
          a.removeAttribute('data-soon'); // let it download instead of opening the modal
        });
      }
    })
    .catch(() => {});

  // "Próximamente" modal — intercept any [data-soon] link until the binary
  // and public repo are ready. Dismiss via × / backdrop / Esc / OK button.
  const soonModal = document.getElementById('soon-modal');
  if (soonModal) {
    const openSoon = () => {
      soonModal.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    const closeSoon = () => {
      soonModal.hidden = true;
      document.body.style.overflow = '';
    };
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-soon]');
      if (trigger) { e.preventDefault(); openSoon(); return; }
      if (!soonModal.hidden && e.target.closest('[data-close]')) {
        e.preventDefault();
        closeSoon();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!soonModal.hidden && e.key === 'Escape') closeSoon();
    });
  }
})();
