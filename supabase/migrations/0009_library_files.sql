-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 6 — Biblioteca de ARCHIVOS en la nube (audio + carátulas)
--
--   Los BYTES viven en Cloudflare R2 (bucket privado). Esta tabla es el
--   MANIFIESTO: qué archivos existen en la nube para cada librería, para que
--   una PC nueva sepa qué bajar sin tener que interrogar a R2 archivo por
--   archivo.
--
--   `path` es la ruta RELATIVA dentro de la biblioteca de audio, la misma que
--   ya usan las canciones en `livepads://app/<path>`:
--       'Sequences/Mi_proyecto__61472ca8c82a.mp3'
--       'Original Tracks/Holy_Forever__d7d3f9064391.m4a'
--       'Covers/yt_5wAfWuKWKJw__6c8771cc269f.jpg'
--   Como el nombre ya lleva el hash del contenido, la clave es content-addressed
--   y la deduplicación entre PCs sale gratis.
--
--   La clave en R2 es:  lib/<library_id>/<path>
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.library_files (
  library_id   uuid not null references public.libraries(id) on delete cascade,
  path         text not null,
  size         bigint,
  content_type text,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz default now(),
  primary key (library_id, path)
);
alter table public.library_files enable row level security;
create index if not exists library_files_idx on public.library_files(library_id, updated_at desc);

-- Leer: cualquier MIEMBRO de la librería ve el manifiesto (para poder bajar).
drop policy if exists "files read" on public.library_files;
create policy "files read" on public.library_files for select
  using (public.is_member(library_id));

-- Escribir: solo EDITORES/dueños registran archivos subidos.
drop policy if exists "files upsert" on public.library_files;
create policy "files upsert" on public.library_files for insert
  with check (public.is_editor(library_id));

drop policy if exists "files update" on public.library_files;
create policy "files update" on public.library_files for update
  using (public.is_editor(library_id))
  with check (public.is_editor(library_id));

drop policy if exists "files delete" on public.library_files;
create policy "files delete" on public.library_files for delete
  using (public.is_editor(library_id));
