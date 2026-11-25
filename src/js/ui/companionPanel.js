// Companion panel — Start/stop the LAN viewer server and surface its URL
// + connected-client count. Triggered from the hamburger menu.
//
// QR code generation lands in Fase 3; for now we show the URL as plain text
// (selectable + copy button) so phones can type it manually.

import { pushModal } from './modalStack.js';

let mounted = null;
let popModal = null;
let pollTimer = null;
let lastQrUrl = null; // cache so we only regenerate the SVG when the URL changes
let serverStartedAt = 0; // ms timestamp — used to show the firewall hint after 8s of zero clients
// Modo del QR: 'cloud' (por internet, por defecto) o 'wifi' (misma red, sin internet).
const MODE_KEY = 'livepads.companionMode';
const getMode = () => { try { return localStorage.getItem(MODE_KEY) === 'wifi' ? 'wifi' : 'cloud'; } catch (_) { return 'cloud'; } };

const SVG_CLOSE = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_COPY  = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

// { mount }: pintar como sección dentro de ese contenedor (sin velo ni Esc).
export function openCompanionPanel({ mount = null } = {}) {
  if (mounted) return;
  if (!window.electronAPI || !window.electronAPI.companionStatus) {
    console.warn('Companion API not exposed via preload');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'companion-overlay';
  overlay.innerHTML = `
    <div class="cp-panel" role="dialog" aria-modal="true" aria-labelledby="cp-title">
      <div class="cp-header">
        <h3 id="cp-title">Companion (móvil)</h3>
        <button class="cp-close ui-close" type="button" aria-label="Cerrar">${SVG_CLOSE}</button>
      </div>
      <p class="cp-subtitle">La letra y los acordes de lo que suena, en el móvil de cada músico.</p>

      <div class="cp-mode ui-seg" role="group" aria-label="Cómo se conectan los móviles">
        <button type="button" class="ui-seg-btn" data-mode="cloud">Por internet</button>
        <button type="button" class="ui-seg-btn" data-mode="wifi" title="Los móviles en la misma WiFi que el portátil, sin internet">WiFi local</button>
      </div>
      <p class="cp-mode-tip" data-ref="modeTip"></p>

      <div class="cp-wifi-only cp-hotspot-row">
        <button class="cp-hotspot-btn" id="cp-softap" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13" style="vertical-align:-2px;margin-right:4px"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>Crear red WiFi local (sin internet)</button>
        <span class="cp-hotspot-tip">La laptop emite la red <b>LivePads</b> (clave <b>livepads2026</b>). Conecta los teléfonos a esa red y escanea el QR. No requiere internet.</span>
      </div>
      <div class="cp-wifi-only cp-hotspot-row">
        <button class="cp-hotspot-btn" id="cp-hotspot" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13" style="vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Hotspot de Windows (si hay internet)</button>
        <span class="cp-hotspot-tip">Alternativa: abre los ajustes de Windows (solo funciona si la laptop tiene internet que compartir).</span>
      </div>

      <div class="cp-status" data-running="false">
        <span class="cp-dot"></span>
        <span class="cp-status-label">Apagado</span>
      </div>

      <div class="cp-qr" id="cp-qr" hidden>
        <div class="cp-qr-frame" id="cp-qr-frame"></div>
        <p class="cp-qr-caption">Escanea con la cámara del teléfono</p>
        <div class="cp-code cp-cloud-only" hidden>
          <span class="cp-code-label">o entra en <b data-ref="web">companion.livepads.online</b> y escribe:</span>
          <span class="cp-code-num" data-ref="code"></span>
        </div>
      </div>

      <div class="cp-url-row" hidden>
        <code class="cp-url" id="cp-url"></code>
        <button class="cp-copy" type="button" aria-label="Copiar URL" title="Copiar URL">${SVG_COPY}</button>
      </div>
      <div class="cp-iface-row cp-wifi-only" hidden>
        <label class="cp-iface-label" for="cp-iface-select">¿No conecta? Prueba otra interfaz:</label>
        <select id="cp-iface-select" class="cp-iface-select"></select>
      </div>
      <p class="cp-clients" hidden><span id="cp-clients-count">0</span> conectado(s)</p>
      <p class="cp-pin" hidden title="El líder lo escribe en su móvil (Ajustes → Modo líder) para controlar LivePads y enviar indicaciones a la banda. Sin él, el móvil solo ve la letra.">PIN del líder: <b id="cp-pin">----</b> <button type="button" class="cp-copy" id="cp-newpin" title="Cambiar el PIN (los móviles tendrán que escribir el nuevo)">Cambiar</button></p>

      <p class="cp-hint">
        Cuando esté activo, los músicos escanean el QR (o escriben el código) y ven la canción que suena.
        <span class="cp-cloud-only"><button type="button" class="cp-copy cp-newcode" id="cp-newcode" title="Otro código y otro QR: los móviles que tenían el anterior dejan de recibir">Cambiar el código</button></span>
      </p>

      <div class="cp-firewall cp-wifi-only" hidden>
        <strong>¿No conecta nadie?</strong>
        Windows suele bloquear el puerto en redes nuevas. Pulsa para permitirlo
        (pedirá confirmación de administrador una sola vez y queda permanente):
        <button class="cp-fw-btn" id="cp-allow-fw" type="button">Permitir en el Firewall</button>
        <span class="cp-fw-tip">Asegúrate también de que el teléfono y la laptop estén en la <em>misma</em> red/WiFi.</span>
      </div>

      <label class="cp-autostart">
        <input type="checkbox" class="mo-switch" id="cp-autostart">
        <span>Iniciar al abrir LivePads</span>
      </label>

      <div class="cp-actions">
        <button class="cp-toggle" id="cp-toggle" type="button">Activar Companion</button>
      </div>
    </div>
  `;
  if (mount) {
    overlay.classList.add('is-embedded');
    mount.innerHTML = '';
    mount.appendChild(overlay);
  } else {
    // Herramienta flotante: la app sigue usable detrás (no hay velo).
    overlay.classList.add('is-floating');
    document.body.appendChild(overlay);
    popModal = pushModal(() => closeCompanionPanel());
    const panel = overlay.querySelector('.cp-panel');
    placePanel(panel);
    dragBy(panel, overlay.querySelector('.cp-header'));
    // Ventana más pequeña con el panel abierto: que no se quede fuera de la pantalla.
    onResize = () => fitPanel(panel);
    window.addEventListener('resize', onResize);
    document.getElementById('btn-companion')?.setAttribute('aria-pressed', 'true');
  }
  mounted = overlay;
  overlay.querySelector('.cp-close').onclick = closeCompanionPanel;

  const paintMode = () => {
    const m = getMode();
    overlay.dataset.mode = m;
    overlay.querySelectorAll('.cp-mode [data-mode]').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === m));
    overlay.querySelector('[data-ref="modeTip"]').textContent = m === 'cloud'
      ? 'Funciona con cualquier conexión del móvil (datos o cualquier WiFi). El portátil necesita internet.'
      : 'Sin internet: los móviles se conectan a la misma WiFi que el portátil.';
    lastQrUrl = null;
  };
  overlay.querySelectorAll('.cp-mode [data-mode]').forEach((b) => b.addEventListener('click', async () => {
    try { localStorage.setItem(MODE_KEY, b.dataset.mode); } catch (_) {}
    paintMode();
    await refresh();
  }));
  overlay.querySelector('#cp-newcode')?.addEventListener('click', async () => {
    await window.electronAPI.companionSetCloud?.({ renew: true });
    lastQrUrl = null; await refresh();
    window.showToast?.('Código nuevo: vuelve a compartir el QR o el código con la banda.', 'info');
  });
  paintMode();

  const toggleBtn = overlay.querySelector('#cp-toggle');
  toggleBtn.onclick = async () => {
    toggleBtn.disabled = true;
    try {
      const cur = await window.electronAPI.companionStatus();
      if (cur.running) {
        await window.electronAPI.companionStop();
        serverStartedAt = 0;
      } else {
        await window.electronAPI.companionStart();
        serverStartedAt = Date.now();
        // Publish whatever is active now so late joiners aren't blank.
        publishCurrentSong();
      }
      await refresh();
    } catch (e) {
      console.error('Companion toggle failed:', e);
      alert('Error al alternar Companion: ' + (e.message || e));
    } finally {
      toggleBtn.disabled = false;
    }
  };

  // Load and wire autostart preference.
  (async () => {
    try {
      const prefs = await window.electronAPI.companionGetPrefs();
      overlay.querySelector('#cp-autostart').checked = !!prefs.autostart;
    } catch (e) {}
  })();
  overlay.querySelector('#cp-autostart').onchange = async (e) => {
    try { await window.electronAPI.companionSetPrefs({ autostart: e.target.checked }); }
    catch (err) { console.error('Companion prefs save failed:', err); }
  };

  overlay.querySelector('#cp-iface-select').onchange = async (e) => {
    const ip = e.target.value;
    if (!ip) return;
    try {
      await window.electronAPI.companionSetIp(ip);
      lastQrUrl = null; // force QR regenerate
      await refresh();
    } catch (err) {
      console.error('Set IP failed:', err);
    }
  };

  const softapBtn = overlay.querySelector('#cp-softap');
  if (softapBtn) softapBtn.onclick = async () => {
    if (!window.electronAPI.companionCreateSoftap) return;
    softapBtn.disabled = true; const lbl = softapBtn.textContent; softapBtn.textContent = 'Creando red…';
    try {
      // Avisa si el adaptador no soporta crear red local (drivers modernos a veces no).
      const sup = await window.electronAPI.companionSoftapSupported?.();
      if (sup && sup.supported === false) {
        window.showToast?.('Tu WiFi no permite crear red local. Usa el hotspot de tu teléfono o un router.', 'warning');
      }
      const r = await window.electronAPI.companionCreateSoftap();
      if (r && r.ok) {
        window.showToast?.('Red "LivePads" creada (clave: livepads2026). Conecta los teléfonos a esa WiFi.', 'success');
      } else {
        window.showToast?.('No se pudo crear la red. Acepta el permiso (UAC) o usa el hotspot del teléfono.', 'error');
      }
    } catch (e) { window.showToast?.('No se pudo crear la red local.', 'error'); }
    finally { softapBtn.disabled = false; softapBtn.textContent = lbl; }
  };

  const hotspotBtn = overlay.querySelector('#cp-hotspot');
  if (hotspotBtn) hotspotBtn.onclick = async () => {
    if (!window.electronAPI.companionOpenHotspot) return;
    try { await window.electronAPI.companionOpenHotspot(); } catch (e) {}
  };

  const fwBtn = overlay.querySelector('#cp-allow-fw');
  if (fwBtn) fwBtn.onclick = async () => {
    if (!window.electronAPI.companionAllowFirewall) return;
    const prev = fwBtn.textContent;
    fwBtn.disabled = true;
    fwBtn.textContent = 'Solicitando permiso…';
    try {
      const res = await window.electronAPI.companionAllowFirewall();
      if (res && res.ok) {
        fwBtn.textContent = '✓ Permitido — reintenta escanear';
      } else {
        fwBtn.textContent = 'Cancelado — púlsalo de nuevo';
        fwBtn.disabled = false;
        setTimeout(() => { if (fwBtn.textContent.startsWith('Cancelado')) fwBtn.textContent = prev; }, 3000);
      }
    } catch (e) {
      fwBtn.textContent = prev;
      fwBtn.disabled = false;
    }
  };

  overlay.querySelector('.cp-copy').onclick = () => {
    const url = overlay.querySelector('#cp-url').textContent;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      const btn = overlay.querySelector('.cp-copy');
      btn.classList.add('is-copied');
      setTimeout(() => btn.classList.remove('is-copied'), 900);
    }).catch(() => {});
  };

  refresh();
  // Poll every 2s to keep client count fresh while the panel is open.
  pollTimer = setInterval(refresh, 2000);

  requestAnimationFrame(() => overlay.classList.add('open'));
}

