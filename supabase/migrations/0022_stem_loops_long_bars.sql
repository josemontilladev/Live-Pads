-- Packs de canción completa (multitrack): las pistas de una canción duran
-- muchos más compases que un loop (86, 114, 160…). Se sube el tope de 64 a 1024.
alter table public.stem_loops drop constraint if exists stem_loops_bars_check;
alter table public.stem_loops add constraint stem_loops_bars_check check (bars between 1 and 1024);

-- Instrumentos de multitrack: «Guía» (voz que canta las secciones) y «Click».
alter table public.stem_loops drop constraint if exists stem_loops_instrument_check;
alter table public.stem_loops add constraint stem_loops_instrument_check check (instrument in (
  'drums', 'perc', 'bass', 'keys', 'pad', 'synth', 'guitar',
  'strings', 'vocals', 'guide', 'click', 'fx', 'other'));
