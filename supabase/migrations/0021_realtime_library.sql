-- ════════════════════════════════════════════════════════════════════
-- LivePads · Sincronización en tiempo real entre equipos
--
--   Publica en Supabase Realtime los cambios de canciones, servicios, borrados
--   y archivos. La app (src/js/cloud/realtime.js) escucha los de la librería
--   activa y baja los cambios en ~1 s, en vez de esperar a la ronda periódica.
--   Las RLS siguen mandando: cada cuenta solo recibe los cambios de las
--   librerías de las que es miembro.
--
-- Pegar TODO en Supabase → SQL Editor → Run. Re-ejecutable.
-- ════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['songs', 'setlists', 'deletions', 'library_files'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
