// Downloads the stem-separation ONNX model into ./models (gitignored).
// Run before packaging if models/ is empty:  node scripts/fetch-models.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const REL = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models';
const MODELS = [
  { name: 'UVR-MDX-NET-Inst_HQ_3.onnx', url: `${REL}/UVR-MDX-NET-Inst_HQ_3.onnx` }, // 2-stem voz/inst
  { name: 'kuielab_a_vocals.onnx',      url: `${REL}/kuielab_a_vocals.onnx` },       // 4-stem set
  { name: 'kuielab_a_drums.onnx',       url: `${REL}/kuielab_a_drums.onnx` },
  { name: 'kuielab_a_bass.onnx',        url: `${REL}/kuielab_a_bass.onnx` },
  { name: 'kuielab_a_other.onnx',       url: `${REL}/kuielab_a_other.onnx` },
];

const dir = path.join(root, 'models');
fs.mkdirSync(dir, { recursive: true });

for (const m of MODELS) {
  const dest = path.join(dir, m.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`✓ ${m.name} already present`);
    continue;
  }
  console.log(`downloading ${m.name} ...`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${m.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`✓ saved ${m.name} (${(buf.length / 1e6).toFixed(1)}MB)`);
}
console.log('done.');
