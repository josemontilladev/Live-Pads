// Custom drum kits — user-editable kits saved to disk via the electronAPI.
//
// Storage format (legacy): a flat object with c_kick/c_snare/... fields.
// Storage format (current): `{ kits: [ {id, kitName, c_kick, lbl_c_kick, ...}, ... ] }`.
// This module owns the boot-time hydration of KIT_BANKS as well as the
// serialization back to disk.

import { KIT_BANKS } from './banks.js';

const PAD_IDS = ['c_kick','c_snare','c_hhc','c_clap','c_perc1','c_perc2','c_crash','c_ride'];
const PAD_DEFS = [
  { id: 'c_kick',  type: 'kick',   defaultLabel: 'Kick'    },
  { id: 'c_snare', type: 'snare',  defaultLabel: 'Snare'   },
  { id: 'c_hhc',   type: 'hihatC', defaultLabel: 'HH Cerr' },
  { id: 'c_clap',  type: 'clap',   defaultLabel: 'Clap'    },
  { id: 'c_perc1', type: 'tomH',   defaultLabel: 'Tom 1'   },
  { id: 'c_perc2', type: 'tomM',   defaultLabel: 'Tom 2'   },
  { id: 'c_crash', type: 'crash',  defaultLabel: 'Crash'   },
  { id: 'c_ride',  type: 'ride',   defaultLabel: 'Ride'    }
];

// Normalize whatever the electron loadUserDrums returned into `{ kits: [...] }`.
// Accepts modern format, legacy flat format, or null/undefined.
export function normalizeCustomKitsRaw(raw) {
  if (!raw) return { kits: [] };
  if (raw.kits) return raw;
  if (raw.kitName) {
    // Legacy single-kit format → wrap into the new shape
    return {
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
        lbl_c_ride: raw.lbl_c_ride, c_ride: raw.c_ride
      }]
    };
  }
  return { kits: [] };
}

// Convert a stored kit (flat fields) into the runtime KIT_BANKS shape.
function inflateKit(k) {
  return {
    id: k.id || `custom_kit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: k.kitName || 'Custom Kit',
    desc: 'Batería personalizada (Edita con el ✏️)',
    color: '#10b981',
    isCustom: true,
    pads: PAD_DEFS.map(def => ({
      id: def.id,
      label: k['lbl_' + def.id] || def.defaultLabel,
      type: def.type,
      sample: k[def.id] || null
    }))
  };
}

// Build an empty custom kit with the given name (or a sane default).
// Used both at boot when no kits exist on disk, and at runtime when the user
// clicks "Nuevo kit".
export function createEmptyCustomKit(name) {
  return {
    id: `custom_kit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: name || 'PadLab Custom',
    desc: 'Batería personalizada (Edita con el ✏️)',
    color: '#10b981',
    isCustom: true,
    pads: PAD_DEFS.map(def => ({
      id: def.id,
      label: def.defaultLabel,
      type: def.type,
      sample: null
    }))
  };
}

// Prepend custom kits (loaded from disk or default empty) to KIT_BANKS.
// Called once at boot from app.js.
export function hydrateCustomKitsInto(kitBanks, rawDrums) {
  const data = normalizeCustomKitsRaw(rawDrums);
  if (data.kits.length > 0) {
    kitBanks.unshift(...data.kits.map(inflateKit));
  } else {
    kitBanks.unshift(createEmptyCustomKit());
  }
}

// Serialize the runtime KIT_BANKS custom kits back into the storage shape
// and persist them via the electronAPI.
export function saveCustomKitsToStorage() {
  const customKits = KIT_BANKS.filter(k => k.isCustom).map(k => {
    const findPad = (padId) => k.pads.find(p => p.id === padId);
    const flat = { id: k.id, kitName: k.name };
    for (const padId of PAD_IDS) {
      const p = findPad(padId);
      flat['lbl_' + padId] = p ? p.label : '';
      flat[padId] = p ? p.sample : null;
    }
    return flat;
  });

  if (window.electronAPI && window.electronAPI.saveUserDrums) {
    window.electronAPI.saveUserDrums({ kits: customKits });
  }
  try { window.dispatchEvent(new Event('livepads:settings-changed')); } catch (_) {}
}
