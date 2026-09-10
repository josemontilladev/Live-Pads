// Muestra la versión instalada bajo el logo del preloader, antes de que
// cargue app.js. Script clásico (no módulo) para que pinte lo antes posible.
(function () {
  try {
    window.electronAPI && window.electronAPI.getAppVersion &&
    window.electronAPI.getAppVersion().then(function (v) {
      var el = document.getElementById('preloader-version');
      if (el && v) el.textContent = 'v' + v;
    }).catch(function () {});
  } catch (e) {}
})();
