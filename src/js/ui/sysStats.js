// ─────────────────────────────────────────────────────────────────────────
// Consumo en la barra superior (discreto): CPU del equipo, memoria de LivePads
// y estado del audio (cortes en el último minuto, de audio/dropoutMonitor.js).
// Sirve para saber de un vistazo si la PC va sobrada o al límite antes de
// tocar. Se actualiza cada 2 s solo con la ventana visible. Se oculta en
// pantallas estrechas y se puede quitar (clic derecho o Ctrl+K → «Consumo»).
// ─────────────────────────────────────────────────────────────────────────

const PREF = 'livepads.sysStats';
let el = null, timer = 0;

export const sysStatsOn = () => { try { return localStorage.getItem(PREF) !== '0'; } catch (_) { return true; } };
export function setSysStats(on) {
  try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (_) {}
  if (on) initSysStats(); else stop();
}

const mb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1).replace('.', ',')} GB` : `${Math.round(b / 1048576)} MB`);
const level = (v, warn, bad) => (v >= bad ? 'is-bad' : v >= warn ? 'is-warn' : '');

function meter(id, label) {
  return `<span class="sys-m" data-m="${id}"><span class="sys-l">${label}</span><span class="sys-bar"><i></i></span><b class="sys-v">—</b></span>`;
}

function stop() {
  clearInterval(timer); timer = 0;
  if (el) { el.remove(); el = null; }
}

async function tick() {
  if (!el || document.hidden) return;
  let s;
  try { s = await window.electronAPI.sysStats(); } catch (_) { return; }
  if (!el || !s) return;
  let drops = { lastMinute: 0, total: 0, supported: false };
  try { drops = (await import('../audio/dropoutMonitor.js')).dropoutStats(); } catch (_) {}
  const set = (id, frac, txt, cls, tip) => {
    const m = el.querySelector(`[data-m="${id}"]`);
    m.querySelector('i').style.width = `${Math.max(2, Math.min(100, frac * 100)).toFixed(0)}%`;
    m.querySelector('.sys-v').textContent = txt;
    m.className = `sys-m ${cls}`;
    m.title = tip;
  };
  const sysUsed = 1 - s.freeMem / s.totalMem;
  set('cpu', s.cpu / 100, `${Math.round(s.cpu)}%`, level(s.cpu, 75, 92),
    `CPU de todo el equipo: ${Math.round(s.cpu)} % (LivePads: ${Math.round(s.appCpu)} %, ${s.cores} núcleos). Por encima de ~90 % el audio puede cortarse: cierra otras apps.`);
  set('ram', s.mem / s.totalMem, mb(s.mem), level(sysUsed * 100, 85, 94),
    `Memoria de LivePads: ${mb(s.mem)}. El equipo usa ${Math.round(sysUsed * 100)} % de ${mb(s.totalMem)}.`);
  const n = drops.lastMinute || 0;
  set('audio', n ? Math.min(1, n / 5) : 1, n ? `${n} ${n === 1 ? 'corte' : 'cortes'}` : 'OK', n ? 'is-bad' : 'is-ok',
    n ? `${n} cortes de audio en el último minuto (${drops.total} en la sesión). Activa «Audio estable» en Ajustes → Audio o cierra otras apps.`
      : `Audio sin cortes en el último minuto${drops.total ? ` (${drops.total} en la sesión)` : ''}.`);
}

export function initSysStats() {
  if (el || !sysStatsOn() || !window.electronAPI?.sysStats) return;
  const anchor = document.getElementById('topbar-clock');
  if (!anchor) return;
  el = document.createElement('div');
  el.id = 'sys-stats';
  el.className = 'sys-stats';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Consumo del equipo');
  el.innerHTML = meter('cpu', 'CPU') + meter('ram', 'RAM') + meter('audio', 'Audio');
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setSysStats(false);
    window.showToast?.('Consumo oculto. Para volver a verlo: Ctrl+K → «Consumo».', 'info');
  });
  anchor.before(el);
  tick();
  timer = setInterval(tick, 2000);
}
