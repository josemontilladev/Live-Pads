// Genera src/js/cloud/googleSecret.js con el secreto del cliente OAuth de
// escritorio de Google (inicio de sesión con Google sin pasar por Supabase).
//
// El secreto no se guarda en el repositorio (git ignora el archivo generado).
// De dónde se lee, por orden:
//   1. variable de entorno GOOGLE_DESKTOP_CLIENT_SECRET (CI: secreto de GitHub Actions)
//   2. scripts/.env.google con la línea  GOOGLE_DESKTOP_CLIENT_SECRET=GOCSPX-...
//      (local; git lo ignora por el patrón .env.* y Syncthing lo comparte)
//
// Sin secreto: en CI falla (no publicar un instalador sin Google directo); en
// local avisa y deja la app con el flujo anterior a través de Supabase.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'js', 'cloud', 'googleSecret.js');
const LOCAL = join(ROOT, 'scripts', '.env.google');

let secret = (process.env.GOOGLE_DESKTOP_CLIENT_SECRET || '').trim();
if (!secret && existsSync(LOCAL)) {
  const m = readFileSync(LOCAL, 'utf8').match(/^\s*GOOGLE_DESKTOP_CLIENT_SECRET\s*=\s*["']?([^"'\s]+)/m);
  if (m) secret = m[1];
}

if (!secret) {
  if (process.env.CI) {
    console.error('✖ Falta GOOGLE_DESKTOP_CLIENT_SECRET (secreto del repositorio en GitHub → Settings → Secrets → Actions).');
    process.exit(1);
  }
  if (!existsSync(OUT)) console.warn('⚠ Sin secreto de Google de escritorio: la app usará el inicio con Google a través de Supabase.');
  process.exit(0);
}
if (!/^GOCSPX-[\w-]+$/.test(secret)) {
  console.error('✖ El secreto de Google no tiene el formato esperado (GOCSPX-…).');
  process.exit(1);
}

writeFileSync(OUT, `// Generado por scripts/write-google-secret.mjs — NO editar ni subir a git.
// Secreto del cliente OAuth "App de escritorio" (no confidencial en apps de
// escritorio: la seguridad del inicio con Google la da PKCE).
export const GOOGLE_DESKTOP_CLIENT_SECRET = ${JSON.stringify(secret)};
`);
console.log('✓ googleSecret.js generado');
