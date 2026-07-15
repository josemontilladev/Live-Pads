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

// DEMO WEB: nube DESHABILITADA a propósito (anon key vacía) → corre en modo
// local sin login (initAuthGate retorna directo). En la app real lleva la key.
export const SUPABASE_ANON_KEY = '';

// true cuando la anon key está puesta; si está vacía, la app simplemente no
// ofrece la nube (modo local de siempre) en vez de romperse.
export const CLOUD_ENABLED = SUPABASE_ANON_KEY.length > 20;

// Correos con permisos de administrador: ven la sincronización con GI.Setlist
// (MongoDB), porque esa base es compartida y solo el responsable del
// repertorio debe poder modificarla. El resto de usuarios usa únicamente sus
// librerías de la nube (creadas por ellos o donde fueron invitados).
export const ADMIN_EMAILS = ['montillajose221@gmail.com'];

export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(String(email).toLowerCase());
}
