// Reproductor flotante (mini.html): pinta lo que le manda la app y le devuelve las órdenes.
const $ = (s) => document.querySelector(`[data-ref="${s}"]`);
const fmt = (s) => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');
const PLAY = '<polygon points="6,4 20,12 6,20"/>', PAUSE = '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>';
let st = null, at = 0;

function paint() {
  if (!st) return;
  $('title').textContent = st.title || 'LivePads';
  const sub = [st.section ? `<b>${esc(st.section)}</b>` : '', st.next ? `Siguiente: ${esc(st.next)}` : (st.key ? esc(st.key) : '')].filter(Boolean).join(' · ');
  $('sub').innerHTML = sub;
  $('icon').innerHTML = st.playing ? PAUSE : PLAY;
  document.querySelector('[data-cmd="next"]').disabled = !st.hasNext;
  const t = st.playing ? Math.min(st.dur || 0, st.t + (Date.now() - at) / 1000) : st.t;
  $('time').textContent = `${fmt(t)} / ${fmt(st.dur)}`;
  $('bar').style.width = st.dur ? `${Math.min(100, (100 * t) / st.dur)}%` : '0';
  if (st.colors) for (const [k, v] of Object.entries(st.colors)) if (v) document.documentElement.style.setProperty(k, v);
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

window.electronAPI?.onMiniState?.((s) => { st = s; at = Date.now(); paint(); });
setInterval(paint, 250);   // el tiempo avanza entre mensajes
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b && !b.disabled) window.electronAPI?.miniCmd?.(b.dataset.cmd); });
