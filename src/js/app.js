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
let giSetlistSongs = [];
let currentGiGenre = 'all';
let serviceSongs   = [];
let isEditKitMode  = false;
let customKitMap   = {};
let isMidiLearnMode = false;
let midiLearnTarget = null;
let customMidiMap = {};

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

  if (window.electronAPI && window.electronAPI.loadUserDrums) {
    customKitMap = (await window.electronAPI.loadUserDrums()) || {};
  }
  if (window.electronAPI && window.electronAPI.loadMidiMap) {
    customMidiMap = (await window.electronAPI.loadMidiMap()) || {};
  }
  const customKit = {
    id: 'custom_kit', name: 'Custom Kit (Tus sonidos)',
    desc: 'Batería personalizada (Edita con el ✏️)', color: '#10b981',
    pads: [
      { id: 'c_kick', label: 'Kick', type: 'kick', sample: customKitMap['c_kick'] },
      { id: 'c_snare', label: 'Snare', type: 'snare', sample: customKitMap['c_snare'] },
      { id: 'c_hhc', label: 'HH Cerr', type: 'hihatC', sample: customKitMap['c_hhc'] },
      { id: 'c_clap', label: 'Clap', type: 'clap', sample: customKitMap['c_clap'] },
      { id: 'c_perc1', label: 'Tom 1', type: 'tomH', sample: customKitMap['c_perc1'] },
      { id: 'c_perc2', label: 'Tom 2', type: 'tomM', sample: customKitMap['c_perc2'] },
      { id: 'c_crash', label: 'Crash', type: 'crash', sample: customKitMap['c_crash'] },
      { id: 'c_ride', label: 'Ride', type: 'ride', sample: customKitMap['c_ride'] },
    ]
  };
  KIT_BANKS.push(customKit);

  applyTheme(currentTheme);
  buildBankSelects();
  loadPadBank(2); // Chris Rocha por defecto
  loadKitBank(0);
  buildKeyGrid();
  buildMetroBeatDots(4);
  buildThemesList();
  loadServiceSongs();
  bindAll();
  loadPresets();
  loadGiSetlistFromFile();

  q('#sidebar').classList.remove('open');

  // Hide preloader smoothly
  setTimeout(() => {
    const preloader = q('#preloader');
    if (preloader) {
      preloader.style.opacity = '0';
      preloader.style.visibility = 'hidden';
      setTimeout(() => preloader.remove(), 800); // clean from DOM
    }
  }, 800);
});

/* ── BANK SELECTS ── */
function buildBankSelects() {
  const padSel = q('#pad-bank-select');
  const kitSel = q('#kit-bank-select');
  if (padSel) {
    padSel.innerHTML = PAD_BANKS.map((b, i) => `<option value="${i}">${b.name}</option>`).join('');
    padSel.onchange = (e) => loadPadBank(parseInt(e.target.value));
  }
  if (kitSel) {
    kitSel.innerHTML = KIT_BANKS.map((b, i) => `<option value="${i}">${b.name}</option>`).join('');
    kitSel.onchange = (e) => loadKitBank(parseInt(e.target.value));
  }
}

/* ── PAD BANK ── */
function loadPadBank(idx) {
  padBankIdx = ((idx % PAD_BANKS.length) + PAD_BANKS.length) % PAD_BANKS.length;
  const bank = PAD_BANKS[padBankIdx];
  const padSel = q('#pad-bank-select');
  if (padSel) padSel.value = padBankIdx;
  engine.setPadBank(bank);
  if (activeKey) engine.playPad(activeKey);
}

/* ── KIT BANK ── */
function loadKitBank(idx) {
  kitBankIdx = ((idx % KIT_BANKS.length) + KIT_BANKS.length) % KIT_BANKS.length;
  const kit = KIT_BANKS[kitBankIdx];
  const kitSel = q('#kit-bank-select');
  if (kitSel) kitSel.value = kitBankIdx;
  engine.initDrumVolumes(kit.pads);
  buildDrumGrid(kit.pads);
  buildDrumVolumes(kit.pads);
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
  if (activeKey === key) { 
    engine.stopPad(); 
    activeKey = null; 
    preparedPadKey = key; // Keep it prepared
    qa('.key-btn').forEach(b => {
      b.classList.remove('active');
      if(b.dataset.key === key) b.classList.add('prepared');
    });
  }
  else { 
    engine.playPad(key, PAD_BANKS[padBankIdx].synth); 
    activeKey = key; 
    preparedPadKey = null;
    qa('.key-btn').forEach(b => {
      b.classList.remove('prepared');
      b.classList.toggle('active', b.dataset.key === activeKey);
    });
  }
}

let preparedPadKey = null;

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

