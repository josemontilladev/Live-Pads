/* ─── Theme definitions ───────────────────────────────
   Each theme drives a set of CSS variables consumed by index.css. The
   palette extras (accent2, glow, borderStrong, gradient) power the
   premium look: subtle 2-tone card gradients, glow on active states,
   stronger borders on focused elements, and a refined body backdrop. */
const THEMES = {
  gi_setlist: {
    name: 'GI.Setlist', desc: 'Estilo oficial · Gold & Dark',
    // Backgrounds
    bg1: '#050505', bg2: '#0f0f0f', bg3: '#181818',
    bgHover: '#232323',
    // Primary + secondary accents
    blue: '#FBAE00', accent2: '#FFD45C',
    // Borders + glow + body backdrop
    border: 'rgba(255,255,255,0.06)',
    borderStrong: 'rgba(251,174,0,0.22)',
    glow: 'rgba(251,174,0,0.20)',
    gradient: 'radial-gradient(at 18% 0%, rgba(251,174,0,0.06) 0%, transparent 45%), linear-gradient(155deg, #050505 0%, #0f0f0f 50%, #050505 100%)',
    swatch: 'linear-gradient(135deg,#FBAE00,#0f0f0f)'
  },
  midnight: {
    name: 'Midnight Aurora', desc: 'Teal profundo · Nocturno',
    bg1: '#020314', bg2: '#0a1228', bg3: '#131c35',
    bgHover: '#1e2a4a',
    blue: '#2dd4bf', accent2: '#67e8f9',
    border: 'rgba(45,212,191,0.10)',
    borderStrong: 'rgba(45,212,191,0.30)',
    glow: 'rgba(45,212,191,0.22)',
    gradient: 'radial-gradient(at 80% 100%, rgba(103,232,249,0.08) 0%, transparent 50%), linear-gradient(155deg, #020314 0%, #0a1228 50%, #020314 100%)',
    swatch: 'linear-gradient(135deg,#67e8f9,#2dd4bf 50%,#0a1228)'
  },
  crimson: {
    name: 'Crimson Power', desc: 'Energía · Rojo & Negro',
    bg1: '#0a0606', bg2: '#141010', bg3: '#1d1818',
    bgHover: '#2a1f1f',
    blue: '#ef4444', accent2: '#f87171',
    border: 'rgba(239,68,68,0.10)',
    borderStrong: 'rgba(239,68,68,0.28)',
    glow: 'rgba(239,68,68,0.22)',
    gradient: 'radial-gradient(at 100% 0%, rgba(239,68,68,0.07) 0%, transparent 45%), linear-gradient(155deg, #0a0606 0%, #141010 50%, #0a0606 100%)',
    swatch: 'linear-gradient(135deg,#f87171,#ef4444 50%,#141010)'
  },
  clean: {
    name: 'Clean Worship', desc: 'Minimalista · Claro & Azul',
    bg1: '#fafbfd', bg2: '#ffffff', bg3: '#f1f5f9',
    bgHover: '#e2e8f0',
    blue: '#0ea5e9', accent2: '#38bdf8',
    text: '#0f172a', textMuted: '#64748b',
    border: 'rgba(15,23,42,0.06)',
    borderStrong: 'rgba(14,165,233,0.30)',
    glow: 'rgba(14,165,233,0.16)',
    gradient: 'radial-gradient(at 18% 0%, rgba(14,165,233,0.06) 0%, transparent 50%), linear-gradient(155deg, #fafbfd 0%, #ffffff 50%, #fafbfd 100%)',
    swatch: 'linear-gradient(135deg,#38bdf8,#0ea5e9 50%,#ffffff)'
  },
  deep_sea: {
    name: 'Deep Sea', desc: 'Azul oceánico profundo',
    bg1: '#051a2c', bg2: '#082f49', bg3: '#0c4a6e',
    bgHover: '#075985',
    blue: '#38bdf8', accent2: '#7dd3fc',
    border: 'rgba(56,189,248,0.12)',
    borderStrong: 'rgba(125,211,252,0.32)',
    glow: 'rgba(56,189,248,0.22)',
    gradient: 'radial-gradient(at 80% 100%, rgba(125,211,252,0.10) 0%, transparent 50%), linear-gradient(155deg, #051a2c 0%, #082f49 50%, #051a2c 100%)',
    swatch: 'linear-gradient(135deg,#7dd3fc,#38bdf8 50%,#082f49)'
  },
  ambient: {
    name: 'Ambient Purple', desc: 'Atmósfera · Púrpura',
    bg1: '#0c0a1f', bg2: '#1a163a', bg3: '#2a2454',
    bgHover: '#3a3070',
    blue: '#a78bfa', accent2: '#c4b5fd',
    border: 'rgba(167,139,250,0.14)',
    borderStrong: 'rgba(196,181,253,0.32)',
    glow: 'rgba(167,139,250,0.24)',
    gradient: 'radial-gradient(at 100% 0%, rgba(196,181,253,0.10) 0%, transparent 50%), linear-gradient(155deg, #0c0a1f 0%, #1a163a 50%, #0c0a1f 100%)',
    swatch: 'linear-gradient(135deg,#c4b5fd,#a78bfa 50%,#1a163a)'
  }
};