export function closeCompanionPanel() {
  if (!mounted) return;
  document.getElementById('btn-companion')?.setAttribute('aria-pressed', 'false');
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (popModal) { popModal(); popModal = null; }
  lastQrUrl = null;
  mounted.classList.remove('open');
  const node = mounted;
  mounted = null;
  if (node.classList.contains('is-embedded')) node.remove();
  else setTimeout(() => node.remove(), 200);
}

export function isCompanionPanelOpen() { return mounted !== null; }

// ── Panel flotante ───────────────────────────────────────────────────────
const POS_KEY = 'livepads.companionPos';
let onResize = null;
/** Dentro de la ventana y con el alto que quepa (la ventana pudo encogerse). */
function fitPanel(panel) {
  const w = panel.offsetWidth || 460;
  const x = Math.max(8, Math.min(innerWidth - w - 8, parseFloat(panel.style.left) || 0));
  const y = Math.max(8, Math.min(innerHeight - 160, parseFloat(panel.style.top) || 0));
  panel.style.left = x + 'px'; panel.style.top = y + 'px';
  // (con prioridad: _linear.css limita todos los paneles con !important)
  panel.style.setProperty('max-height', Math.max(160, innerHeight - y - 12) + 'px', 'important');
}
function placePanel(panel) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (_) {}
  const w = Math.min(460, innerWidth - 24);
  const x = p && p.x != null ? p.x : innerWidth - w - 16;
  const y = p && p.y != null ? p.y : 64;
  panel.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
  panel.style.top = Math.max(8, Math.min(innerHeight - 120, y)) + 'px';
  fitPanel(panel);
}
function dragBy(panel, handle) {
  let on = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, a')) return;
    on = true; const r = panel.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!on) return;
    panel.style.left = Math.max(8 - panel.offsetWidth + 120, Math.min(innerWidth - 120, ox + e.clientX - sx)) + 'px';
    panel.style.top = Math.max(8, Math.min(innerHeight - 60, oy + e.clientY - sy)) + 'px';
  });
  const end = () => {
    if (!on) return; on = false; fitPanel(panel);
    const r = panel.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (_) {}
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}

