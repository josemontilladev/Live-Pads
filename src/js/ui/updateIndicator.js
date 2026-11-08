// ─────────────────────────────────────────────────────────────────────────
// Icono de actualizaciones en la barra superior.
//
// Sigue el estado del actualizador (proceso principal, 'update-state'):
//   idle / latest → icono tenue; clic = buscar actualizaciones.
//   checking      → el icono gira.
//   downloading   → barra fina bajo el icono + porcentaje.
//   ready         → acento + «Reiniciar»; clic = reiniciar e instalar.
//   error         → punto rojo; el motivo en el título; clic = reintentar.
// Así no hace falta ir al menú para actualizar ni para ver cómo va la descarga.
// ─────────────────────────────────────────────────────────────────────────

let btn = null, pctEl = null, fillEl = null, labelEl = null;
let st = { state: 'idle' };
let latestTimer = 0;

const fmtPct = (p) => `${Math.max(0, Math.min(100, Math.floor(p || 0)))} %`;

function render() {
  if (!btn) return;
  const s = st.state || 'idle';
  btn.dataset.state = s;
  const cur = st.current ? `v${st.current}` : '';
  let title = 'Buscar actualizaciones';
  let label = '';
  if (s === 'checking') title = 'Buscando actualizaciones…';
  else if (s === 'downloading') {
    title = `Descargando la versión ${st.version || 'nueva'}… ${fmtPct(st.percent)}` +
      (st.bytesPerSecond > 0 ? ` · ${(st.bytesPerSecond / 1e6).toFixed(1)} MB/s` : '') +
      '\nSe instala al reiniciar; puedes seguir usando LivePads.';
    label = fmtPct(st.percent);
  } else if (s === 'ready') {
    title = `Versión ${st.version || 'nueva'} lista. Clic para reiniciar e instalar.`;
    label = 'Reiniciar';
  } else if (s === 'latest') title = `Ya tienes la última versión${cur ? ` (${cur})` : ''}`;
  else if (s === 'error') title = `No se pudo actualizar: ${st.message || 'error desconocido'}\nClic para reintentar.`;
  else if (cur) title = `Buscar actualizaciones (tienes la ${cur})`;
  btn.title = title;
  btn.setAttribute('aria-label', title.split('\n')[0]);
  labelEl.textContent = label;
  fillEl.style.width = s === 'downloading' ? `${Math.max(2, Math.min(100, st.percent || 0))}%` : '0%';
}

function setState(next) {
  st = next || { state: 'idle' };
  clearTimeout(latestTimer);
  // «Ya está al día» se muestra un momento y vuelve a reposo.
  if (st.state === 'latest') latestTimer = setTimeout(() => { if (st.state === 'latest') { st = { ...st, state: 'idle' }; render(); } }, 4000);
  render();
}

async function onClick() {
  const api = window.electronAPI;
  if (!api) return;
  if (st.state === 'ready') { api.installUpdate(); return; }
  if (st.state === 'checking' || st.state === 'downloading') return;
  setState({ ...st, state: 'checking' });
  try {
    const r = await api.checkForUpdates();
    if (r && r.status === 'dev') { setState({ ...st, state: 'idle' }); window.showToast?.('Las actualizaciones solo funcionan en la app instalada.', 'info'); }
    else if (r && r.status === 'error' && st.state === 'checking') setState({ ...st, state: 'error', message: r.message });
    else if (r && r.status === 'latest' && st.state === 'checking') setState({ ...st, state: 'latest' });
  } catch (e) {
    setState({ ...st, state: 'error', message: (e && e.message) || 'error desconocido' });
  }
}

export function initUpdateIndicator() {
  const api = window.electronAPI;
  btn = document.getElementById('btn-update');
  if (!btn || !api || !api.checkForUpdates) { if (btn) btn.hidden = true; return; }
  labelEl = btn.querySelector('.upd-label');
  fillEl = btn.querySelector('.upd-meter-fill');
  btn.addEventListener('click', onClick);
  if (api.onUpdateState) api.onUpdateState(setState);
  if (api.getUpdateState) api.getUpdateState().then((s) => { if (s) setState(s); }).catch(() => {});
  else render();
}

/** Para probar la interfaz sin el actualizador: window.__updState({state:'downloading', percent:40}). */
export function _testState(s) { setState(s); }
