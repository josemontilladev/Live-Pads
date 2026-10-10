-- ─────────────────────────────────────────────────────────────────────────
-- 0014 · Suscripciones de LivePads (Gratis / Pro / Iglesia)
--
-- · lp_subscriptions: una fila por persona. Solo la escribe el servidor (las
--   funciones `billing` y `paypal-webhook` con la clave de servicio); cada uno
--   puede LEER la suya.
-- · Prueba de 14 días de Pro para cada cuenta nueva (sin tarjeta), creada la
--   primera vez que la app pregunta por el plan.
-- · Plan Iglesia: lo paga el dueño de una librería y cubre a los miembros de
--   esa librería (hasta `seats`).
-- · Fundadores: todos los usuarios que ya existían reciben 3 meses de Pro y el
--   precio de fundador (50 %) para siempre.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.lp_subscriptions (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free', 'pro', 'church')),
  status             text not null default 'none' check (status in ('none', 'trial', 'pending', 'active', 'past_due', 'canceled', 'expired')),
  billing_interval   text check (billing_interval in ('month', 'year')),
  provider           text,                         -- 'paypal'
  provider_sub_id    text unique,                  -- id de la suscripción en PayPal (I-XXXX)
  library_id         uuid references public.libraries(id) on delete set null,  -- plan Iglesia: librería cubierta
  seats              int  not null default 5,
  founder            boolean not null default false,
  trial_ends_at      timestamptz,
  current_period_end timestamptz,                  -- hasta cuándo está pagado
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.lp_subscriptions enable row level security;

drop policy if exists "sub read own" on public.lp_subscriptions;
create policy "sub read own" on public.lp_subscriptions for select using (user_id = auth.uid());
-- Sin políticas de escritura: solo el servidor (service role) escribe.

-- Historial de cobros y eventos (auditoría). Solo el servidor lo usa.
create table if not exists public.lp_payments (
  id              bigserial primary key,
  user_id         uuid,
  provider_sub_id text,
  event           text not null,
  amount          numeric,
  currency        text,
  raw             jsonb,
  created_at      timestamptz not null default now()
);
alter table public.lp_payments enable row level security;

-- ── ¿Qué plan tengo? ──────────────────────────────────────────────────────
-- La app la llama al iniciar sesión (a través de la función `billing`, que
-- además firma la licencia para usarla sin internet).
create or replace function public.lp_entitlement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s   public.lp_subscriptions;
  ch  record;
  t   timestamptz := now();
begin
  if uid is null then
    return jsonb_build_object('plan', 'free', 'status', 'anon');
  end if;

  select * into s from public.lp_subscriptions where user_id = uid;
  if not found then
    -- Cuenta nueva: 14 días de Pro de prueba
    insert into public.lp_subscriptions (user_id, plan, status, trial_ends_at)
    values (uid, 'pro', 'trial', t + interval '14 days')
    on conflict (user_id) do nothing
    returning * into s;
    if s.user_id is null then
      select * into s from public.lp_subscriptions where user_id = uid;
    end if;
  end if;

  -- 1) Su propia suscripción pagada (cancelada también vale hasta fin del periodo)
  if s.status in ('active', 'past_due', 'canceled') and s.current_period_end is not null and s.current_period_end > t then
    return jsonb_build_object('plan', s.plan, 'status', s.status, 'until', s.current_period_end,
      'interval', s.billing_interval, 'source', case when s.provider = 'comp' then 'comp' else 'own' end,
      'library_id', s.library_id, 'founder', s.founder);
  end if;

  -- 2) Cubierto por el plan Iglesia de una librería en la que es miembro.
  --    Entran los `seats` primeros miembros (por antigüedad; el dueño siempre).
  select c.user_id as owner, c.current_period_end as until, c.library_id
    into ch
    from public.lp_subscriptions c
   where c.plan = 'church'
     and c.status in ('active', 'past_due', 'canceled')
     and c.current_period_end > t
     and c.library_id is not null
     and (c.user_id = uid or uid in (
           select x.user_id from (
             select m.user_id,
                    row_number() over (order by (m.user_id = c.user_id) desc, m.created_at, m.user_id) as rn
               from public.memberships m
              where m.library_id = c.library_id) x
            where x.rn <= c.seats))
   order by c.current_period_end desc
   limit 1;
  if found then
    return jsonb_build_object('plan', 'church', 'status', 'member', 'until', ch.until,
      'source', 'church', 'library_id', ch.library_id, 'founder', s.founder);
  end if;

  -- 3) Prueba vigente
  if s.trial_ends_at is not null and s.trial_ends_at > t then
    return jsonb_build_object('plan', 'pro', 'status', 'trial', 'until', s.trial_ends_at,
      'source', 'trial', 'founder', s.founder);
  end if;

  -- 4) Gratis
  return jsonb_build_object('plan', 'free',
    'status', case when s.trial_ends_at is not null then 'trial_ended' else 'none' end,
    'trial_ended_at', s.trial_ends_at, 'founder', s.founder,
    'last_status', s.status);
end;
$$;

revoke all on function public.lp_entitlement() from public;
grant execute on function public.lp_entitlement() to authenticated;

-- ── Fundadores ────────────────────────────────────────────────────────────
-- Quien ya tenía cuenta antes del lanzamiento: 3 meses de Pro y precio de
-- fundador para siempre.
insert into public.lp_subscriptions (user_id, plan, status, trial_ends_at, founder)
select p.id, 'pro', 'trial', now() + interval '90 days', true
  from public.profiles p
on conflict (user_id) do update
  set founder = true,
      trial_ends_at = greatest(coalesce(public.lp_subscriptions.trial_ends_at, now()), now() + interval '90 days');

comment on table public.lp_subscriptions is
  'Plan de LivePads por persona (Gratis/Pro/Iglesia), prueba de 14 días y fundadores. Escribe solo el servidor.';
