// ─────────────────────────────────────────────────────────────────────────
// Cuenta atrás en la TV: «El servicio empieza en 05:00» y un anuncio, sobre el
// fondo de la pantalla de la letra. El estado vive en localStorage (lo comparten
// la ventana principal y la de la TV: el evento 'storage' avisa al instante).
//   { until: ms, title, msg }   ·   sin estado (o vencido) = no se muestra
// ─────────────────────────────────────────────────────────────────────────

export const CD_KEY = 'livepads.tvCountdown';

export function cdState() {
  try {
    const s = JSON.parse(localStorage.getItem(CD_KEY) || 'null');
    return s && Number(s.until) > 0 ? { until: Number(s.until), title: String(s.title || ''), msg: String(s.msg || '') } : null;
  } catch (_) { return null; }
}
export function setCdState(s) {
  try { if (s) localStorage.setItem(CD_KEY, JSON.stringify(s)); else localStorage.removeItem(CD_KEY); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('livepads:tv-countdown')); } catch (_) {}
}
/** Segundos que faltan (0 si ya pasó o no hay cuenta). */
export function cdLeft(s = cdState(), now = Date.now()) {
  return s ? Math.max(0, Math.ceil((s.until - now) / 1000)) : 0;
}
export function fmtLeft(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
}

/** En la ventana de la TV: capa a pantalla completa sobre el fondo (se repinta sola). */
export function mountTvCountdown(doc = document) {
  let box = null, timer = null;
  const paint = () => {
    const s = cdState(), left = cdLeft(s);
    if (!s || !left) {
      if (box) { box.remove(); box = null; }
      doc.body.classList.remove('has-countdown');
      clearInterval(timer); timer = null;
      return;
    }
    if (!box) {
      box = doc.createElement('div');
      box.className = 'lw-countdown';
      box.innerHTML = '<div class="lw-cd-title"></div><div class="lw-cd-time"></div><div class="lw-cd-msg"></div>';
      doc.body.appendChild(box);
      doc.body.classList.add('has-countdown');
    }
    box.querySelector('.lw-cd-title').textContent = s.title;
    box.querySelector('.lw-cd-time').textContent = fmtLeft(left);
    const msg = box.querySelector('.lw-cd-msg');
    msg.textContent = s.msg; msg.hidden = !s.msg;
    if (!timer) timer = setInterval(paint, 250);
  };
  window.addEventListener('storage', (e) => { if (e.key === CD_KEY) paint(); });
  paint();
}
