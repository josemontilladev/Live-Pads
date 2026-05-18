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
let activeServiceIndex = -1;
let activeGiSongId = null;
let openAccordionSongId = null;
let openAccordionServiceId = null;
let isEditKitMode  = false;
let isMidiLearnMode = false;
let midiLearnTarget = null;
let customMidiMap = {};

const KEY_MAP_PADS  = ['1','2','3','4','5','6','7','8','9','0','-','='];
const KEY_MAP_DRUMS = ['Q','W','E','R','A','S','D','F'];

const q  = s => document.querySelector(s);
const qa = s => document.querySelectorAll(s);

// Global Toast Notification Helper for professional UX
window.showToast = function(message, type = 'info') {
  let container = q('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 10000; pointer-events: none;';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  let bg = 'rgba(0, 170, 255, 0.9)'; // info / blue
  let color = '#000';
  let border = '1px solid var(--blue)';
  
  if (type === 'success') {
    bg = 'rgba(16, 185, 129, 0.95)'; // emerald
    color = '#fff';
    border = '1px solid #10b981';
  } else if (type === 'error') {
    bg = 'rgba(239, 68, 68, 0.95)'; // red
    color = '#fff';
    border = '1px solid #ef4444';
  } else if (type === 'warning') {
    bg = 'rgba(245, 158, 11, 0.95)'; // amber
    color = '#000';
    border = '1px solid #f59e0b';
  }
  
  toast.style.cssText = `background: ${bg}; color: ${color}; border: ${border}; backdrop-filter: blur(8px); padding: 12px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; box-shadow: 0 10px 25px rgba(0,0,0,0.3); opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); display: flex; align-items: center; gap: 8px;`;
  
  // Icon SVG
  let icon = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  if (type === 'success') {
    icon = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><polyline points="20,6 9,17 4,12"/></svg>';
  } else if (type === 'error') {
    icon = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else if (type === 'warning') {
    icon = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  }
  
  toast.innerHTML = `${icon}<span>${message}</span>`;
  container.appendChild(toast);
  
  // Slide up and bounce in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  
  // Slide out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  engine = new SynthEngine();
  await engine.init();
  await engine.loadClickBuffers();    // load real click audio files
  // Pad Amb files are lazy-loaded on first keypress (files are ~48MB each)
  metro = new Metronome(engine);
  metro.onBeat = onMetroBeat;
  metro.sound = 'cowbell';  // default: Cowbell

  let customKitsData = { kits: [] };
  if (window.electronAPI && window.electronAPI.loadUserDrums) {
    const raw = await window.electronAPI.loadUserDrums();
    if (raw) {
      if (raw.kits) {
        customKitsData = raw;
      } else if (raw.kitName) {
        // Migrate legacy format
        customKitsData = {
          kits: [{
            id: 'custom_kit_legacy',
            kitName: raw.kitName || 'Custom Kit',
            lbl_c_kick: raw.lbl_c_kick, c_kick: raw.c_kick,
            lbl_c_snare: raw.lbl_c_snare, c_snare: raw.c_snare,
            lbl_c_hhc: raw.lbl_c_hhc, c_hhc: raw.c_hhc,
            lbl_c_clap: raw.lbl_c_clap, c_clap: raw.c_clap,
            lbl_c_perc1: raw.lbl_c_perc1, c_perc1: raw.c_perc1,
            lbl_c_perc2: raw.lbl_c_perc2, c_perc2: raw.c_perc2,
            lbl_c_crash: raw.lbl_c_crash, c_crash: raw.c_crash,
            lbl_c_ride: raw.lbl_c_ride, c_ride: raw.c_ride,
          }]
        };
      }
    }
  }

  // Load custom kits into KIT_BANKS
  // Load custom kits into KIT_BANKS (prepended so they are at the top)
  if (customKitsData.kits && customKitsData.kits.length > 0) {
    const loadedCustomKits = customKitsData.kits.map(k => ({
      id: k.id || `custom_kit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: k.kitName || 'Custom Kit',
      desc: 'Batería personalizada (Edita con el ✏️)',
      color: '#10b981',
      isCustom: true, // Mark it so we know we can edit/delete it!
      pads: [
        { id: 'c_kick', label: k.lbl_c_kick || 'Kick', type: 'kick', sample: k.c_kick },
        { id: 'c_snare', label: k.lbl_c_snare || 'Snare', type: 'snare', sample: k.c_snare },
        { id: 'c_hhc', label: k.lbl_c_hhc || 'HH Cerr', type: 'hihatC', sample: k.c_hhc },
        { id: 'c_clap', label: k.lbl_c_clap || 'Clap', type: 'clap', sample: k.c_clap },
        { id: 'c_perc1', label: k.lbl_c_perc1 || 'Tom 1', type: 'tomH', sample: k.c_perc1 },
        { id: 'c_perc2', label: k.lbl_c_perc2 || 'Tom 2', type: 'tomM', sample: k.c_perc2 },
        { id: 'c_crash', label: k.lbl_c_crash || 'Crash', type: 'crash', sample: k.c_crash },
        { id: 'c_ride', label: k.lbl_c_ride || 'Ride', type: 'ride', sample: k.c_ride },
      ]
    }));
    KIT_BANKS.unshift(...loadedCustomKits);
  } else {
    // If no custom kits exist, create one default custom kit
    KIT_BANKS.unshift({
      id: `custom_kit_${Date.now()}`,
      name: 'PadLab Custom',
      desc: 'Batería personalizada (Edita con el ✏️)',
      color: '#10b981',
      isCustom: true,
      pads: [
        { id: 'c_kick', label: 'Kick', type: 'kick', sample: null },
        { id: 'c_snare', label: 'Snare', type: 'snare', sample: null },
        { id: 'c_hhc', label: 'HH Cerr', type: 'hihatC', sample: null },
        { id: 'c_clap', label: 'Clap', type: 'clap', sample: null },
        { id: 'c_perc1', label: 'Tom 1', type: 'tomH', sample: null },
        { id: 'c_perc2', label: 'Tom 2', type: 'tomM', sample: null },
        { id: 'c_crash', label: 'Crash', type: 'crash', sample: null },
        { id: 'c_ride', label: 'Ride', type: 'ride', sample: null },
      ]
    });
  }

  if (window.electronAPI && window.electronAPI.loadMidiMap) {
    customMidiMap = (await window.electronAPI.loadMidiMap()) || {};
  }

  applyTheme(currentTheme);
  buildBankSelects();
  loadPadBank(2); // Chris Rocha por defecto
  // Load EFX 1 by name; fall back to index 0 if not found
  const efx1Idx = KIT_BANKS.findIndex(k => k.name === 'EFX 1');
  loadKitBank(efx1Idx >= 0 ? efx1Idx : 0);
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
    padSel.value = padBankIdx;
    padSel.onchange = (e) => loadPadBank(parseInt(e.target.value));
  }
  if (kitSel) {
    kitSel.innerHTML = KIT_BANKS.map((b, i) => `<option value="${i}">${b.name}</option>`).join('');
    kitSel.value = kitBankIdx;
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

function loadKitBank(idx) {
  kitBankIdx = ((idx % KIT_BANKS.length) + KIT_BANKS.length) % KIT_BANKS.length;
  const kit = KIT_BANKS[kitBankIdx];
  const kitSel = q('#kit-bank-select');
  if (kitSel) kitSel.value = kitBankIdx;
  
  // Show or hide the trash button depending on whether this is a custom kit
  const btnDelete = q('#btn-delete-kit');
  if (btnDelete) {
    btnDelete.style.display = kit.isCustom ? 'flex' : 'none';
  }
  
  // Toggle opacity and availability of the edit pencil button
  const btnEdit = q('#btn-edit-kit');
  if (btnEdit) {
    btnEdit.style.opacity = kit.isCustom ? '1' : '0.2';
    btnEdit.style.pointerEvents = kit.isCustom ? 'auto' : 'none';
  }

  engine.initDrumVolumes(kit.pads);
  buildDrumGrid(kit.pads);
  buildDrumVolumes(kit.pads);
  // Load real WAV samples in background
  engine.loadKitSamples(kit.pads).then(loadedIds => {
    loadedIds.forEach(id => {
      const btn = q(`.drum-btn[data-drum="${id}"]`);
      if (btn) btn.classList.add('has-sample');
    });
    // Re-apply MIDI/keyboard hints after async kit load so the mapping stays visible
    if (typeof updateKeyHints === 'function') updateKeyHints();
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
  if (typeof updateKeyHints === 'function') updateKeyHints();
}

function updateKeyHints() {
  qa('.key-btn').forEach(btn => {
    const key = btn.dataset.key;
    const padIdx = (useFlats ? KEYS_FLAT : KEYS_SHARP).indexOf(key);
    let hint = KEY_MAP_PADS[padIdx] || '';
    const customKey = Object.keys(customMidiMap).find(k => k.startsWith('kbd_') && customMidiMap[k].action === 'pad' && customMidiMap[k].id === key);
    if (customKey) hint = customKey.replace('kbd_Key', '').replace('kbd_Digit', '').replace('kbd_', '');
    const hintEl = btn.querySelector('.kbd-hint');
    if(hintEl) hintEl.textContent = hint;
  });
  qa('.drum-btn').forEach((btn, i) => {
    const type = btn.dataset.type;
    let hint = KEY_MAP_DRUMS[i] || '';
    const customKey = Object.keys(customMidiMap).find(k => k.startsWith('kbd_') && customMidiMap[k].action === 'drum' && customMidiMap[k].id === type);
    if (customKey) hint = customKey.replace('kbd_Key', '').replace('kbd_Digit', '').replace('kbd_', '');
    const hintEl = btn.querySelector('.kbd-hint');
    if(hintEl) hintEl.textContent = hint;
  });
}

function clearMappingForTarget(target, isKeyboard) {
  Object.keys(customMidiMap).forEach(key => {
    if (isKeyboard && !key.startsWith('kbd_')) return;
    if (!isKeyboard && key.startsWith('kbd_')) return;
    const mapping = customMidiMap[key];
    if (mapping && mapping.action === target.action && mapping.id === target.id) {
      delete customMidiMap[key];
    }
  });
}

function onKeyClick(key) {
  if (activeKey === key) { 
    engine.stopPad(5.0); // Smooth 5-second fade out on stop
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
    btn.innerHTML = `<span class="drum-label" spellcheck="false">${pad.label}</span><span class="kbd-hint">${KEY_MAP_DRUMS[i]}</span>`;
    
    if (pad.sample) {
      btn.classList.add('has-sample');
    }

    const lbl = btn.querySelector('.drum-label');
    lbl.addEventListener('blur', async () => {
      if (lbl.textContent.trim() !== pad.label) {
        pad.label = lbl.textContent.trim() || 'Pad';
        const currentKit = KIT_BANKS[kitBankIdx];
        if (currentKit && currentKit.isCustom) {
          saveCustomKitsToStorage();
        }
        // Sync volume labels below in real-time
        const mainLabel = q(`#lbl-dvol-text-${pad.id}`);
        if (mainLabel) mainLabel.textContent = pad.label;
        const sbLabel = q(`#sb-lbl-dvol-text-${pad.id}`);
        if (sbLabel) sbLabel.textContent = pad.label;
      }
    });

    btn.onmousedown = (e) => {
      if (isEditKitMode && e.target === lbl) return;
      hitDrum(pad.id, pad.type, btn);
    };
    btn.addEventListener('touchstart', e => { 
      if (isEditKitMode && e.target === lbl) return;
      e.preventDefault(); hitDrum(pad.id, pad.type, btn); 
    });
    grid.appendChild(btn);
  });
  if (typeof updateKeyHints === 'function') updateKeyHints();
}

async function hitDrum(id, type, btn) {
  if (isEditKitMode) {
    if (!window.electronAPI) return;
    
    const currentKit = KIT_BANKS[kitBankIdx];
    const kitId = currentKit ? currentKit.id : 'unknown';

    const onUploadNew = async () => {
      const fileData = await window.electronAPI.openAudioFile();
      if (!fileData || !fileData.path) return;
      
      const resPath = await window.electronAPI.assignDrumSample({
        sourcePath: fileData.path,
        padName: id,
        kitId: kitId
      });
      if (resPath) {
        assignSampleToPad(id, resPath, btn);
      }
    };
    
    const onAssignPool = (resPath) => {
      assignSampleToPad(id, resPath, btn);
    };

    const pad = currentKit ? currentKit.pads.find(p => p.id === id) : null;
    const padLabel = pad ? pad.label : 'Pad';

    console.log("DEBUG: opening sound pool modal for", { id, padLabel });
    openSoundPoolModal(id, padLabel, onAssignPool, onUploadNew);
    return;
  }
  if (!engine.playCustomDrum(id, id)) engine.playDrum(type, id);
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 120);
}

