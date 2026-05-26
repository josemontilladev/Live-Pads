-- ════════════════════════════════════════════════════════════════════
-- LivePads · Centralización GI.Setlist — columnas extra en songs
-- GI.Setlist (otra app) usa estos campos; LivePads simplemente los ignora.
-- Una sola tabla `songs` como fuente única. Re-ejecutable.
-- Pegar TODO en Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════

alter table public.songs add column if not exists youtube_url   text;
alter table public.songs add column if not exists notes         text;
alter table public.songs add column if not exists original_key  text;
alter table public.songs add column if not exists vocalist_key  text;
alter table public.songs add column if not exists duration      text;
