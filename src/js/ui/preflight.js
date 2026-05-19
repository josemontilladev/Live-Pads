// Pre-service ready check. Modal that surfaces common "is this set up to
// go live?" pitfalls in one glance: audio context, banks loaded, MIDI
// status, service list completeness. Each row is either a green ✓ or
// an amber ⚠ with sub-text explaining what's missing.
//
// The checks read state from the engine + the central store + service.js
// — no mutation. Trigger from the hamburger menu ("Pre-vuelo").

import { KIT_BANKS, PAD_BANKS } from '../data/banks.js';
import { getServiceSongs } from '../data/service.js';
import { getPadBankIdx, getKitBankIdx } from '../state/store.js';
import { getMidiMap } from '../midi/midiMap.js';

let mounted = null;

const SVG_OK = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" fill="none" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_WARN = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

/**
 * @param {Object} ctx
 *   - getEngine () => SynthEngine
 *   Used to verify the AudioContext is running.
 */
export function openPreflight(ctx) {
  if (mounted) return;

  const checks = runChecks(ctx);
  const warnings = checks.filter(c => !c.ok).length;
  const overallLabel = warnings === 0
    ? 'Todo listo para empezar.'
    : `${warnings} ${warnings === 1 ? 'cosa' : 'cosas'} por revisar antes de comenzar.`;

  const overlay = document.createElement('div');
  overlay.id = 'preflight-overlay';
  overlay.innerHTML = `
    <div class="pf-panel" role="dialog" aria-modal="true" aria-labelledby="pf-title">
      <div class="pf-header">
        <h3 id="pf-title">Pre-vuelo</h3>
        <button class="pf-close" type="button" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p class="pf-subtitle">Antes de empezar el servicio:</p>
      <ul class="pf-list">
        ${checks.map(c => `
          <li class="pf-row ${c.ok ? 'pf-row--ok' : 'pf-row--warn'}">
            <span class="pf-icon" aria-hidden="true">${c.ok ? SVG_OK : SVG_WARN}</span>
            <div class="pf-text">
              <span class="pf-label">${c.label}</span>
              ${c.detail ? `<span class="pf-detail">${c.detail}</span>` : ''}
            </div>
          </li>
        `).join('')}
      </ul>
      <p class="pf-summary ${warnings === 0 ? 'is-ok' : 'is-warn'}">${overallLabel}</p>
    </div>
  `;
  document.body.appendChild(overlay);
  mounted = overlay;

  overlay.onclick = (e) => { if (e.target === overlay) closePreflight(); };
  overlay.querySelector('.pf-close').onclick = closePreflight;

  requestAnimationFrame(() => overlay.classList.add('open'));
}

export function closePreflight() {
  if (!mounted) return;
  mounted.classList.remove('open');
  const node = mounted;
  mounted = null;
  setTimeout(() => node.remove(), 200);
}

export function isPreflightOpen() { return mounted !== null; }

// ── Checks ────────────────────────────────────────────────────────────

function runChecks(ctx) {
  const out = [];
  const engine = ctx.getEngine ? ctx.getEngine() : null;

  // 1. Audio context running
  const ctxState = engine && engine.ctx ? engine.ctx.state : 'unknown';
  out.push({
    label: 'Salida de audio',
    detail: ctxState === 'running' ? 'AudioContext activo' : `AudioContext en estado "${ctxState}" — toca cualquier pad para activarlo`,
    ok: ctxState === 'running'
  });

  // 2. Pad bank loaded
  const padBank = PAD_BANKS[getPadBankIdx()];
  out.push({
    label: 'Banco de pads cargado',
    detail: padBank ? `Actual: ${padBank.name}` : 'No hay banco de pads seleccionado',
    ok: !!padBank
  });

  // 3. Drum kit loaded
  const kit = KIT_BANKS[getKitBankIdx()];
  const kitOk = !!(kit && kit.pads && kit.pads.length > 0);
  out.push({
    label: 'Kit de batería cargado',
    detail: kit ? `Actual: ${kit.name} (${kit.pads ? kit.pads.length : 0} pads)` : 'No hay kit seleccionado',
    ok: kitOk
  });

  // 4. MIDI mappings (informational — not a fail)
  const mappings = getMidiMap() || {};
  const mappingCount = Object.keys(mappings).length;
  out.push({
    label: 'MIDI mapeado',
    detail: mappingCount > 0 ? `${mappingCount} controles asignados` : 'Sin mapeo MIDI (puedes usar teclado o el ratón)',
    ok: true // informational
  });

  // 5. Service list populated
  const svc = getServiceSongs();
  out.push({
    label: 'Lista de servicio',
    detail: svc.length === 0 ? 'Vacía — añade canciones desde la Librería' : `${svc.length} ${svc.length === 1 ? 'canción' : 'canciones'} cargadas`,
    ok: svc.length > 0
  });

  // 6. Service songs have BPM + key
  const missing = svc.filter(s => !s.bpm || !s.key);
  if (svc.length > 0) {
    out.push({
      label: 'Metadata completa (BPM + tono)',
      detail: missing.length === 0
        ? 'Todas las canciones tienen BPM y tono'
        : `Faltan datos en ${missing.length}: ${missing.slice(0, 3).map(s => s.title).join(', ')}${missing.length > 3 ? '…' : ''}`,
      ok: missing.length === 0
    });
  }

  return out;
}