function assignSampleToPad(id, resPath, btn) {
  const currentKit = KIT_BANKS[kitBankIdx];
  if (currentKit && currentKit.isCustom) {
    const pad = currentKit.pads.find(p => p.id === id);
    if (pad) pad.sample = resPath;
    saveCustomKitsToStorage();
  }
  engine.loadSingleDrum(id, resPath).then((success) => {
    if (success) {
      btn.classList.add('has-sample');
      const oldBg = btn.style.background;
      btn.style.background = 'var(--blue)';
      setTimeout(() => { btn.style.background = oldBg; }, 300);
    }
  });
}

function getCleanSampleName(path) {
  const filename = path.split('/').pop().split('\\').pop();
  let clean = filename.replace(/^c_[a-z0-9]+_[0-9]+_/i, '');
  clean = clean.replace(/\.[a-z0-9]+$/i, '');
  clean = clean.replace(/_/g, ' ');
  return clean || filename;
}

function openSoundPoolModal(padId, padLabel, onAssign, onUploadNew) {
  const existing = q('#sound-pool-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'sound-pool-modal';

  // ── Inline styles REQUIRED: the global `body * { transition: all 0.5s }` rule
  // makes CSS-class-based opacity transitions fight and keep the modal hidden.
  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(16px)',
    webkitBackdropFilter: 'blur(16px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: '99999', opacity: '1', transition: 'none', fontFamily: "'Inter', sans-serif"
  });

  const uniqueSamples = new Set();
  const sampleList = [];
  KIT_BANKS.forEach(kit => {
    if (kit.isCustom && kit.pads) {
      kit.pads.forEach(p => {
        if (p.sample && !uniqueSamples.has(p.sample)) {
          uniqueSamples.add(p.sample);
          sampleList.push({ path: p.sample, id: p.id, label: p.label, kitName: kit.name });
        }
      });
    }
  });

  // ── Build the box
  const box = document.createElement('div');
  Object.assign(box.style, {
    background: '#111111', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: '20px', width: '460px', maxHeight: '76vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)',
    overflow: 'hidden', transition: 'none', opacity: '1'
  });

  // ── Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    padding: '22px 24px 18px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)'
  });
  const titleWrap = document.createElement('div');
  const badge = document.createElement('span');
  Object.assign(badge.style, {
    display: 'inline-block', background: 'rgba(251,174,0,0.15)', color: '#FBAE00',
    fontSize: '10px', fontWeight: '700', letterSpacing: '1px',
    textTransform: 'uppercase', padding: '2px 8px', borderRadius: '20px', marginBottom: '6px'
  });
  badge.textContent = 'Selector de sonido';
  const titleEl = document.createElement('h3');
  Object.assign(titleEl.style, { margin: '0', fontSize: '17px', fontWeight: '700', color: '#fff', lineHeight: '1.2' });
  titleEl.textContent = padLabel;
  titleWrap.appendChild(badge);
  titleWrap.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, {
    background: 'rgba(255,255,255,0.06)', border: 'none', color: '#aaa',
    cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
    transition: 'none'
  });
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.12)'; closeBtn.style.color = '#fff'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255,255,255,0.06)'; closeBtn.style.color = '#aaa'; };
  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  // ── Content
  const content = document.createElement('div');
  Object.assign(content.style, {
    padding: '20px 24px', overflowY: 'auto', flex: '1',
    display: 'flex', flexDirection: 'column', gap: '16px'
  });

  // Upload button
  const uploadBtn = document.createElement('button');
  Object.assign(uploadBtn.style, {
    background: 'linear-gradient(135deg, #FBAE00 0%, #e09900 100%)',
    color: '#000', border: 'none', padding: '13px 18px', borderRadius: '12px',
    fontWeight: '700', fontSize: '13px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%',
    boxShadow: '0 4px 16px rgba(251,174,0,0.25)', transition: 'none', letterSpacing: '0.3px'
  });
  uploadBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="15" height="15"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Subir nuevo archivo desde PC`;
  uploadBtn.onmouseenter = () => { uploadBtn.style.boxShadow = '0 6px 24px rgba(251,174,0,0.4)'; uploadBtn.style.filter = 'brightness(1.07)'; };
  uploadBtn.onmouseleave = () => { uploadBtn.style.boxShadow = '0 4px 16px rgba(251,174,0,0.25)'; uploadBtn.style.filter = ''; };

  // Section label
  const sectionLabel = document.createElement('div');
  Object.assign(sectionLabel.style, {
    fontSize: '10px', fontWeight: '800', color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase', letterSpacing: '1.2px'
  });
  sectionLabel.textContent = sampleList.length > 0
    ? `${sampleList.length} sonido${sampleList.length !== 1 ? 's' : ''} disponible${sampleList.length !== 1 ? 's' : ''}`
    : 'Sonidos en la App';

  // List container
  const listEl = document.createElement('div');
  Object.assign(listEl.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    maxHeight: '300px', overflowY: 'auto', paddingRight: '2px'
  });

  if (sampleList.length === 0) {
    const empty = document.createElement('div');
    Object.assign(empty.style, {
      textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '13px',
      padding: '32px 0', lineHeight: '1.6'
    });
    empty.innerHTML = `<div style="font-size:28px;margin-bottom:10px;">🥁</div>Aún no has cargado sonidos.<br>Usa "Subir nuevo archivo" para comenzar.`;
    listEl.appendChild(empty);
  } else {
    sampleList.forEach((item, idx) => {
      const cleanName = getCleanSampleName(item.path);

      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: '10px', gap: '10px',
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
        cursor: 'default', transition: 'none'
      });
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.07)'; row.style.borderColor = 'rgba(255,255,255,0.1)'; };
      row.onmouseleave = () => { row.style.background = 'rgba(255,255,255,0.03)'; row.style.borderColor = 'rgba(255,255,255,0.05)'; };

      const nameEl = document.createElement('div');
      Object.assign(nameEl.style, {
        flex: '1', overflow: 'hidden', minWidth: '0'
      });
      const nameText = document.createElement('div');
      Object.assign(nameText.style, {
        fontSize: '13px', fontWeight: '500', color: '#e0e0e0',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      });
      nameText.textContent = cleanName;
      nameText.title = cleanName;
      const kitTag = document.createElement('div');
      Object.assign(kitTag.style, {
        fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '1px',
        fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      });
      kitTag.textContent = item.kitName || '';
      nameEl.appendChild(nameText);
      nameEl.appendChild(kitTag);

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: '0' });

      // ── Play button
      const playBtn = document.createElement('button');
      Object.assign(playBtn.style, {
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)',
        color: '#ccc', width: '30px', height: '30px', borderRadius: '8px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'none'
      });
      const iconPlay = `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><polygon points="5,3 19,12 5,21"/></svg>`;
      const iconStop = `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
      playBtn.innerHTML = iconPlay;
      playBtn.title = 'Preescuchar';
      playBtn.onmouseenter = () => { if (playBtn.innerHTML === iconPlay) { playBtn.style.background = 'rgba(255,255,255,0.15)'; playBtn.style.color = '#fff'; } };
      playBtn.onmouseleave = () => { if (playBtn.innerHTML === iconPlay) { playBtn.style.background = 'rgba(255,255,255,0.07)'; playBtn.style.color = '#ccc'; } };
      playBtn.onclick = () => {
        // Reset the previously active play button if any
        if (window.previewBtn && window.previewBtn !== playBtn) {
          window.previewBtn.innerHTML = iconPlay;
          window.previewBtn.style.color = '#ccc';
          window.previewBtn.style.borderColor = 'rgba(255,255,255,0.08)';
          window.previewBtn.style.background = 'rgba(255,255,255,0.07)';
        }
        if (window.previewAudio) {
          window.previewAudio.pause();
          window.previewAudio.onended = null;
          window.previewAudio.onerror = null;
          window.previewAudio = null;
        }
        playBtn.innerHTML = iconStop;
        playBtn.style.color = '#FBAE00';
        playBtn.style.borderColor = 'rgba(251,174,0,0.4)';
        playBtn.style.background = 'rgba(251,174,0,0.1)';
        window.previewBtn = playBtn;

        const resetBtn = () => {
          playBtn.innerHTML = iconPlay;
          playBtn.style.color = '#ccc';
          playBtn.style.borderColor = 'rgba(255,255,255,0.08)';
          playBtn.style.background = 'rgba(255,255,255,0.07)';
          if (window.previewBtn === playBtn) window.previewBtn = null;
          window.previewAudio = null;
        };

        const audio = new Audio(item.path);
        audio.volume = 0.8;
        audio.onerror = () => {
          console.error('Audio load error for:', item.path);
          resetBtn();
        };
        audio.onended = resetBtn;
        window.previewAudio = audio;
        audio.play().catch(err => {
          console.error('Preview error:', err, item.path);
          resetBtn();
        });
      };

      // ── Assign button
      const assignBtn = document.createElement('button');
      Object.assign(assignBtn.style, {
        background: '#FBAE00', border: 'none', color: '#000',
        fontWeight: '700', fontSize: '11px', padding: '6px 14px',
        borderRadius: '8px', cursor: 'pointer', letterSpacing: '0.3px', transition: 'none'
      });
      assignBtn.textContent = 'Usar';
      assignBtn.onmouseenter = () => { assignBtn.style.background = '#ffc130'; };
      assignBtn.onmouseleave = () => { assignBtn.style.background = '#FBAE00'; };
      assignBtn.onclick = () => {
        if (window.previewAudio) { window.previewAudio.pause(); window.previewAudio.onended = null; window.previewAudio = null; }
        modal.remove();
        onAssign(item.path);
      };

      actions.appendChild(playBtn);
      actions.appendChild(assignBtn);
      row.appendChild(nameEl);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }


  content.appendChild(uploadBtn);
  content.appendChild(sectionLabel);
  content.appendChild(listEl);
  box.appendChild(header);
  box.appendChild(content);
  modal.appendChild(box);
  document.body.appendChild(modal);

  const close = () => {
    if (window.previewAudio) { window.previewAudio.pause(); window.previewAudio.onended = null; window.previewAudio = null; }
    modal.remove();
  };
  closeBtn.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  uploadBtn.onclick = () => { close(); onUploadNew(); };
}



