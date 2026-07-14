-- ════════════════════════════════════════════════════════════════════
-- LivePads · Fase 7 — Buzón de invitaciones DENTRO de la app
--
--   Problema: la política "inv manage" (0001) solo deja ver las invitaciones
--   al DUEÑO de la librería. El invitado no puede consultarlas, así que hoy
--   hay que pasarle el código a mano por WhatsApp.
--
--   Solución: una función SECURITY DEFINER que devuelve las invitaciones
--   PENDIENTES dirigidas al email del usuario que llama, ya enriquecidas con el
--   nombre de la librería y de quien invita (datos que el invitado todavía NO
--   puede leer por RLS, porque aún no es miembro).
--
--   Con esto la app puede mostrar: «Fulano te invitó a "Repertorio GI" ·
--   [Aceptar]». Al aceptar se sigue usando accept_invite(token), que ya existe.
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.my_pending_invites()
returns table (
  id           uuid,
  token        text,
  role         text,
  library_id   uuid,
  library_name text,
  inviter      text,
  created_at   timestamptz,
  expires_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    i.id,
    i.token,
    i.role,
    i.library_id,
    l.name                                         as library_name,
    coalesce(p.display_name, p.email, 'Alguien')   as inviter,
    i.created_at,
    i.expires_at
  from public.invites i
  join public.libraries l on l.id = i.library_id
  left join public.profiles p on p.id = l.owner_id
  where i.status = 'pending'
    and i.expires_at > now()
    -- Solo las dirigidas a MI email. Las invitaciones por ENLACE tienen
    -- email NULL: esas no aparecen en el buzón (se aceptan con el código),
    -- justamente porque no van dirigidas a nadie en concreto.
    and i.email is not null
    and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    -- Y solo si aún no soy miembro de esa librería.
    and not exists (
      select 1 from public.memberships m
      where m.library_id = i.library_id and m.user_id = auth.uid()
    )
  order by i.created_at desc;
$$;

revoke all on function public.my_pending_invites() from public;
grant execute on function public.my_pending_invites() to authenticated;
