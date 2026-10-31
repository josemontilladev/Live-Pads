-- ════════════════════════════════════════════════════════════════════
-- LivePads · Biblioteca de stems (Fase 1: loops y packs para el editor)
--
--   Catálogo OFICIAL de LivePads: packs de loops (batería, bajo, pads,
--   guitarras, FX…) listos para arrastrar al editor de stems, que se ajustan
--   solos al BPM y al tono del proyecto.
--
--   A diferencia de `library_files` (archivos de la librería de cada iglesia),
--   este catálogo es el MISMO para todos y solo lo escribe LivePads (el panel
--   de administración con service_role). Los usuarios solo leen lo publicado.
--
--   Los BYTES viven en el mismo bucket privado de R2, bajo `catalog/`:
--       catalog/<pack-slug>/<archivo>.m4a       ← audio completo
--       catalog/<pack-slug>/preview/<archivo>.mp3  ← escucha previa (gratis)
--       catalog/<pack-slug>/cover.jpg
--   Las columnas *_path guardan la ruta SIN el prefijo `catalog/`. La Edge
--   Function `stem-library-sign` firma la descarga y aplica el plan.
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.stem_packs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title       text not null,
  description text,
  cover_path  text,
  genre       text,                      -- 'worship', 'pop', 'gospel', 'ambient'…
  mood        text,                      -- 'íntimo', 'celebración', 'épico'…
  -- 'free' = cualquiera con cuenta lo descarga; 'pro' = requiere LivePads Pro.
  -- La escucha previa siempre es libre (para que se pueda explorar).
  tier        text not null default 'pro' check (tier in ('free', 'pro')),
  published   boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.stem_loops (
  id            uuid primary key default gen_random_uuid(),
  pack_id       uuid not null references public.stem_packs(id) on delete cascade,
  title         text not null,
  -- Mismos roles que usa el editor (stemRole.js) + los propios de loops.
  instrument    text not null check (instrument in (
                  'drums', 'perc', 'bass', 'keys', 'pad', 'synth', 'guitar',
                  'strings', 'vocals', 'fx', 'other')),
  section       text not null default 'any' check (section in (
                  'any', 'intro', 'verse', 'prechorus', 'chorus', 'bridge',
                  'build', 'outro')),
  bpm           numeric(6, 2) not null check (bpm between 20 and 300),
  -- Tono en cifrado americano ("G", "F#m", "Bb"). NULL = sin tono (batería,
  -- percusión, FX): el editor lo ajusta solo de tempo, nunca de afinación.
  musical_key   text,
  beats_per_bar smallint not null default 4 check (beats_per_bar between 1 and 16),
  beat_value    smallint not null default 4 check (beat_value in (2, 4, 8, 16)),
  bars          smallint not null check (bars between 1 and 64),
  audio_path    text not null,
  preview_path  text,
  size          bigint,
  duration_sec  numeric(8, 3),
  tags          text[] not null default '{}',
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists stem_loops_pack_idx       on public.stem_loops(pack_id, sort);
create index if not exists stem_loops_instrument_idx on public.stem_loops(instrument);
create index if not exists stem_loops_bpm_idx        on public.stem_loops(bpm);
create index if not exists stem_loops_tags_idx       on public.stem_loops using gin(tags);
create index if not exists stem_packs_published_idx  on public.stem_packs(published, sort);

alter table public.stem_packs enable row level security;
alter table public.stem_loops enable row level security;

-- Leer: cualquier usuario con sesión ve lo PUBLICADO. Sin políticas de
-- escritura → solo service_role (panel de administración) crea o edita.
drop policy if exists "stem packs read" on public.stem_packs;
create policy "stem packs read" on public.stem_packs for select
  to authenticated
  using (published);

drop policy if exists "stem loops read" on public.stem_loops;
create policy "stem loops read" on public.stem_loops for select
  to authenticated
  using (exists (select 1 from public.stem_packs p where p.id = pack_id and p.published));

comment on table public.stem_packs is
  'Biblioteca de stems de LivePads: packs de loops oficiales. Escribe solo el panel de administración.';
comment on table public.stem_loops is
  'Loops de la biblioteca de stems, con BPM/tono/compases para que el editor los ajuste al proyecto.';
