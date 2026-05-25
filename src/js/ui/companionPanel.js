// Companion panel — Start/stop the LAN viewer server and surface its URL
// + connected-client count. Triggered from the hamburger menu.
//
// QR code generation lands in Fase 3; for now we show the URL as plain text
// (selectable + copy button) so phones can type it manually.

let mounted = null;
let pollTimer = null;
let lastQrUrl = null; // cache so we only regenerate the SVG when the URL changes
let serverStartedAt = 0; // ms timestamp — used to show the firewall hint after 8s of zero clients

const SVG_CLOSE = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_COPY  = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

export function openCompanionPanel() {
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
        <button class="cp-close" type="button" aria-label="Cerrar">${SVG_CLOSE}</button>
      </div>
      <p class="cp-subtitle">Visor pasivo de letras+acordes para los músicos en la misma WiFi.</p>

      <div class="cp-hotspot-row">
        <button class="cp-hotspot-btn" id="cp-hotspot" type="button">📶 Modo iglesia (Hotspot)</button>
        <span class="cp-hotspot-tip">Sin internet: la laptop emite su propia WiFi y los teléfonos solo escanean.</span>
      </div>

      <div class="cp-status" data-running="false">
        <span class="cp-dot"></span>
        <span class="cp-status-label">Apagado</span>
      </div>

      <div class="cp-qr" id="cp-qr" hidden>
        <div class="cp-qr-frame" id="cp-qr-frame"></div>
        <p class="cp-qr-caption">Escanea con la cámara del teléfono</p>
      </div>

      <div class="cp-url-row" hidden>
        <code class="cp-url" id="cp-url"></code>
        <button class="cp-copy" type="button" aria-label="Copiar URL" title="Copiar URL">${SVG_COPY}</button>
      </div>
      <div class="cp-iface-row" hidden>
        <label class="cp-iface-label" for="cp-iface-select">¿No conecta? Probá otra interfaz:</label>
        <select id="cp-iface-select" class="cp-iface-select"></select>
      </div>
      <p class="cp-clients" hidden><span id="cp-clients-count">0</span> conectado(s)</p>

      <p class="cp-hint">
        Cuando esté activo, los músicos abren la URL en el navegador del teléfono
        y verán la canción que dispares en la cabina.
      </p>

      <div class="cp-firewall" hidden>
        <strong>¿No conecta nadie?</strong>
        Windows suele bloquear el puerto en redes nuevas. Pulsa para permitirlo
        (pedirá confirmación de administrador una sola vez y queda permanente):
        <button class="cp-fw-btn" id="cp-allow-fw" type="button">Permitir en el Firewall</button>
        <span class="cp-fw-tip">Asegúrate también de que el teléfono y la laptop estén en la <em>misma</em> red/WiFi.</span>
      </div>

      <label class="cp-autostart">
        <input type="checkbox" id="cp-autostart">
        <span>Iniciar al abrir LivePads</span>
      </label>

      <div class="cp-actions">
        <button class="cp-toggle" id="cp-toggle" type="button">Activar Companion</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  mounted = overlay;

  overlay.onclick = (e) => { if (e.target === overlay) closeCompanionPanel(); };
  overlay.querySelector('.cp-close').onclick = closeCompanionPanel;

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
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  lastQrUrl = null;
  mounted.classList.remove('open');
  const node = mounted;
  mounted = null;
  setTimeout(() => node.remove(), 200);
}

export function isCompanionPanelOpen() { return mounted !== null; }

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

    if (status.running && status.url) {
      qrBox.hidden = false;
      urlRow.hidden = false;
      mounted.querySelector('#cp-url').textContent = status.url;
      clientsRow.hidden = false;
      mounted.querySelector('#cp-clients-count').textContent = status.clients;
      toggleBtn.textContent = 'Apagar Companion';
      toggleBtn.classList.add('cp-toggle--off');

      // Firewall hint: surface after 8 s with zero clients connected. The
      // most common reason is Windows silently dropping the inbound. Once
      // any client connects, the hint hides itself.
      const fw = mounted.querySelector('.cp-firewall');
      if (fw) {
        const showHint = serverStartedAt > 0 && status.clients === 0
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
      if (status.url !== lastQrUrl) {
        lastQrUrl = status.url;
        try {
          const svg = await window.electronAPI.companionQR(status.url);
          // Server might have stopped while we awaited — guard before mutating.
          if (mounted && status.url === lastQrUrl) {
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
