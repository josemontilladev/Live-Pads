// Sube un pack a la biblioteca de stems oficial (R2 `catalog/` + Supabase).
// Solo para el ADMINISTRADOR: usa la service_role y las llaves de R2, que viven
// en un archivo junto a este script. Git lo ignora (.env.*) y el instalador no
// lo empaqueta (build.files solo incluye main/preload/src/companion); Syncthing
// sí lo comparte entre los equipos del administrador.
//
//   scripts/stem-library/.env.admin   (o la ruta en LP_ADMIN_ENV)
//     SUPABASE_URL=https://<proyecto>.supabase.co
//     SUPABASE_SERVICE_ROLE_KEY=...
//     R2_ACCOUNT_ID=...
//     R2_ACCESS_KEY_ID=...
//     R2_SECRET_ACCESS_KEY=...
//     R2_BUCKET=...
//
// Uso:
//   node scripts/stem-library/upload-pack.mjs <carpeta-con-pack.json>
//   node scripts/stem-library/upload-pack.mjs --delete <slug>
//
// pack.json:
//   { slug, title, description?, genre?, mood?, tier: 'free'|'pro', published, sort?,
//     cover?: 'cover.jpg',
//     loops: [{ file, title, instrument, section?, bpm, key|null, bars,
//               beatsPerBar?, tags?, sort?, preview?: 'archivo',
//               tier?: 'free'|'pro' }] }
//
// `tier` del pack es el valor por defecto de sus loops; cada loop puede
// llevar el suyo. Después se cambia desde la app (panel Biblioteca, cuenta de
// administrador) sin volver a subir nada.
//
// Volver a subir el mismo slug lo REEMPLAZA (sube los archivos y rehace la
// lista de loops), así que el script es idempotente.

import { readFileSync, existsSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { r2Url } from './sigv4.mjs';
import { readWav, previewWav } from './wav.mjs';

const CONTENT_TYPES = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
const INSTRUMENTS = ['drums', 'perc', 'bass', 'keys', 'pad', 'synth', 'guitar', 'strings', 'vocals', 'fx', 'other'];
const SECTIONS = ['any', 'intro', 'verse', 'prechorus', 'chorus', 'bridge', 'build', 'outro'];

function loadConfig() {
  const file = process.env.LP_ADMIN_ENV || join(dirname(fileURLToPath(import.meta.url)), '.env.admin');
  if (!existsSync(file)) throw new Error(`No encuentro ${file}. Créalo con las llaves (mira el encabezado del script).`);
  const cfg = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    if (!cfg[k]) throw new Error(`Falta ${k} en ${file}`);
  }
  return cfg;
}

