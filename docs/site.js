// Landing LivePads: nav con cristal al hacer scroll, aparición suave de bloques
// y enlaces de descarga dinámicos (Windows .exe y Android .apk) desde GitHub Releases.
(function () {
  var nav = document.getElementById('nav');
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 12); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var items = document.querySelectorAll('.rv');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    document.documentElement.classList.add('reduced');
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  // Descargas: el .exe de la última versión de escritorio y el .apk de la app
  // móvil (release aparte, sin marcar como "latest"). Si la API falla o aún no
  // hay APK, los enlaces de respaldo siguen funcionando (Releases / versión web).
  var REPO = 'josemontilladev/Live-Pads';
  fetch('https://api.github.com/repos/' + REPO + '/releases?per_page=15')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (list) {
      if (!Array.isArray(list)) return;
      function asset(re) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].draft || list[i].prerelease) continue;
          var a = (list[i].assets || []).filter(function (x) { return re.test(x.name); })[0];
          if (a) return { asset: a, rel: list[i] };
        }
        return null;
      }
      var exe = asset(/\.exe$/i);
      if (exe) {
        var v = (exe.rel.tag_name || '').trim();
        if (v) {
          if (v.charAt(0) !== 'v') v = 'v' + v;
          document.querySelectorAll('.js-version').forEach(function (el) { el.textContent = v; });
        }
        document.querySelectorAll('.js-download').forEach(function (el) { el.setAttribute('href', exe.asset.browser_download_url); });
      }
      var apk = asset(/\.apk$/i);
      if (apk) document.querySelectorAll('.js-apk').forEach(function (el) { el.setAttribute('href', apk.asset.browser_download_url); });
    })
    .catch(function () {});
})();

/* Precios: mensual / anual */
(function () {
  var t = document.querySelector('.price-toggle');
  if (!t) return;
  t.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-period]');
    if (!b) return;
    var p = b.getAttribute('data-period');
    t.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    document.querySelectorAll('.card.price .amount[data-month]').forEach(function (a) {
      a.querySelector('b').textContent = a.getAttribute('data-' + p);
      var s = a.querySelector('span');
      s.textContent = s.getAttribute('data-' + p);
    });
  });
})();
