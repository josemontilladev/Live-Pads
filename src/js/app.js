import { SynthEngine } from './audio/SynthEngine.js';
import { Metronome }   from './audio/Metronome.js';
import { PAD_BANKS, KIT_BANKS, THEMES } from './data/banks.js';

const KEYS_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const KEYS_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

let engine, metro;
let activeKey = null;
let useFlats = false;
let padBankIdx = 0, kitBankIdx = 0;
let currentTheme = 'gi_setlist';
let metroRunning = false;
let presets = [];

const KEY_MAP_PADS  = ['1','2','3','4','5','6','7','8','9','0','-','='];
const KEY_MAP_DRUMS = ['Q','W','E','R','A','S','D','F'];

const q  = s => document.querySelector(s);
const qa = s => document.querySelectorAll(s);

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  engine = new SynthEngine();
  await engine.init();
  await engine.loadClickBuffers();    // load real click audio files
  // Pad Amb files are lazy-loaded on first keypress (files are ~48MB each)
  metro = new Metronome(engine);
  metro.onBeat = onMetroBeat;
  metro.sound = 'cowbell';  // default: Cowbell

  applyTheme(currentTheme);
  loadPadBank(0);
  loadKitBank(0);
  buildKeyGrid();
  buildMetroBeatDots(4);
  buildThemesList();
  bindAll();
  loadPresets();

  q('#sidebar').classList.remove('open');
});

/* ── PAD BANK ── */
function loadPadBank(idx) {
  padBankIdx = ((idx % PAD_BANKS.length) + PAD_BANKS.length) % PAD_BANKS.length;
  const bank = PAD_BANKS[padBankIdx];
  q('#pad-bank-name').textContent = bank.name;
  engine.setPadBank(bank);
  if (activeKey) engine.playPad(activeKey);
  buildPadBankList();
}

/* ── KIT BANK ── */
function loadKitBank(idx) {
  kitBankIdx = ((idx % KIT_BANKS.length) + KIT_BANKS.length) % KIT_BANKS.length;
  const kit = KIT_BANKS[kitBankIdx];
  q('#kit-bank-name').textContent = kit.name;
  engine.initDrumVolumes(kit.pads);
  buildDrumGrid(kit.pads);
  buildDrumVolumes(kit.pads);
  buildKitBankList();
  // Load real WAV samples in background
  engine.loadKitSamples(kit.pads).then(loadedIds => {
    loadedIds.forEach(id => {
      const btn = q(`.drum-btn[data-drum="${id}"]`);
      if (btn) btn.classList.add('has-sample');
    });
  });
}

/* ── KEY GRID ── */
function buildKeyGrid() {
  const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
  const grid = q('#key-grid'); grid.innerHTML = '';
  keys.forEach((key, keyIdx) => {
    const btn = document.createElement('button');
    btn.className = 'key-btn' + (key === activeKey ? ' active' : '');
    btn.dataset.key = key;
    btn.innerHTML = `<span>${key}</span><span class="kbd-hint">${KEY_MAP_PADS[keyIdx]}</span>`;
    btn.onclick = () => onKeyClick(key);
    grid.appendChild(btn);
  });
}

function onKeyClick(key) {
  if (activeKey === key) { engine.stopPad(); activeKey = null; }
  else { engine.playPad(key, PAD_BANKS[padBankIdx].synth); activeKey = key; }
  qa('.key-btn').forEach(b => b.classList.toggle('active', b.dataset.key === activeKey));
}

/* ── DRUM GRID ── */
function buildDrumGrid(pads) {
  const grid = q('#drum-grid'); grid.innerHTML = '';
  pads.forEach((pad, i) => {
    const btn = document.createElement('button');
    btn.className = 'drum-btn'; btn.dataset.drum = pad.id; btn.dataset.type = pad.type;
    btn.innerHTML = `<span class="drum-label">${pad.label}</span><span class="kbd-hint">${KEY_MAP_DRUMS[i]}</span>`;
    btn.onmousedown = () => hitDrum(pad.id, pad.type, btn);
    btn.addEventListener('touchstart', e => { e.preventDefault(); hitDrum(pad.id, pad.type, btn); });
    grid.appendChild(btn);
  });
}

