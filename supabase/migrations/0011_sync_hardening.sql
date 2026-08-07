-- ─────────────────────────────────────────────────────────────────────────
-- 0011 — Endurecimiento de la sincronización compartida
--
-- Dos problemas de fondo que esta migración habilita resolver en el cliente:
--
--  1) BORRADOS QUE NO SE PROPAGAN. Hoy borrar una canción hace DELETE de la
--     fila; pero cualquier otro miembro que aún la tenga local la vuelve a
--     insertar con el MISMO uuid en su siguiente auto-push. Resultado: los
--     borrados "revivían". Se añade una tabla de LÁPIDAS (tombstones): el
--     borrado deja constancia, los demás clientes la ven y (a) borran la copia
--     local y (b) dejan de re-subirla.
--
--  2) TONO POR SERVICIO. Una canción tiene su tono "oficial" en la librería,
--     pero un domingo concreto puede tocarse en otro. `setlists.song_keys` es
--     un mapa { "<song uuid>": "G" } con los tonos que aplican SOLO en ese
--     servicio. Columna propia (no dentro de `meta`) para que las otras apps
--     que escriben `meta` no lo pisen sin querer.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) Lápidas de borrado ─────────────────────────────────────────────────
create table if not exists public.deletions (
  library_id uuid not null references public.libraries(id) on delete cascade,
  entity     text not null check (entity in ('song', 'setlist')),
  entity_id  uuid not null,
  title      text,                        -- solo para el historial legible
  deleted_by uuid references auth.users(id),
  deleted_at timestamptz not null default now(),
  primary key (library_id, entity, entity_id)
);
alter table public.deletions enable row level security;

-- Índice de la consulta del cliente: "¿qué se borró desde mi última bajada?"
create index if not exists deletions_since_idx
  on public.deletions(library_id, deleted_at desc);

-- Leer: cualquier miembro (necesita saber qué desapareció).
drop policy if exists "del read" on public.deletions;
create policy "del read" on public.deletions for select
  using (public.is_member(library_id));

-- Escribir: solo editores/dueños, y siempre firmando quién borró.
drop policy if exists "del insert" on public.deletions;
create policy "del insert" on public.deletions for insert
  with check (public.is_editor(library_id) and deleted_by = auth.uid());

-- Actualizar: re-borrar algo ya borrado refresca la marca de tiempo (upsert).
drop policy if exists "del update" on public.deletions;
create policy "del update" on public.deletions for update
  using (public.is_editor(library_id))
  with check (public.is_editor(library_id));

-- Borrar la lápida = "resucitar" a propósito (volver a crear la canción con el
-- mismo id). Editores pueden.
drop policy if exists "del delete" on public.deletions;
create policy "del delete" on public.deletions for delete
  using (public.is_editor(library_id));

-- Purga: una lápida de más de 180 días ya no aporta (ningún cliente vivo tiene
-- esa copia sin sincronizar). Se ejecuta a mano o por cron si se configura.
create or replace function public.purge_old_deletions()
returns void language sql security definer set search_path = public as $$
  delete from public.deletions where deleted_at < now() - interval '180 days';
$$;

-- ── 2) Tonos por servicio ─────────────────────────────────────────────────
-- Mapa { "<song uuid>": "G" }. Vacío = cada canción suena en el tono de la
-- librería. Las apps que no conocen esta columna simplemente la ignoran.
alter table public.setlists
  add column if not exists song_keys jsonb not null default '{}'::jsonb;

comment on column public.setlists.song_keys is
  'Tono por canción SOLO para este servicio: { "<song uuid>": "G" }. Sin entrada = tono de la librería.';
