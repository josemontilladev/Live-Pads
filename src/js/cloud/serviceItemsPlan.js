// ─────────────────────────────────────────────────────────────────────────
// Setlist de LivePads → programa del servicio en GI App (`service_items`).
//
// GI App guarda cada servicio con su programa (canciones, bienvenida, oración,
// avisos…) y copia la lista de canciones a `setlists` para LivePads. El camino
// de vuelta no existía: un cambio hecho en LivePads no llegaba a GI App. Esto
// calcula qué escribir en el programa para que sus CANCIONES queden como en el
// setlist, sin tocar lo que no es canción (que sigue en su sitio, con su
// responsable y sus notas).
//
// Puro: recibe el programa actual y devuelve las operaciones. Probado en
// tests/serviceItemsPlan.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {Array<{id, position, kind, song_id, key}>} items  programa actual
 * @param {string[]} songIds   canciones del setlist, en orden
 * @param {Object<string,string>} keys  tono por canción en este servicio
 * @param {(songId:string)=>string} titleOf  título de una canción
 * @returns {{ creates: object[], updates: object[], deletes: string[], changed: boolean }}
 */
export function planServiceItems(items, songIds, keys = {}, titleOf = () => 'Canción') {
  const ordered = [...(items || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  const isSong = (it) => it.kind === 'song' && it.song_id;
  // Reutilizar las filas de canción que ya existen (conservan su responsable/notas).
  const pool = new Map();
  ordered.filter(isSong).forEach((it) => {
    const k = String(it.song_id);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(it);
  });
  const want = (songIds || []).map(String);
  const keyOf = (sid) => (keys && keys[sid]) || null;
  const take = (sid) => {
    const list = pool.get(sid);
    if (list && list.length) return { ...list.shift(), _reuse: true };
    return { song_id: sid, kind: 'song', title: titleOf(sid) || 'Canción', _new: true };
  };

  const final = [];
  let d = 0;
  for (const it of ordered) {
    if (!isSong(it)) { final.push(it); continue; }
    // Hueco de canción: va la siguiente canción del setlist (si quedan).
    if (d < want.length) final.push(take(want[d++]));
  }
  while (d < want.length) final.push(take(want[d++]));

  const used = new Set(final.filter((x) => x._reuse).map((x) => x.id));
  const deletes = ordered.filter((it) => isSong(it) && !used.has(it.id)).map((it) => it.id);
  const creates = [], updates = [];
  final.forEach((it, position) => {
    if (it._new) { creates.push({ kind: 'song', song_id: it.song_id, title: it.title, key: keyOf(String(it.song_id)), position }); return; }
    const patch = {};
    if ((it.position || 0) !== position) patch.position = position;
    if (isSong(it)) {
      const k = keyOf(String(it.song_id));
      if ((it.key || null) !== k) patch.key = k;
    }
    if (Object.keys(patch).length) updates.push({ id: it.id, ...patch });
  });
  return { creates, updates, deletes, changed: !!(creates.length || updates.length || deletes.length) };
}
