-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 4 — Atribución de cambios + invitación por enlace/código
--   · songs.updated_by  → quién hizo el último cambio (para el aviso
--     "Fulano actualizó N canciones" en la bajada automática)
--   · FK updated_by → profiles(id) para que PostgREST pueda embeber el
--     perfil del editor (songs?select=*,editor:updated_by(display_name,email))
--   · invites.email pasa a NULLABLE → permite crear un código/enlace para
--     compartir sin escribir un correo concreto.
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

-- 1) Columna con el autor del último cambio de cada canción.
alter table public.songs
  add column if not exists updated_by uuid;

-- 2) FK updated_by → profiles(id). Es válida: todo user_id tiene su profile
--    (lo crea el trigger handle_new_user). ON DELETE SET NULL para no perder la
--    canción si el autor borra su cuenta. Necesaria para el embed de PostgREST.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'songs_updated_by_profile_fk'
  ) then
    alter table public.songs
      add constraint songs_updated_by_profile_fk
      foreign key (updated_by) references public.profiles(id) on delete set null;
  end if;
end $$;

-- 3) Invitaciones "por enlace": el correo deja de ser obligatorio. El token ya
--    existente (columna `token`) es el código para compartir por WhatsApp/chat.
alter table public.invites
  alter column email drop not null;
