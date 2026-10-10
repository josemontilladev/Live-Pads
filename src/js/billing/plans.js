// ─────────────────────────────────────────────────────────────────────────
// Planes de LivePads: qué incluye cada uno y cuánto cuesta.
// Los límites se aplican en la app (ver license.js → hasFeature/limitOf); el
// plan de cada persona lo decide el servidor y llega firmado.
// ─────────────────────────────────────────────────────────────────────────

export const LIMITS = {
  free:   { songs: 10,       padBanks: false, stems: false, chords: false, cloud: false },
  pro:    { songs: Infinity, padBanks: true,  stems: true,  chords: true,  cloud: true },
  church: { songs: Infinity, padBanks: true,  stems: true,  chords: true,  cloud: true },
};

// Precios en USD. Fundadores: 50 % para siempre.
export const PRICES = {
  pro:    { month: 6.99,  year: 49.99,  founderMonth: 3.49, founderYear: 24.99 },
  church: { month: 17.99, year: 149.99, founderMonth: 8.99, founderYear: 74.99 },
};

// Banco de pads incluido en Gratis (Chris Rocha los liberó gratis).
export const FREE_PAD_BANK = 'chris_rocha';

export const PLAN_NAMES = { free: 'Gratis', pro: 'Pro', church: 'Iglesia' };

// Texto para explicar por qué algo está bloqueado.
export const FEATURE_TEXT = {
  songs: 'El plan Gratis permite hasta 10 canciones.',
  padBanks: 'El plan Gratis incluye el pad de Chris Rocha. Los demás bancos son parte de Pro.',
  stems: 'Stems (multipistas) es parte de Pro.',
  chords: 'El detector de acordes es parte de Pro.',
  cloud: 'Sincronizar con tu equipo en la nube es parte de Pro.',
};