function hitDrum(id, type, btn) {
  if (!engine.playCustomDrum(id, id)) engine.playDrum(type, id);
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 120);
}

/* ── DRUM VOLUMES ── */
function buildDrumVolumes(pads) {
  const container = q('#drum-volumes'); container.innerHTML = '';
  const sbContainer = q('#sidebar-drum-volumes'); sbContainer.innerHTML = '';
  for (const pad of pads) {
    const item = document.createElement('div'); item.className='drum-vol-item';
    item.innerHTML = `
      <div class="drum-vol-header">
        <label>${pad.label}</label>
        <span class="drum-vol-pct" id="dpct-${pad.id}">80%</span>
      </div>
      <input type="range" min="0" max="100" value="80" id="dvol-${pad.id}">`;
    container.appendChild(item);

    const sbItem = document.createElement('div'); sbItem.className='sb-row'; sbItem.style.padding='0';
    sbItem.innerHTML = `<span class="sr-label" style="min-width:70px;">${pad.label}</span>
      <input type="range" min="0" max="100" value="80" id="sb-dvol-${pad.id}" class="blue-slider">
      <span class="sr-val" id="sb-dpct-${pad.id}">80%</span>`;
    sbContainer.appendChild(sbItem);

    const slider   = item.querySelector('input');
    const sbSlider = sbItem.querySelector('input');
    const pctEl    = item.querySelector('.drum-vol-pct');
    const sbPctEl  = sbItem.querySelector('.sr-val');

    slider.oninput = function() {
      engine.setDrumPadVolume(pad.id, this.value/100);
      sbSlider.value = this.value;
      pctEl.textContent = this.value + '%';
      sbPctEl.textContent = this.value + '%';
      syncSlider(this); syncSlider(sbSlider);
    };
    sbSlider.oninput = function() {
      engine.setDrumPadVolume(pad.id, this.value/100);
      slider.value = this.value;
      pctEl.textContent = this.value + '%';
      sbPctEl.textContent = this.value + '%';
      syncSlider(this); syncSlider(slider);
    };
    syncSlider(slider); syncSlider(sbSlider);
  }
}

/* ── METRO BEAT DOTS ── */
function buildMetroBeatDots(n) {
  const c = q('#metro-beat-dots'); if (!c) return;
  c.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'beat-dot' + (i === 0 ? ' accent' : '');
    d.dataset.beat = i;
    c.appendChild(d);
  }
}

function onMetroBeat(beat) {
  qa('.beat-dot').forEach(d => {
    d.classList.toggle('on', parseInt(d.dataset.beat) === beat);
  });
  q('#metro-bpm-live').textContent = metro.bpm + ' BPM';
}

/* ── THEME ── */
function applyTheme(id) {
  currentTheme = id;
  const t = THEMES[id]; if (!t) return;
  const s = document.documentElement.style;
  s.setProperty('--blue', t.blue);
  s.setProperty('--bg-main', t.bg1);
  s.setProperty('--bg-card', t.bg2);
  s.setProperty('--bg-surface', t.bg3);
  s.setProperty('--bg-hover', t.bgHover || '#1f1f1f');
  s.setProperty('--border', t.border || 'rgba(255,255,255,0.08)');
  
  // Optional text color
  s.setProperty('--text', t.text || '#ffffff');
  s.setProperty('--text-muted', t.textMuted || '#a3a3a3');
  
  document.body.style.background = `linear-gradient(155deg, ${t.bg1} 0%, ${t.bg2} 50%, ${t.bg1} 100%)`;
  buildThemesList();
}

