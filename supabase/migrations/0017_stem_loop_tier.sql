-- ════════════════════════════════════════════════════════════════════
-- LivePads · Biblioteca de stems — marca GRATIS / PRO por loop
--
--   Hasta ahora el plan se decidía por pack (stem_packs.tier). Ahora cada
--   loop lleva su propia marca y el administrador la cambia desde la app
--   (panel Biblioteca), así un mismo pack puede tener loops gratis de
--   muestra y el resto Pro. stem_packs.tier queda como valor por defecto
--   para los loops nuevos que suba el script.
--
--   Quién es administrador lo decide la tabla stem_library_admins (por
--   correo). La comprobación es en el servidor: la app solo muestra u
--   oculta el botón, pero quien no esté en la tabla recibe un error.
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

-- 1) Marca por loop, heredando la del pack para los que ya existen.
alter table public.stem_loops add column if not exists tier text;
update public.stem_loops l set tier = p.tier
  from public.stem_packs p
 where p.id = l.pack_id and l.tier is null;
alter table public.stem_loops alter column tier set default 'pro';
alter table public.stem_loops alter column tier set not null;
do $$ begin
  alter table public.stem_loops add constraint stem_loops_tier_check check (tier in ('free', 'pro'));
exception when duplicate_object then null;
end $$;
create index if not exists stem_loops_tier_idx on public.stem_loops(tier);

-- 2) Administradores de la biblioteca. Sin políticas: nadie la lee por la API.
create table if not exists public.stem_library_admins (
  email text primary key
);
alter table public.stem_library_admins enable row level security;
insert into public.stem_library_admins (email) values ('montillajose221@gmail.com')
on conflict (email) do nothing;

create or replace function public.stem_library_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.stem_library_admins a
      join auth.users u on lower(u.email) = lower(a.email)
     where u.id = auth.uid()
  );
$$;
-- Supabase da EXECUTE a anon por defecto en funciones nuevas: se quita.
revoke all on function public.stem_library_is_admin() from public, anon;
grant execute on function public.stem_library_is_admin() to authenticated;

-- 3) Cambiar la marca de un loop (solo administradores).
create or replace function public.stem_loop_set_tier(p_loop_id uuid, p_tier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.stem_library_is_admin() then
    raise exception 'Solo el administrador de la biblioteca puede cambiar esto' using errcode = '42501';
  end if;
  if p_tier not in ('free', 'pro') then
    raise exception 'Marca inválida: usa free o pro' using errcode = '22023';
  end if;
  update public.stem_loops set tier = p_tier where id = p_loop_id;
  if not found then
    raise exception 'Loop no encontrado' using errcode = 'P0002';
  end if;
  return p_tier;
end;
$$;
revoke all on function public.stem_loop_set_tier(uuid, text) from public, anon;
grant execute on function public.stem_loop_set_tier(uuid, text) to authenticated;

comment on column public.stem_loops.tier is
  'free = cualquiera con cuenta lo usa en el editor; pro = requiere LivePads Pro. Lo cambia el administrador desde la app.';
