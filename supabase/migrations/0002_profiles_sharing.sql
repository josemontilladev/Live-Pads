-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 3 — Ver perfiles de co-miembros + relación para PostgREST
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

-- 1) Poder ver el correo/nombre de las personas con las que compartes una
--    librería (para listar el equipo). SECURITY DEFINER evita recursión RLS.
create or replace function public.shares_any_library(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them on them.library_id = me.library_id
    where me.user_id = auth.uid() and them.user_id = other
  );
$$;

drop policy if exists "profiles co-member read" on public.profiles;
create policy "profiles co-member read" on public.profiles for select
  using (auth.uid() = id or public.shares_any_library(id));

-- 2) FK extra de memberships.user_id → profiles.id para que PostgREST pueda
--    "embeber" el perfil al consultar miembros (memberships?select=...,profiles(email)).
--    Es válida: todo user_id tiene su profile (lo crea el trigger handle_new_user).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'memberships_user_profile_fk'
  ) then
    alter table public.memberships
      add constraint memberships_user_profile_fk
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;
