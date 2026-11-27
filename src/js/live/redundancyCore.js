// ─────────────────────────────────────────────────────────────────────────
// Respaldo entre dos PCs: decisiones del RESPALDO (puro; tests/redundancyCore.test.mjs).
//
// El principal manda { songId, title, artist, slot, t, playing, rate, pitch } y el
// proceso principal le pone recvAt (hora de LLEGADA en este PC: así no hace falta que
// los relojes de los dos PCs coincidan).
// ─────────────────────────────────────────────────────────────────────────

export const DRIFT_S = 0.12;          // más desfase que esto → se recoloca
export const SEEK_GAP_MS = 1500;      // y como mucho una vez cada 1,5 s (recolocar cuesta)
export const TAKEOVER_MS = 1200;      // sin noticias del principal durante esto → relevo
const NET_S = 0.005;                  // ~5 ms de red local

/** Dónde va el principal AHORA (segundos de la pista). */
export function expectedTime(remote, now) {
  if (!remote) return 0;
  const t = Number(remote.t) || 0;
  if (!remote.playing) return t;
  const dt = Math.max(0, (now - (remote.recvAt || now)) / 1000);
  return t + (dt + NET_S) * (Number(remote.rate) || 1);
}

const sameSong = (a, b) => !!a && !!b && (String(a.id) === String(b.songId) || (b.title && String(a.title || '').trim().toLowerCase() === String(b.title).trim().toLowerCase() && String(a.artist || '').trim().toLowerCase() === String(b.artist || '').trim().toLowerCase()));

/**
 * Qué tiene que hacer el respaldo para ir igual que el principal.
 * local = { song, type, playing, t, pitch, lastSeekAt }
 * → { action: 'load'|'play'|'pause'|'seek'|'pitch'|'none', t?, pitch? }
 */
export function followStep(remote, local, now) {
  if (!remote || !remote.songId) return { action: 'none' };
  if (!sameSong(local.song, remote) || (remote.slot && local.type !== remote.slot)) return { action: 'load' };
  const want = expectedTime(remote, now);
  if (Number.isFinite(remote.pitch) && Number.isFinite(local.pitch) && remote.pitch !== local.pitch) return { action: 'pitch', pitch: remote.pitch };
  if (remote.playing && !local.playing) return { action: 'play', t: want };
  if (!remote.playing && local.playing) return { action: 'pause', t: want };
  const drift = (Number(local.t) || 0) - want;
  if (Math.abs(drift) > (remote.playing ? DRIFT_S : 0.05) && now - (local.lastSeekAt || 0) > (remote.playing ? SEEK_GAP_MS : 0)) return { action: 'seek', t: want };
  return { action: 'none' };
}

/** ¿Hay que tomar el relevo? Solo si el principal estaba sonando y se ha callado. */
export function shouldTakeOver(remote, lastSeenAt, now, timeoutMs = TAKEOVER_MS) {
  return !!(remote && remote.playing && lastSeenAt && now - lastSeenAt > timeoutMs);
}

/** Lo que manda el principal, a partir del reproductor. */
export function principalState({ song, type, audio, pitch, serviceIndex }) {
  if (!song) return { songId: null };
  return {
    songId: String(song.id), title: song.title || '', artist: song.artist || '', slot: type || null,
    t: audio ? Math.round((Number(audio.currentTime) || 0) * 1000) / 1000 : 0,
    playing: !!(audio && !audio.paused),
    rate: audio && Number(audio.playbackRate) > 0 ? Number(audio.playbackRate) : 1,
    pitch: Number.isFinite(pitch) ? pitch : 0,
    serviceIndex: Number.isFinite(serviceIndex) ? serviceIndex : -1,
  };
}
