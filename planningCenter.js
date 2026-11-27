// ─────────────────────────────────────────────────────────────────────────
// Planning Center Services (proceso principal). Conexión con un «Personal Access
// Token» (ID de aplicación + secreto) que cada iglesia crea en
// api.planningcenteronline.com/oauth/applications. Se guarda cifrado (safeStorage)
// y solo se permiten LECTURAS de /services/v2/… : LivePads no cambia nada allí.
// Sin Electron para poder probarlo con Node (el cifrado y fetch se inyectan).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const DEFAULT_BASE = 'https://api.planningcenteronline.com';

function createPco({ fetch, readCreds, writeCreds, base = DEFAULT_BASE, timeoutMs = 15000 }) {
  let creds = null;
  const load = () => { if (creds === null) { try { creds = readCreds() || false; } catch (_) { creds = false; } } return creds || null; };
  const auth = (c) => 'Basic ' + Buffer.from(`${c.appId}:${c.secret}`).toString('base64');

  async function get(pathAndQuery, c = load()) {
    if (!c) { const e = new Error('Planning Center no está conectado'); e.code = 'NOAUTH'; throw e; }
    const p = String(pathAndQuery || '');
    if (!/^\/services\/v2(\/|\?|$)/.test(p) || p.includes('..') || /[\s\\]/.test(p)) throw new Error('Ruta no permitida');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(base + p, { headers: { Authorization: auth(c), Accept: 'application/json' }, signal: ctrl.signal });
    } catch (err) {
      const e = new Error(ctrl.signal.aborted ? 'Planning Center no responde (¿sin internet?)' : 'Sin conexión con Planning Center');
      e.code = 'NET'; throw e;
    } finally { clearTimeout(timer); }
    if (res.status === 401 || res.status === 403) { const e = new Error('Planning Center rechazó el acceso: revisa el ID y el secreto'); e.code = 'NOAUTH'; throw e; }
    if (res.status === 429) { const e = new Error('Planning Center pide esperar unos segundos (demasiadas consultas)'); e.code = 'RATE'; throw e; }
    if (!res.ok) throw new Error(`Planning Center respondió ${res.status}`);
    return res.json();
  }

  // Todas las páginas de una lista (links.next), con tope para no quedarse en bucle.
  async function getAll(pathAndQuery, maxPages = 10) {
    const first = await get(pathAndQuery);
    const out = { data: [].concat(first.data || []), included: [].concat(first.included || []) };
    let next = first.links && first.links.next, n = 1;
    while (next && n < maxPages) {
      const u = new URL(next);
      const page = await get(u.pathname + u.search);
      out.data.push(...(page.data || [])); out.included.push(...(page.included || []));
      next = page.links && page.links.next; n++;
    }
    return out;
  }

  return {
    status() { const c = load(); return { connected: !!c, appId: c ? String(c.appId).slice(0, 6) + '…' : '' }; },
    async connect(appId, secret) {
      const c = { appId: String(appId || '').trim(), secret: String(secret || '').trim() };
      if (!c.appId || !c.secret) throw new Error('Falta el ID de aplicación o el secreto');
      const me = await get('/services/v2', c);                 // comprueba que la clave sirve
      writeCreds(c); creds = c;
      const org = me && me.data && me.data.attributes ? me.data.attributes.name || '' : '';
      return { connected: true, org };
    },
    disconnect() { creds = false; try { writeCreds(null); } catch (_) {} return { connected: false }; },
    get,
    getAll,
  };
}

module.exports = { createPco, DEFAULT_BASE };
