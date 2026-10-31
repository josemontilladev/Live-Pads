-- ════════════════════════════════════════════════════════════════════
-- LivePads · Biblioteca de stems — métricas de uso
--
--   Cada vez que alguien AGREGA un loop al editor o lo ESCUCHA se anota un
--   evento. Sirve para saber qué loops funcionan y qué contenido producir.
--   Los usuarios solo pueden anotar los suyos (no leer nada); las
--   estadísticas las pide el administrador con stem_library_stats().
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.stem_loop_events (
  id         bigserial primary key,
  loop_id    uuid not null references public.stem_loops(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event      text not null check (event in ('add', 'preview')),
  created_at timestamptz not null default now()
);
create index if not exists stem_loop_events_loop_idx on public.stem_loop_events(loop_id, created_at desc);
create index if not exists stem_loop_events_time_idx on public.stem_loop_events(created_at desc);

alter table public.stem_loop_events enable row level security;

-- Anotar: solo con sesión y a nombre propio. Sin política de lectura.
drop policy if exists "loop events insert own" on public.stem_loop_events;
create policy "loop events insert own" on public.stem_loop_events for insert
  to authenticated
  with check (user_id = auth.uid());

-- Estadísticas para el administrador: los loops más usados en los últimos días.
create or replace function public.stem_library_stats(p_days int default 30)
returns table (loop_id uuid, title text, pack_title text, instrument text, adds bigint, previews bigint, users bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.stem_library_is_admin() then
    raise exception 'Solo el administrador de la biblioteca' using errcode = '42501';
  end if;
  return query
    select l.id, l.title, p.title, l.instrument,
           count(*) filter (where e.event = 'add'),
           count(*) filter (where e.event = 'preview'),
           count(distinct e.user_id)
      from public.stem_loop_events e
      join public.stem_loops l on l.id = e.loop_id
      join public.stem_packs p on p.id = l.pack_id
     where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
     group by l.id, l.title, p.title, l.instrument
     order by 5 desc, 6 desc
     limit 50;
end;
$$;
revoke all on function public.stem_library_stats(int) from public, anon;
grant execute on function public.stem_library_stats(int) to authenticated;

comment on table public.stem_loop_events is
  'Uso de la biblioteca de stems: add = agregado al editor, preview = escuchado. Solo inserción por el propio usuario.';
