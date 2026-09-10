// Comparación pura entre un setlist local y su versión en la nube. La ronda de
// sincronización corre al arrancar, al volver el foco y cada 45 s: si la nube
// no trae nada nuevo, no hay que tocar nada (re-montar el servicio cambia los
// serviceId de las tarjetas y re-renderiza la lista bajo el usuario).

export const keysSignature = (k) =>
  Object.entries(k || {}).map(([a, b]) => `${a}=${b}`).sort().join('|');

// `incoming` ya viene normalizado: songs sin serviceId, keys como objeto.
export function cloudSetlistUnchanged(existing, { cloudId, name, date, songs, keys, updatedAt }) {
  if (!existing) return false;
  const nextDate = date || existing.date || null;
  return existing.cloudId === (cloudId || existing.cloudId || null)
    && existing.cloudUpdatedAt === (updatedAt || existing.cloudUpdatedAt || null)
    && existing.name === name
    && (existing.date || null) === nextDate
    && keysSignature(existing.keys) === keysSignature(keys)
    && JSON.stringify(existing.songs || []) === JSON.stringify(songs || []);
}
