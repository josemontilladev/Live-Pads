// Ajustes → Audio → «Sonido general»: volumen igualado entre canciones (audio/loudness.js) y
// ecualizador + techo de seguridad del bus principal (audio/mainBus.js).
import { q } from '../utils/dom.js';
import { normalizeOn, setNormalize } from '../audio/loudness.js';
import { mainEqPrefs, setMainEq } from '../audio/mainBus.js';
import { syncPanSlider } from '../utils/sliders.js';

export function initSoundSetting() {
  const norm = q('#norm-switch'), bass = q('#eq-bass'), treble = q('#eq-treble'), ceil = q('#eq-ceiling');
  if (!norm || !bass || !treble || !ceil) return;
  const fmt = (v) => `${v > 0 ? '+' : ''}${v} dB`;
  const paint = () => {
    const p = mainEqPrefs();
    norm.checked = normalizeOn();
    bass.value = p.bass; treble.value = p.treble; ceil.value = String(p.ceiling);
    q('#eq-bass-val').textContent = fmt(p.bass);
    q('#eq-treble-val').textContent = fmt(p.treble);
    try { syncPanSlider(bass); syncPanSlider(treble); } catch (_) {}   // relleno desde el centro (0 dB)
  };
  norm.addEventListener('change', () => setNormalize(norm.checked));
  bass.addEventListener('input', () => { setMainEq({ bass: Number(bass.value) }); paint(); });
  treble.addEventListener('input', () => { setMainEq({ treble: Number(treble.value) }); paint(); });
  ceil.addEventListener('change', () => { setMainEq({ ceiling: Number(ceil.value) }); paint(); });
  // Doble clic en un deslizador = volver a 0 dB.
  for (const s of [bass, treble]) s.addEventListener('dblclick', () => { setMainEq({ [s === bass ? 'bass' : 'treble']: 0 }); paint(); });
  paint();
}