function buildThemesList() {
  const container = q('#themes-list'); if (!container) return;
  container.innerHTML = '';
  Object.keys(THEMES).forEach(id => {
    const t = THEMES[id];
    const item = document.createElement('div');
    item.className = 'theme-item' + (currentTheme === id ? ' active' : '');
    item.innerHTML = `
      <div class="theme-swatch" style="background:${t.swatch}"></div>
      <div class="theme-info">
        <div class="theme-name">${t.name}</div>
        <div class="theme-desc">${t.desc}</div>
      </div>
      ${currentTheme === id ? '<div class="theme-check"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><polyline points="20,6 9,17 4,12"/></svg></div>' : ''}
    `;
    item.onclick = () => applyTheme(id);
    container.appendChild(item);
    const div = document.createElement('div'); div.className='theme-div'; container.appendChild(div);
  });
}

/* ── SYNC SLIDER ── */
function syncSlider(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  if (!el.classList.contains('grey-slider')) {
    el.style.background = `linear-gradient(to right,var(--blue) ${pct}%,rgba(255,255,255,.12) ${pct}%)`;
  }
}

function bindToggle(el, cb) {
  el.onclick = () => { el.classList.toggle('on'); cb(el.classList.contains('on')); };
}

/* ── BIND ALL ── */
function bindAll() {
  const api = window.electronAPI;

  // Window controls
  if (api) {
    q('#btn-min').onclick   = () => api.windowAction('minimize');
    q('#btn-max').onclick   = () => api.windowAction('maximize');
    q('#btn-close').onclick = () => api.windowAction('close');
  }

  // Sidebar
  q('#btn-settings-toggle').onclick = () => q('#sidebar').classList.toggle('open');
  q('#sidebar-overlay').onclick = () => q('#sidebar').classList.remove('open');

  qa('.stab').forEach(btn => {
    btn.onclick = () => {
      qa('.stab').forEach(b => b.classList.remove('active'));
      qa('.stab-body').forEach(b => b.classList.remove('visible'));
      btn.classList.add('active');
      q(`#tab-${btn.dataset.tab}`).classList.add('visible');
    };
  });

  // Hamburger
  q('#btn-menu').onclick = () => {
    const pop = q('#menu-popover'), ov = q('#menu-overlay');
    const vis = !pop.classList.contains('hidden');
    pop.classList.toggle('hidden', vis); ov.classList.toggle('hidden', vis);
  };
  window.closeMenu = closeAllOverlays;
  q('#menu-pad-sounds').onclick  = () => { closeMenu(); openPicker('pad'); };
  q('#menu-drum-kits').onclick   = () => { closeMenu(); openPicker('kit'); };
  q('#menu-save-set').onclick    = () => { closeMenu(); showDialog('Guardar set', doSavePreset); };
  q('#menu-open-settings').onclick = () => { closeMenu(); openSidebarTab('settings'); };
  q('#menu-open-themes').onclick   = () => { closeMenu(); openSidebarTab('themes'); };

  // Bank arrows
  q('#pad-bank-prev').onclick = () => loadPadBank(padBankIdx - 1);
  q('#pad-bank-next').onclick = () => loadPadBank(padBankIdx + 1);
  q('#kit-bank-prev').onclick = () => loadKitBank(kitBankIdx - 1);
  q('#kit-bank-next').onclick = () => loadKitBank(kitBankIdx + 1);
  q('#bank-row-pad').onclick  = e => { if (!e.target.closest('.bank-arrow')) openPicker('pad'); };
  q('#bank-row-kit').onclick  = e => { if (!e.target.closest('.bank-arrow')) openPicker('kit'); };

  // Pad volume (stage)
  const pvolStage = q('#pad-vol-stage'), pvolValStage = q('#pad-vol-val-stage');
  const pvol = q('#pad-vol'), pvolVal = q('#pad-vol-val');
  const updatePadVol = val => {
    engine.setPadVolume(val / 100);
    pvol.value = val; pvolStage.value = val;
    pvolVal.textContent = val + '%'; pvolValStage.textContent = val + '%';
    syncSlider(pvol); syncSlider(pvolStage);
  };
  pvolStage.oninput = () => updatePadVol(pvolStage.value);
  pvol.oninput = () => updatePadVol(pvol.value);
  syncSlider(pvol); syncSlider(pvolStage);

  // Pad pan
  const ppanStage = q('#pad-pan-stage'), ppanValStage = q('#pad-pan-val-stage');
  const ppan = q('#pad-pan'), ppanVal = q('#pad-pan-val');
  const updatePadPan = val => {
    engine.setPadPan(val / 100);
    ppan.value = val; ppanStage.value = val;
    ppanVal.textContent = panLabel(val); ppanValStage.textContent = panShort(val);
    syncPanSlider(ppanStage); syncPanSlider(ppan);
  };
  ppanStage.oninput = () => updatePadPan(ppanStage.value);
  ppan.oninput = () => updatePadPan(ppan.value);
  syncPanSlider(ppanStage); syncPanSlider(ppan);

  // Drum pan
  const drumPanStage = q('#drum-pan-stage'), drumPanVal = q('#drum-pan-val-stage');
  drumPanStage.oninput = () => {
    engine.setDrumPan(drumPanStage.value / 100);
    drumPanVal.textContent = panShort(drumPanStage.value);
    syncPanSlider(drumPanStage);
  };
  syncPanSlider(drumPanStage);
  drumPanVal.textContent = 'C';

  // LPF
  const lpfStage = q('#pad-lpf-stage'), lpfToggleStage = q('#lpf-toggle-stage');
  const lpf = q('#pad-lpf'), lpfToggle = q('#lpf-toggle');
  const updateLPF = (val, on) => {
    engine.setLPF(parseInt(val), on);
    lpf.value = val; lpfStage.value = val;
    lpfToggle.className = 'toggle-sw ' + (on ? 'on' : '');
    lpfToggleStage.className = 'toggle-sw ' + (on ? 'on' : '');
    syncSlider(lpf); syncSlider(lpfStage);
  };
  lpfStage.oninput = () => updateLPF(lpfStage.value, lpfToggleStage.classList.contains('on'));
  lpf.oninput = () => updateLPF(lpf.value, lpfToggle.classList.contains('on'));
  bindToggle(lpfToggleStage, on => updateLPF(lpfStage.value, on));
  bindToggle(lpfToggle, on => updateLPF(lpf.value, on));
  syncSlider(lpf); syncSlider(lpfStage);

  // Master vol
  const mvol = q('#master-vol'), mvolVal = q('#master-vol-val');
  mvol.oninput = () => {
    engine.setMasterVolume(mvol.value / 100);
    mvolVal.textContent = mvol.value + '%';
    syncSlider(mvol);
  };
  syncSlider(mvol);

  // ── METRO START/STOP ──
  q('#btn-metro-main').onclick = toggleMetro;

  // BPM
  const bpmSlider = q('#bpm-slider'), bpmDisp = q('#bpm-display');
  const updateBPM = v => {
    metro.setBPM(v);
    bpmSlider.value = metro.bpm;
    bpmDisp.textContent = metro.bpm;
    q('#metro-bpm-live').textContent = metro.bpm + ' BPM';
    syncSlider(bpmSlider);
  };
  bpmSlider.oninput = () => updateBPM(parseInt(bpmSlider.value));
  q('#bpm-minus').onclick = () => updateBPM(metro.bpm - 1);
  q('#bpm-plus').onclick  = () => updateBPM(metro.bpm + 1);
  q('#tap-tempo').onclick = () => updateBPM(metro.tap());
  syncSlider(bpmSlider);
  q('#metro-bpm-live').textContent = metro.bpm + ' BPM';

  // Time signatures
  qa('.sig-btn').forEach(btn => {
    btn.onclick = () => {
      const n = parseInt(btn.dataset.v);
      metro.setBeats(n);
      qa('.sig-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildMetroBeatDots(n);
    };
  });
  // Default 4/4
  q('.sig-btn[data-v="4"]').classList.add('active');
  q('.sig-btn[data-v="2"]').classList.remove('active');
  metro.setBeats(4);
  buildMetroBeatDots(4);

  // Multiplier
  q('#btn-mult-1').onclick = () => {
    metro.multiplier = 1;
    q('#btn-mult-1').classList.add('active');
    q('#btn-mult-2').classList.remove('active');
    if (metro.running) { metro.stop(); metro.start(); }
  };
  q('#btn-mult-2').onclick = () => {
    metro.multiplier = 2;
    q('#btn-mult-2').classList.add('active');
    q('#btn-mult-1').classList.remove('active');
    if (metro.running) { metro.stop(); metro.start(); }
  };

  // Click sound — Click Tracks profesionales
  metro.sound = 'cowbell';   // default
  const setSound = (btn, sound) => {
    qa('[id^="btn-ms-"]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    metro.sound = sound;
  };
  q('#btn-ms-classic').onclick    = e => setSound(e.currentTarget, 'classic');
  q('#btn-ms-woodblock').onclick  = e => setSound(e.currentTarget, 'woodblock');
  q('#btn-ms-percussive').onclick = e => setSound(e.currentTarget, 'percussive');
  q('#btn-ms-gentle').onclick     = e => setSound(e.currentTarget, 'gentle');
  q('#btn-ms-blip').onclick       = e => setSound(e.currentTarget, 'blip');
  q('#btn-ms-digital').onclick    = e => setSound(e.currentTarget, 'digital');
  q('#btn-ms-cowbell').onclick    = e => setSound(e.currentTarget, 'cowbell');

  // Metro volume + pan
  const metroVolSlider = q('#metro-vol-slider'), metroVolVal = q('#metro-vol-val');
  metroVolSlider.oninput = () => {
    metro.volume = metroVolSlider.value / 100;
    metroVolVal.textContent = metroVolSlider.value + '%';
    syncSlider(metroVolSlider);
  };
  syncSlider(metroVolSlider);

  const metroPanSlider = q('#metro-pan-slider'), metroPanVal = q('#metro-pan-val');
  metroPanSlider.oninput = () => {
    metro.pan = metroPanSlider.value / 100;
    metroPanVal.textContent = panShort(metroPanSlider.value);
    syncPanSlider(metroPanSlider);
  };
  syncPanSlider(metroPanSlider);
  metroPanVal.textContent = 'C';

  // Notation
  q('#btn-flats').onclick  = () => { useFlats = true;  q('#btn-flats').classList.add('active');  q('#btn-sharps').classList.remove('active'); buildKeyGrid(); };
  q('#btn-sharps').onclick = () => { useFlats = false; q('#btn-sharps').classList.add('active'); q('#btn-flats').classList.remove('active');  buildKeyGrid(); };

  // Setlist
  q('#btn-add-preset').onclick = () => showDialog('Guardar set', doSavePreset);

  // MIDI
  engine.initMIDI(msg => {
    const [cmd, note, velocity] = msg.data;
    if (cmd >= 144 && cmd <= 159 && velocity > 0) {
      if (note >= 60 && note <= 71) {
        const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
        onKeyClick(keys[note - 60]);
      } else {
        const kit = KIT_BANKS[kitBankIdx];
        if (!kit) return;
        const typeMap = { 36:'kick',38:'snare',40:'snare',39:'clap',42:'hihatC',44:'hihatC',46:'hihatO',50:'tomH',47:'tomM',43:'tomL',41:'tomL',49:'crash',55:'crash',51:'ride',54:'tamb',56:'cowbell',81:'shaker',82:'shaker' };
        const mappedType = typeMap[note];
        if (mappedType) {
          const pad = kit.pads.find(p => p.type === mappedType || p.id.includes(mappedType));
          if (pad) { const btn = q(`.drum-btn[data-drum="${pad.id}"]`); hitDrum(pad.id, pad.type, btn); }
        }
      }
    }
  });

  // Dialog
  q('#dialog-cancel').onclick = hideDialog;
  q('#dialog-ok').onclick = () => { doSavePreset(q('#dialog-name').value.trim()); hideDialog(); };

  // Keyboard
  document.addEventListener('keydown', onKey);

  // Close pickers on click outside
  document.addEventListener('click', () => {
    q('#pad-bank-picker').classList.add('hidden');
    q('#kit-bank-picker').classList.add('hidden');
  });
}

function toggleMetro() {
  metroRunning = metro.toggle();
  const btn = q('#btn-metro-main');
  btn.innerHTML = metroRunning
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener metrónomo'
    : '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5,3 19,12 5,21"/></svg> Iniciar metrónomo';
  btn.classList.toggle('running', metroRunning);
  if (!metroRunning) {
    qa('.beat-dot').forEach(d => d.classList.remove('on'));
  }
}

function openSidebarTab(tab) {
  q('#sidebar').classList.add('open');
  qa('.stab').forEach(b => b.classList.remove('active'));
  qa('.stab-body').forEach(b => b.classList.remove('visible'));
  q(`.stab[data-tab="${tab}"]`).classList.add('active');
  q(`#tab-${tab}`).classList.add('visible');
}

function closeAllOverlays() {
  q('#menu-popover').classList.add('hidden');
  q('#menu-overlay').classList.add('hidden');
  q('#dialog-overlay').classList.add('hidden');
  q('#pad-bank-picker').classList.add('hidden');
  q('#kit-bank-picker').classList.add('hidden');
}
window.closeMenu = closeAllOverlays;

function buildPadBankList() {
  const list = q('#pad-bank-list'); list.innerHTML = '<div class="bank-picker-title">Sonidos de pads</div>';
  PAD_BANKS.forEach((b, i) => {
    const btn = document.createElement('button'); btn.className = 'bank-picker-item' + (i === padBankIdx ? ' active' : '');
    btn.innerHTML = `<div class="bank-color" style="background:${b.color}"></div><div><div style="font-weight:700">${b.name}</div><div style="font-size:10px;opacity:.6">${b.desc}</div></div>` + (i === padBankIdx ? '<div class="bank-check"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><polyline points="20,6 9,17 4,12"/></svg></div>' : '');
    btn.onclick = () => { loadPadBank(i); q('#pad-bank-picker').classList.add('hidden'); };
    list.appendChild(btn);
  });
}

function buildKitBankList() {
  const list = q('#kit-bank-list'); list.innerHTML = '<div class="bank-picker-title">Kits de batería</div>';
  KIT_BANKS.forEach((b, i) => {
    const btn = document.createElement('button'); btn.className = 'bank-picker-item' + (i === kitBankIdx ? ' active' : '');
    btn.innerHTML = `<div class="bank-color" style="background:${b.color}"></div><div><div style="font-weight:700">${b.name}</div><div style="font-size:10px;opacity:.6">${b.desc}</div></div>` + (i === kitBankIdx ? '<div class="bank-check"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><polyline points="20,6 9,17 4,12"/></svg></div>' : '');
    btn.onclick = () => { loadKitBank(i); q('#kit-bank-picker').classList.add('hidden'); };
    list.appendChild(btn);
  });
}

function openPicker(type) {
  const picker = q(type === 'pad' ? '#pad-bank-picker' : '#kit-bank-picker');
  const rect = q(type === 'pad' ? '#bank-row-pad' : '#bank-row-kit').getBoundingClientRect();
  picker.style.top = (rect.bottom + 4) + 'px'; picker.style.left = rect.left + 'px';
  picker.classList.toggle('hidden');
}

function panLabel(v) { v = parseInt(v); return v === 0 ? 'Centro' : v < 0 ? `Izq ${Math.abs(v)}` : `Der ${v}`; }
function panShort(v) { v = parseInt(v); return v === 0 ? 'C' : v < 0 ? `L${Math.abs(v)}` : `R${v}`; }

function syncPanSlider(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  const center = 50;
  if (pct === center) {
    el.style.background = `rgba(255,255,255,0.12)`;
  } else if (pct < center) {
    el.style.background = `linear-gradient(to right, rgba(255,255,255,0.06) ${pct}%, var(--blue) ${pct}%, var(--blue) ${center}%, rgba(255,255,255,0.06) ${center}%)`;
  } else {
    el.style.background = `linear-gradient(to right, rgba(255,255,255,0.06) ${center}%, var(--blue) ${center}%, var(--blue) ${pct}%, rgba(255,255,255,0.06) ${pct}%)`;
  }
}

function onKey(e) {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toUpperCase();
  if (e.code === 'Space') { e.preventDefault(); toggleMetro(); }
  if (e.code === 'Escape') { closeAllOverlays(); q('#sidebar').classList.remove('open'); engine.stopPad(); activeKey = null; buildKeyGrid(); }

  const padIdx = KEY_MAP_PADS.indexOf(k);
  if (padIdx !== -1) { const keys = useFlats ? KEYS_FLAT : KEYS_SHARP; onKeyClick(keys[padIdx]); }

  const drumIdx = KEY_MAP_DRUMS.indexOf(k);
  if (drumIdx !== -1) {
    const kit = KIT_BANKS[kitBankIdx];
    const pad = kit.pads[drumIdx];
    if (pad) { const btn = q(`.drum-btn[data-drum="${pad.id}"]`); hitDrum(pad.id, pad.type, btn); }
  }
}

function loadPresets() {
  if (window.electronAPI) window.electronAPI.loadPresets().then(p => { presets = p || []; renderPresets(); });
}

function renderPresets() {
  const list = q('#setlist-list'); list.innerHTML = '';
  if (!presets.length) { list.innerHTML = '<div class="setlist-empty">No hay sets guardados</div>'; return; }
  presets.forEach(p => {
    const el = document.createElement('div'); el.className = 'preset-item';
    el.innerHTML = `<div class="preset-info"><div class="preset-item-name">${p.name}</div><div class="preset-item-meta">${p.key || '—'} · ${p.bpm} BPM</div></div>
    <div class="preset-actions"><button class="pi-play"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5,3 19,12 5,21"/></svg></button></div>`;
    el.onclick = () => applyPreset(p);
    list.appendChild(el);
  });
}

function doSavePreset(name) {
  if (!name) return;
  const p = { id: Date.now().toString(36), name, key: activeKey, bpm: metro.bpm, padBankIdx, kitBankIdx };
  presets.push(p); renderPresets();
  if (window.electronAPI) window.electronAPI.savePreset(p);
}

function applyPreset(p) {
  loadPadBank(p.padBankIdx); loadKitBank(p.kitBankIdx);
  if (p.key) onKeyClick(p.key);
  const updateBPM = v => {
    metro.setBPM(v);
    q('#bpm-slider').value = metro.bpm;
    q('#bpm-display').textContent = metro.bpm;
    q('#metro-bpm-live').textContent = metro.bpm + ' BPM';
    syncSlider(q('#bpm-slider'));
  };
  updateBPM(p.bpm);
}

function showDialog(title) { q('#dialog-title').textContent = title; q('#dialog-overlay').classList.remove('hidden'); q('#dialog-name').value = ''; setTimeout(() => q('#dialog-name').focus(), 50); }
function hideDialog() { q('#dialog-overlay').classList.add('hidden'); }