// ── Botón de la cabecera: encendido (verde) y nº de móviles conectados ───
let badgeTimer = null;
export function watchCompanionBadge() {
  if (badgeTimer || !window.electronAPI?.companionStatus) return;
  const paint = async () => {
    if (document.hidden) return;
    const btn = document.getElementById('btn-companion');
    if (!btn) return;
    try {
      const st = await window.electronAPI.companionStatus();
      const cloud = getMode() === 'cloud' && st.cloud;
      const n = st.running ? (cloud ? st.cloud.clients : st.clients) || 0 : 0;
      btn.classList.toggle('is-active', !!st.running);
      const b = btn.querySelector('.cp-badge');
      if (b) { b.hidden = !st.running || !n; b.textContent = n > 9 ? '9+' : String(n); }
      btn.title = st.running
        ? `Companion activo · ${n} móvil${n === 1 ? '' : 'es'} conectado${n === 1 ? '' : 's'}`
        : 'Companion — letra y acordes en el móvil de cada músico (QR o código)';
    } catch (_) {}
  };
  paint();
  badgeTimer = setInterval(paint, 4000);
}

async function refresh() {
  if (!mounted) return;
  // Skip the IPC round-trip + QR work while the window is hidden/minimized —
  // resumes automatically when visible again.
  if (document.hidden) return;
  try {
    const status = await window.electronAPI.companionStatus();
    const statusEl = mounted.querySelector('.cp-status');
    const statusLabel = mounted.querySelector('.cp-status-label');
    const qrBox = mounted.querySelector('#cp-qr');
    const urlRow = mounted.querySelector('.cp-url-row');
    const clientsRow = mounted.querySelector('.cp-clients');
    const toggleBtn = mounted.querySelector('#cp-toggle');

    statusEl.dataset.running = status.running ? 'true' : 'false';
    statusLabel.textContent = status.running ? 'Activo' : 'Apagado';

    const cloudMode = getMode() === 'cloud' && status.cloud;
    const shownUrl = cloudMode ? status.cloud.url : status.url;
    if (status.running && shownUrl) {
      qrBox.hidden = false;
      urlRow.hidden = false;
      mounted.querySelector('#cp-url').textContent = shownUrl;
      const codeBox = mounted.querySelector('.cp-code');
      if (codeBox) {
        const c = cloudMode && status.cloud.code;
        codeBox.hidden = !c;
        if (c) {
          mounted.querySelector('[data-ref="code"]').textContent = /^\d{6}$/.test(c) ? c.slice(0, 3) + ' ' + c.slice(3) : c;
          if (status.cloud.web) mounted.querySelector('[data-ref="web"]').textContent = status.cloud.web;
        }
      }
      clientsRow.hidden = false;
      mounted.querySelector('#cp-clients-count').textContent = cloudMode ? status.cloud.clients : status.clients;
      statusLabel.textContent = cloudMode ? (status.cloud.connected ? 'Activo · por internet' : 'Conectando con internet…') : 'Activo · misma WiFi';
      const pinRow = mounted.querySelector('.cp-pin');
      if (pinRow && status.pin) { pinRow.hidden = false; mounted.querySelector('#cp-pin').textContent = status.pin; }
      const np = mounted.querySelector('#cp-newpin');
      if (np && !np.dataset.bound) { np.dataset.bound = '1'; np.addEventListener('click', async () => { const v = await window.electronAPI?.companionNewPin?.(); if (v) mounted.querySelector('#cp-pin').textContent = v; }); }
      toggleBtn.textContent = 'Apagar Companion';
      toggleBtn.classList.add('cp-toggle--off');

      // Firewall hint: surface after 8 s with zero clients connected. The
      // most common reason is Windows silently dropping the inbound. Once
      // any client connects, the hint hides itself.
      const fw = mounted.querySelector('.cp-firewall');
      if (fw) {
        const showHint = !cloudMode && serverStartedAt > 0 && status.clients === 0
                         && (Date.now() - serverStartedAt) > 8000;
        fw.hidden = !showHint;
      }

      // Surface the interface picker when there's more than one IPv4 candidate
      // (very common on machines with VPN active). Auto-detect picks the
      // highest-scored one but VPN tunnels sometimes win — user can switch.
      const ifaceRow = mounted.querySelector('.cp-iface-row');
      const select = mounted.querySelector('#cp-iface-select');
      const cands = status.candidates || [];
      if (cands.length > 1) {
        ifaceRow.hidden = false;
        const desired = select.value;
        if (select.options.length !== cands.length || desired !== status.ip) {
          select.innerHTML = cands.map(c =>
            `<option value="${c.ip}">${c.ip} — ${c.iface}</option>`
          ).join('');
          select.value = status.ip;
        }
      } else {
        ifaceRow.hidden = true;
      }

      // Only regenerate when the URL changes (avoid SVG flicker every 2s).
      if (shownUrl !== lastQrUrl) {
        lastQrUrl = shownUrl;
        try {
          const svg = await window.electronAPI.companionQR(shownUrl);
          // Server might have stopped while we awaited — guard before mutating.
          if (mounted && shownUrl === lastQrUrl) {
            mounted.querySelector('#cp-qr-frame').innerHTML = svg;
          }
        } catch (e) {
          console.warn('QR generation failed:', e);
        }
      }
    } else {
      qrBox.hidden = true;
      urlRow.hidden = true;
      clientsRow.hidden = true;
      mounted.querySelector('.cp-iface-row').hidden = true;
      toggleBtn.textContent = 'Activar Companion';
      toggleBtn.classList.remove('cp-toggle--off');
      lastQrUrl = null;
    }
  } catch (e) {
    // Server probably restarting — ignore one poll.
  }
}

// Reuse the active song from the library so a newly-started server has
// state to send to the first client that connects.
function publishCurrentSong() {
  const activeCard = document.querySelector('.gi-song-item.is-active');
  if (!activeCard) return;
  // The card carries the song-id; the real publish happens on the next
  // applyGiSong call. Nothing to do here — the server's cached lastState
  // will catch up automatically next time the user clicks a song.
}
