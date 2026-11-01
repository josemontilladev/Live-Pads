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

// Inicio de sesión con Google SIN pasar por la página de Supabase: cliente
// OAuth de tipo "App de escritorio" (Google Cloud → Clientes). Así la pantalla
// de Google no muestra <proyecto>.supabase.co y la marca se puede verificar.
// El ID también debe estar en Supabase → Auth → Providers → Google → Client IDs.
// El secreto NO va en el repositorio: lo genera scripts/write-google-secret.mjs
// en src/js/cloud/googleSecret.js (ignorado por git) desde la variable
// GOOGLE_DESKTOP_CLIENT_SECRET o el archivo local scripts/.env.google. En el
// instalador sí viaja (en apps de escritorio no es confidencial: la seguridad
// la da PKCE). Sin ese archivo, se usa el flujo anterior a través de Supabase.
export const GOOGLE_DESKTOP_CLIENT_ID = '124670106941-81n4fr13q26o3pt5b57poca3k39k140o.apps.googleusercontent.com';

// Suscripciones (Gratis / Pro / Iglesia). Mientras sea false la app se
// comporta como siempre (todo desbloqueado). Se enciende cuando el servidor
// de cobros (funciones `billing` y `paypal-webhook`) esté desplegado.
export const BILLING_ENABLED = true;