async function hitDrum(id, type, btn) {
  if (isEditKitMode) {
    if (!window.electronAPI) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/mp3, audio/wav';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const resPath = await window.electronAPI.assignDrumSample({ sourcePath: file.path, padName: id });
      if (resPath) {
        customKitMap[id] = resPath;
        await window.electronAPI.saveUserDrums(customKitMap);
        const ckit = KIT_BANKS.find(k => k.id === 'custom_kit');
        if (ckit) {
          const pad = ckit.pads.find(p => p.id === id);
          if (pad) pad.sample = resPath;
        }
        engine.loadKitSamples(KIT_BANKS[kitBankIdx].pads).then(() => {
          btn.classList.add('has-sample');
          btn.style.borderColor = 'var(--blue)';
        });
      }
    };
    input.click();
    return;
  }
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
    d.className = 'beat-dot' + (metro.accents.includes(i) ? ' accent' : '');
    d.dataset.beat = i;
    d.title = metro.accents.includes(i) ? 'Acento activo (Click para quitar)' : 'Click para acentuar';
    d.onclick = () => {
      metro.toggleAccent(i);
      d.classList.toggle('accent', metro.accents.includes(i));
      d.title = metro.accents.includes(i) ? 'Acento activo (Click para quitar)' : 'Click para acentuar';
    };
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

  const btnEditKit = q('#btn-edit-kit');
  if (btnEditKit) {
    btnEditKit.onclick = () => {
      isEditKitMode = !isEditKitMode;
      btnEditKit.style.color = isEditKitMode ? 'var(--blue)' : 'var(--text-muted)';
      btnEditKit.style.borderColor = isEditKitMode ? 'var(--blue)' : 'var(--border)';
      if (isEditKitMode) {
        const customIdx = KIT_BANKS.findIndex(k => k.id === 'custom_kit');
        if (customIdx >= 0) {
          q('#kit-bank-select').value = customIdx;
          loadKitBank(customIdx);
        }
      }
    };
  }

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
  const btnMidiLearn = q('#menu-midi-learn');
  if (btnMidiLearn) {
    btnMidiLearn.onclick = () => {
      closeMenu();
      isMidiLearnMode = true;
      midiLearnTarget = null;
      q('#midi-learn-overlay').innerHTML = '🎹 Modo Mapeo MIDI: Haz clic en un botón de la app. (Clic aquí para salir)';
      q('#midi-learn-overlay').style.display = 'block';
    };
  }

  // Bank arrows (Removed, now using dropdowns)


  // Pad volume (stage)
  const pvolStage = q('#pad-vol-stage'), pvolValStage = q('#pad-vol-val-stage');
  const pvol = q('#pad-vol'), pvolVal = q('#pad-vol-val');
  const updatePadVol = val => {
    engine.setPadVolume(val / 100);
    if (pvol) { pvol.value = val; pvolVal.textContent = val + '%'; syncSlider(pvol); }
    if (pvolStage) { pvolStage.value = val; pvolValStage.textContent = val + '%'; syncSlider(pvolStage); }
  };
  if (pvolStage) pvolStage.oninput = () => updatePadVol(pvolStage.value);
  if (pvol) pvol.oninput = () => updatePadVol(pvol.value);
  if (pvol) syncSlider(pvol);
  if (pvolStage) syncSlider(pvolStage);

  // Pad pan
  const ppanStage = q('#pad-pan-stage'), ppanValStage = q('#pad-pan-val-stage');
  const ppan = q('#pad-pan'), ppanVal = q('#pad-pan-val');
  const updatePadPan = val => {
    engine.setPadPan(val / 100);
    if (ppan) { ppan.value = val; ppanVal.textContent = panShort(val); syncPanSlider(ppan); }
    if (ppanStage) { ppanStage.value = val; ppanValStage.textContent = panShort(val); syncPanSlider(ppanStage); }
  };
  if (ppanStage) ppanStage.oninput = () => updatePadPan(ppanStage.value);
  if (ppan) ppan.oninput = () => updatePadPan(ppan.value);
  if (ppanStage) updatePadPan(ppanStage.value);

  // Drum pan
  const drumPanStage = q('#drum-pan-stage'), drumPanVal = q('#drum-pan-val-stage');
  const updateDrumPan = () => {
    engine.setDrumPan(drumPanStage.value / 100);
    drumPanVal.textContent = panShort(drumPanStage.value);
    syncPanSlider(drumPanStage);
  };
  drumPanStage.oninput = updateDrumPan;
  updateDrumPan();

  // LPF
  const lpfStage = q('#pad-lpf-stage'), lpfToggleStage = q('#lpf-toggle-stage');
  const lpf = q('#pad-lpf'), lpfToggle = q('#lpf-toggle');
  const updateLPF = (val, on) => {
    engine.setLPF(parseInt(val), on);
    if (lpf) {
      lpf.value = val;
      lpfToggle.className = 'toggle-sw ' + (on ? 'on' : '');
      syncSlider(lpf);
    }
    if (lpfStage) {
      lpfStage.value = val;
      lpfToggleStage.className = 'toggle-sw ' + (on ? 'on' : '');
      syncSlider(lpfStage);
    }
  };
  if (lpfStage) {
    lpfStage.oninput = () => updateLPF(lpfStage.value, lpfToggleStage.classList.contains('on'));
    bindToggle(lpfToggleStage, on => updateLPF(lpfStage.value, on));
  }
  if (lpf) {
    lpf.oninput = () => updateLPF(lpf.value, lpfToggle.classList.contains('on'));
    bindToggle(lpfToggle, on => updateLPF(lpf.value, on));
    syncSlider(lpf);
  }
  if (lpfStage) syncSlider(lpfStage);

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

  window.updateBPM = updateBPM; // Make it accessible globally for GI-Setlist

  // Time signatures (ahora es un select dropdown)
  const sigSelect = q('#metro-sig-select');
  if (sigSelect) {
    sigSelect.value = '4'; // 4/4 por defecto
    sigSelect.onchange = (e) => {
      const n = parseInt(e.target.value);
      metro.setBeats(n);
      buildMetroBeatDots(n);
    };
  }
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

  // Accent toggle — acentúa el primer tiempo del compás (Removed, now click dots)


  // Click sound — Select dropdown
  metro.sound = 'cowbell';   // default
  const soundSelect = q('#metro-sound-select');
  if (soundSelect) {
    soundSelect.value = 'cowbell';
    soundSelect.onchange = (e) => { metro.sound = e.target.value; };
  }

  // Metro volume + pan
  const metroVolSlider = q('#metro-vol-slider'), metroVolVal = q('#metro-vol-val');
  metroVolSlider.oninput = () => {
    metro.volume = metroVolSlider.value / 100;
    metroVolVal.textContent = metroVolSlider.value + '%';
    syncSlider(metroVolSlider);
  };
  syncSlider(metroVolSlider);

  const metroPanSlider = q('#metro-pan-slider'), metroPanVal = q('#metro-pan-val');
  const updateMetroPan = () => {
    metro.pan = metroPanSlider.value / 100;
    metroPanVal.textContent = panShort(metroPanSlider.value);
    syncPanSlider(metroPanSlider);
  };
  metroPanSlider.oninput = updateMetroPan;
  updateMetroPan();

  // Notation — Select dropdown
  const notSelect = q('#metro-notation-select');
  if (notSelect) {
    notSelect.addEventListener('change', (e) => {
      useFlats = e.target.value === 'flats';
      buildKeyGrid();
    });
  }

  // Setlist
  q('#btn-add-preset').onclick = () => showDialog('Guardar set', doSavePreset);
  
  // GI-Setlist UI bindings
  qa('.s-toggle').forEach(btn => {
    btn.onclick = () => {
      qa('.s-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      q('#setlist-list').classList.add('hidden');
      q('#gi-setlist-list').classList.add('hidden');
      q('#service-setlist-list').classList.add('hidden');
      q('#' + btn.dataset.target).classList.remove('hidden');
    };
  });

  // Clear service list
  const btnClear = q('#btn-clear-service');
  if (btnClear) btnClear.onclick = clearServiceList;


  q('#btn-import-gi').onclick = () => q('#gi-file-input').click();
  q('#gi-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        if (json.data && json.data.songs) {
          giSetlistSongs = json.data.songs;
          if (window.electronAPI && window.electronAPI.saveGiSetlist) {
            window.electronAPI.saveGiSetlist(giSetlistSongs);
          }
          updateFilterCounts();
          renderGiSetlist();
          // Switch to GI tab automatically
          q('.s-toggle[data-target="gi-setlist-list"]').click();
        } else {
          alert('El archivo no parece ser un export de GI-Setlist válido.');
        }
      } catch (err) {
        alert('Error al leer el archivo JSON.');
      }
    };
    reader.readAsText(file);
  };

  q('#gi-search').oninput = (e) => renderGiSetlist(e.target.value);
  
  qa('.gi-filter-btn').forEach(btn => {
    btn.onclick = () => {
      qa('.gi-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGiGenre = btn.dataset.genre;
      renderGiSetlist(q('#gi-search').value);
    };
  });

  // MIDI
  engine.initMIDI(msg => {
    const [cmd, data1, data2] = msg.data;
    const isNoteOn = cmd >= 144 && cmd <= 159;
    const isCC = cmd >= 176 && cmd <= 191;

    if ((isNoteOn || isCC) && data2 > 0) {
      const mapKey = isCC ? `cc_${data1}` : `note_${data1}`;

      if (isMidiLearnMode && midiLearnTarget) {
        customMidiMap[mapKey] = midiLearnTarget;
        if (window.electronAPI && window.electronAPI.saveMidiMap) window.electronAPI.saveMidiMap(customMidiMap);
        q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado! ${midiLearnTarget.action.toUpperCase()} al control MIDI. Selecciona otro o sal.`;
        midiLearnTarget = null;
        return;
      }

      const mapping = customMidiMap[mapKey] || customMidiMap[data1];
      if (mapping) {
        if (mapping.action === 'pad') {
          onKeyClick(mapping.id);
        } else if (mapping.action === 'drum') {
          const kit = KIT_BANKS[kitBankIdx];
          if (!kit) return;
          const pad = kit.pads.find(p => p.type === mapping.id);
          if (pad) {
            const btn = q(`.drum-btn[data-drum="${pad.id}"]`);
            if (btn) btn.classList.add('hit');
            setTimeout(() => { if(btn) btn.classList.remove('hit'); }, 120);
            if (!engine.playCustomDrum(pad.id, pad.id)) engine.playDrum(pad.type, pad.id);
          }
        } else if (mapping.action === 'metro') {
          toggleMetro();
        } else if (mapping.action === 'play_seq') {
          q('#tp-play-btn').click();
        } else if (mapping.action === 'stop_seq') {
          q('#tp-stop-btn').click();
        }
        return;
      }

      // Hardcoded fallback map
      if (isNoteOn) {
        if (data1 >= 60 && data1 <= 71) {
          const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
          onKeyClick(keys[data1 - 60]);
        } else {
          const kit = KIT_BANKS[kitBankIdx];
          if (!kit) return;
          const typeMap = { 36:'kick',38:'snare',40:'snare',39:'clap',42:'hihatC',44:'hihatC',46:'hihatO',50:'tomH',47:'tomM',43:'tomL',41:'tomL',49:'crash',55:'crash',51:'ride',54:'tamb',56:'cowbell',81:'shaker',82:'shaker' };
          const mappedType = typeMap[data1];
          if (mappedType) {
            const pad = kit.pads.find(p => p.type === mappedType || p.id.includes(mappedType));
            if (pad) { const btn = q(`.drum-btn[data-drum="${pad.id}"]`); hitDrum(pad.id, pad.type, btn); }
          }
        }
      }
    }
  });

  // Midi Learn Intercept
  document.addEventListener('click', (e) => {
    if (!isMidiLearnMode) return;
    
    if (e.target.closest('#midi-learn-overlay')) {
       isMidiLearnMode = false;
       q('#midi-learn-overlay').style.display = 'none';
       midiLearnTarget = null;
       e.stopPropagation(); e.preventDefault();
       return;
    }

    const keyBtn = e.target.closest('.key-btn');
    const drumBtn = e.target.closest('.drum-btn');
    const metroBtn = e.target.closest('#btn-metro-main');
    const playSeqBtn = e.target.closest('#tp-play-btn');
    const stopSeqBtn = e.target.closest('#tp-stop-btn');

    let target = null;
    if (keyBtn) target = { action: 'pad', id: keyBtn.dataset.key };
    else if (drumBtn) target = { action: 'drum', id: drumBtn.dataset.type };
    else if (metroBtn) target = { action: 'metro' };
    else if (playSeqBtn) target = { action: 'play_seq' };
    else if (stopSeqBtn) target = { action: 'stop_seq' };
    else return; // unmappable

    e.stopPropagation();
    e.preventDefault();
    midiLearnTarget = target;
    q('#midi-learn-overlay').innerHTML = `🎹 Esperando MIDI para: <b>${target.action.toUpperCase()} ${target.id || ''}</b>... Toca tu controlador.`;
  }, true);

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
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><polygon points="5,3 19,12 5,21"/></svg>';
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
  if (e.code === 'Space') { 
    e.preventDefault(); 
    if (preparedPadKey && !activeKey && !metroRunning) {
       onKeyClick(preparedPadKey);
       toggleMetro();
    } else if (activeKey || metroRunning) {
       if (activeKey) onKeyClick(activeKey);
       if (metroRunning) toggleMetro();
    } else {
       toggleMetro();
    }
  }
  if (e.code === 'Escape') { closeAllOverlays(); q('#sidebar').classList.remove('open'); engine.stopPad(); activeKey = null; preparedPadKey = null; buildKeyGrid(); }

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

/* ── GI-SETLIST LOGIC ── */
function updateFilterCounts() {
  const total = giSetlistSongs.length;
  const alabanzas = giSetlistSongs.filter(s => {
    const genre = s.genre ? s.genre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';
    return genre.includes('alabanza');
  }).length;
  const adoracion = giSetlistSongs.filter(s => {
    const genre = s.genre ? s.genre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';
    return genre.includes('adoracion');
  }).length;

  const btnAll = q('#btn-filter-all');
  if (btnAll) btnAll.textContent = `Todas (${total})`;
  const btnAla = q('#btn-filter-alabanza');
  if (btnAla) btnAla.textContent = `Alabanza (${alabanzas})`;
  const btnAdo = q('#btn-filter-adoracion');
  if (btnAdo) btnAdo.textContent = `Adoración (${adoracion})`;
}

async function loadGiSetlistFromFile() {
  try {
    if (window.electronAPI && window.electronAPI.loadGiSetlist) {
      const json = await window.electronAPI.loadGiSetlist();
      if (json && json.data && json.data.songs) {
        giSetlistSongs = json.data.songs;
        updateFilterCounts();
        renderGiSetlist();
        return;
      }
    }
    
    // Fallback if not using Electron
    const res = await fetch('../assets/setlists/canciones_app.json');
    if (res.ok) {
      const json = await res.json();
      if (json.data && json.data.songs) {
        giSetlistSongs = json.data.songs;
        updateFilterCounts();
        renderGiSetlist();
      }
    }
  } catch (e) {
    console.log('GI-Setlist local no encontrado, esperando importación manual.');
  }
}

function renderGiSetlist(filter = '') {
  const container = q('#gi-songs-container');
  container.innerHTML = '';
  
  if (!giSetlistSongs.length) {
    container.innerHTML = '<div class="setlist-empty">No hay canciones importadas. Usa el botón de importar arriba.</div>';
    return;
  }

  const term = filter.toLowerCase();
  const filtered = giSetlistSongs.filter(s => {
    const matchText = s.title.toLowerCase().includes(term) || 
                      (s.artist && s.artist.toLowerCase().includes(term));
    if (!matchText) return false;
    
    if (currentGiGenre === 'all') return true;
    
    // Normalize string: remove accents and lowercase
    const genre = s.genre ? s.genre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';
    return genre.includes(currentGiGenre);
  });

  // Sort alphabetically by title
  filtered.sort((a, b) => a.title.localeCompare(b.title));

  if (!filtered.length) {
    container.innerHTML = '<div class="setlist-empty">No se encontraron resultados.</div>';
    return;
  }

  filtered.forEach(song => {
    const el = document.createElement('div');
    el.className = 'gi-song-item';
    
    el.innerHTML = `
      <div class="gi-song-main">
        <div class="gi-song-title">${song.title}</div>
        <div class="gi-song-artist">${song.artist || 'Sin artista'}</div>
        <div class="gi-song-meta">
          <span class="gi-badge bpm">${song.bpm} BPM</span>
          <span class="gi-badge key">${song.key || '-'}</span>
          ${song.genre ? `<span class="gi-badge">${song.genre}</span>` : ''}
        </div>
      </div>
      <div class="gi-song-actions">
         <button class="action-btn btn-seq" title="Secuencia Split-Track" style="${song.audio && song.audio.sequence ? 'color: var(--blue);' : ''}">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="6" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="18" cy="12" r="2"></circle></svg>
         </button>
         <button class="action-btn btn-orig" title="Canción Original" style="${song.audio && song.audio.original ? 'color: var(--blue);' : ''}">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
         </button>
         <button class="action-btn btn-edit" title="Editar canción">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
         </button>
      </div>
    `;
    
    el.querySelector('.gi-song-main').onclick = () => applyGiSong(song);
    el.querySelector('.btn-seq').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'sequence'); };
    el.querySelector('.btn-orig').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'original'); };
    
    // Add to service button
    const btnAdd = document.createElement('button');
    btnAdd.className = 'action-btn';
    btnAdd.title = 'Añadir al servicio de hoy';
    btnAdd.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    btnAdd.onclick = (e) => {
      e.stopPropagation();
      addToService(song);
      
      // Feedback visual
      const originalHtml = btnAdd.innerHTML;
      btnAdd.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      btnAdd.style.color = '#4ade80';
      btnAdd.style.borderColor = '#4ade80';
      
      const metaDiv = el.querySelector('.gi-song-meta');
      const badge = document.createElement('span');
      badge.className = 'gi-badge';
      badge.style.background = 'rgba(74, 222, 128, 0.15)';
      badge.style.color = '#4ade80';
      badge.textContent = 'En servicio';
      metaDiv.appendChild(badge);
      
      setTimeout(() => {
        btnAdd.innerHTML = originalHtml;
        btnAdd.style.color = '';
        btnAdd.style.borderColor = '';
        if(metaDiv.contains(badge)) metaDiv.removeChild(badge);
      }, 2000);
    };
    el.querySelector('.gi-song-actions').appendChild(btnAdd);

    el.querySelector('.btn-edit').onclick = (e) => {
      e.stopPropagation();
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <input type="text" class="edit-title" value="${song.title}" placeholder="Título" style="width: 100%; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 13px; font-weight: 700; outline: none; box-sizing: border-box;">
          <input type="text" class="edit-artist" value="${song.artist || ''}" placeholder="Artista" style="width: 100%; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; outline: none; box-sizing: border-box;">
          <div style="display: flex; gap: 6px;">
            <input type="text" class="edit-bpm" value="${song.bpm || ''}" placeholder="BPM" style="flex: 1; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; text-align: center; outline: none; width: 0;">
            <input type="text" class="edit-key" value="${song.key || ''}" placeholder="Tono" style="flex: 1; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; text-align: center; outline: none; width: 0;">
            <input type="text" class="edit-genre" value="${song.genre || ''}" placeholder="Género" style="flex: 1; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; text-align: center; outline: none; width: 0;">
          </div>
          <div style="display: flex; gap: 6px; margin-top: 4px;">
            <button class="gi-edit-btn save" style="flex: 1; padding: 6px; background: var(--blue); color: #000; border: none; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">Guardar</button>
            <button class="gi-edit-btn cancel" style="flex: 1; padding: 6px; background: transparent; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; cursor: pointer;">Cancelar</button>
          </div>
        </div>
      `;
      
      el.querySelector('.cancel').onclick = (ev) => {
        ev.stopPropagation();
        renderGiSetlist(q('#gi-search').value);
      };
      
      el.querySelector('.save').onclick = (ev) => {
        ev.stopPropagation();
        song.title = el.querySelector('.edit-title').value;
        song.artist = el.querySelector('.edit-artist').value;
        song.bpm = el.querySelector('.edit-bpm').value;
        song.key = el.querySelector('.edit-key').value;
        song.genre = el.querySelector('.edit-genre').value;
        
        if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
        updateFilterCounts();
        renderGiSetlist(q('#gi-search').value);
      };
    };

    container.appendChild(el);
  });
}

/* ── SERVICE SETLIST LOGIC ── */
function loadServiceSongs() {
  const saved = localStorage.getItem('serviceSongs');
  if (saved) {
    try {
      serviceSongs = JSON.parse(saved);
      renderServiceList();
    } catch(e) { serviceSongs = []; }
  }
}

function saveServiceSongs() {
  localStorage.setItem('serviceSongs', JSON.stringify(serviceSongs));
}

function addToService(song) {
  // Add a unique ID for drag and drop to work correctly even with duplicate songs
  const songToAdd = { ...song, serviceId: Date.now() + Math.random() };
  serviceSongs.push(songToAdd);
  saveServiceSongs();
  renderServiceList();
  
  // Optional: Visual feedback or switch to service tab
  // openServiceTab();
}

function removeFromService(serviceId) {
  serviceSongs = serviceSongs.filter(s => s.serviceId !== serviceId);
  saveServiceSongs();
  renderServiceList();
}

function clearServiceList() {
  if (confirm('¿Vaciar toda la lista de servicio?')) {
    serviceSongs = [];
    saveServiceSongs();
    renderServiceList();
  }
}

function renderServiceList() {
  const container = q('#service-songs-container');
  const emptyMsg = q('#service-empty-msg');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (serviceSongs.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }
  
  emptyMsg.classList.add('hidden');
  
  serviceSongs.forEach((song, index) => {
    const el = document.createElement('div');
    el.className = 'gi-song-item';
    el.draggable = true;
    el.dataset.index = index;
    
    el.innerHTML = `
      <div class="gi-song-main">
        <div class="gi-song-title">${song.title}</div>
        <div class="gi-song-artist">${song.artist || 'Sin artista'}</div>
        <div class="gi-song-meta">
          <span class="gi-badge bpm">${song.bpm} BPM</span>
          <span class="gi-badge key">${song.key || '-'}</span>
          ${song.genre ? `<span class="gi-badge">${song.genre}</span>` : ''}
        </div>
      </div>
      <div class="gi-song-actions">
         <button class="action-btn btn-seq" title="Secuencia Split-Track" style="${song.audio && song.audio.sequence ? 'color: var(--blue);' : ''}">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="6" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="18" cy="12" r="2"></circle></svg>
         </button>
         <button class="action-btn btn-orig" title="Canción Original" style="${song.audio && song.audio.original ? 'color: var(--blue);' : ''}">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
         </button>
         <button class="action-btn btn-edit" title="Editar canción">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
         </button>
         <button class="action-btn btn-remove" title="Quitar de la lista" style="color: #ff4747;">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
         </button>
      </div>
    `;
    
    el.querySelector('.gi-song-main').onclick = () => applyGiSong(song);
    el.querySelector('.btn-seq').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'sequence'); };
    el.querySelector('.btn-orig').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'original'); };
    el.querySelector('.btn-remove').onclick = (e) => {
      e.stopPropagation();
      removeFromService(song.serviceId);
    };

    el.querySelector('.btn-edit').onclick = (e) => {
      e.stopPropagation();
      // ... edit logic same as above ...
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <input type="text" class="edit-title" value="${song.title}" placeholder="Título" style="width: 100%; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 13px; font-weight: 700; outline: none; box-sizing: border-box;">
          <input type="text" class="edit-artist" value="${song.artist || ''}" placeholder="Artista" style="width: 100%; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; outline: none; box-sizing: border-box;">
          <div style="display: flex; gap: 6px;">
            <input type="text" class="edit-bpm" value="${song.bpm || ''}" placeholder="BPM" style="flex: 1; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; text-align: center; outline: none; width: 0;">
            <input type="text" class="edit-key" value="${song.key || ''}" placeholder="Tono" style="flex: 1; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; text-align: center; outline: none; width: 0;">
            <input type="text" class="edit-genre" value="${song.genre || ''}" placeholder="Género" style="flex: 1; padding: 6px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 4px; color: #fff; font-size: 11px; text-align: center; outline: none; width: 0;">
          </div>
          <div style="display: flex; gap: 6px; margin-top: 4px;">
            <button class="gi-edit-btn save" style="flex: 1; padding: 6px; background: var(--blue); color: #000; border: none; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">Guardar</button>
            <button class="gi-edit-btn cancel" style="flex: 1; padding: 6px; background: transparent; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; cursor: pointer;">Cancelar</button>
          </div>
        </div>
      `;
      el.querySelector('.cancel').onclick = (ev) => { ev.stopPropagation(); renderServiceList(); };
      el.querySelector('.save').onclick = (ev) => {
        ev.stopPropagation();
        song.title = el.querySelector('.edit-title').value;
        song.artist = el.querySelector('.edit-artist').value;
        song.bpm = el.querySelector('.edit-bpm').value;
        song.key = el.querySelector('.edit-key').value;
        song.genre = el.querySelector('.edit-genre').value;
        
        // Sincronizar con librería principal
        const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
        if (giSong) {
          giSong.title = song.title; giSong.artist = song.artist;
          giSong.bpm = song.bpm; giSong.key = song.key; giSong.genre = song.genre;
          if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
        }
        
        saveServiceSongs();
        renderServiceList();
      };
    };
    
    // Drag and Drop events
    el.ondragstart = (e) => {
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', index);
    };
    
    el.ondragend = () => el.classList.remove('dragging');
    
    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    };
    
    el.ondragleave = () => el.classList.remove('drag-over');
    
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
      const toIndex = index;
      
      if (fromIndex !== toIndex) {
        const movedItem = serviceSongs.splice(fromIndex, 1)[0];
        serviceSongs.splice(toIndex, 0, movedItem);
        saveServiceSongs();
        renderServiceList();
      }
    };
    
    container.appendChild(el);
  });
}


function applyGiSong(song) {
  // Update BPM
  if (song.bpm) {
    const v = parseInt(song.bpm);
    if (!isNaN(v)) {
      metro.setBPM(v);
      q('#bpm-slider').value = metro.bpm;
      q('#bpm-display').textContent = metro.bpm;
      const liveBpm = q('#metro-bpm-live');
      if(liveBpm) liveBpm.textContent = metro.bpm + ' BPM';
      syncSlider(q('#bpm-slider'));
    }
  }
  
  // Update Key
  if (song.key) {
    let key = song.key.replace('m', '').trim();
    // Normalizar Do, Re, Mi si vienen así
    const esToEn = { 'Do':'C', 'Re':'D', 'Mi':'E', 'Fa':'F', 'Sol':'G', 'La':'A', 'Si':'B' };
    for (let es in esToEn) {
      if (key.startsWith(es)) key = key.replace(es, esToEn[es]);
    }
    
    // Check if flat or sharp — update the select dropdown
    const notSel = q('#metro-notation-select');
    if (key.includes('b')) {
      useFlats = true;
      if (notSel) notSel.value = 'flats';
    } else {
      useFlats = false;
      if (notSel) notSel.value = 'sharps';
    }
    buildKeyGrid();
    
    // Stop playing pad and metronome if they are running
    if (activeKey) {
      engine.stopPad();
      activeKey = null;
    }
    if (metroRunning) {
      toggleMetro();
    }
    
    // Prepare the new key
    const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
    if (keys.includes(key)) {
      preparedPadKey = key;
      qa('.key-btn').forEach(b => {
        b.classList.remove('active', 'prepared');
        if (b.dataset.key === key) b.classList.add('prepared');
      });
    }
  }
}

/* ── TRACK PLAYER LOGIC ── */
let currentTrackAudio = null;
let currentTrackType = null;
let currentTrackSong = null;

window.loadAndPlayTrack = function(song, type) {
  if (currentTrackAudio) {
    currentTrackAudio.pause();
    currentTrackAudio = null;
  }
  currentTrackSong = song;
  const path = (song.audio && song.audio[type]) ? song.audio[type] : null;

  if (!path) {
    if (window.electronAPI && window.electronAPI.openAudioFile) {
      window.electronAPI.openAudioFile().then(async (file) => {
        if (file && file.path) {
          const newPath = await window.electronAPI.assignAudioFile({ sourcePath: file.path, type });
          
          if (!song.audio) song.audio = {};
          song.audio[type] = newPath;
          
          const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
          if (giSong) {
            if (!giSong.audio) giSong.audio = {};
            giSong.audio[type] = newPath;
          }
          
          if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
          saveServiceSongs();
          
          // Refrescar vistas para colorear el botón
          if (q('#gi-search')) renderGiSetlist(q('#gi-search').value);
          renderServiceList();
          
          startTrackPlayback(newPath, song.title, type);
        }
      });
    } else {
      const input = q('#tp-file-input');
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          startTrackPlayback(URL.createObjectURL(file), song.title, type);
        }
        input.value = '';
      };
      input.click();
    }
  } else {
    startTrackPlayback(path, song.title, type);
  }
};

async function startTrackPlayback(url, title, type) {
  let safeUrl = url;
  if (safeUrl && typeof safeUrl === 'string') {
    // FIX for old corrupted paths in JSON
    safeUrl = safeUrl.replace('../assets/', 'assets/');
  }

  if (safeUrl && !safeUrl.startsWith('blob:') && !safeUrl.startsWith('http')) {
    if (window.electronAPI && window.electronAPI.getAbsolutePath) {
      try {
        const absPath = await window.electronAPI.getAbsolutePath(safeUrl);
        // Construir URL absoluta con protocolo file:/// y codificando espacios/símbolos
        let fileUrl = 'file:///' + absPath.replace(/\\/g, '/');
        safeUrl = encodeURI(fileUrl).replace(/#/g, '%23').replace(/\?/g, '%3F');
      } catch (e) {
        console.error("Error al obtener ruta absoluta", e);
      }
    } else {
      safeUrl = encodeURI(url).replace(/#/g, '%23').replace(/\?/g, '%3F');
      if (!safeUrl.startsWith('./') && !safeUrl.startsWith('/')) safeUrl = './' + safeUrl;
    }
  }
  
  currentTrackAudio = new Audio(safeUrl);
  currentTrackType = type;
  
  currentTrackAudio.onerror = (e) => {
    console.error("Error cargando el audio:", safeUrl, e);
    q('#tp-title').textContent = "Error al cargar audio";
  };
  
  q('#tp-title').textContent = title + (type === 'sequence' ? ' (Secuencia)' : ' (Original)');
  
  const playBtn = q('#tp-play-btn');
  const stopBtn = q('#tp-stop-btn');
  const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5,3 19,12 5,21"/></svg>';
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  
  const updatePlayBtn = () => {
    playBtn.innerHTML = currentTrackAudio.paused ? playIcon : pauseIcon;
    if(currentTrackAudio.paused) {
       playBtn.style.transform = 'scale(1)';
    } else {
       playBtn.style.transform = 'scale(0.96)';
    }
  };
  
  playBtn.onclick = () => {
    if (currentTrackAudio.paused) currentTrackAudio.play();
    else currentTrackAudio.pause();
    updatePlayBtn();
  };

  stopBtn.onclick = () => {
    currentTrackAudio.pause();
    currentTrackAudio.currentTime = 0;
    updatePlayBtn();
    q('#tp-progress').value = 0;
    q('#tp-time-current').textContent = "0:00";
  };
  
  const loopBtn = q('#tp-loop-btn');
  if (!loopBtn.dataset.active) loopBtn.dataset.active = 'false';
  currentTrackAudio.loop = loopBtn.dataset.active === 'true';
  loopBtn.style.color = currentTrackAudio.loop ? 'var(--blue)' : 'var(--text-muted)';
  loopBtn.style.borderColor = currentTrackAudio.loop ? 'var(--blue)' : 'var(--border)';

  loopBtn.onclick = () => {
    currentTrackAudio.loop = !currentTrackAudio.loop;
    loopBtn.dataset.active = currentTrackAudio.loop ? 'true' : 'false';
    loopBtn.style.color = currentTrackAudio.loop ? 'var(--blue)' : 'var(--text-muted)';
    loopBtn.style.borderColor = currentTrackAudio.loop ? 'var(--blue)' : 'var(--border)';
  };
  
  const formatTime = (s) => {
    if (isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  currentTrackAudio.ontimeupdate = () => {
    q('#tp-time-current').textContent = formatTime(currentTrackAudio.currentTime);
    if (currentTrackAudio.duration) {
      q('#tp-time-total').textContent = formatTime(currentTrackAudio.duration);
      q('#tp-progress').value = (currentTrackAudio.currentTime / currentTrackAudio.duration) * 100;
      syncSlider(q('#tp-progress'));
    }
  };
  
  q('#tp-progress').oninput = (e) => {
    if (currentTrackAudio.duration) {
      currentTrackAudio.currentTime = (e.target.value / 100) * currentTrackAudio.duration;
      syncSlider(e.target);
    }
  };
  
  const tpVolSlider = q('#tp-vol');
  const tpVolVal = q('#tp-vol-val');
  
  tpVolSlider.oninput = (e) => {
    currentTrackAudio.volume = e.target.value / 100;
    tpVolVal.textContent = e.target.value + '%';
    syncSlider(e.target);
  };
  
  // Set initial value
  currentTrackAudio.volume = tpVolSlider.value / 100;
  tpVolVal.textContent = tpVolSlider.value + '%';
  syncSlider(tpVolSlider);
  
  q('#tp-close-btn').onclick = () => {
    currentTrackAudio.pause();
    currentTrackAudio = null;
    q('#tp-title').textContent = "Ninguna pista cargada";
    q('#tp-time-current').textContent = "0:00";
    q('#tp-time-total').textContent = "0:00";
    q('#tp-progress').value = 0;
    syncSlider(q('#tp-progress'));
    playBtn.innerHTML = playIcon;
  };
  
  currentTrackAudio.onended = () => {
    updatePlayBtn();
    q('#tp-progress').value = 0;
    syncSlider(q('#tp-progress'));
    q('#tp-time-current').textContent = "0:00";
  };
  
  // Detener metrónomo y pad ambiental
  if (metroRunning) {
    toggleMetro();
  }
  if (activeKey) {
    engine.stopPad();
    activeKey = null;
    qa('.key-btn').forEach(b => b.classList.remove('active'));
  }
  
  currentTrackAudio.play();
  updatePlayBtn();
}