/* ─── Pad banks (real ambient samples) ────────────────── */
const P = 'assets/Pads Amb/';

export const PAD_BANKS = [
  {
    id: 'foundations', name: 'Foundations Pad',
    desc: 'Pad base sólido y profundo', color: '#1e3a6e',
    folder: P + 'Fundations Pad/',
    pattern: 'Reawaken Worship Pads - Foundations - ' // suffix like '04 C.mp3'
  },
  {
    id: 'organic', name: 'Organic Pad',
    desc: 'Ambiente orgánico y cálido', color: '#b45309',
    folder: P + 'Organic Pad/',
    pattern: 'Reawaken Worship Pads - Organic - ' // suffix like '04 C.mp3'
  },
  {
    id: 'chris_rocha', name: 'Pad Chris Rocha',
    desc: 'Estilo profesional Chris Rocha', color: '#7c3aed',
    folder: P + 'Pad Chris Rocha/',
    pattern: '' // direct like 'C.mp3'
  }
];

/* ─── Drum kit banks ────────────────────────────────── */
const S = 'assets/Drums Pad/99 Drum Samples/Samples/'; // base path for real samples

export const KIT_BANKS = [
  {
    id: 'worship_acoustic', name: 'Worship Acoustic',
    desc: 'Kit acústico de iglesia · real samples', color: '#b45309',
    pads: [
      { id: 'wa_kick',   label: 'Kick',      type: 'kick',   sample: S+'kick-acoustic01.wav'   },
      { id: 'wa_snare',  label: 'Snare',     type: 'snare',  sample: S+'snare-acoustic01.wav'  },
      { id: 'wa_clap',   label: 'Clap',      type: 'clap',   sample: S+'clap-fat.wav'           },
      { id: 'wa_hhc',    label: 'HH Cerr',   type: 'hihatC', sample: S+'hihat-acoustic01.wav'  },
      { id: 'wa_hho',    label: 'HH Abie',   type: 'hihatO', sample: S+'openhat-acoustic01.wav'},
      { id: 'wa_tom1',   label: 'Tom 1',     type: 'tomH',   sample: S+'tom-acoustic01.wav'    },
      { id: 'wa_crash',  label: 'Crash',     type: 'crash',  sample: S+'crash-acoustic.wav'    },
      { id: 'wa_ride',   label: 'Ride',      type: 'ride',   sample: S+'ride-acoustic01.wav'   },
    ]
  },
  {
    id: 'worship_modern', name: 'Worship Modern',
    desc: 'Producción contemporánea · sub + clap seca', color: '#7c3aed',
    pads: [
      { id: 'wm_kick',   label: 'Kick 808',  type: 'kick',   sample: S+'kick-808.wav'          },
      { id: 'wm_kick2',  label: 'Kick Big',  type: 'subkick',sample: S+'kick-big.wav'          },
      { id: 'wm_snare',  label: 'Snare',     type: 'snare',  sample: S+'snare-big.wav'         },
      { id: 'wm_clap',   label: 'Clap',      type: 'clap',   sample: S+'clap-808.wav'          },
      { id: 'wm_hhc',    label: 'HH Cerr',   type: 'hihatC', sample: S+'hihat-808.wav'         },
      { id: 'wm_hho',    label: 'HH Abie',   type: 'hihatO', sample: S+'openhat-808.wav'       },
      { id: 'wm_crash',  label: 'Crash',     type: 'crash',  sample: S+'crash-808.wav'         },
      { id: 'wm_perc',   label: 'Perc',      type: 'tomH',   sample: S+'perc-hollow.wav'       },
    ]
  },
  {
    id: 'gospel_live', name: 'Gospel Live',
    desc: 'Feel de iglesia viva · groove gospel', color: '#dc2626',
    pads: [
      { id: 'gl_kick',   label: 'Kick',      type: 'kick',   sample: S+'kick-deep.wav'         },
      { id: 'gl_snare',  label: 'Snare',     type: 'snare',  sample: S+'snare-brute.wav'       },
      { id: 'gl_clap',   label: 'Clap',      type: 'clap',   sample: S+'clap-slapper.wav'      },
      { id: 'gl_shaker', label: 'Shaker',    type: 'shaker', sample: S+'shaker-shuffle.wav'    },
      { id: 'gl_tamb',   label: 'Tamb.',     type: 'tamb',   sample: S+'perc-tambo.wav'        },
      { id: 'gl_tom1',   label: 'Tom',       type: 'tomH',   sample: S+'tom-acoustic02.wav'    },
      { id: 'gl_crash',  label: 'Crash',     type: 'crash',  sample: S+'crash-tape.wav'        },
      { id: 'gl_ride',   label: 'Ride',      type: 'ride',   sample: S+'ride-acoustic02.wav'   },
    ]
  },
  {
    id: 'electronic', name: 'Electronic Kit',
    desc: 'Batería electrónica · 808 style', color: '#0891b2',
    pads: [
      { id: 'e_kick',   label: 'Kick',    type: 'kick',   sample: S+'kick-electro01.wav'  },
      { id: 'e_snare',  label: 'Snare',   type: 'snare',  sample: S+'snare-808.wav'       },
      { id: 'e_clap',   label: 'Clap',    type: 'clap',   sample: S+'clap-analog.wav'     },
      { id: 'e_hh_c',   label: 'HH Cerr', type: 'hihatC', sample: S+'hihat-electro.wav'  },
      { id: 'e_hh_o',   label: 'HH Abie', type: 'hihatO', sample: S+'openhat-tight.wav'  },
      { id: 'e_tom',    label: 'Tom',     type: 'tomH',   sample: S+'tom-808.wav'         },
      { id: 'e_crash',  label: 'Crash',   type: 'crash',  sample: S+'crash-noise.wav'     },
      { id: 'e_cowbell',label: 'Cowbell', type: 'cowbell',sample: S+'cowbell-808.wav'     },
    ]
  },
  {
    id: 'latin', name: 'Latin Percussion',
    desc: 'Percusión latina · real samples', color: '#b45309',
    pads: [
      { id: 'l_conga_h', label: 'Conga H',  type: 'congaH', sample: S+'tom-rototom.wav'   },
      { id: 'l_conga_l', label: 'Conga L',  type: 'congaL', sample: S+'tom-lofi.wav'      },
      { id: 'l_shaker',  label: 'Shaker',   type: 'shaker', sample: S+'shaker-analog.wav' },
      { id: 'l_cowbell', label: 'Cowbell',  type: 'cowbell',sample: S+'cowbell-808.wav'   },
      { id: 'l_tamb',    label: 'Tamb.',    type: 'tamb',   sample: S+'perc-tambo.wav'    },
      { id: 'l_perc1',   label: 'Perc 1',  type: 'tomH',   sample: S+'perc-tribal.wav'   },
      { id: 'l_perc2',   label: 'Perc 2',  type: 'tomM',   sample: S+'perc-hollow.wav'   },
      { id: 'l_crash',   label: 'Crash',   type: 'crash',  sample: S+'crash-tape.wav'    },
    ]
  },
  {
    id: 'minimal', name: 'Minimal Kit',
    desc: 'Kit minimalista · clean', color: '#374151',
    pads: [
      { id: 'm_kick',  label: 'Kick',    type: 'kick',   sample: S+'kick-tight.wav'      },
      { id: 'm_snare', label: 'Snare',   type: 'snare',  sample: S+'snare-tight.wav'     },
      { id: 'm_hhc',   label: 'Hi-Hat',  type: 'hihatC', sample: S+'hihat-plain.wav'     },
      { id: 'm_clap',  label: 'Clap',    type: 'clap',   sample: S+'clap-crushed.wav'    },
      { id: 'm_perc1', label: 'Perc 1',  type: 'tomH',   sample: S+'perc-short.wav'      },
      { id: 'm_perc2', label: 'Perc 2',  type: 'tomM',   sample: S+'perc-metal.wav'      },
      { id: 'm_crash', label: 'Crash',   type: 'crash',  sample: S+'crash-808.wav'       },
      { id: 'm_ride',  label: 'Ride',    type: 'ride',   sample: S+'ride-acoustic01.wav' },
    ]
  },
  {
    id: 'retro_juno', name: 'Retro Juno (Pack II)',
    desc: 'Sonido vintage · Juno Series', color: '#059669',
    pads: [
      { id: 'rj_kick',   label: 'Kick Juno',  type: 'kick',   sample: 'assets/Drums Pad/99 Drum Samples II/Kick - Juno.wav' },
      { id: 'rj_snare',  label: 'Snare Retro',type: 'snare',  sample: 'assets/Drums Pad/99 Drum Samples II/Snare - Retro.wav' },
      { id: 'rj_clap',   label: 'Clap Cass.', type: 'clap',   sample: 'assets/Drums Pad/99 Drum Samples II/Snare - Cassette.wav' },
      { id: 'rj_perc1',  label: 'Analog 1',   type: 'tomH',   sample: 'assets/Drums Pad/99 Drum Samples II/Perc - Analog 1.wav' },
      { id: 'rj_perc2',  label: 'Analog 2',   type: 'tomM',   sample: 'assets/Drums Pad/99 Drum Samples II/Perc - Analog 2.wav' },
      { id: 'rj_tom',    label: 'Tomtom',     type: 'tomL',   sample: 'assets/Drums Pad/99 Drum Samples II/Perc - Tomtom.wav' },
      { id: 'rj_snare2', label: 'Trapped',    type: 'snare',  sample: 'assets/Drums Pad/99 Drum Samples II/Snare - Trapped.wav' },
      { id: 'rj_perc3',  label: 'Old Comp',   type: 'tomH',   sample: 'assets/Drums Pad/99 Drum Samples II/Perc - Old Computer.wav' },
    ]
  },
];

export { THEMES };
