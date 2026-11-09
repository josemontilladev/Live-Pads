-- Artista o banda de un pack (p. ej. los loops de una canción de Elevation Worship).
-- Distinto de author_name (la firma de quien lo sube en la comunidad).
alter table public.stem_packs add column if not exists artist text;
