// ─────────────────────────────────────────────────────────────────────────
// Configuración de Supabase (lado cliente).
//
// La anon/public key es SEGURA de incluir en la app: es pública por diseño y
// solo permite lo que las políticas RLS de la base de datos autoricen. NO es
// la service_role key (esa jamás va en el cliente).
//
// 👉 Pega aquí la `anon` `public` key de tu proyecto:
//    Supabase → Project Settings → API → Project API keys → "anon public".
// ─────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL = 'https://hmrviyzisgoovyttnsth.supabase.co';

// Pega la anon key entre las comillas (empieza por "eyJ...").
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtcnZpeXppc2dvb3Z5dHRuc3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDUzMzYsImV4cCI6MjA5NTM4MTMzNn0.GzUFdrLjl6VnYngmMrKCkLpPSrvqrY0m_wDAjKEfsxk';

// DESKTOP CLOUD (movil.livepads.online): el motor de nube PROPIO del renderer
// (songSync / setlistSync / libraryLive) SÍ se usa — es el mismo que sincroniza
// LivePads de escritorio. Funciona en el navegador porque _cloud-shim.js le da
// un electronAPI con sesión en localStorage y OAuth web. Así, crear o editar
// canciones y servicios desde aquí se sincroniza con la PC y el móvil.
export const CLOUD_ENABLED = SUPABASE_ANON_KEY.length > 20;

// Correos con permisos de administrador: ven la sincronización con GI.Setlist
// (MongoDB), porque esa base es compartida y solo el responsable del
// repertorio debe poder modificarla. El resto de usuarios usa únicamente sus
// librerías de la nube (creadas por ellos o donde fueron invitados).
export const ADMIN_EMAILS = ['montillajose221@gmail.com'];

export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(String(email).toLowerCase());
}
