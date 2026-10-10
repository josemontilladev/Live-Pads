-- ─────────────────────────────────────────────────────────────────────────
-- 0015 · Pro de cortesía para el equipo de GI Setlist
--
-- Todos los miembros de las librerías del administrador (montillajose221@gmail.com)
-- reciben Pro sin fecha de fin (provider = 'comp'). Se puede volver a ejecutar
-- cuando entren miembros nuevos al repertorio.
--
-- Quitar la cortesía a alguien:
--   update public.lp_subscriptions set status = 'expired', current_period_end = now()
--    where provider = 'comp' and user_id = (select id from auth.users where email = 'correo@x.com');
-- ─────────────────────────────────────────────────────────────────────────

insert into public.lp_subscriptions (user_id, plan, status, provider, current_period_end, founder)
select distinct m.user_id, 'pro', 'active', 'comp', timestamptz '2099-12-31', true
  from public.memberships m
  join public.libraries l on l.id = m.library_id
  join auth.users a on a.id = l.owner_id
 where lower(a.email) = 'montillajose221@gmail.com'
   and exists (select 1 from public.profiles p where p.id = m.user_id)
on conflict (user_id) do update
  set plan = 'pro', status = 'active', provider = 'comp',
      current_period_end = timestamptz '2099-12-31', founder = true, updated_at = now()
  -- no pisar a quien ya paga por su cuenta
  where public.lp_subscriptions.provider is distinct from 'paypal'
     or public.lp_subscriptions.status not in ('active', 'past_due');

-- Comprobar quién quedó con cortesía:
select a.email, s.plan, s.status, s.current_period_end
  from public.lp_subscriptions s join auth.users a on a.id = s.user_id
 where s.provider = 'comp'
 order by a.email;
