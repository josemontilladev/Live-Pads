-- ════════════════════════════════════════════════════════════════════
-- LivePads · Biblioteca de stems — comunidad, edición y uso ampliado
--
--   1. Un loop se identifica por (pack, archivo de audio): volver a subir el
--      mismo archivo ACTUALIZA el loop (conserva su id, su marca GRATIS/PRO y
--      sus métricas) en vez de duplicarlo.
--   2. Packs de la comunidad: cualquier cuenta Pro puede enviar un pack; queda
--      'pending' hasta que el administrador lo aprueba (y se publica) o lo
--      rechaza con una nota. Quien lo envía ve sus envíos; el administrador ve
--      todo (también borradores), para escuchar antes de publicar.
--   3. stem_library_overview(): uso de TODOS los loops, también los que nadie
--      ha usado (para la pestaña Uso del administrador).
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

-- 1) Un archivo = un loop por pack
create unique index if not exists stem_loops_pack_audio_uidx on public.stem_loops(pack_id, audio_path);

-- 2) Comunidad
alter table public.stem_packs add column if not exists status text not null default 'official';
do $$ begin
  alter table public.stem_packs add constraint stem_packs_status_check
    check (status in ('official', 'pending', 'approved', 'rejected'));
exception when duplicate_object then null;
end $$;
alter table public.stem_packs add column if not exists submitted_by uuid references auth.users(id) on delete set null;
alter table public.stem_packs add column if not exists author_name text;
alter table public.stem_packs add column if not exists review_note text;
alter table public.stem_packs add column if not exists rights_confirmed_at timestamptz;
alter table public.stem_packs add column if not exists submitted_at timestamptz;
create index if not exists stem_packs_status_idx on public.stem_packs(status, submitted_at desc);
create index if not exists stem_packs_submitter_idx on public.stem_packs(submitted_by);

-- Lectura: lo publicado para todos; además, quien lo envió ve sus envíos y el
-- administrador ve todo. (stem-library-sign lee con el JWT de quien llama, así
-- que estas mismas reglas deciden qué se puede escuchar/bajar.)
drop policy if exists "stem packs read" on public.stem_packs;
create policy "stem packs read" on public.stem_packs for select
  to authenticated
  using (published or submitted_by = auth.uid() or public.stem_library_is_admin());

drop policy if exists "stem loops read" on public.stem_loops;
create policy "stem loops read" on public.stem_loops for select
  to authenticated
  using (exists (
    select 1 from public.stem_packs p
     where p.id = pack_id
       and (p.published or p.submitted_by = auth.uid() or public.stem_library_is_admin())
  ));

comment on column public.stem_packs.status is
  'official = lo sube el administrador; pending/approved/rejected = pack enviado por la comunidad y su moderación.';

-- 3) Uso de todos los loops (incluidos los que nadie ha usado)
create or replace function public.stem_library_overview(p_days int default 30)
returns table (loop_id uuid, title text, pack_id uuid, pack_title text, instrument text, tier text,
               published boolean, adds bigint, previews bigint, users bigint)
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
    select l.id, l.title, p.id, p.title, l.instrument, l.tier, p.published,
           count(e.id) filter (where e.event = 'add'),
           count(e.id) filter (where e.event = 'preview'),
           count(distinct e.user_id)
      from public.stem_loops l
      join public.stem_packs p on p.id = l.pack_id
      left join public.stem_loop_events e
             on e.loop_id = l.id
            and e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
     where p.status in ('official', 'approved')
     group by l.id, l.title, p.id, p.title, l.instrument, l.tier, p.published
     order by 8 desc, 9 desc, p.title, l.title
     limit 2000;
end;
$$;
revoke all on function public.stem_library_overview(int) from public, anon;
grant execute on function public.stem_library_overview(int) to authenticated;
