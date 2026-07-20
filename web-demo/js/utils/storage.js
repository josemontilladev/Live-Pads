// localStorage con schema versioning + parsing seguro.
//
// Problema que resuelve: a lo largo del tiempo guardamos JSON en
// localStorage (configs de nube, mapeo MIDI, settings, etc.). Si el
// formato cambia (campo nuevo, renombrado, tipo distinto), las claves
// viejas siguen ahí y fallan en silencio al leerse — o peor: rompen la
// app si confiamos ciegamente en su forma.
//
// Este módulo expone helpers que:
//   - serializan SIEMPRE como { v: N, d: data } (la "v" es la versión del
//     schema; "d" el payload).
//   - al leer comparan v contra la versión esperada y aplican migración
//     (si hay) o devuelven el fallback.
//   - capturan errores de quota / parse en lugar de propagar.
//
// Compatibilidad: read() detecta automáticamente claves "legacy" (un
// string crudo, un JSON sin wrapper). En ese caso aplica una función
// `migrateLegacy(rawString)` si la pasas; si no, intenta JSON.parse y
// devuelve eso si parsea, fallback si no. Esto evita tener que migrar
// todas las claves existentes de la noche a la mañana.

const PREFIX = 'lv1:'; // namespace para claves nuevas envueltas con esquema

function isWrapped(obj) {
  return obj && typeof obj === 'object' && 'v' in obj && 'd' in obj;
}

/**
 * Lee una clave con esquema. Si la clave no existe o el contenido no
 * coincide con la versión esperada y no hay migración, devuelve `fallback`.
 *
 * @param {string} key
 * @param {object} opts
 *   version:        número, versión esperada del schema.
 *   fallback:       valor a devolver si no hay nada / falla / versión
 *                   incompatible sin migración.
 *   migrate:        opcional { from:number, to:number, run:(d)=>d } — se
 *                   ejecuta si el valor leído está en versión `from`.
 *   migrateLegacy:  opcional (rawString)=>data — corre cuando la clave
 *                   existe pero NO está envuelta (formato legacy).
 */
export function read(key, { version, fallback = null, migrate, migrateLegacy } = {}) {
  let raw;
  try { raw = localStorage.getItem(key); } catch (_) { return fallback; }
  if (raw == null) return fallback;

  // Intento de parseo. Si no es JSON, tratamos como legacy "raw string".
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) {
    if (typeof migrateLegacy === 'function') {
      try { return migrateLegacy(raw); } catch (_) { return fallback; }
    }
    return raw; // legacy: la clave guardaba un string plano
  }

  if (isWrapped(parsed)) {
    if (parsed.v === version) return parsed.d;
    if (migrate && parsed.v === migrate.from && migrate.to === version) {
      try { return migrate.run(parsed.d); } catch (_) { return fallback; }
    }
    return fallback;
  }

  // Parsed pero sin wrapper — formato legacy. Si nos dan migrateLegacy,
  // lo usamos; si no, devolvemos el JSON tal cual (compatibilidad hacia
  // atrás con claves que guardaban arrays/objetos directos).
  if (typeof migrateLegacy === 'function') {
    try { return migrateLegacy(parsed); } catch (_) { return fallback; }
  }
  return parsed;
}

/**
 * Escribe envolviendo con { v, d }. Lanza-y-traga errores de quota.
 */
export function write(key, data, { version } = {}) {
  if (version == null) throw new Error('storage.write: version is required');
  try {
    localStorage.setItem(key, JSON.stringify({ v: version, d: data }));
    return true;
  } catch (e) {
    console.warn(`storage.write(${key}) failed:`, e?.message || e);
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}
