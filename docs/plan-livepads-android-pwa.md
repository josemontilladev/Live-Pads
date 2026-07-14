# LivePads Móvil — PWA de respaldo para Android (tablet / teléfono)

**Decisiones tomadas (2026-07-14):** PWA instalable (no APK por ahora) + shell
móvil dedicado (no adaptar la UI de escritorio). Es el "plan de respaldo": si
falla la PC, cualquier tablet/teléfono Android con el navegador sirve para
tocar.

## Por qué ahora es viable
- Todo el repertorio ya vive en la nube (v1.0.145–149): metadatos en Supabase,
  audio + carátulas en R2 con la Edge Function `r2-sign` firmando descargas.
- `web-demo/` ya probó que los motores de LivePads corren en navegador.
- La PWA **bebe del mismo backend**: cero sync nuevo que construir.

## Alcance v1 (lo pedido)
- Login con la cuenta de LivePads (Supabase) y elección de librería.
- Cards de canciones (carátula, título, artista, tono, BPM) + búsqueda +
  setlists del domingo.
- Reproducir **secuencia** y **original** (desde R2, con caché offline).
- **Paneo** de la música y del click (secuencia L / click R para in-ears).
- **Metrónomo** con el BPM de la canción.
- **Pads de notas** (12 tonos, loop con crossfade), auto-tono de la canción.
- Instalable (manifest + service worker), funciona offline tras la 1ª carga.

## Arquitectura
```
mobile/            ← PWA estática (ES modules, sin bundler — como la app)
  index.html       ← 3 pantallas: login / biblioteca / reproducción
  css/app.css      ← identidad LivePads (oscuro + ámbar), táctil (targets 48px)
  js/config.js     ← mismas credenciales públicas (URL + anon key)
  js/supabase.js   ← cliente slim: login password, sesión en localStorage
  js/cloud.js      ← librerías, canciones, setlists, firma R2 (r2-sign op:get)
  js/audio.js      ← player Web Audio: fetch firmado → Cache API → decode →
                     source + StereoPannerNode (pan música)
  js/pads.js       ← loops de pads por tono con crossfade (assets locales)
  js/metronome.js  ← scheduler lookahead + click sintetizado (pan propio)
  js/app.js        ← wiring UI
  assets/pads/     ← 12 mp3 (Pad Chris Rocha, ~25 MB, cache del SW)
  manifest.webmanifest + sw.js + vercel.json
```
- **Audio offline**: los bytes de R2 se guardan en Cache Storage con clave
  sintética estable (`https://r2-cache.local/<path>`) porque la URL firmada
  cambia en cada petición. Segunda reproducción = 0 red.
- **Solo lectura** en v1: la tablet reproduce; se edita en la PC.

## Requisito de infraestructura (única config manual)
CORS en el bucket R2 (el navegador baja directo con URL firmada):
Cloudflare → R2 → livepads → Settings → CORS policy →
```json
[{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
```
(Se puede restringir AllowedOrigins al dominio final cuando esté decidido.)

## Despliegue
Vercel, proyecto nuevo apuntando al repo con **Root Directory = `mobile/`**
(igual que web-demo). Dominio sugerido: `app.livepads.online` o
`movil.livepads.online` (cuando el usuario quiera; mientras, la URL de Vercel).

## Fase 2 (después de validar v1)
- APK con envoltorio (TWA/Capacitor) si hace falta Play Store o mejor audio.
- Edición de metadatos, favoritos, pads de batería, guías en español.
- Latencia: AudioWorklet para el click si el scheduler se queda corto.
