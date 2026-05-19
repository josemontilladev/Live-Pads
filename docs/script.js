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
})();
