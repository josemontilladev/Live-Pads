-- ─────────────────────────────────────────────────────────────────────────
-- 0024 · Voces de referencia por canción: que CUALQUIER miembro pueda subirlas
--
-- Las voces (melodía, 2.ª voz, 3.ª voz…) se graban desde GI App y viven en
-- songs.meta.audio.voices. Hasta ahora solo editores y dueños podían añadirlas,
-- porque para eso hay que modificar la canción. Aquí se abre SOLO ese gesto:
--
--   · song_voices_enabled()            → la app pregunta si el servidor lo admite
--   · song_add_voice(song, voice)      → añade una voz (cualquier miembro)
--   · song_remove_voice(song, voiceId) → la quita quien la subió, o un editor
--   · library_files: un miembro puede registrar archivos bajo «Voces/»
--
-- El resto de la canción (letra, tono, pistas…) sigue siendo solo de editores.
-- Hay que desplegar también la función r2-sign (deja subir a «Voces/» a miembros).
-- Se puede ejecutar más de una vez.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.song_voices_enabled()
returns boolean language sql stable as $$ select true; $$;
grant execute on function public.song_voices_enabled() to authenticated;

create or replace function public.song_add_voice(p_song uuid, p_voice jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lib uuid;
  m   jsonb;
  a   jsonb;
  v   jsonb;
  nv  jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select library_id, coalesce(meta, '{}'::jsonb) into lib, m from public.songs where id = p_song for update;
  if lib is null or not public.is_member(lib) then
    raise exception 'No perteneces a la iglesia de esta canción';
  end if;
  -- Solo audios de la carpeta de voces, con identificador y etiqueta.
  if coalesce(p_voice->>'id', '') = '' or coalesce(p_voice->>'label', '') = ''
     or coalesce(p_voice->>'path', '') not like 'livepads://app/Voces/%'
     or position('..' in p_voice->>'path') > 0 then
    raise exception 'Voz no válida';
  end if;
  if length(p_voice::text) > 2000 then raise exception 'Voz no válida'; end if;

  a := case when jsonb_typeof(m->'audio') = 'object' then m->'audio' else '{}'::jsonb end;
  v := case when jsonb_typeof(a->'voices') = 'array' then a->'voices' else '[]'::jsonb end;
  if jsonb_array_length(v) >= 24 then raise exception 'Esta canción ya tiene muchas voces guardadas'; end if;
  -- Se sella quién la subió (no se acepta del cliente).
  nv := (p_voice - 'uid') || jsonb_build_object('uid', auth.uid());
  v := coalesce((select jsonb_agg(x) from jsonb_array_elements(v) x where x->>'id' <> nv->>'id'), '[]'::jsonb)
       || jsonb_build_array(nv);

  update public.songs
     set meta = jsonb_set(m, '{audio}', a || jsonb_build_object('voices', v), true),
         updated_by = auth.uid()
   where id = p_song;
  return v;
end;
$$;
revoke all on function public.song_add_voice(uuid, jsonb) from public;
grant execute on function public.song_add_voice(uuid, jsonb) to authenticated;

create or replace function public.song_remove_voice(p_song uuid, p_voice_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lib uuid;
  m   jsonb;
  a   jsonb;
  v   jsonb;
  cur jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select library_id, coalesce(meta, '{}'::jsonb) into lib, m from public.songs where id = p_song for update;
  if lib is null or not public.is_member(lib) then
    raise exception 'No perteneces a la iglesia de esta canción';
  end if;
  a := case when jsonb_typeof(m->'audio') = 'object' then m->'audio' else '{}'::jsonb end;
  v := case when jsonb_typeof(a->'voices') = 'array' then a->'voices' else '[]'::jsonb end;
  select x into cur from jsonb_array_elements(v) x where x->>'id' = p_voice_id limit 1;
  if cur is null then return v; end if;
  -- La quita quien la subió; un editor o el dueño, cualquiera.
  if not public.is_editor(lib) and coalesce(cur->>'uid', '') <> auth.uid()::text then
    raise exception 'Solo quien subió esta voz, o un editor, puede quitarla';
  end if;
  v := coalesce((select jsonb_agg(x) from jsonb_array_elements(v) x where x->>'id' <> p_voice_id), '[]'::jsonb);
  if jsonb_array_length(v) = 0 then a := a - 'voices'; else a := a || jsonb_build_object('voices', v); end if;
  update public.songs set meta = jsonb_set(m, '{audio}', a, true), updated_by = auth.uid() where id = p_song;
  return v;
end;
$$;
revoke all on function public.song_remove_voice(uuid, text) from public;
grant execute on function public.song_remove_voice(uuid, text) to authenticated;

-- Manifiesto de archivos: un miembro puede registrar (y volver a registrar) audios
-- de la carpeta «Voces/». Todo lo demás sigue siendo de editores.
drop policy if exists "files upsert voices" on public.library_files;
create policy "files upsert voices" on public.library_files for insert
  with check (public.is_member(library_id) and path like 'Voces/%' and position('..' in path) = 0);

drop policy if exists "files update voices" on public.library_files;
create policy "files update voices" on public.library_files for update
  using (public.is_member(library_id) and path like 'Voces/%')
  with check (public.is_member(library_id) and path like 'Voces/%' and position('..' in path) = 0);