/* ── DRUM VOLUMES ── */
function buildDrumVolumes(pads) {
  const container = q('#drum-volumes'); container.innerHTML = '';
  const sbContainer = q('#sidebar-drum-volumes'); sbContainer.innerHTML = '';
  for (const pad of pads) {
    const item = document.createElement('div'); item.className='drum-vol-item';
    item.innerHTML = `
      <div class="drum-vol-header">
        <label id="lbl-dvol-text-${pad.id}">${pad.label}</label>
        <span class="drum-vol-pct" id="dpct-${pad.id}">80%</span>
      </div>
      <input type="range" min="0" max="100" value="80" id="dvol-${pad.id}">`;
    container.appendChild(item);

    const sbItem = document.createElement('div'); sbItem.className='sb-row'; sbItem.style.padding='0';
    sbItem.innerHTML = `<span class="sr-label" id="sb-lbl-dvol-text-${pad.id}" style="min-width:70px;">${pad.label}</span>
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

  // Track Player Volume & Progress startup sync
  const tpVolSlider = q('#tp-vol');
  const tpVolVal = q('#tp-vol-val');
  if (tpVolSlider && tpVolVal) {
    tpVolSlider.oninput = (e) => {
      if (currentTrackAudio) {
        currentTrackAudio.volume = e.target.value / 100;
      }
      tpVolVal.textContent = e.target.value + '%';
      syncSlider(e.target);
    };
    syncSlider(tpVolSlider);
  }

  const tpProgress = q('#tp-progress');
  if (tpProgress) {
    tpProgress.oninput = (e) => {
      if (currentTrackAudio && currentTrackAudio.duration) {
        currentTrackAudio.currentTime = (e.target.value / 100) * currentTrackAudio.duration;
        syncSlider(e.target);
      }
    };
    syncSlider(tpProgress);
  }

  const btnCreateKit = q('#btn-create-kit');
  if (btnCreateKit) {
    btnCreateKit.onclick = () => {
      // Exit edit mode first so contentEditable pads don't steal focus from the dialog
      if (isEditKitMode) {
        const btnEditKit = q('#btn-edit-kit');
        if (btnEditKit) btnEditKit.click();
      }
      showDialog('Nuevo kit de batería', 'Ej. Worship Acoustic', (name) => {
        if (!name || !name.trim()) return;
        const newKit = {
          id: `custom_kit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          name: name.trim(),
          desc: 'Batería personalizada (Edita con el ✏️)',
          color: '#10b981',
          isCustom: true,
          pads: [
            { id: 'c_kick', label: 'Kick', type: 'kick', sample: null },
            { id: 'c_snare', label: 'Snare', type: 'snare', sample: null },
            { id: 'c_hhc', label: 'HH Cerr', type: 'hihatC', sample: null },
            { id: 'c_clap', label: 'Clap', type: 'clap', sample: null },
            { id: 'c_perc1', label: 'Tom 1', type: 'tomH', sample: null },
            { id: 'c_perc2', label: 'Tom 2', type: 'tomM', sample: null },
            { id: 'c_crash', label: 'Crash', type: 'crash', sample: null },
            { id: 'c_ride', label: 'Ride', type: 'ride', sample: null },
          ]
        };
        KIT_BANKS.unshift(newKit);
        saveCustomKitsToStorage();
        buildBankSelects();
        loadKitBank(0);
      });
    };
  }

  const btnDeleteKit = q('#btn-delete-kit');
  if (btnDeleteKit) {
    btnDeleteKit.onclick = () => {
      const currentKit = KIT_BANKS[kitBankIdx];
      if (!currentKit || !currentKit.isCustom) return;
      if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el kit "${currentKit.name}"?`)) {
        KIT_BANKS.splice(kitBankIdx, 1);
        saveCustomKitsToStorage();
        buildBankSelects();
        loadKitBank(0);
      }
    };
  }

  const btnEditKit = q('#btn-edit-kit');
  if (btnEditKit) {
    btnEditKit.onclick = () => {
      const currentKit = KIT_BANKS[kitBankIdx];
      if (!currentKit || !currentKit.isCustom) {
        alert('Selecciona un kit personalizado primero.');
        return;
      }
      
      isEditKitMode = !isEditKitMode;
      btnEditKit.style.color = isEditKitMode ? 'var(--blue)' : 'var(--text-muted)';
      btnEditKit.style.borderColor = isEditKitMode ? 'var(--blue)' : 'transparent';
      if (isEditKitMode) {
        btnEditKit.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" width="18" height="18"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else {
        btnEditKit.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" width="18" height="18"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
      }
      
      const kitSelect = q('#kit-bank-select');
      const selectWrapper = kitSelect.parentElement;

      if (isEditKitMode) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'edit-kit-name-input';
        input.className = 'metro-dropdown';
        input.style.width = '100%';
        input.style.border = '1px solid var(--blue)';
        input.value = currentKit.name;
        kitSelect.style.display = 'none';
        selectWrapper.insertBefore(input, kitSelect);
        input.focus();
      } else {
        const input = q('#edit-kit-name-input');
        if (input) {
           const newName = input.value.trim() || 'Custom Kit';
           currentKit.name = newName;
           saveCustomKitsToStorage();
           input.remove();
        }
        kitSelect.style.display = 'block';
        buildBankSelects();
        kitSelect.value = kitBankIdx;
      }

      qa('.drum-btn').forEach(b => {
        const lbl = b.querySelector('.drum-label');
        if (isEditKitMode) {
           b.classList.add('edit-pulse');
           if(lbl) lbl.contentEditable = true;
        } else {
           b.classList.remove('edit-pulse');
           if(lbl) lbl.contentEditable = false;
        }
      });
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

  q('#menu-open-settings').onclick = () => { closeMenu(); openSidebarTab('settings'); };
  q('#menu-open-themes').onclick   = () => { closeMenu(); openSidebarTab('themes'); };
  q('#menu-fullscreen').onclick = () => {
    closeMenu();
    window.electronAPI.windowAction('fullscreen');
  };
  q('#menu-about').onclick = () => { closeMenu(); openSidebarTab('about'); };
  
  const btnMidiLearn = q('#menu-midi-learn');
  if (btnMidiLearn) {
    btnMidiLearn.onclick = () => {
      closeMenu();
      isMidiLearnMode = true;
      midiLearnTarget = null;
      q('#midi-learn-overlay').innerHTML = '🎹 Modo Mapeo: Haz clic en un botón de la app. (Clic aquí para salir)';
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

  // Drum Master Volume (controls the main drumGain node — all pads together)
  const drumMasterVolStage    = q('#drum-master-vol-stage');
  const drumMasterVolValStage = q('#drum-master-vol-val-stage');
  const drumMasterVol         = q('#drum-master-vol');
  const drumMasterVolVal      = q('#drum-master-vol-val');
  const updateDrumMasterVol = val => {
    engine.setDrumVolume(val / 100);
    if (drumMasterVolStage) { drumMasterVolStage.value = val; drumMasterVolValStage.textContent = val + '%'; syncSlider(drumMasterVolStage); }
    if (drumMasterVol)      { drumMasterVol.value = val;      drumMasterVolVal.textContent      = val + '%'; syncSlider(drumMasterVol); }
  };
  if (drumMasterVolStage) drumMasterVolStage.oninput = () => updateDrumMasterVol(drumMasterVolStage.value);
  if (drumMasterVol)      drumMasterVol.oninput      = () => updateDrumMasterVol(drumMasterVol.value);
  updateDrumMasterVol(80); // init at 80% matching engine default

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

  // Click-to-edit inline BPM
  bpmDisp.style.cursor = 'pointer';
  bpmDisp.title = 'Hacer clic para editar BPM';
  bpmDisp.onclick = () => {
    if (q('#bpm-inline-input')) return; // already editing

    const currentBpm = metro.bpm;
    const input = document.createElement('input');
    input.id = 'bpm-inline-input';
    input.type = 'text';
    input.value = currentBpm;
    input.style.cssText = 'font-size: 34px; font-weight: 900; color: var(--blue); background: rgba(0, 170, 255, 0.08); border: 1px solid rgba(0, 170, 255, 0.25); border-radius: 8px; outline: none; width: 85px; text-align: center; font-variant-numeric: tabular-nums; font-family: inherit; margin: 0 auto; display: block; padding: 2px 4px; box-sizing: border-box; box-shadow: 0 0 10px rgba(0, 170, 255, 0.1);';

    input.onkeypress = (e) => {
      if (e.key < '0' || e.key > '9') e.preventDefault();
    };

    bpmDisp.innerHTML = '';
    bpmDisp.appendChild(input);
    input.focus();
    input.select();

    const commitChange = () => {
      let val = parseInt(input.value);
      if (isNaN(val) || val < 30) val = 30;
      if (val > 300) val = 300;
      updateBPM(val);
    };

    input.onblur = () => {
      commitChange();
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        commitChange();
      } else if (e.key === 'Escape') {
        bpmDisp.textContent = currentBpm;
      }
    };
  };

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
  const btnAddPreset = q('#btn-add-preset');
  if (btnAddPreset) {
    btnAddPreset.onclick = () => showDialog('Guardar set', 'Nombre…', doSavePreset);
  }
  
  // GI-Setlist UI bindings
  qa('.s-toggle').forEach(btn => {
    btn.onclick = () => {
      qa('.s-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      q('#setlist-list').classList.add('hidden');
      q('#gi-setlist-list').classList.add('hidden');
      q('#service-setlist-list').classList.add('hidden');
      q('#' + btn.dataset.target).classList.remove('hidden');
  
      // Update top-level button visibility based on active tab
      const target = btn.dataset.target;
      const btnImport = q('#btn-import-gi');
      const btnSync = q('#btn-sync-gi');
      const btnAddPresetEl = q('#btn-add-preset');
      
      if (btnImport) {
        if (target === 'setlist-list') {
          btnImport.style.display = 'none';
          if (btnSync) btnSync.style.display = 'none';
          if (btnAddPresetEl) btnAddPresetEl.style.display = 'flex';
        } else if (target === 'gi-setlist-list') {
          btnImport.style.display = 'flex';
          if (btnSync) btnSync.style.display = 'flex';
          if (btnAddPresetEl) btnAddPresetEl.style.display = 'none';
        } else {
          btnImport.style.display = 'none';
          if (btnSync) btnSync.style.display = 'none';
          if (btnAddPresetEl) btnAddPresetEl.style.display = 'none';
        }
      }
    };
  });

  // Initial sync of setlist header buttons
  const activeToggle = q('.s-toggle.active');
  if (activeToggle) activeToggle.click();

  // Clear service list
  const btnClear = q('#btn-clear-service');
  if (btnClear) btnClear.onclick = clearServiceList;

  const btnPrev = q('#btn-service-prev');
  if (btnPrev) btnPrev.onclick = servicePrevSong;
  const btnNext = q('#btn-service-next');
  if (btnNext) btnNext.onclick = serviceNextSong;

  const btnSyncGi = q('#btn-sync-gi');
  if (btnSyncGi) {
    btnSyncGi.onclick = async () => {
      if (!window.electronAPI) return;
      try {
        btnSyncGi.style.animation = 'pulse 1s infinite';
        btnSyncGi.style.color = '#fbae00';
        
        const mongoSongs = await window.electronAPI.syncMongoSetlist();
        
        if (!mongoSongs || !mongoSongs.length) {
           throw new Error("No se encontraron canciones en MongoDB");
        }
        
        let updatedCount = 0;
        let newCount = 0;

        mongoSongs.forEach(mSong => {
          const existingIdx = giSetlistSongs.findIndex(s => 
            (s._id && s._id === mSong._id) || 
            (s.title.toLowerCase() === mSong.title.toLowerCase() && (s.artist || '').toLowerCase() === (mSong.artist || '').toLowerCase())
          );

          if (existingIdx >= 0) {
            const existing = giSetlistSongs[existingIdx];
            let changed = false;
            if (!existing._id) { existing._id = mSong._id; changed = true; }
            if (existing.lyrics !== mSong.lyrics) { existing.lyrics = mSong.lyrics; changed = true; }
            if (existing.bpm !== mSong.bpm) { existing.bpm = mSong.bpm; changed = true; }
            if (existing.key !== mSong.key) { existing.key = mSong.key; changed = true; }
            if (existing.genre !== mSong.genre) { existing.genre = mSong.genre; changed = true; }
            
            if (changed) updatedCount++;
          } else {
            giSetlistSongs.push({
              id: 'song_sync_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
              _id: mSong._id,
              title: mSong.title,
              artist: mSong.artist || '',
              bpm: mSong.bpm || '',
              key: mSong.key || '',
              genre: mSong.genre || '',
              lyrics: mSong.lyrics || ''
            });
            newCount++;
          }
        });
        
        if (updatedCount > 0 || newCount > 0) {
          if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
          updateFilterCounts();
          renderGiSetlist(q('#gi-search').value);
          showToast(`Sincronización exitosa. Nuevas: ${newCount}, Actualizadas: ${updatedCount}`, 'success');
        } else {
          showToast('Tu librería ya está al día, sin cambios.', 'success');
        }
      } catch (e) {
        console.error('Error sincronizando con MongoDB:', e);
        showToast('Error de red. Operando en Modo Local.', 'warning');
      } finally {
        btnSyncGi.style.animation = '';
        btnSyncGi.style.color = '';
      }
    };
  }

  q('#btn-import-gi').onclick = () => q('#gi-file-input').click();
  q('#gi-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        if (json.data && json.data.songs) {
          giSetlistSongs = json.data.songs.map((s, idx) => {
            if (!s.id) s.id = 'song_imp_' + idx + '_' + Date.now();
            return s;
          });
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
  
  const btnAddGiSong = q('#btn-add-gi-song');
  if (btnAddGiSong) {
    btnAddGiSong.onclick = () => {
      const newSong = {
        id: 'song_' + Date.now(),
        title: 'Nueva Canción',
        artist: '',
        bpm: '',
        key: '',
        genre: 'adoracion',
        audio: {
          sequence: null,
          original: null
        }
      };
      giSetlistSongs.push(newSong);
      if (window.electronAPI && window.electronAPI.saveGiSetlist) {
        window.electronAPI.saveGiSetlist(giSetlistSongs);
      }
      updateFilterCounts();
      renderGiSetlist(q('#gi-search').value, newSong.id);
    };
  }
  
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

    if (!isNoteOn && !isCC) return;
    const mapKey = isCC ? `cc_${data1}` : `note_${data1}`;

    if (isMidiLearnMode && midiLearnTarget) {
      if (data2 > 0) {
        clearMappingForTarget(midiLearnTarget, false);
        customMidiMap[mapKey] = midiLearnTarget;
        if (window.electronAPI && window.electronAPI.saveMidiMap) window.electronAPI.saveMidiMap(customMidiMap);
        q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado! ${midiLearnTarget.action.toUpperCase()} al control MIDI. Selecciona otro o sal.`;
        midiLearnTarget = null;
      }
      return;
    }

    const mapping = customMidiMap[mapKey] || customMidiMap[data1];
    if (mapping) {
      if (mapping.action === 'slider') {
        const sliderEl = q('#' + mapping.id);
        if (sliderEl) {
          const min = parseFloat(sliderEl.min) || 0;
          const max = parseFloat(sliderEl.max) || 100;
          sliderEl.value = min + ((data2 / 127) * (max - min));
          sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }

      if (data2 > 0) {
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
          triggerMasterPlayPause();
        } else if (mapping.action === 'stop_seq') {
          triggerMasterStop();
        } else if (mapping.action === 'loop_seq') {
          const btn = q('#tp-loop-btn'); if (btn) btn.click();
        } else if (mapping.action === 'prev_song') {
          servicePrevSong();
        } else if (mapping.action === 'next_song') {
          serviceNextSong();
        }
      }
      return;
    }

    // Hardcoded fallback map
    if (isNoteOn && data2 > 0) {
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
    const loopBtn = e.target.closest('#tp-loop-btn');
    const prevBtn = e.target.closest('#btn-service-prev');
    const nextBtn = e.target.closest('#btn-service-next');
    const slider = e.target.closest('input[type="range"]');

    let target = null;
    if (keyBtn) target = { action: 'pad', id: keyBtn.dataset.key };
    else if (drumBtn) target = { action: 'drum', id: drumBtn.dataset.type };
    else if (metroBtn) target = { action: 'metro' };
    else if (playSeqBtn) target = { action: 'play_seq' };
    else if (stopSeqBtn) target = { action: 'stop_seq' };
    else if (loopBtn) target = { action: 'loop_seq' };
    else if (prevBtn) target = { action: 'prev_song' };
    else if (nextBtn) target = { action: 'next_song' };
    else if (slider && slider.id) target = { action: 'slider', id: slider.id };
    else return; // unmappable

    e.stopPropagation();
    e.preventDefault();
    midiLearnTarget = target;
    q('#midi-learn-overlay').innerHTML = `🎹 Esperando MIDI para: <b>${target.action.toUpperCase()} ${target.id || ''}</b>... Toca tu controlador.`;
  }, true);

  // Dialog
  q('#dialog-cancel').onclick = hideDialog;

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

