-- ════════════════════════════════════════════════════════════════════
-- LivePads · Biblioteca de stems — reportar loops de la comunidad
--
--   Cualquier cuenta puede reportar un loop publicado (derechos de autor,
--   calidad, contenido inapropiado u otro), una vez por loop. Nadie lee los
--   reportes salvo el administrador, con stem_library_reports(); al revisarlos
--   los descarta (stem_library_dismiss_reports) o borra el loop.
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.stem_loop_reports (
  id         bigserial primary key,
  loop_id    uuid not null references public.stem_loops(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason     text not null check (reason in ('copyright', 'quality', 'inappropriate', 'other')),
  note       text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (loop_id, user_id)
);
create index if not exists stem_loop_reports_loop_idx on public.stem_loop_reports(loop_id);

alter table public.stem_loop_reports enable row level security;

-- Reportar: solo con sesión, a nombre propio y sobre algo que se puede ver.
drop policy if exists "loop reports insert own" on public.stem_loop_reports;
create policy "loop reports insert own" on public.stem_loop_reports for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.stem_loops l join public.stem_packs p on p.id = l.pack_id
       where l.id = loop_id and p.published
    )
  );

-- Administrador: loops reportados, con cuántos reportes y por qué.
create or replace function public.stem_library_reports()
returns table (loop_id uuid, title text, pack_id uuid, pack_title text, pack_status text,
               reports bigint, reasons text[], notes text[], last_at timestamptz)
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
    select l.id, l.title, p.id, p.title, p.status,
           count(*),
           array_agg(distinct r.reason),
           array_remove(array_agg(r.note order by r.created_at desc), null),
           max(r.created_at)
      from public.stem_loop_reports r
      join public.stem_loops l on l.id = r.loop_id
      join public.stem_packs p on p.id = l.pack_id
     group by l.id, l.title, p.id, p.title, p.status
     order by count(*) desc, max(r.created_at) desc;
end;
$$;
revoke all on function public.stem_library_reports() from public, anon;
grant execute on function public.stem_library_reports() to authenticated;

-- Administrador: el loop está bien → se descartan sus reportes.
create or replace function public.stem_library_dismiss_reports(p_loop_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.stem_library_is_admin() then
    raise exception 'Solo el administrador de la biblioteca' using errcode = '42501';
  end if;
  delete from public.stem_loop_reports where loop_id = p_loop_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.stem_library_dismiss_reports(uuid) from public, anon;
grant execute on function public.stem_library_dismiss_reports(uuid) to authenticated;

comment on table public.stem_loop_reports is
  'Reportes de loops de la biblioteca (derechos, calidad, contenido). Solo inserción propia; los lee el administrador por RPC.';
