-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 3c — Configuración personal por usuario (sigue a la cuenta)
-- MIDI + kits de batería + servicios + preferencias, en un solo blob jsonb.
-- Offline-first: el cliente trabaja en local y espeja esto cuando hay internet.
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;

-- Cada quien solo ve/edita SU configuración.
drop policy if exists "settings self" on public.user_settings;
create policy "settings self" on public.user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at automático (clave para decidir quién gana al sincronizar).
drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