async function db(cfg, path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function put(cfg, key, bytes, contentType) {
  const res = await fetch(r2Url(cfg, 'PUT', `catalog/${key}`), {
    method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes,
  });
  if (!res.ok) throw new Error(`R2 rechazó ${key} (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

async function del(cfg, key) {
  const res = await fetch(r2Url(cfg, 'DELETE', `catalog/${key}`), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) console.warn(`  No se pudo borrar ${key} de R2 (${res.status})`);
}

// Nombre seguro para R2 y para la caché local de cada PC.
const safeName = (f) => basename(f).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-');

function validate(pack) {
  const errs = [];
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(pack.slug || '')) errs.push('slug: minúsculas, números y guiones');
  if (!pack.title) errs.push('title es obligatorio');
  if (!['free', 'pro'].includes(pack.tier)) errs.push("tier debe ser 'free' o 'pro'");
  if (!Array.isArray(pack.loops) || !pack.loops.length) errs.push('loops vacío');
  (pack.loops || []).forEach((l, i) => {
    const at = `loops[${i}] (${l.title || l.file})`;
    if (!l.file) errs.push(`${at}: falta file`);
    if (!l.title) errs.push(`${at}: falta title`);
    if (!INSTRUMENTS.includes(l.instrument)) errs.push(`${at}: instrument debe ser uno de ${INSTRUMENTS.join(', ')}`);
    if (l.section && !SECTIONS.includes(l.section)) errs.push(`${at}: section debe ser uno de ${SECTIONS.join(', ')}`);
    if (!(l.bpm >= 20 && l.bpm <= 300)) errs.push(`${at}: bpm entre 20 y 300`);
    if (!(Number.isInteger(l.bars) && l.bars >= 1 && l.bars <= 64)) errs.push(`${at}: bars entero entre 1 y 64`);
    if (l.tier && !['free', 'pro'].includes(l.tier)) errs.push(`${at}: tier debe ser 'free' o 'pro'`);
  });
  if (errs.length) throw new Error('pack.json inválido:\n  - ' + errs.join('\n  - '));
}

async function upload(cfg, dir) {
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
  validate(pack);
  const slug = pack.slug;
  console.log(`Subiendo pack "${pack.title}" (${slug}, ${pack.tier}) con ${pack.loops.length} loops…`);

  let coverPath = null;
  if (pack.cover) {
    coverPath = `${slug}/${safeName(pack.cover)}`;
    await put(cfg, coverPath, readFileSync(join(dir, pack.cover)), CONTENT_TYPES[extname(pack.cover).toLowerCase()] || 'image/jpeg');
  }

  const rows = [];
  for (const [i, l] of pack.loops.entries()) {
    const bytes = readFileSync(join(dir, l.file));
    const ext = extname(l.file).toLowerCase();
    if (ext !== '.wav' && ext !== '.flac') console.warn(`  ⚠ ${l.file}: se recomienda WAV o FLAC (MP3/AAC desplazan el loop unos ms).`);
    const audioPath = `${slug}/${safeName(l.file)}`;
    await put(cfg, audioPath, bytes, CONTENT_TYPES[ext] || 'application/octet-stream');

    let duration = null, previewPath = null;
    if (ext === '.wav') {
      const wav = readWav(bytes);
      duration = Math.round(wav.duration * 1000) / 1000;
      const expected = l.bars * (l.beatsPerBar || 4) * 60 / l.bpm;
      if (Math.abs(duration - expected) > 0.05) {
        console.warn(`  ⚠ ${l.file}: dura ${duration.toFixed(2)} s pero ${l.bars} compases a ${l.bpm} BPM son ${expected.toFixed(2)} s. Revisa bpm/bars.`);
      }
      previewPath = `${slug}/preview/${safeName(l.file)}`;
      await put(cfg, previewPath, previewWav(wav), 'audio/wav');
    } else if (l.preview) {
      previewPath = `${slug}/preview/${safeName(l.preview)}`;
      await put(cfg, previewPath, readFileSync(join(dir, l.preview)), CONTENT_TYPES[extname(l.preview).toLowerCase()] || 'audio/mpeg');
    } else {
      console.warn(`  ⚠ ${l.file}: sin escucha previa (solo se genera sola desde WAV). En packs Pro, quien no es Pro no podrá escucharlo.`);
    }

    rows.push({
      title: l.title, instrument: l.instrument, section: l.section || 'any',
      bpm: l.bpm, musical_key: l.key || null, beats_per_bar: l.beatsPerBar || 4, beat_value: l.beatValue || 4,
      bars: l.bars, tier: l.tier || pack.tier, audio_path: audioPath, preview_path: previewPath, size: bytes.length,
      duration_sec: duration, tags: l.tags || [], sort: l.sort ?? i,
    });
    console.log(`  ✓ ${l.title}`);
  }

  const [saved] = await db(cfg, '/stem_packs?on_conflict=slug', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      slug, title: pack.title, description: pack.description || null, cover_path: coverPath,
      genre: pack.genre || null, mood: pack.mood || null, tier: pack.tier,
      published: !!pack.published, sort: pack.sort || 0, updated_at: new Date().toISOString(),
    },
  });
  await db(cfg, `/stem_loops?pack_id=eq.${saved.id}`, { method: 'DELETE' });
  await db(cfg, '/stem_loops', { method: 'POST', body: rows.map((r) => ({ ...r, pack_id: saved.id })) });
  console.log(`Listo: ${rows.length} loops ${pack.published ? 'publicados' : 'en borrador (published: false)'}.`);
}

async function remove(cfg, slug) {
  const packs = await db(cfg, `/stem_packs?slug=eq.${encodeURIComponent(slug)}&select=id,cover_path,stem_loops(audio_path,preview_path)`);
  if (!packs.length) { console.log(`No existe el pack "${slug}".`); return; }
  const p = packs[0];
  const keys = [p.cover_path, ...p.stem_loops.flatMap((l) => [l.audio_path, l.preview_path])].filter(Boolean);
  for (const k of keys) await del(cfg, k);
  await db(cfg, `/stem_packs?id=eq.${p.id}`, { method: 'DELETE' }); // los loops caen en cascada
  console.log(`Pack "${slug}" borrado (${keys.length} archivos de R2).`);
}

const args = process.argv.slice(2);
try {
  const cfg = loadConfig();
  if (args[0] === '--delete' && args[1]) await remove(cfg, args[1]);
  else if (args[0] && !args[0].startsWith('--')) await upload(cfg, args[0]);
  else {
    console.error('Uso:\n  node scripts/stem-library/upload-pack.mjs <carpeta>\n  node scripts/stem-library/upload-pack.mjs --delete <slug>');
    process.exit(1);
  }
} catch (e) {
  console.error('✖ ' + e.message);
  process.exit(1);
}
