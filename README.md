# Live Pads 🎛️

Plataforma profesional de directo para iglesias y músicos en escena.
Combina colchones de pads continuos, metrónomo interactivo con lookahead
scheduler, reproductor híbrido de secuencias/originales, mapeo MIDI y
teclado, sincronización con MongoDB, transposición automática de acordes
y editor de letras con auto-save.

- 🌐 **Página oficial:** https://josemontilladev.github.io/Live-Pads/
- 📦 **Repo:** https://github.com/josemontilladev/Live-Pads

---

## Inicio rápido

```bash
git clone https://github.com/josemontilladev/Live-Pads.git
cd Live-Pads
npm install
npm start          # arranca Electron en modo dev
```

### Configuración local (MongoDB sync — opcional)

El botón "Sincronizar" del setlist trae canciones desde un MongoDB
remoto. La cadena de conexión vive en un archivo de usuario que **no se
commitea** al repo:

**Ubicación:** `%APPDATA%\LivePads\config.json` (Windows)
**Plantilla:**

```json
{
  "mongoUri": "mongodb+srv://USUARIO:PASSWORD@cluster.mongodb.net/gi-setlist?retryWrites=true&w=majority"
}
```

La app crea `config.json` con `mongoUri: ""` en su primera ejecución.
Edítalo a mano y pega tu cadena. Sin esta configuración la app funciona
en modo local — sólo el botón Sync queda inhabilitado.

Si nunca usas MongoDB, ignora este paso completamente.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca Electron en modo desarrollo |
| `npm run dev` | Igual que start pero con flag --dev |
| `npm run build` | Empaqueta el instalador NSIS para Windows (~250 MB) |
| `npm run build:dir` | Empaqueta sin crear el .exe (más rápido para iterar) |
| `npm run build:mac` | Empaqueta `.dmg` para macOS (x64 + arm64) — requiere correr en Mac |
| `npm run build:linux` | Empaqueta `.AppImage` para Linux x64 |
| `npm run build:all` | Empaqueta los tres a la vez (requiere correr en Mac para los `.dmg`) |
| `npm run rebuild` | Recompila el módulo nativo de mongodb tras un upgrade |

El instalador termina en `dist/LivePads-Setup-1.0.0.exe` (o `.dmg` / `.AppImage` según target).

---

## Atajos de teclado

Pulsa **?** dentro de la app, o abre el sidebar → pestaña "Atajos". Lista
completa con todos los shortcuts agrupados por dominio.

Esenciales:

- **Espacio** — Play / Stop maestro
- **1–=** (fila superior) — Tocar pad C / C# / D ... B
- **Q W E R / A S D F** — Disparar drums
- **↑↓ ←→** — Navegar canciones del Servicio
- **Tab** — Preparar siguiente canción del servicio
- **Esc** — Pánico (detiene todo)
- **Ctrl+S** — Guardar letras (en editor)
- **Ctrl+N** — Nueva canción

---

## Estructura del proyecto

```
src/
├── index.html            Markup principal
├── css/
│   ├── index.css         Manifiesto @import
│   └── modules/          10 módulos por dominio
└── js/
    ├── app.js            Boot + glue mínimo (~750 líneas)
    ├── audio/            SynthEngine, Metronome, trackPlayer
    ├── data/             Stores: banks, presets, service, kits, gi loader
    ├── midi/             MIDI map + listener + learn mode
    ├── state/            Store central de UI state
    ├── ui/               Vistas: giList, serviceListView, modals, controls
    └── utils/            Helpers (dom, sliders, text, touchReorder)
```

`app.js` arrancó en **3055 líneas**; tras la refactorización modular
queda en **~750 líneas** que solo orquestan boot + funciones puente
entre módulos.

---

## Tecnologías

- **Electron 33** (Chromium-based)
- **Web Audio API** con lookahead scheduler (Chris Wilson) para timing
  sample-accurate del metrónomo
- **Web MIDI API** para controladores externos
- **MongoDB Node Driver 7** (opcional, para sync con catálogo remoto)
- **electron-builder** para empaquetado NSIS

ES Modules nativos; sin bundler. CSS sin frameworks — variables CSS
custom para theming (6 paletas: GI.Setlist, Midnight Aurora, Crimson
Power, Clean Worship, Deep Sea, Ambient Purple).

---

## Audio assets

Los pads ambientales (3 bancos × 12 notas) viven en `src/assets/Pads Amb/`
y pesan ~137 MB. Los originales sin re-encode están en
`audio_assets/originales/` (gitignored). Si añades pads nuevos, recodéa
con LAME VBR V0 para mantener el tamaño del instalador a raya:

```bash
ffmpeg -i input.mp3 -codec:a libmp3lame -q:a 0 output.mp3
```

---

## Licencia

Copyright © 2026 — Live Pads. Uso personal y eclesiástico.
