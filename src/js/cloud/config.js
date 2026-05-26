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
