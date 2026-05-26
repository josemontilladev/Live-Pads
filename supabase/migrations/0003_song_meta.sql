-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 3b — Campo `meta` para extras de la app en las canciones
-- (favorito, audio local, mostrar acordes, addedAt…). Re-ejecutable.
-- Pegar TODO en Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════

alter table public.songs    add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.setlists add column if not exists meta jsonb not null default '{}'::jsonb;
