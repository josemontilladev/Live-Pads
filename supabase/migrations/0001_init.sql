-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 1 — Cuentas + librerías compartidas por invitación (RLS)
-- Pegar TODO esto en Supabase → SQL Editor → Run. Es re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 0) keepalive: tabla mínima que el workflow de GitHub pinguea a diario
--    para que el proyecto del free tier no se pause ────────────────────
create table if not exists public.keepalive (
  id  int primary key default 1,
  ts  timestamptz default now()
);
insert into public.keepalive (id) values (1) on conflict (id) do nothing;
alter table public.keepalive enable row level security;
drop policy if exists "keepalive read" on public.keepalive;
create policy "keepalive read" on public.keepalive for select using (true);

-- ── 1) profiles: datos extra del usuario (id = auth.users.id) ──────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles self read"   on public.profiles;
create policy "profiles self read"   on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- crea el profile automáticamente al registrarse un usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2) libraries: las "carpetas" / repertorios ─────────────────────────
create table if not exists public.libraries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.libraries enable row level security;

-- ── 3) memberships: quién pertenece a qué library y con qué rol ────────
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('owner','editor','viewer')),
  created_at timestamptz default now(),
  unique (library_id, user_id)
);
alter table public.memberships enable row level security;

-- helpers SECURITY DEFINER (evitan recursión infinita en las políticas RLS)
create or replace function public.is_member(lib uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.memberships m where m.library_id = lib and m.user_id = auth.uid());
$$;
create or replace function public.is_editor(lib uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.library_id = lib and m.user_id = auth.uid() and m.role in ('owner','editor'));
$$;

-- al crear una library, su dueño queda como owner automáticamente
create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (library_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (library_id, user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_library_created on public.libraries;
create trigger on_library_created after insert on public.libraries
  for each row execute function public.add_owner_membership();

-- libraries: ves las tuyas o donde eres miembro; solo el dueño edita/borra
drop policy if exists "lib read"   on public.libraries;
create policy "lib read"   on public.libraries for select using (owner_id = auth.uid() or public.is_member(id));
drop policy if exists "lib insert" on public.libraries;
create policy "lib insert" on public.libraries for insert with check (owner_id = auth.uid());
drop policy if exists "lib update" on public.libraries;
create policy "lib update" on public.libraries for update using (owner_id = auth.uid());
drop policy if exists "lib delete" on public.libraries;
create policy "lib delete" on public.libraries for delete using (owner_id = auth.uid());

-- memberships: ves tus membresías (o todas si eres dueño de la library);
-- gestionarlas (añadir/quitar miembros) solo el dueño
drop policy if exists "mem read"   on public.memberships;
create policy "mem read" on public.memberships for select
  using (user_id = auth.uid()
         or exists (select 1 from public.libraries l where l.id = library_id and l.owner_id = auth.uid()));
drop policy if exists "mem manage" on public.memberships;
create policy "mem manage" on public.memberships for all
  using      (exists (select 1 from public.libraries l where l.id = library_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.libraries l where l.id = library_id and l.owner_id = auth.uid()));

-- ── 4) invites: invitar por correo a una library ──────────────────────
create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  email      text not null,
  role       text not null default 'viewer' check (role in ('editor','viewer')),
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  status     text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references auth.users(id),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '14 days')
);
alter table public.invites enable row level security;
drop policy if exists "inv manage" on public.invites;
create policy "inv manage" on public.invites for all
  using      (exists (select 1 from public.libraries l where l.id = library_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.libraries l where l.id = library_id and l.owner_id = auth.uid()));

-- aceptar invitación (valida token + crea la membresía, saltándose RLS de
-- forma controlada). Lo llama el invitado ya logueado.
create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites
    where token = invite_token and status = 'pending' and expires_at > now();
  if inv.id is null then raise exception 'Invitación inválida o expirada'; end if;
  insert into public.memberships (library_id, user_id, role)
    values (inv.library_id, auth.uid(), inv.role)
    on conflict (library_id, user_id) do nothing;
  update public.invites set status = 'accepted' where id = inv.id;
  return inv.library_id;
end; $$;

-- ── 5) songs: las canciones, pertenecen a una library ─────────────────
create table if not exists public.songs (
  id         uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  title      text not null,
  artist     text,
  lyrics     text,
  bpm        text,
  key        text,
  genre      text,
  tags       text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.songs enable row level security;
create index if not exists songs_library_idx on public.songs(library_id);
drop policy if exists "song read"  on public.songs;
create policy "song read"  on public.songs for select using (public.is_member(library_id));
drop policy if exists "song write" on public.songs;
create policy "song write" on public.songs for all
  using (public.is_editor(library_id)) with check (public.is_editor(library_id));

-- ── 6) setlists: orden de canciones para un servicio ──────────────────
create table if not exists public.setlists (
  id         uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  name       text not null,
  song_ids   uuid[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.setlists enable row level security;
create index if not exists setlists_library_idx on public.setlists(library_id);
drop policy if exists "setlist read"  on public.setlists;
create policy "setlist read"  on public.setlists for select using (public.is_member(library_id));
drop policy if exists "setlist write" on public.setlists;
create policy "setlist write" on public.setlists for all
  using (public.is_editor(library_id)) with check (public.is_editor(library_id));

-- ── 7) updated_at automático (clave para futura resolución de conflictos)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists songs_touch on public.songs;
create trigger songs_touch    before update on public.songs    for each row execute function public.touch_updated_at();
drop trigger if exists setlists_touch on public.setlists;
create trigger setlists_touch before update on public.setlists for each row execute function public.touch_updated_at();
