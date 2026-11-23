-- ════════════════════════════════════════════════════════════════════
-- Biblioteca de stems: SOLO el administrador sube packs.
--
-- Cierra los envíos de la comunidad en la propia base de datos, aunque
-- alguien use una versión vieja de LivePads o llame a la función a mano:
--   · no se pueden crear packs de la comunidad (estado 'pending') ni
--     volver a mandar uno rechazado a revisión;
--   · no se pueden añadir loops a un envío sin aprobar.
-- Lo del administrador (packs oficiales, aprobar o rechazar, editar,
-- borrar) sigue igual. Quien ya envió algo puede verlo y retirarlo.
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- Para volver a abrir los envíos: drop trigger … (ver el final).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.stem_library_block_community()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'stem_packs' then
    if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
      raise exception 'Por ahora solo el equipo de LivePads publica packs en la Biblioteca de stems.'
        using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'stem_loops' then
    if exists (select 1 from public.stem_packs p where p.id = new.pack_id and p.status in ('pending', 'rejected')) then
      raise exception 'Por ahora solo el equipo de LivePads publica packs en la Biblioteca de stems.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists stem_packs_admin_only on public.stem_packs;
create trigger stem_packs_admin_only
  before insert or update on public.stem_packs
  for each row execute function public.stem_library_block_community();

drop trigger if exists stem_loops_admin_only on public.stem_loops;
create trigger stem_loops_admin_only
  before insert on public.stem_loops
  for each row execute function public.stem_library_block_community();

-- Comprobación (el editor muestra solo el último resultado, por eso va todo junto):
--   · quién es administrador (debería salir solo tu correo);
--   · envíos de la comunidad que siguen abiertos (revísalos o bórralos en Moderación).
select 'Administrador' as tipo, email as detalle
from public.stem_library_admins
union all
select 'Envío sin aprobar (' || status || ')', title || coalesce(' · por ' || author_name, '')
from public.stem_packs
where status in ('pending', 'rejected');

-- Para volver a abrir los envíos de la comunidad algún día:
--   drop trigger if exists stem_packs_admin_only on public.stem_packs;
--   drop trigger if exists stem_loops_admin_only on public.stem_loops;