function triggerMasterPlayPause() {
  const isTrackPlaying = typeof currentTrackAudio !== 'undefined' && currentTrackAudio && !currentTrackAudio.paused;
  const isTrackLoaded = typeof currentTrackAudio !== 'undefined' && currentTrackAudio && currentTrackAudio.src;

  // We are actively playing a session if:
  // - A track is loaded and it is currently playing
  // - OR, no track is loaded and the metronome is running
  const isCurrentlyActive = isTrackLoaded ? isTrackPlaying : metroRunning;

  if (isCurrentlyActive) {
     // STOP MASTER
     triggerMasterStop();
  } else {
     // START MASTER
     // 1. Play the pad if not already active (if it crossfaded, it is already active!)
     if (preparedPadKey && !activeKey) {
       onKeyClick(preparedPadKey);
     }
     
     // 2. Play the track or the metronome
     if (isTrackLoaded) {
       if (!isTrackPlaying) {
         const btn = q('#tp-play-btn');
         if (btn) btn.click();
       }
     } else {
       if (!metroRunning) {
         toggleMetro();
       }
     }
  }
}

function triggerMasterStop() {
  const isTrackPlaying = typeof currentTrackAudio !== 'undefined' && currentTrackAudio && !currentTrackAudio.paused;
  if (activeKey) onKeyClick(activeKey);
  if (metroRunning) toggleMetro();
  if (isTrackPlaying) {
     const btn = q('#tp-play-btn');
     if (btn) btn.click();
  }
}

function onKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;

  const k = e.code; // Use e.code (e.g. 'KeyA', 'Digit1', 'Space')
  
  if (isMidiLearnMode && midiLearnTarget) {
    e.preventDefault();
    clearMappingForTarget(midiLearnTarget, true);
    customMidiMap[`kbd_${k}`] = midiLearnTarget;
    if (window.electronAPI && window.electronAPI.saveMidiMap) window.electronAPI.saveMidiMap(customMidiMap);
    const kName = k.replace('Key', '').replace('Digit', '');
    q('#midi-learn-overlay').innerHTML = `✅ ¡Asignado! ${midiLearnTarget.action.toUpperCase()} a la tecla ${kName}. Selecciona otro o sal.`;
    midiLearnTarget = null;
    updateKeyHints();
    return;
  }

  // Check custom keyboard mapping
  const mapping = customMidiMap[`kbd_${k}`];
  if (mapping) {
    e.preventDefault();
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
      triggerMasterPlayPause();
    } else if (mapping.action === 'stop_seq') {
      triggerMasterStop();
    } else if (mapping.action === 'loop_seq') {
      const btn = q('#tp-loop-btn'); if (btn) btn.click();
    } else if (mapping.action === 'prev_song') {
      servicePrevSong();
    } else if (mapping.action === 'next_song') {
      serviceNextSong();
    }
    return;
  }

  // Fallbacks
  const kUpper = e.key.toUpperCase();
  if (e.code === 'Space') { 
    e.preventDefault(); 
    triggerMasterPlayPause();
  }
  
  // Arrow key navigation for Service List
  if (document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
      e.preventDefault();
      serviceNextSong();
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
      e.preventDefault();
      servicePrevSong();
      return;
    }
  }

  if (e.code === 'Escape') { closeAllOverlays(); q('#sidebar').classList.remove('open'); engine.stopPad(); activeKey = null; preparedPadKey = null; buildKeyGrid(); }

  const padIdx = KEY_MAP_PADS.indexOf(kUpper);
  if (padIdx !== -1) { const keys = useFlats ? KEYS_FLAT : KEYS_SHARP; onKeyClick(keys[padIdx]); }

  const drumIdx = KEY_MAP_DRUMS.indexOf(kUpper);
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
    el.innerHTML = `<div class="preset-info" style="flex: 1;"><div class="preset-item-name">${p.name}</div><div class="preset-item-meta">${p.key || '—'} · ${p.bpm} BPM</div></div>
    <div class="preset-actions" style="display: flex; gap: 6px; align-items: center;">
      <button class="pi-play" style="padding: 6px;"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5,3 19,12 5,21"/></svg></button>
      <button class="pi-delete" title="Eliminar" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted)'" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:6px; display:flex; align-items:center; transition:color 0.2s;"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14" style="pointer-events:none;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
    </div>`;
    
    el.querySelector('.preset-info').onclick = () => applyPreset(p);
    el.querySelector('.pi-play').onclick = (e) => { e.stopPropagation(); applyPreset(p); };
    el.querySelector('.pi-delete').onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`¿Estás seguro de que deseas eliminar el preset "${p.name}"?`)) {
        presets = presets.filter(item => item.id !== p.id);
        renderPresets();
        if (window.electronAPI && window.electronAPI.deletePreset) {
          await window.electronAPI.deletePreset(p.id);
        }
      }
    };
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

function showDialog(title, placeholder = 'Nombre…', onConfirm = null) {
  q('#dialog-title').textContent = title;
  q('#dialog-overlay').classList.remove('hidden');
  q('#dialog-name').value = '';
  q('#dialog-name').placeholder = placeholder;
  setTimeout(() => q('#dialog-name').focus(), 50);
  if (onConfirm) {
    q('#dialog-ok').onclick = () => {
      onConfirm(q('#dialog-name').value.trim());
      hideDialog();
    };
  }
}
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
        giSetlistSongs = json.data.songs.map((s, idx) => {
          if (!s.id) s.id = 'song_' + idx + '_' + Date.now();
          return s;
        });
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
        giSetlistSongs = json.data.songs.map((s, idx) => {
          if (!s.id) s.id = 'song_fb_' + idx + '_' + Date.now();
          return s;
        });
        updateFilterCounts();
        renderGiSetlist();
      }
    }
  } catch (e) {
    console.log('GI-Setlist local no encontrado, esperando importación manual.');
  }
}

function formatLyrics(lyrics) {
  if (!lyrics) return '<div style="color:var(--text-muted);font-style:italic;font-size:11px;">No hay letra disponible.</div>';
  
  const cleanLyrics = lyrics.replace(/\r/g, '');
  const lines = cleanLyrics.split('\n');
  
  let html = '';
  
  const chordRegex = /^[A-G][b#]?(?:maj|min|m|maj7|min7|m7|dim|aug|sus\d*|add\d*|no\d*|2|4|5|6|7|9|11|13)*(?:\/[A-G][b#]?)?$/i;
  
  function isChordLine(line) {
    const clean = line.replace(/\[|\]/g, '').trim();
    if (clean.length === 0) return false;
    
    const tokens = clean.split(/\s+/);
    let chordCount = 0;
    let wordCount = 0;
    
    for (const token of tokens) {
      if (/^x\d+$/i.test(token)) continue; 
      
      const cleanToken = token.replace(/[()]/g, '');
      if (chordRegex.test(cleanToken)) {
        chordCount++;
      } else {
        wordCount++;
      }
    }
    
    return chordCount > 0 && wordCount === 0;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    
    if (trimmed.length === 0) {
      html += '<div class="lyrics-spacer" style="height:10px;"></div>';
      continue;
    }
    
    const isBracketedHeader = trimmed.startsWith('[') && trimmed.endsWith(']') && !isChordLine(trimmed);
    const sectionKeywords = ['INTRO', 'VERSO', 'CORO', 'PUENTE', 'PRECORO', 'PRE-CORO', 'INSTRUMENTAL', 'OUTRO', 'SOLO', 'TAG', 'ENDING', 'ESTRIBILLO'];
    const isKeywordHeader = sectionKeywords.some(keyword => {
      return trimmed.toUpperCase().startsWith(keyword);
    }) && trimmed.split(/\s+/).length <= 3;
    
    if (isBracketedHeader || isKeywordHeader) {
      const headerText = trimmed.replace(/\[|\]/g, '');
      html += `<div class="section-header-line">${headerText}</div>`;
      continue;
    }
    
    if (isChordLine(rawLine)) {
      let formattedChords = rawLine.replace(/\[|\]/g, '');
      html += `<div class="chord-line">${formattedChords}</div>`;
    } else {
      const hasChords = /\[([^\]<>]+)\]/.test(rawLine);
      let formattedLyrics = rawLine.replace(/\[([^\]<>]+)\]/g, (match, chord) => {
        return `<span class="inline-chord">${chord}</span>`;
      });
      html += `<div class="lyric-line ${hasChords ? 'has-inline-chords' : ''}">${formattedLyrics}</div>`;
    }
  }
  
  return html;
}

function highlightSyntax(text) {
  if (!text) return '';
  
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  const sectionKeywords = ['INTRO', 'VERSO', 'CORO', 'PUENTE', 'PRECORO', 'PRE-CORO', 'INSTRUMENTAL', 'OUTRO', 'SOLO', 'TAG', 'ENDING', 'ESTRIBILLO', 'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS'];
  
  html = html.replace(/(\[[^\]\n]+\])/g, (match) => {
    const clean = match.replace(/\[|\]/g, '').toUpperCase().trim();
    const isHeader = sectionKeywords.some(kw => clean.startsWith(kw));
    if (isHeader) {
      return `<span style="color:#60a5fa; font-weight:800; font-family:'Inter', system-ui, sans-serif;">${match}</span>`;
    }
    return `<span style="color:#fbae00; font-weight:800; font-family:'Consolas', 'Monaco', monospace; font-size: 13px;">${match}</span>`;
  });
  
  return html + (html.endsWith('\n') ? ' ' : '');
}

function wrapTextareaSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  const replacement = before + selected + after;
  
  const savedScrollTop = textarea.scrollTop;
  const savedScrollLeft = textarea.scrollLeft;
  
  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
  
  textarea.scrollTop = savedScrollTop;
  textarea.scrollLeft = savedScrollLeft;
  
  textarea.dispatchEvent(new Event('input'));
}

function insertTextAtCursor(textarea, textToInsert) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  
  let prefix = '';
  if (start > 0 && text[start - 1] !== '\n') {
    prefix = '\n';
  }
  
  const replacement = prefix + textToInsert + '\n';
  
  const savedScrollTop = textarea.scrollTop;
  const savedScrollLeft = textarea.scrollLeft;
  
  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  
  textarea.focus();
  const newCursorPos = start + replacement.length;
  textarea.selectionStart = newCursorPos;
  textarea.selectionEnd = newCursorPos;
  
  textarea.scrollTop = savedScrollTop;
  textarea.scrollLeft = savedScrollLeft;
  
  textarea.dispatchEvent(new Event('input'));
}

