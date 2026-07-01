-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 5 — Historial de actividad de la librería compartida
--   Registro append-only de qué pasó en el equipo: canción añadida/editada/
--   borrada y "se unió". Se muestra en Mi cuenta → Equipo → Actividad reciente.
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.library_activity (
  id         uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  type       text not null check (type in ('added','edited','deleted','joined')),
  song_title text,
  created_at timestamptz default now()
);
alter table public.library_activity enable row level security;
create index if not exists library_activity_idx on public.library_activity(library_id, created_at desc);

-- Leer: cualquier miembro de la librería ve su actividad.
drop policy if exists "activity read" on public.library_activity;
create policy "activity read" on public.library_activity for select
  using (public.is_member(library_id));

-- Insertar: un miembro registra su propia actividad (actor = él mismo). No hay
-- update/delete (append-only; se limpia en cascada al borrar la librería).
drop policy if exists "activity insert" on public.library_activity;
create policy "activity insert" on public.library_activity for insert
  with check (public.is_member(library_id) and actor_id = auth.uid());
