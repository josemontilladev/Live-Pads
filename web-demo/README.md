# LivePads — Demo web (Pads + metrónomo)

Demo estático para enganchar descargas: corre la experiencia estrella de
**Pads** (12 colchones de adoración continuos con crossfade) + **metrónomo**
directo en el navegador, con Web Audio API. Sin login, sin instalar nada.

No comparte código con la app de escritorio (Electron); es un demo enfocado.

## Estructura
- `index.html` — página del demo (header con CTA de descarga, grid de pads,
  transporte, footer con features de la app completa).
- `styles.css` — look de la app (tema oscuro + acento ámbar).
- `engine.js` — motor Web Audio: pads en loop, crossfade 2 s, metrónomo con
  scheduler de lookahead, buses de volumen. Decode perezoso por tono.
- `app.js` — wiring de la UI (grid, teclado, beat dots, overlay de gesto).
- `assets/` — 1 set de pads (12 tonos) + clicks + logo.

## Probar localmente
```bash
# desde esta carpeta, cualquier server estático sirve. Ej:
npx serve .
# o
python -m http.server 5050
```
Abrí la URL, pulsá "Entrar al demo" (gesto necesario para activar el audio del
navegador) y probá los pads.

## Desplegar (Vercel)
Sitio 100% estático. Con la CLI de Vercel, desde esta carpeta:
```bash
npm i -g vercel
vercel            # primera vez: crea/linkea el proyecto (preview)
vercel --prod     # publica a producción
```
Luego, en el panel de Vercel → Project → Settings → Domains, agregá el
subdominio (ej. `demo.livepads.online`) y creá el **CNAME** que te indique
Vercel en tu DNS.

## Cambiar el enlace de descarga
Los botones "Descargar" apuntan a `https://livepads.online`. Editá los `href`
en `index.html` (id `download-btn` y el botón grande del footer) si querés que
apunten a la página/instalador final.

## Nota de licencias
`assets/pads/` incluye **un solo** set de pads (con licencia para la app). Para
un demo público, mantené un único set y considerá versiones más livianas.
