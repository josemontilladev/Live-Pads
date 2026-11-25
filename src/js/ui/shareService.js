// ─────────────────────────────────────────────────────────────────────────
// Enviar el setlist por WhatsApp: arma el mensaje del servicio (canciones en
// orden, tono de hoy, BPM y el enlace para practicar cada una) y abre WhatsApp
// con el texto listo para elegir el grupo. También se puede copiar y pegar.
// buildServiceMessage() es puro; probado en tests/shareService.test.mjs.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Enlace corto y limpio: YouTube → https://youtu.be/ID (sin ?si=, &list=, &start_radio=… que lo alargan).
 * Otros enlaces, tal cual.
 */
export function cleanLink(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  const m = u.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m && /youtu\.?be/.test(u) ? `https://youtu.be/${m[1]}` : u;
}

/**
 * Texto del mensaje. songs: [{ title, artist, key, bpm, youtubeUrl }] (key = el de hoy).
 * Una canción por bloque, separadas por una línea en blanco; sin emojis (WhatsApp de escritorio
 * mostraba «�» en su lugar).
 */
export function buildServiceMessage(songs, { name = 'Servicio', date = '', note = '' } = {}) {
  const lines = [`*${name}*${date ? ` · ${date}` : ''}`];
  (songs || []).forEach((s, i) => {
    const info = [s.artist, s.key && `Tono ${s.key}`, s.bpm && `${s.bpm} BPM`].filter(Boolean).join(' · ');
    const link = cleanLink(s.youtubeUrl);
    lines.push('', `${i + 1}. *${s.title || 'Sin título'}*`);
    if (info) lines.push(`    ${info}`);
    if (link) lines.push(`    ${link}`);
  });
  if (note) lines.push('', note);
  lines.push('', '_Enviado desde LivePads_');
  return lines.join('\n');
}

export function whatsappUrl(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}

export async function sendServiceToWhatsApp(songs, meta) {
  const text = buildServiceMessage(songs, meta);
  const url = whatsappUrl(text);
  const ok = window.electronAPI?.openExternal ? await window.electronAPI.openExternal(url) : !!window.open(url, '_blank');
  if (!ok) await copyServiceMessage(songs, meta);
}

export async function copyServiceMessage(songs, meta) {
  try {
    await navigator.clipboard.writeText(buildServiceMessage(songs, meta));
    window.showToast?.('Mensaje del servicio copiado: pégalo en el grupo de WhatsApp.', 'success');
  } catch (_) {
    window.showToast?.('No se pudo copiar el mensaje.', 'error');
  }
}
