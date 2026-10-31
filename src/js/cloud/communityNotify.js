// Avisos de la comunidad de la Biblioteca de stems, dentro de la app:
//   · a quien envió un pack: cuando se aprueba o se rechaza (con la nota);
//   · al administrador: cuando hay envíos por revisar o loops reportados.
// Se revisa poco después de arrancar y cada 10 minutos. Lo ya avisado se
// recuerda en este equipo para no repetirlo.
//
//   startCommunityNews({ openReview, openMine })

import { isLoggedIn } from './supabase.js';
import * as stemLibrary from './stemLibrary.js';
import { hasFeature } from '../billing/license.js';
import { showToast } from '../ui/toast.js';

const SEEN_KEY = 'lp.community.seen';        // { packId: 'estado|nota' }
const ADMIN_KEY = 'lp.community.adminSeen';  // firma de lo pendiente ya avisado
const FIRST_DELAY_MS = 9000;
const EVERY_MS = 10 * 60 * 1000;

const read = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def; } catch (_) { return def; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

let started = false;
let checking = false;

export async function checkCommunityNews({ openReview, openMine } = {}) {
  if (checking || !isLoggedIn() || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  checking = true;
  try {
    // Administrador: envíos esperando y reportes.
    if (await stemLibrary.isLibraryAdmin()) {
      const [packs, reports] = await Promise.all([
        stemLibrary.adminListPacks().catch(() => []),
        stemLibrary.adminReports().catch(() => []),
      ]);
      const pending = packs.filter((p) => p.status === 'pending' && p.submitted_at);
      const sig = [...pending.map((p) => `${p.id}@${p.submitted_at}`), ...reports.map((r) => `${r.loop_id}#${r.reports}`)].sort().join(',');
      if (sig && sig !== read(ADMIN_KEY, '')) {
        const parts = [];
        if (pending.length) parts.push(`${pending.length} envío${pending.length === 1 ? '' : 's'} de la comunidad por revisar`);
        if (reports.length) parts.push(`${reports.length} loop${reports.length === 1 ? '' : 's'} reportado${reports.length === 1 ? '' : 's'}`);
        showToast(`Biblioteca: ${parts.join(' y ')}.`, 'info', openReview ? { action: { label: 'Revisar', onClick: openReview } } : {});
      }
      write(ADMIN_KEY, sig);
    }
    // Mis envíos: ¿alguno cambió a aprobado o rechazado desde la última vez?
    if (hasFeature('stems')) {
      const mine = await stemLibrary.myCommunityPacks().catch(() => null);
      if (mine) {
        const seen = read(SEEN_KEY, {});
        for (const p of mine) {
          const sig = `${p.status}|${p.review_note || ''}`;
          if (seen[p.id] !== sig && (p.status === 'approved' || p.status === 'rejected')) {
            const action = openMine ? { action: { label: 'Ver', onClick: openMine } } : {};
            if (p.status === 'approved') showToast(`¡Tu pack "${p.title}" fue aprobado y ya está en la Biblioteca!`, 'success', action);
            else showToast(`Tu pack "${p.title}" no se aprobó${p.review_note ? `: ${p.review_note}` : ''}. Puedes corregirlo y volver a enviarlo.`, 'warning', action);
          }
          seen[p.id] = sig;
        }
        // Olvidar lo que ya no existe (retirado o borrado).
        const ids = new Set(mine.map((p) => p.id));
        Object.keys(seen).forEach((id) => { if (!ids.has(id)) delete seen[id]; });
        write(SEEN_KEY, seen);
      }
    }
  } catch (_) {
    // sin red o sin permiso: se reintenta en la próxima ronda
  } finally {
    checking = false;
  }
}

export function startCommunityNews(handlers = {}) {
  if (started) return;
  started = true;
  setTimeout(() => checkCommunityNews(handlers), FIRST_DELAY_MS);
  setInterval(() => checkCommunityNews(handlers), EVERY_MS);
}
