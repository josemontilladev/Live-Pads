-- ════════════════════════════════════════════════════════════════════
-- LivePads · Permitir que un miembro SALGA de una librería por su cuenta
-- (borra su propia membresía, salvo si es el dueño). Re-ejecutable.
-- Pegar TODO en Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "mem leave" on public.memberships;
create policy "mem leave" on public.memberships for delete
  using (user_id = auth.uid() and role <> 'owner');