function openLyricsEditorModal(song, onSaveCallback) {
  const overlay = document.createElement('div');
  overlay.id = 'gi-lyrics-modal';
  overlay.className = 'lyrics-modal-overlay';
  
  const content = document.createElement('div');
  content.className = 'lyrics-modal-panel';
  
  content.innerHTML = `
    <div class="lyrics-modal-header">
      <div>
        <h3 class="lyrics-modal-title">Editar Letra y Acordes</h3>
        <p class="lyrics-modal-subtitle">${song.title} — ${song.artist || 'Sin artista'}</p>
      </div>
      <button class="modal-close-btn lyrics-modal-close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    
    <div style="flex:1; min-height:0; margin-bottom:20px; display:flex; flex-direction:column; gap:12px;">
      <div class="lyrics-editor-toolbar">
        <select class="format-select lyrics-section-select">
          <option value="normal" style="background:#121212; color:#888;">+ SECCIÓN</option>
          <option value="intro" style="background:#121212; color:#fff;">Intro</option>
          <option value="verso" style="background:#121212; color:#fff;">Verso</option>
          <option value="pre-coro" style="background:#121212; color:#fff;">Pre-Coro</option>
          <option value="coro" style="background:#121212; color:#fff;">Coro</option>
          <option value="puente" style="background:#121212; color:#fff;">Puente</option>
          <option value="instrumental" style="background:#121212; color:#fff;">Instrumental</option>
          <option value="solo" style="background:#121212; color:#fff;">Solo</option>
          <option value="final" style="background:#121212; color:#fff;">Final</option>
        </select>
        <div class="toolbar-sep"></div>
        <button type="button" class="format-tool-btn chord-btn" data-action="chord" title="Envolver selección en [ ]">[ ]</button>
        <button type="button" class="format-tool-btn" data-action="clear" title="Limpiar formato de selección">Tx</button>
        <div style="margin-left:auto;">
          <button class="btn-preview-toggle lyrics-preview-btn">Vista Previa</button>
        </div>
      </div>
      
      <div class="editor-workspace" style="flex:1; position:relative; min-height:0;">
        <div class="editor-container">
          <div class="editor-highlight"></div>
          <textarea class="editor-textarea" placeholder="[Intro]\n[C#m] [B] [A]\n\n[Verso 1]\n[C#m]              [B]\nMi Dios todo lo puede hacer..." spellcheck="false" style="tab-size:4; overflow-y:auto;"></textarea>
        </div>
        <div class="modal-preview-panel lyrics-preview-panel" style="display:none;">
          <div class="lyrics-text-content" style="font-size:12px;"></div>
        </div>
      </div>
    </div>
    
    <div class="lyrics-modal-footer">
      <button class="modal-btn cancel-btn lyrics-modal-cancel">Cancelar</button>
      <button class="modal-btn save-btn lyrics-modal-save">Guardar Cambios</button>
    </div>
  `;
  
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  
  const textarea = overlay.querySelector('.editor-textarea');
  const highlight = overlay.querySelector('.editor-highlight');
  
  // Set value after attaching to avoid cursor reset issues
  textarea.value = song.lyrics || '';
  
  setTimeout(() => {
    overlay.style.opacity = '1';
    content.style.transform = 'translateX(0)';
  }, 10);
  
  const closeModal = () => {
    overlay.style.opacity = '0';
    content.style.transform = 'translateX(100%)';
    setTimeout(() => overlay.remove(), 300);
  };
  
  overlay.querySelector('.modal-close-btn').onclick = closeModal;
  overlay.querySelector('.cancel-btn').onclick = closeModal;
  
  const previewPanel = overlay.querySelector('.modal-preview-panel');
  const previewBtn = overlay.querySelector('.btn-preview-toggle');
  
  highlight.innerHTML = highlightSyntax(textarea.value);
  
  textarea.oninput = () => {
    highlight.innerHTML = highlightSyntax(textarea.value);
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  };
  textarea.onscroll = () => {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  };
  
  overlay.querySelectorAll('.format-tool-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      if (action === 'chord') {
        wrapTextareaSelection(textarea, '[', ']');
      } else if (action === 'clear') {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);
        const cleaned = selected.replace(/[\*_\[\]]/g, '');
        
        const savedScrollTop = textarea.scrollTop;
        textarea.value = text.substring(0, start) + cleaned + text.substring(end);
        textarea.focus();
        textarea.selectionStart = start;
        textarea.selectionEnd = start + cleaned.length;
        textarea.scrollTop = savedScrollTop;
        textarea.dispatchEvent(new Event('input'));
      }
    };
  });
  
  const formatSelect = overlay.querySelector('.format-select');
  formatSelect.onchange = (e) => {
    const val = formatSelect.value;
    if (val === 'intro') {
      insertTextAtCursor(textarea, '[INTRO]');
    } else if (val === 'verso') {
      insertTextAtCursor(textarea, '[VERSO 1]');
    } else if (val === 'pre-coro') {
      insertTextAtCursor(textarea, '[PRE-CORO]');
    } else if (val === 'coro') {
      insertTextAtCursor(textarea, '[CORO]');
    } else if (val === 'puente') {
      insertTextAtCursor(textarea, '[PUENTE]');
    } else if (val === 'instrumental') {
      insertTextAtCursor(textarea, '[INSTRUMENTAL]');
    } else if (val === 'solo') {
      insertTextAtCursor(textarea, '[SOLO]');
    } else if (val === 'final') {
      insertTextAtCursor(textarea, '[FINAL]');
    }
    formatSelect.value = 'normal';
  };
  
  let isPreview = false;
  previewBtn.onclick = () => {
    isPreview = !isPreview;
    if (isPreview) {
      previewBtn.textContent = 'Editar Letra';
      previewBtn.style.color = 'var(--blue)';
      previewBtn.style.borderColor = 'var(--blue)';
      textarea.parentNode.style.display = 'none';
      previewPanel.style.display = 'block';
      previewPanel.querySelector('.lyrics-text-content').innerHTML = formatLyrics(textarea.value);
    } else {
      previewBtn.textContent = 'Vista Previa';
      previewBtn.style.color = '';
      previewBtn.style.borderColor = '';
      textarea.parentNode.style.display = 'block';
      previewPanel.style.display = 'none';
      highlight.innerHTML = highlightSyntax(textarea.value);
      setTimeout(() => {
        highlight.scrollTop = textarea.scrollTop;
      }, 10);
    }
  };
  
  overlay.querySelector('.save-btn').onclick = () => {
    onSaveCallback(textarea.value);
    closeModal();
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };
}

