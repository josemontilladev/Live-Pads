-- ─────────────────────────────────────────────────────────────────────────
-- 0012 — "Qué suena ahora" por librería
--
-- La cabina (LivePads escritorio) publica la canción actual y la siguiente
-- del servicio cada vez que cambia. La PWA móvil (y cualquier web del equipo)
-- lo lee para que la banda vea en qué va el director aunque no esté en la
-- misma WiFi (el Companion sigue siendo la vía LAN sin internet).
--
-- Una sola fila por librería (upsert por library_id). No es historial: es el
-- estado presente, y se pisa en cada cambio.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.now_playing (
  library_id  uuid primary key references public.libraries(id) on delete cascade,
  song_id     uuid,                       -- songs.id de la canción actual (null = nada preparado)
  title       text,
  artist      text,
  key         text,                       -- tono efectivo de hoy (puede diferir del de la librería)
  next_song_id uuid,
  next_title  text,
  next_key    text,
  position    int,                        -- 1-based dentro del servicio
  total       int,
  is_live     boolean not null default false,  -- true = hay audio sonando en la cabina
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
alter table public.now_playing enable row level security;

-- Leer: cualquier miembro de la librería.
drop policy if exists "np read" on public.now_playing;
create policy "np read" on public.now_playing for select
  using (public.is_member(library_id));

-- Escribir: editores/dueños (la cabina), firmando quién publica.
drop policy if exists "np insert" on public.now_playing;
create policy "np insert" on public.now_playing for insert
  with check (public.is_editor(library_id) and updated_by = auth.uid());

drop policy if exists "np update" on public.now_playing;
create policy "np update" on public.now_playing for update
  using (public.is_editor(library_id))
  with check (public.is_editor(library_id) and updated_by = auth.uid());

drop policy if exists "np delete" on public.now_playing;
create policy "np delete" on public.now_playing for delete
  using (public.is_editor(library_id));

-- Realtime opcional: los clientes que prefieran suscribirse en vez de sondear.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.now_playing;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

comment on table public.now_playing is
  'Estado presente del servicio por librería: canción actual y siguiente publicadas por la cabina.';
