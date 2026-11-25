// Publica la página del móvil (companion/client) en GitHub Pages:
// repositorio josemontilladev/livepads-companion → https://companion.livepads.online/
// (o el subdominio propio si se configura: ver CNAME).
// Uso: npm run publish:companion   (necesita `gh` con sesión iniciada)
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'companion', 'client');
const REPO = 'josemontilladev/livepads-companion';
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

// La configuración de la nube sale siempre de la app (misma clave pública).
const cfg = fs.readFileSync(path.join(ROOT, 'src', 'js', 'cloud', 'config.js'), 'utf8');
const url = /SUPABASE_URL = '([^']+)'/.exec(cfg)[1], key = /SUPABASE_ANON_KEY = '([^']+)'/.exec(cfg)[1];
fs.writeFileSync(path.join(SRC, 'cloud-config.js'), `// Nube de LivePads (clave pública, la misma que lleva la app). La genera scripts/publish-companion.cjs.\nwindow.LP_CLOUD = { url: '${url}', key: '${key}' };\n`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-companion-'));
run(`gh repo clone ${REPO} "${tmp}" -- --depth 1`);
for (const f of fs.readdirSync(tmp)) if (!['.git', 'CNAME', 'README.md', '.nojekyll'].includes(f)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
fs.cpSync(SRC, tmp, { recursive: true });
run('git add -A', tmp);
try { execSync('git diff --cached --quiet', { cwd: tmp }); console.log('Sin cambios: la página ya está al día.'); }
catch (_) {
  run('git -c user.name=josemontilladev -c user.email=josemontilladev@users.noreply.github.com commit -m "Actualizar Companion"', tmp);
  run('git push', tmp);
  console.log('Publicado. GitHub Pages tarda 1-2 minutos en actualizarse.');
}
fs.rmSync(tmp, { recursive: true, force: true });