function renderGiSetlist(filter = '', editSongId = null) {
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
    const genre = s.genre ? s.genre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';
    return genre.includes(currentGiGenre);
  });

  filtered.sort((a, b) => {
    if (a.id === editSongId) return -1;
    if (b.id === editSongId) return 1;
    return a.title.localeCompare(b.title);
  });

  if (!filtered.length) {
    container.innerHTML = '<div class="setlist-empty">No se encontraron resultados.</div>';
    return;
  }

  filtered.forEach((song, idx) => {
    const el = document.createElement('div');
    el.className = 'gi-song-item';
    const isActive = song.id && activeGiSongId && (song.id === activeGiSongId);
    const isLyricsOpen = song.id && (song.id === openAccordionSongId);
    const showChords = !!song.showChords;

    if (isActive) {
      el.style.borderColor = 'var(--blue)';
      el.style.background = 'rgba(0, 170, 255, 0.05)';
      el.style.boxShadow = '0 0 10px rgba(0, 170, 255, 0.15)';
    }

    const lyricsBtnStyle = song.lyrics 
      ? (isLyricsOpen 
         ? 'color:#fbae00; border-color:#fbae00; background:rgba(251,174,0,0.06);' 
         : 'color:#fbae00; border-color:#fbae00;') 
      : 'opacity:0.4; cursor:not-allowed;';

    el.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div style="display: flex; gap: 12px; flex: 1; min-width: 0;">
          <div class="gi-row-num" style="font-size: 14px; font-weight: 800; color: ${isActive ? 'var(--blue)' : 'var(--text-muted)'}; width: 20px; text-align: center; margin-top: 2px; display: flex; align-items: center; justify-content: center;">
            ${isActive ? `
              <svg viewBox="0 0 24 24" fill="var(--blue)" width="12" height="12" style="filter: drop-shadow(0 0 3px var(--blue)); margin-right: 1px;"><polygon points="5,3 19,12 5,21"/></svg>
            ` : idx + 1}
          </div>
          <div class="gi-song-main" style="flex: 1; min-width: 0;">
            <div class="gi-song-title" style="white-space: normal; line-height: 1.2; margin-bottom: 3px; ${isActive ? 'color: var(--blue); font-weight: 800;' : ''}">${song.title}</div>
            <div class="gi-song-artist">${song.artist || 'Sin artista'}</div>
          </div>
        </div>
        <div class="gi-song-meta" style="display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-shrink: 0;">
          ${song.bpm ? `<span class="gi-badge bpm">${song.bpm}</span>` : ''}
          ${song.key  ? `<span class="gi-badge key">${song.key}</span>` : ''}
          ${song.genre ? `<span class="gi-badge" style="display:none;">${song.genre}</span>` : ''}
        </div>
      </div>
      <div class="gi-song-actions" style="justify-content: flex-end; margin-top: 8px;">
        <button class="action-btn btn-lyrics ${isLyricsOpen ? 'active' : ''}" title="Ver letra y acordes" style="${lyricsBtnStyle}" ${song.lyrics ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </button>
        <button class="action-btn btn-seq" title="Secuencia Split-Track" style="${song.audio && song.audio.sequence ? 'color:var(--blue); border-color:var(--blue);' : ''}">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>
        </button>
        <button class="action-btn btn-orig" title="Canción Original" style="${song.audio && song.audio.original ? 'color:var(--blue); border-color:var(--blue);' : ''}">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
        </button>
        <button class="action-btn btn-add" title="Añadir al servicio">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="action-btn btn-edit" title="Editar canción">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn btn-remove-lib" title="Eliminar de la librería" style="color: #ff4747;">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="gi-lyrics-accordion ${isLyricsOpen ? 'open' : ''}">
        <div class="lyrics-accordion-header">
          <button class="lyrics-edit-btn" title="Editar letra y acordes">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="chord-toggle-btn lyrics-chord-pill ${showChords ? 'active' : ''}" title="${showChords ? 'Ocultar acordes' : 'Mostrar acordes'}">
            ${showChords ? 'Con acordes' : 'Solo letra'}
          </button>
        </div>
        <div class="lyrics-text-content ${showChords ? '' : 'hide-chords'}">
          ${formatLyrics(song.lyrics)}
        </div>
      </div>
    `;

    el.onclick = () => applyGiSong(song);
    el.querySelector('.btn-seq').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'sequence'); };
    el.querySelector('.btn-orig').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'original'); };

    const btnAdd = el.querySelector('.btn-add');
    btnAdd.onclick = (e) => {
      e.stopPropagation();
      addToService(song);
      
      // Visual feedback
      btnAdd.style.color = '#4ade80';
      
      // Floating notification popup
      const popup = document.createElement('div');
      popup.textContent = '¡Añadida al servicio!';
      popup.style.cssText = 'position: absolute; right: 10px; bottom: 45px; background: var(--blue); color: #000; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; pointer-events: none; z-index: 100; box-shadow: 0 4px 12px rgba(0,170,255,0.3); opacity: 1; transition: opacity 0.4s, transform 0.4s; transform: translateY(0);';
      
      // Relative parent is the song card 'el'
      el.style.position = 'relative';
      el.appendChild(popup);
      
      // Animate out
      setTimeout(() => {
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(-10px)';
      }, 800);
      
      setTimeout(() => {
        popup.remove();
        btnAdd.style.color = '';
      }, 1200);
    };

    el.querySelector('.btn-remove-lib').onclick = (e) => {
      e.stopPropagation();
      if (confirm('¿Estás seguro de eliminar esta canción de la librería?')) {
        giSetlistSongs = giSetlistSongs.filter(s => s.id !== song.id);
        if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
        updateFilterCounts();
        renderGiSetlist(q('#gi-search').value);
      }
    };

    const triggerEdit = () => {
      el.innerHTML = `
        <div style="grid-column:1/-1; display:flex; flex-direction:column; gap:8px; padding:4px 0;" onclick="event.stopPropagation()">
          <input type="text" class="edit-title" value="${song.title === 'Nueva Canción' ? '' : song.title}" placeholder="Título (Requerido)" style="width:100%;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:13px;font-weight:700;outline:none;box-sizing:border-box;">
          <input type="text" class="edit-artist" value="${song.artist||''}" placeholder="Artista" style="width:100%;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;">
          <div style="display:flex;gap:6px;">
            <input type="text" class="edit-bpm" value="${song.bpm||''}" placeholder="BPM" style="flex:1;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;text-align:center;outline:none;width:0;">
            <select class="edit-key" style="flex:1;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;cursor:pointer;">
              <option value="" ${!song.key ? 'selected' : ''}>-- Tono --</option>
              <option value="C" ${song.key === 'C' ? 'selected' : ''}>C (Do)</option>
              <option value="C#" ${song.key === 'C#' ? 'selected' : ''}>C# (Do#)</option>
              <option value="Db" ${song.key === 'Db' ? 'selected' : ''}>Db (Reb)</option>
              <option value="D" ${song.key === 'D' ? 'selected' : ''}>D (Re)</option>
              <option value="D#" ${song.key === 'D#' ? 'selected' : ''}>D# (Re#)</option>
              <option value="Eb" ${song.key === 'Eb' ? 'selected' : ''}>Eb (Mib)</option>
              <option value="E" ${song.key === 'E' ? 'selected' : ''}>E (Mi)</option>
              <option value="F" ${song.key === 'F' ? 'selected' : ''}>F (Fa)</option>
              <option value="F#" ${song.key === 'F#' ? 'selected' : ''}>F# (Fa#)</option>
              <option value="Gb" ${song.key === 'Gb' ? 'selected' : ''}>Gb (Solb)</option>
              <option value="G" ${song.key === 'G' ? 'selected' : ''}>G (Sol)</option>
              <option value="G#" ${song.key === 'G#' ? 'selected' : ''}>G# (Sol#)</option>
              <option value="Ab" ${song.key === 'Ab' ? 'selected' : ''}>Ab (Lab)</option>
              <option value="A" ${song.key === 'A' ? 'selected' : ''}>A (La)</option>
              <option value="A#" ${song.key === 'A#' ? 'selected' : ''}>A# (La#)</option>
              <option value="Bb" ${song.key === 'Bb' ? 'selected' : ''}>Bb (Sib)</option>
              <option value="B" ${song.key === 'B' ? 'selected' : ''}>B (Si)</option>
            </select>
            <select class="edit-genre" style="flex:1;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;cursor:pointer;">
              <option value="alabanza" ${song.genre === 'alabanza' ? 'selected' : ''}>Alabanza</option>
              <option value="adoracion" ${song.genre === 'adoracion' ? 'selected' : ''}>Adoración</option>
            </select>
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;">
            <button class="gi-edit-btn save" style="flex:1;padding:6px;background:var(--blue);color:#000;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">Guardar</button>
            <button class="gi-edit-btn cancel" style="flex:1;padding:6px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;font-size:11px;cursor:pointer;">Cancelar</button>
          </div>
        </div>
      `;
      el.querySelector('.cancel').onclick = (ev) => {
        ev.stopPropagation();
        if (song.title === 'Nueva Canción' && !song.artist && !song.bpm && !song.key) {
          giSetlistSongs = giSetlistSongs.filter(s => s.id !== song.id);
          if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
          updateFilterCounts();
        }
        renderGiSetlist(q('#gi-search').value);
      };
      el.querySelector('.save').onclick = (ev) => {
        ev.stopPropagation();
        const valTitle = el.querySelector('.edit-title').value.trim();
        song.title = valTitle || 'Nueva Canción';
        song.artist = el.querySelector('.edit-artist').value.trim();
        song.bpm = el.querySelector('.edit-bpm').value.trim();
        song.key = el.querySelector('.edit-key').value;
        song.genre = el.querySelector('.edit-genre').value;
        if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
        updateFilterCounts();
        renderGiSetlist(q('#gi-search').value);
      };
    };

    el.querySelector('.btn-edit').onclick = (e) => {
      e.stopPropagation();
      triggerEdit();
    };

    // Lyrics accordion trigger
    const btnLyrics = el.querySelector('.btn-lyrics');
    if (btnLyrics) {
      btnLyrics.onclick = (e) => {
        e.stopPropagation();
        if (openAccordionSongId === song.id) {
          openAccordionSongId = null;
        } else {
          openAccordionSongId = song.id;
          openAccordionServiceId = null;
        }
        renderGiSetlist(q('#gi-search').value);
        renderServiceList();
      };
    }

    // Lyrics editor modal trigger
    const btnEditLyrics = el.querySelector('.lyrics-edit-btn');
    if (btnEditLyrics) {
      btnEditLyrics.onclick = (e) => {
        e.stopPropagation();
        openLyricsEditorModal(song, (newLyrics) => {
          song.lyrics = newLyrics;
          if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
          renderGiSetlist(q('#gi-search').value);
        });
      };
    }

    // Chord toggle inside the accordion
    const btnChordToggle = el.querySelector('.chord-toggle-btn');
    if (btnChordToggle) {
      btnChordToggle.onclick = (e) => {
        e.stopPropagation();
        song.showChords = !song.showChords;
        renderGiSetlist(q('#gi-search').value);
      };
    }

    if (editSongId === song.id) {
      triggerEdit();
    }

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

function serviceNextSong() {
  if (serviceSongs.length === 0) return;
  activeServiceIndex++;
  if (activeServiceIndex >= serviceSongs.length) activeServiceIndex = 0;
  const song = serviceSongs[activeServiceIndex];
  applyGiSong(song);
}

function servicePrevSong() {
  if (serviceSongs.length === 0) return;
  activeServiceIndex--;
  if (activeServiceIndex < 0) activeServiceIndex = serviceSongs.length - 1;
  const song = serviceSongs[activeServiceIndex];
  applyGiSong(song);
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
    const isActive = (index === activeServiceIndex);
    const isLyricsOpen = song.serviceId && (song.serviceId === openAccordionServiceId);
    const showChords = !!song.showChords;
    
    if (isActive) {
      el.style.borderColor = 'var(--blue)';
      el.style.background = 'rgba(0, 170, 255, 0.05)';
      el.style.boxShadow = '0 0 10px rgba(0, 170, 255, 0.15)';
    }
    el.draggable = true;
    el.dataset.index = index;

    const lyricsBtnStyle = song.lyrics 
      ? (isLyricsOpen 
         ? 'color:#fbae00; border-color:#fbae00; background:rgba(251,174,0,0.06);' 
         : 'color:#fbae00; border-color:#fbae00;') 
      : 'opacity:0.4; cursor:not-allowed;';
    
    el.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div style="display: flex; gap: 12px; flex: 1; min-width: 0;">
          <div class="gi-row-num" style="font-size: 14px; font-weight: 800; color: ${isActive ? 'var(--blue)' : 'var(--text-muted)'}; width: 20px; text-align: center; margin-top: 2px; display: flex; align-items: center; justify-content: center;">
            ${isActive ? `
              <svg viewBox="0 0 24 24" fill="var(--blue)" width="12" height="12" style="filter: drop-shadow(0 0 3px var(--blue)); margin-right: 1px;"><polygon points="5,3 19,12 5,21"/></svg>
            ` : index + 1}
          </div>
          <div class="gi-song-main" style="flex: 1; min-width: 0;">
            <div class="gi-song-title" style="white-space: normal; line-height: 1.2; margin-bottom: 3px; ${isActive ? 'color: var(--blue); font-weight: 800;' : ''}">${song.title}</div>
            <div class="gi-song-artist">${song.artist || 'Sin artista'}</div>
          </div>
        </div>
        <div class="gi-song-meta" style="display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-shrink: 0;">
          ${song.bpm ? `<span class="gi-badge bpm">${song.bpm}</span>` : ''}
          ${song.key  ? `<span class="gi-badge key">${song.key}</span>` : ''}
          ${song.genre ? `<span class="gi-badge" style="display:none;">${song.genre}</span>` : ''}
        </div>
      </div>
      <div class="gi-song-actions" style="justify-content: flex-end; margin-top: 8px;">
        <button class="action-btn btn-lyrics ${isLyricsOpen ? 'active' : ''}" title="Ver letra y acordes" style="${lyricsBtnStyle}" ${song.lyrics ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </button>
        <button class="action-btn btn-seq" title="Secuencia Split-Track" style="${song.audio && song.audio.sequence ? 'color:var(--blue); border-color:var(--blue);' : ''}">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>
        </button>
        <button class="action-btn btn-orig" title="Canción Original" style="${song.audio && song.audio.original ? 'color:var(--blue); border-color:var(--blue);' : ''}">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
        </button>
        <button class="action-btn btn-edit" title="Editar canción">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn btn-remove" title="Quitar de la lista" style="color: #ff4747;">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="gi-lyrics-accordion ${isLyricsOpen ? 'open' : ''}">
        <div class="lyrics-accordion-header">
          <button class="lyrics-edit-btn" title="Editar letra y acordes">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="chord-toggle-btn lyrics-chord-pill ${showChords ? 'active' : ''}" title="${showChords ? 'Ocultar acordes' : 'Mostrar acordes'}">
            ${showChords ? 'Con acordes' : 'Solo letra'}
          </button>
        </div>
        <div class="lyrics-text-content ${showChords ? '' : 'hide-chords'}">
          ${formatLyrics(song.lyrics)}
        </div>
      </div>
    `;
    
    el.onclick = () => applyGiSong(song);
    el.querySelector('.btn-seq').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'sequence'); };
    el.querySelector('.btn-orig').onclick = (e) => { e.stopPropagation(); loadAndPlayTrack(song, 'original'); };
    el.querySelector('.btn-remove').onclick = (e) => {
      e.stopPropagation();
      removeFromService(song.serviceId);
    };

    // Lyrics accordion trigger
    const btnLyrics = el.querySelector('.btn-lyrics');
    if (btnLyrics) {
      btnLyrics.onclick = (e) => {
        e.stopPropagation();
        if (openAccordionServiceId === song.serviceId) {
          openAccordionServiceId = null;
        } else {
          openAccordionServiceId = song.serviceId;
          openAccordionSongId = null;
        }
        renderGiSetlist(q('#gi-search').value);
        renderServiceList();
      };
    }

    // Lyrics editor modal trigger
    const btnEditLyrics = el.querySelector('.lyrics-edit-btn');
    if (btnEditLyrics) {
      btnEditLyrics.onclick = (e) => {
        e.stopPropagation();
        openLyricsEditorModal(song, (newLyrics) => {
          song.lyrics = newLyrics;
          
          // Sincronizar con librería principal
          const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
          if (giSong) {
            giSong.lyrics = song.lyrics;
            if (window.electronAPI) window.electronAPI.saveGiSetlist(giSetlistSongs);
          }
          
          saveServiceSongs();
          renderGiSetlist(q('#gi-search').value);
          renderServiceList();
        });
      };
    }

    // Chord toggle inside the accordion
    const btnChordToggle = el.querySelector('.chord-toggle-btn');
    if (btnChordToggle) {
      btnChordToggle.onclick = (e) => {
        e.stopPropagation();
        song.showChords = !song.showChords;
        // Sincronizar con librería principal
        const giSong = giSetlistSongs.find(s => s.title === song.title && s.artist === song.artist);
        if (giSong) giSong.showChords = song.showChords;
        renderGiSetlist(q('#gi-search').value);
        renderServiceList();
      };
    }

    el.querySelector('.btn-edit').onclick = (e) => {
      e.stopPropagation();
      el.innerHTML = `
        <div style="grid-column:1/-1; display:flex; flex-direction:column; gap:8px; padding:4px 0;" onclick="event.stopPropagation()">
          <input type="text" class="edit-title" value="${song.title}" placeholder="Título" style="width:100%;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:13px;font-weight:700;outline:none;box-sizing:border-box;">
          <input type="text" class="edit-artist" value="${song.artist||''}" placeholder="Artista" style="width:100%;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;">
          <div style="display:flex;gap:6px;">
            <input type="text" class="edit-bpm" value="${song.bpm||''}" placeholder="BPM" style="flex:1;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;text-align:center;outline:none;width:0;">
            <select class="edit-key" style="flex:1;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;cursor:pointer;">
              <option value="" ${!song.key ? 'selected' : ''}>-- Tono --</option>
              <option value="C" ${song.key === 'C' ? 'selected' : ''}>C (Do)</option>
              <option value="C#" ${song.key === 'C#' ? 'selected' : ''}>C# (Do#)</option>
              <option value="Db" ${song.key === 'Db' ? 'selected' : ''}>Db (Reb)</option>
              <option value="D" ${song.key === 'D' ? 'selected' : ''}>D (Re)</option>
              <option value="D#" ${song.key === 'D#' ? 'selected' : ''}>D# (Re#)</option>
              <option value="Eb" ${song.key === 'Eb' ? 'selected' : ''}>Eb (Mib)</option>
              <option value="E" ${song.key === 'E' ? 'selected' : ''}>E (Mi)</option>
              <option value="F" ${song.key === 'F' ? 'selected' : ''}>F (Fa)</option>
              <option value="F#" ${song.key === 'F#' ? 'selected' : ''}>F# (Fa#)</option>
              <option value="Gb" ${song.key === 'Gb' ? 'selected' : ''}>Gb (Solb)</option>
              <option value="G" ${song.key === 'G' ? 'selected' : ''}>G (Sol)</option>
              <option value="G#" ${song.key === 'G#' ? 'selected' : ''}>G# (Sol#)</option>
              <option value="Ab" ${song.key === 'Ab' ? 'selected' : ''}>Ab (Lab)</option>
              <option value="A" ${song.key === 'A' ? 'selected' : ''}>A (La)</option>
              <option value="A#" ${song.key === 'A#' ? 'selected' : ''}>A# (La#)</option>
              <option value="Bb" ${song.key === 'Bb' ? 'selected' : ''}>Bb (Sib)</option>
              <option value="B" ${song.key === 'B' ? 'selected' : ''}>B (Si)</option>
            </select>
            <select class="edit-genre" style="flex:1;padding:6px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;cursor:pointer;">
              <option value="alabanza" ${song.genre === 'alabanza' ? 'selected' : ''}>Alabanza</option>
              <option value="adoracion" ${song.genre === 'adoracion' ? 'selected' : ''}>Adoración</option>
            </select>
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;">
            <button class="gi-edit-btn save" style="flex:1;padding:6px;background:var(--blue);color:#000;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">Guardar</button>
            <button class="gi-edit-btn cancel" style="flex:1;padding:6px;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;font-size:11px;cursor:pointer;">Cancelar</button>
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
  // Sync activeGiSongId
  activeGiSongId = song.id;

  // Sync activeServiceIndex
  const foundIdx = serviceSongs.findIndex(s => s.title === song.title && s.artist === song.artist);
  activeServiceIndex = foundIdx;
  renderServiceList();
  
  // Re-render Gi list to show play indicator in Library
  const searchInput = q('#gi-search');
  renderGiSetlist(searchInput ? searchInput.value : '');

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
    
    // Stop metronome if it is running
    if (metroRunning) {
      toggleMetro();
    }
    
    // Smooth transition or prepare the new key
    const keys = useFlats ? KEYS_FLAT : KEYS_SHARP;
    if (keys.includes(key)) {
      if (activeKey) {
        // If a pad is playing, smoothly crossfade to the new key
        onKeyClick(key);
      } else {
        // If no pad is playing, just prepare the key for master trigger
        preparedPadKey = key;
        qa('.key-btn').forEach(b => {
          b.classList.remove('active', 'prepared');
          if (b.dataset.key === key) b.classList.add('prepared');
        });
      }
    }
  }

  // Auto-load track if available
  if (song.audio) {
    if (song.audio.sequence) {
      loadAndPlayTrack(song, 'sequence');
    } else if (song.audio.original) {
      loadAndPlayTrack(song, 'original');
    }
  } else {
    // Clear track player if no audio is available for the new song
    if (currentTrackAudio) {
      cleanupTrackAudio();
      q('#tp-title').textContent = "Sin pista seleccionada";
      q('#tp-time-current').textContent = "0:00";
      q('#tp-time-total').textContent = "0:00";
      q('#tp-progress').value = 0;
      q('#tp-play-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5,3 19,12 5,21"/></svg>';
    }
  }
}

/* ── TRACK PLAYER LOGIC ── */
let currentTrackAudio = null;
let currentTrackType = null;
let currentTrackSong = null;

// Safe audio release and hardware decoder garbage collection
function cleanupTrackAudio() {
  if (currentTrackAudio) {
    try {
      currentTrackAudio.pause();
      currentTrackAudio.src = '';
      currentTrackAudio.load(); // Force immediate release of OS audio resources
      currentTrackAudio.onerror = null;
      currentTrackAudio.ontimeupdate = null;
      currentTrackAudio.onended = null;
    } catch (e) {
      console.warn("Error cleaning up audio element:", e);
    }
    currentTrackAudio = null;
  }
}

window.loadAndPlayTrack = function(song, type) {
  cleanupTrackAudio();
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

  if ((safeUrl && !safeUrl.startsWith('blob:') && !safeUrl.startsWith('http') && !safeUrl.startsWith('file:')) || (safeUrl && safeUrl.includes('/livepads/'))) {
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
  
  // Set initial value
  const tpVolSlider = q('#tp-vol');
  if (tpVolSlider) {
    currentTrackAudio.volume = tpVolSlider.value / 100;
  }
  
  q('#tp-close-btn').onclick = () => {
    cleanupTrackAudio();
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
  
  // Metronome and pad are managed by the main player play master flow, so they are not stopped here
  
  updatePlayBtn();
}

function saveCustomKitsToStorage() {
  const customKits = KIT_BANKS.filter(k => k.isCustom).map(k => {
    const getSample = (padId) => {
      const p = k.pads.find(pad => pad.id === padId);
      return p ? p.sample : null;
    };
    const getLabel = (padId) => {
      const p = k.pads.find(pad => pad.id === padId);
      return p ? p.label : '';
    };
    return {
      id: k.id,
      kitName: k.name,
      lbl_c_kick: getLabel('c_kick'), c_kick: getSample('c_kick'),
      lbl_c_snare: getLabel('c_snare'), c_snare: getSample('c_snare'),
      lbl_c_hhc: getLabel('c_hhc'), c_hhc: getSample('c_hhc'),
      lbl_c_clap: getLabel('c_clap'), c_clap: getSample('c_clap'),
      lbl_c_perc1: getLabel('c_perc1'), c_perc1: getSample('c_perc1'),
      lbl_c_perc2: getLabel('c_perc2'), c_perc2: getSample('c_perc2'),
      lbl_c_crash: getLabel('c_crash'), c_crash: getSample('c_crash'),
      lbl_c_ride: getLabel('c_ride'), c_ride: getSample('c_ride'),
    };
  });
  
  if (window.electronAPI && window.electronAPI.saveUserDrums) {
    window.electronAPI.saveUserDrums({ kits: customKits });
  }
}
