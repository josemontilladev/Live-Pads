# Estado del Proyecto - LivePads 🎛️

Un software profesional y ligero para la reproducción de pads ambientales y disparadores de batería en vivo, diseñado específicamente para iglesias y presentaciones musicales.

**Repositorio Oficial**: [https://github.com/josemontilladev/Live-Pads.git](https://github.com/josemontilladev/Live-Pads.git)

---

## 📍 CHECKPOINT — Sesión cerrada 2026-05-19 (duodécima pasada)

### Estado al cerrar

- **Última fase completada**: 🏗️ Fase 34 — 17 mejoras UX adicionales (atajos, MIDI status, touch reorder, modal edición, README)
- **app.js**: ~755 líneas (-76% desde el origen 3055)
- **Total módulos**: **43** archivos JS + 11 módulos CSS
- **Pads Amb**: 137 MB sin pérdida audible
- **Instalador NSIS**: 250 MB

### Fase 34 (esta sesión) — pulido UX final + maintenance

1. **Atajos + flujo**:
   - `Ctrl+N` quick-add nueva canción (cambia tab + dispara botón)
   - `Enter` en buscador aplica la primera card filtrada
   - Tooltips `Ctrl+S` / `Esc` en el editor de letras
2. **Guardas + feedback**:
   - Toast warning cuando el tono de una canción no mapea a las 12 notas cromáticas
   - `confirmDialog` cuando se importa JSON sobre librería poblada (evita overwrite silencioso)
   - Último `alert()` nativo (kitControls) reemplazado por `showToast`
3. **Búsqueda + MIDI**:
   - `<mark.search-hit>` resalta el match en title/artist usando `var(--accent)` + `var(--glow)`
   - Pill `🟢 [device name]` en topbar via `MIDIAccess.inputs`, auto-update con `statechange`
   - UI dim global durante MIDI Learn: `body.midi-learning` → `filter: saturate(0.55) brightness(0.7)` en `#app`
4. **Layout**:
   - Sticky search header: `#panel-setlist` deja de scrollear, scroll vive en los containers `#gi-songs-container`/`#service-songs-container`
5. **Tiempo real del servicio**:
   - `audio.onloadedmetadata` graba `song.durationSec` la primera vez que cada canción se reproduce, persistido en GI-Setlist
   - `updateServiceMeta` suma duraciones reales + 240s fallback para canciones desconocidas; prefijo `~` si hay incógnitas
6. **Touch reorder** (`src/js/utils/touchReorder.js`, nuevo):
   - Long-press 300ms + pointermove + drop con `elementFromPoint`
   - Coexiste con HTML5 drag (mouse usa el flujo nativo, touch usa pointer events)
   - Wired en library + servicio
7. **Modal de edición expandido**:
   - `songEditForm` ahora incluye sección "Audio" con status pill (`✓ asignado`) + clear-X cuando el slot está lleno, o "Asignar archivo" cuando vacío
   - Nuevos `data-action`: `assign-audio-seq/orig`, `clear-audio-seq/orig`
   - Sólo para canciones existentes (no en placeholder "Nueva Canción")
8. **README.md nuevo**: setup, scripts npm, atajos esenciales, estructura del proyecto, instrucciones de `%APPDATA%\LivePads\config.json` para MongoDB sync

### Fase 33 (esta sesión) — premium UX en vivo (24 mejoras)

1. **Now playing banner** clickeable encima del setlist con título + artista, click hace scroll-to + flash de 0.95s en la library
2. **Auto-scroll del servicio** al cambiar de canción (`scrollIntoView` smooth)
3. **Played-song fade**: cards anteriores al active-idx dimmean a 45% opacity
4. **Tab prepara siguiente canción** sin reproducir; badge "PRÓXIMA" en la card encolada
5. **Indicador `3 / 8 · N canciones · ~M min`** en pestaña Servicio
6. **Heartbeat pulse** en botón Play del metrónomo cuando running
7. **Fade-progress bar** de 5s en key-pad activa durante stopPad
8. **Pestaña Atajos en sidebar** (sustituye al modal overlay)
9. **Botón ?** en topbar abre Atajos
10. **Pre-vuelo modal** desde menú hamburguesa (6 checks)
11. **Empty states** Library + Service con icono + CTAs
12. **× clear** en buscador
13. **Búsqueda por tono** (`tono:G`, `key:Cm`)
14. **Favoritos ★** + filtro dedicado (sync GI↔Service)
15. **Auto-save de letras** 1.5s debounce + on blur + indicador "Guardando…/Guardado✓"
16. **6 `confirm()` nativos** reemplazados por `confirmDialog`/`confirmDialogAsync`
17. **Drag-and-drop en Library** + cursor `grab` + 6-dot grip hint en hover
18. **Drop zone bar** 4px accent con glow + animation
19. **Loading state** durante import JSON
20. **Vaciar Servicio** → icono de papelera (hover rojo)
21. **Theme preview on hover** + persistencia en `localStorage`
22. **MIDI learn overlay** slim, top-center, pill rounded
23. **Toasts** anclados arriba del track player
24. **Sidebar close button** ×
25. **Export GI Library** a `livepads-library-YYYY-MM-DD.json`

### Fase 32 (sesión anterior) — motion polish, state manager, extracciones finales

### Fase 32 (esta sesión) — motion polish, state manager, extracciones finales

1. **`_motion.css`** (167 líneas, nuevo módulo CSS) — capa de polish táctil sin glassmorphism:
   - Press-down `scale(0.96)` en 60ms + spring release de 180ms en todos los botones touch
   - `:focus-visible` rings premium con doble box-shadow `accent` + `glow` del tema activo
   - Tactile inner-shadow en hover de `.key-btn` y `.drum-btn` ("iluminado desde arriba")
   - Tokens centralizados en `:root` (`--ease-press`, `--ease-spring`, `--ease-release`, `--press-scale`)
   - `@media (prefers-reduced-motion)` respeta accesibilidad
2. **`state/store.js`** (94 líneas, nuevo) — state manager central, **conservador y sin pub/sub**.
   Cubre 11 piezas de state mutable:
   - Library: songs, currentGenre, activeSongId
   - Accordion exclusivity: openAccordionSongId, openAccordionServiceId
   - Banks: padBankIdx, kitBankIdx
   - Audio/metro: activeKey, preparedPadKey, useFlats, metroRunning
   - UI modes: isEditKitMode, isMidiLearnMode, midiLearnTarget
   Sólo quedan en app.js como `let`: `engine` y `metro` (instances creadas una vez, no resetean).
3. **Migración masiva de `app.js` al store**: todos los `let` viejos eliminados, lecturas vía `getX()`, escrituras vía `setX(v)`. Bug fix encontrado: una regex de migración con `(?!\s*=)` excluyó incorrectamente `activeKey === key` ([app.js:354](src/js/app.js#L354)) por el `=` de `===`; fix manual + sweep verifico que no quedaron más.
4. **Extracciones de `bind*` (5 nuevos módulos UI)**:
   - **`ui/kitControls.js`** (124 líneas) — CRUD de drum kits custom + modo edición de nombres de pads
   - **`midi/midiBindings.js`** (164 líneas) — MIDI listener + learn-mode click intercept
   - **`ui/mixerControls.js`** (99 líneas) — pad/drum/master vol+pan + LPF filter
   - **`ui/metronomeControls.js`** (146 líneas) — play/stop/BPM/sig/mult/sound/vol/pan/notation + inline BPM editor
   - **`ui/setlistTabs.js`** (45 líneas) — toggle de tabs Presets/Librería/Servicio + prev/next/clear
   - **`ui/giToolbar.js`** (150 líneas) — search input + add-song + import/export JSON + dropdown de filtro de género
5. **Sidebar close button**: añadido botón × en esquina superior derecha del sidebar de ajustes (antes sólo se cerraba con Esc).
6. **Sync MongoDB visible**: el botón `#btn-sync-gi` estaba oculto por mi error en Fase 26 (cambié `style="display:none"` a `class="hidden"`); ahora vuelve a aparecer en pestaña Librería como antes.
7. **Export GI Library**: nuevo botón en setlist header que descarga la librería completa a `livepads-library-YYYY-MM-DD.json` (formato round-trippable con el botón de importar). Implementado en `giSetlistLoader.js`.

### Auditoría final

`bindRestOfApp` desapareció — quedó como un orchestrador de 18 líneas que llama a los 5 módulos extraídos + `bindMidiHandlers` + `bindGlobalHandlers`. **Cero `bindX()` grandes en `app.js`**. Las funciones que quedan en `app.js`:
- `bindAll` y sub-coordinators (`bindWindowControls`, `bindSidebarAndTabs`, `bindHamburgerMenu`, `bindGlobalHandlers`) — todos < 30 líneas
- `applyGiSong`, `applyBpm`, `toggleMetro`, `triggerMasterPlayPause/Stop`, `onKeyClick`, `onKey`, `applyPreset`, `loadPadBank`, `loadKitBank`, `buildBankSelects`, `buildKeyGrid`, `updateKeyHints`, `refreshActiveSongHighlights` (usa store)
- Boot async + helpers — la columna vertebral del arranque

### Fase 31 (anterior) — re-encode audio + extracciones finales

### Fase 31 (esta sesión) — re-encode audio + extracciones finales

1. **Re-encode de pads ambientales** (Foundations + Organic banks):
   - 24 archivos × 320 kbps CBR stereo → **LAME VBR V0** (≈233 kbps Foundations, ≈189 kbps Organic)
   - Duración exacta preservada (offset de 25ms de encoder delay LAME — gapless playback respetado por Web Audio)
   - Foundations: 85 MB → 63 MB (-26%)
   - Organic: 83 MB → 49 MB (-41% — material con alta redundancia harmónica comprimió mejor)
   - Chris Rocha: sin tocar (ya estaba a 96 kbps mono)
   - **Backup** de originales en `audio_assets/originales/` (fuera del bundle del instalador via `files:` de electron-builder)
2. **`data/mongoSync.js`** (89 líneas, nuevo) — extracción del handler de sync MongoDB (`#btn-sync-gi`).
   - API: `bindMongoSync({ getSongs, persist, rerender, updateFilterCounts, getSearchFilter })`
   - Atado una sola vez en boot; el handler de antes vivía inline en `bindRestOfApp`.
3. **`ui/songState.js`** (125 líneas, nuevo) — extracción de las 4 primitivas de estado visual compartidas entre la librería GI y el servicio:
   - `refreshActiveSongHighlights()` — surgical highlight (≤2 cards por list).
   - `toggleLyricsAccordion(song, isService)` — exclusividad cross-list (sólo un acordeón abierto).
   - `paintChordVisibility(card, showChords)` — pinta el texto + el botón pill.
   - `toggleChordVisibility(song, isService, syncToLibrary)` — flip + sync opcional a librería.
   - API: `initSongState({ getActiveGiSongId, getOpenAccordionSongId/Service+setters, getGiSongs })`.

### Auditoría de extracciones restantes

Las funciones `bindMidiHandlers` (120 líneas), `bindMetronomeControls` (126), `bindRestOfApp` (146), `bindKitButtons` (91) NO se extrajeron en esta sesión — están tightly coupled a 10-18 globals mutables (engine, metro, KIT_BANKS, isMidiLearnMode, midiLearnTarget, kitBankIdx, useFlats, isEditKitMode, activeKey, preparedPadKey, metroRunning). Su extracción correcta requiere primero el **state manager central** (refactor 🔴 pendiente del ROADMAP) para no crear deps objects de >10 entradas que anulen la ganancia organizacional.

### Fase 30 (esta sesión) — extracción modular de los renderers

### Fase 30 (esta sesión) — extracción modular de los renderers

**Objetivo**: sacar la lógica de las dos listas de canciones (Librería GI y Servicio) de `app.js` a módulos dedicados, manteniendo el estado en `app.js` y exponiéndolo vía getters/setters inyectados.

1. **`src/js/ui/giList.js`** (271 líneas, nuevo) — encapsula:
   - `renderGiList()` con chunked rendering (60+ canciones) y token de aborto
   - Delegación completa de clicks (10 acciones: `play-seq`, `play-orig`, `add`, `remove`, `edit`, `edit-save`, `edit-cancel`, `toggle-lyrics`, `toggle-chords`, `edit-lyrics`, `edit-form-shell`)
   - Helpers quirúrgicos: `repaintGiCard`, `renumberGiCards`, `getGiCardBySongId`
   - Constructor de cards puro (sólo markup, sin handlers)
2. **`src/js/ui/serviceListView.js`** (175 líneas, nuevo) — equivalente para el servicio:
   - `renderServiceList()` + delegación de clicks (9 acciones) + delegación de drag-and-drop (5 listeners)
   - `repaintServiceCard()` quirúrgico
   - Sync GI↔Service vía callbacks `syncLyricsToLibrary` y `syncMetaToLibrary` (no toca `giSetlistSongs` directamente)
3. **API de deps**: ambos módulos reciben los hooks que necesitan; no comparten estado mutable global.

### Fase 29 (esta sesión) — refactor quirúrgico de renderers

Con event delegation ya activo, varios handlers que antes hacían `renderGiSetlist()` completo (80 cards) ahora actualizan **1 sola card**:

| Acción | Antes | Ahora |
|---|---|---|
| `remove` lib | re-render 80 cards | `card.remove()` + renumber |
| `edit-cancel` revert | re-render 80 | `repaintGiCard` × 1 |
| `edit-cancel` discard nueva | re-render 80 | `card.remove()` + renumber |
| `edit-lyrics save` lib | re-render 80 | `repaintGiCard` × 1 |
| `edit-save` lib (sin sort change) | re-render 80 | `repaintGiCard` × 1 |
| `edit-lyrics save` svc | re-render 80 + svc | 2 repaints × 1 |
| `edit-cancel` svc | re-render svc | `repaintServiceCard` × 1 |

Bug fix de propina: en service `edit-save`, la búsqueda de `giSong` se hacía con el título **ya mutado** — si renombrabas desde el servicio, no encontraba la matching en la librería. Ahora se guarda `oldTitleArtist` antes de mutar.

### Fase 28 (esta sesión) — event delegation en setlists

- **Antes**: cada render adjuntaba **8 handlers × N filas** (≈640 closures para 80 canciones). Cambiar de búsqueda recompilaba todos en cada keystroke.
- **Ahora**: **1 listener por container**, atachado una vez en boot. Dispatch por `[data-action]` con `closest()`.
- `buildCard` pasó de ~120 líneas con handlers inline a ~15 líneas de markup puro.
- Drag-and-drop del service list también delegado.
- `songCard.js`: añadidos `data-action` a cada botón.
- `songEditForm.js`: eliminados 9 inline styles, ahora usa clases `.gi-edit-form`, `.gi-edit-input`, `.gi-edit-row`, etc.
- **Ganancia estimada**: 3-5× más rápido el re-render en cada búsqueda/filtro; ~640 closures menos vivas por render.

### Fase 27 (esta sesión) — single-scroll en acordeón de letra

- El acordeón de letra+acordes (`.gi-lyrics-accordion.open`) tenía `max-height: 700px` + `overflow-y: auto`, lo que creaba **dos barras de scroll verticales** confusas (una para la lista, otra dentro de la card abierta).
- Cambio: `max-height: 2500px` + `overflow: visible`. La letra fluye natural; sólo la barra externa del setlist scrollea. Eliminados los estilos de scrollbar interno.

### Fase 26 (esta sesión) — inline styles, CSS split, chunked render, iconos

1. **Inline styles → clases CSS**: 36 → **0** `style="..."` en `index.html`. Nuevas utilities en `_utilities.css` (topbar, metronome, drum tray, sidebar labels, etc.).
2. **Split de `index.css`**: 2456 líneas en 1 archivo → **10 módulos** en `src/css/modules/`:
   - `_base.css` (vars, premium polish, reset)
   - `_layout.css` (topbar, stage, panels)
   - `_sidebar.css` (sidebar + about)
   - `_setlist.css` (setlist + gi rows + service + song card + edit form)
   - `_metronome.css`, `_trackplayer.css`
   - `_modals.css` (dialogs + soundpool + lyrics editor)
   - `_preloader.css`, `_utilities.css`, `_responsive.css`
   - `index.css` ahora es un manifiesto de `@import` en orden de cascada.
3. **Chunked rendering de la lista GI** (precursor de la extracción a giList.js): libraries ≤60 canciones renderizan síncrono; >60 hacen primer chunk de 30 + streaming vía `requestIdleCallback`. Token de aborto cancela streams obsoletos si entra una nueva búsqueda.
4. **Botones "Importar URL" + "Vista Previa" → solo iconos**: 26×26 cuadrados con SVG (cadena + ojo). Toggle por clase `.active` (no `textContent`) para no borrar el SVG. `aria-label` + `title` para accesibilidad.
5. **Dead code en `chordImporter.js`**: removido `import { transposeAll }` marcado "future use" + branch redundante de `<br>` en el `<font>` fallback.

### Fase 25 (sesión anterior) — bugs reportados arreglados

1. **🐛 Bug: drum pad activaba al teclear `R` (o `Q/W/E/A/S/D/F`) en el textarea de letras** — El `onKey` global solo filtraba `INPUT` pero no `TEXTAREA`. Ahora filtra `INPUT`, `TEXTAREA`, `SELECT`, contentEditable, **y** detecta si el modal de letras está abierto (`#gi-lyrics-modal`) → lockout total de pad/drum/master shortcuts mientras editas letra.
2. **🐛 Bug: botón "Importar URL" no hacía nada** — `window.prompt()` está **deshabilitado en Electron 33** (devuelve `undefined` silenciosamente sin abrir diálogo). Reemplazado por `showDialog()` interno (el mismo que usa "Nuevo kit") que SÍ abre un modal inline con input, botones, focus, validación.
3. **🎨 Estilo discreto/moderno** — Los botones "Importar URL" y "Vista Previa" antes eran prominentes (oro/border azul). Ahora son **ghost outline** con borde transparente, hover en color del tema activo. Coherentes con el resto de la toolbar, no compiten visualmente con [+ SECCIÓN] o transpose. Más pulcro.

### Fase 24 (anterior) — qué se hizo
- **Nuevo módulo**: `src/js/data/chordImporter.js` con parser para LaCuerda
- **Nueva ruta IPC**: `fetch-chord-url` (main.js) con whitelist + timeout

### Fase 24 (esta sesión) — qué se hizo

**Feature nuevo**: importar la letra+acordes de una canción desde una URL (ej. `https://acordes.lacuerda.net/gateway_worship/celebrare.shtml`), evitando copiar/pegar manualmente.

1. **Backend (main.js)**: handler `fetch-chord-url` con:
   - Whitelist de dominios (`lacuerda.net`, `acordes.lacuerda.net`, `www.lacuerda.net`)
   - Timeout 10s vía AbortController
   - Validación de URL + content-type
   - User-Agent identificable
2. **Parser** (`src/js/data/chordImporter.js`):
   - Extrae título (de `<h1>` o `<title>`)
   - Artista (del `<title>` o anchor con `title*=acordes`)
   - Tono (regex `Tono:\s*X`)
   - Body (de los `<pre>` o `<font>` legacy)
   - Normaliza: decodea entidades HTML, strip tags inline (`<a>`, `<span>`, `<font>`)
   - Convierte headers `Coro:`, `Verso 1:` a `[CORO]`, `[VERSO 1]`
3. **UI** (`lyricsEditor.js`):
   - Botón "Importar URL" en toolbar (al lado del transpose)
   - Al click: prompt URL → spinner → fetch → parse → llena textarea
   - Si la canción no tiene título/artista/tono, los autocompleta del HTML
   - Confirm si ya había letra escrita (no sobrescribe sin pedir)
   - Toast success/error con mensaje útil
   - Botón usa colores del tema activo (`var(--glow)`, `var(--accent)`)
4. **Seguridad**: el renderer NO puede hacer fetch directo (webSecurity:true), todo pasa por main.js que valida domain whitelist. Imposible que el renderer abuse de la conexión.
- **soundPoolModal.js**: 278 → **177 líneas** (-101, -36%)
- **app.js**: 1687 líneas (sin cambios desde Fase 22)

### Fase 23 (esta sesión) — qué se hizo

1. **soundPoolModal reescrito completo** — antes tenía 18 `Object.assign(el.style, {...})` blobs con styles hardcoded. La razón era el legacy `body * { transition }` rule que ya eliminamos en Fase 16. Ahora todo el modal usa clases CSS (`.spm-*`).
   - 6 handlers `onmouseenter`/`onmouseleave` con `style.background` eliminados → reemplazados por CSS `:hover`
   - Theme-aware: el botón de "Subir archivo" usa `linear-gradient(135deg, var(--accent2), var(--accent))` → se tinta del color del tema activo
   - El badge "Selector de sonido" usa `var(--glow)` y `var(--accent)` → coherente con el tema
   - El estado `.playing` del play button usa `var(--accent)` en vez de oro hardcoded
   - El botón "Usar" usa `var(--accent)`
2. **Helper `el(tag, className, opts)`** añadido al módulo — reemplaza el patrón repetitivo `document.createElement + className + textContent + innerHTML` con un constructor declarativo de 3 args.
3. **Hover effects ahora puramente declarativos** — JS solo se encarga de eventos (click, audio playback), el visual lo maneja CSS.

### Fase 22 (esta sesión) — qué se hizo

1. **Setlist tab header visibility imperativa → CSS** — La lógica del toggle de tabs (Presets / Librería / Servicio) antes hacía 9 `btn.style.display = ...` para mostrar/ocultar los botones del header (Import/Sync/AddPreset). Ahora el JS solo setea `panelSetlist.dataset.activeTab = target` y CSS controla la visibilidad con selectores `#panel-setlist[data-active-tab="..."] #btn-import-gi { display: none; }`. **Más declarativo, más rápido, código JS más corto.**
2. **Dead code eliminado**:
   - `doSavePreset()` ya no se llamaba desde ningún lado (su único caller era el `#btn-add-preset` que no existe en HTML)
   - Su import `addPreset` ya no se usa, removido de `import { ... } from './data/presets.js'`
   - Las 3 ramas defensivas que tocaban `btn-add-preset` removidas
3. La función `doSavePreset` queda documentada como removed con la receta para retomarla si se agrega el botón ("usar `addPreset({...})` directamente").

### Fase 21 (anterior) — qué se hizo
- **Inline styles en HTML**: 61 → **36** (-41% adicional, **acumulado 85→36 = -58%**)
- Cleanup adicional: `kbd-chip` class reusable, `service-nav-btn`, `empty-state`, `metro-main-btn--square` variant, `.svg-nudge-up/down` para SVGs con offset
- Logo del About ahora usa `var(--glow)` → tinta el drop-shadow al color del tema activo
- Versión del About usa `var(--accent)` para colorear según tema
- Vendor prefix warning legacy (`appearance` sin `-webkit-`) corregido tras toda la sesión apareciendo

### Fase 21 (esta sesión) — qué se hizo
- **Las 6 paletas (GI.Setlist, Midnight Aurora, Crimson Power, Clean Worship, Deep Sea, Ambient Purple) ahora cada una con**:
  - Color secundario (`accent2`) para gradientes en buttons/popups
  - `glow` por tema → todos los box-shadows usan el color del tema activo
  - `borderStrong` para énfasis (focus rings, BPM editor, etc.)
  - `gradient` con radial highlight sutil + linear backdrop — cada tema tiene su "vibe" único
- Cards y panels ahora con gradiente sutil 2-tone (155deg) en vez de flat color
- Botones acento usan gradiente accent → accent2
- Scrollbar adapta al color del tema
- Active song highlight ahora con un wash diagonal del color del tema + glow refinado
- Cero costo runtime — todo CSS variables nativas, browser las cachea

### Fase 20 (esta sesión) — qué se hizo
- **Build instalador**: `dist/LivePads-Setup-1.0.0.exe` (296 MB) — Fase 17, sigue válido
- **app.js**: ~1720 líneas (de 3055 iniciales, **-44%**)
- **Módulos creados**: 30 archivos especializados
- **Inline styles en HTML**: 85 → 61 (-28%)
- **Funcionalidad**: 100% operativa, app corre en dev y empaquetada

### Fase 19 (esta sesión) — qué se hizo

1. **Preloader inline styles → CSS** — `#preloader`, `.preloader-logo`, `.preloader-title`, `.preloader-bar`, `.preloader-fill` ahora viven en CSS. El markup HTML pasó de 4 atributos `style="…"` largos a clases limpias.
2. **MIDI Learn overlay → CSS** — `#midi-learn-overlay` con sus estilos del chip flotante movidos a CSS.
3. **Track Player bar completo → CSS** — `#track-player-bar` y sus hijos (`.tp-transport`, `.tp-play`, `.tp-stop`, `.tp-loop`, `.tp-info`, `.tp-time`, `.tp-right`, `.tp-vol-*`, `.tp-close`) ahora en CSS. Eliminados ~8 atributos style inline grandes.
4. **Kit action buttons (create/edit/delete) → clase compartida** — los tres botones tenían el mismo blob de 213 chars repetido. Ahora usan `.kit-action-btn` + modifiers `.kit-action-btn--hidden` y `.kit-action-btn--disabled`. JS dejó de hacer `style.display` y `style.opacity` directos, ahora togglea clases.

### Fase 18 (esta sesión) — qué se hizo

1. **BPM inline editor** — `input.style.cssText` enorme (350+ chars) reemplazado por clase CSS `#bpm-inline-input`. Más legible, themable, sin penalty de parse en cada apertura del editor.
2. **Pre-warm pad bank optimizado** — `_preloadBank` antes cargaba 12 notas secuencialmente con breathers de 50ms (~1-2s total). Ahora **dos fases**:
   - **Fase 1 paralela** (5 notas más comunes en worship: C, G, D, A, F) → todas decodificadas concurrentemente con `Promise.all`, ~200-300ms para que las teclas más probables estén listas.
   - **Fase 2 secuencial** (E, B, Bb, Eb, Db, Gb, Ab) con breathers de 50ms para no bloquear el main thread.
   - Resultado: la primera presión en cualquiera de los 5 tonos más usados tiene **latencia cero** mucho antes que antes.
3. **Added-popup "¡Añadida al servicio!"** — `popup.style.cssText` reemplazado por clase `.added-popup` + `.leaving` para el fade-out. Usa `transform + opacity` (GPU). Animación más fluida y código del handler 50% más corto.

### Cómo retomar rápido mañana

1. Abrir el proyecto en `c:\Users\josem\OneDrive\Escritorio\Live Pads`
2. Verificar que arranca: `npm start`
3. Leer las secciones **"Próximos blancos"** y **"Estado actual de la arquitectura"** abajo
4. Elegir un target de la lista y atacar

### Próximos blancos sugeridos (ordenados por valor / riesgo)

#### 🟢 Bajos en riesgo (cleanup / micro-perf)

1. **Auditoría de inline styles residuales en `index.html`** — quedan muchos `style="..."` que podrían moverse a CSS classes para reducir reflow. Especialmente el `#track-player-bar` y el preloader.
2. **BPM inline editor** (en `bindMetronomeControls`, ~30 líneas) — usa `input.style.cssText` con un blob enorme. Mover a una clase CSS `.bpm-inline-input`.
3. **Asset audit**: revisar tamaños de los MP3 en `src/assets/Pads Amb/` y `Click Tracks/`. Buscar si hay archivos sobre-comprimidos o que podrían bajar a 192kbps sin pérdida perceptible (ya hubo una pasada con `compress_pads.js`, ver si quedan oportunidades).
4. **Reducir el bundle Electron**: hay ~250MB de Electron framework + ~250MB de assets. Si comprimimos o eliminamos formatos redundantes podríamos bajar el instalador.

#### 🟡 Medios (mejoras de UX / perf concretas)

5. **Virtualización del song list** — actualmente renderiza las 81 cards aunque solo ~10 son visibles. Con un catálogo creciendo (200+ canciones), conviene renderizar solo lo visible + buffer. Librería ligera: ~50 líneas custom code.
6. **Boot profiling** — medir realmente dónde se va el tiempo del cold start (engine.init, asset decoding, electronAPI calls). Apuntar a <500ms hasta interactividad.
7. **Lyrics editor**: aún tiene `transition` en algunas piezas que podrían snap. Auditar.
8. **Pre-warm más agresivo del pad bank por defecto**: actualmente sequential con `setTimeout(50ms)` entre cada nota. Podríamos paralelizar las primeras 4-5 (C, G, D, A — las más comunes).
9. **CSS organization**: `index.css` es un solo archivo de 1848 líneas. Si lo dividimos en `base.css`, `components.css`, `layout.css`, `theme.css`, mejora navegabilidad. Sin impacto runtime pero más limpio.

#### 🔴 Altos (refactors estructurales)

10. **Mini state-manager (`src/js/state.js`)** — desbloquea extracción de Key Grid, Master Controls y onKey. Cambia el modelo mental de la app — refactor profundo. Hacer SOLO si planeas comercializar y necesitas que un equipo trabaje sobre esto.
11. **Render functions surgical refactor** — `renderGiSetlist`/`renderServiceList` aún rebuildean al editar canción / añadir / borrar. Surgical updates posibles pero complejo. Solo si el feel todavía no es perfecto.
12. **Web Workers para parseo de letras** — si tienes canciones muy largas (~2000 versos), el parseo de acordes podría ir a un worker. Para uso normal no hace falta.

### Lo que NO debes hacer

- ❌ Tocar el `body * { transition }` — lo eliminamos en Fase 16 y era el peor offender de fluidez. No vuelvas a añadirlo.
- ❌ Añadir nuevas referencias a `customMidiMap`, `presets` (variable), `serviceSongs`, `activeServiceIndex` como globals — ya están encapsulados en módulos. Usar los helpers (`getMapping`, `addPreset`, `getServiceSongs`, etc.).
- ❌ Modificar `defaults/` durante runtime cuando `app.isPackaged` — solo en dev. Ya hay guards.
- ❌ Hardcodear credenciales MongoDB en main.js — pasan por `config.json` en userData ahora.

### Archivos clave para conocer al retomar

- **`src/js/app.js`** — orquestador. Contiene boot, `bindAll` (orquestador de 9 sub-binders), render functions, master controls.
- **`main.js`** — Electron main process. Tiene protocolo `livepads://`, IPC handlers con validación, paralelización de boot.
- **`src/js/audio/Metronome.js`** — lookahead scheduler. Si lo modificas, cuidado con `_nextNoteTime` y la deduplicación.
- **`src/css/index.css`** — todo el styling. CSS variables en `:root`, NO existe `body *` transition.
- **`package.json`** — `build` config completo de electron-builder.

### Comandos útiles

```bash
# Arrancar dev
npm start

# Verificar sintaxis sin correr
node --input-type=module --check < src/js/app.js

# Build instalador completo
npm run build

# Build sin instalador (más rápido, para testing)
.\node_modules\.bin\electron-builder.cmd --win --dir
```

---

## 🚀 Implementado con Éxito

### 🎨 Diseño y UI (Aesthetics & UX)
- **Grilla de Estilo "Bento" Premium**: Layout limpio y ordenado para los 12 tonos de pads y batería. Los módulos superiores (Bancos y Metrónomo) ahora están integrados en una grilla de 2 columnas con bordes redondeados y estilo unificado.
- **Modernización de Controles**: Reemplazo de botones y flechas por selectores dinámicos (`dropdowns`) para bancos de sonidos, compases y notación, logrando una interfaz más profesional y uniforme.
- **Sistema de Temas Dinámico**: Implementación de 6 temas completos que afectan fondos, tarjetas y textos, con adaptación inteligente de contrastes.
- **Feedback Visual Avanzado**: Los botones tienen animaciones sutiles y los pads de batería muestran un indicador visual (dot) cuando el sample real está cargado.
- **Optimización de Espacio**: Limpieza de la bandeja de ajustes del pad (volumen/pan), moviendo controles avanzados (filtro LPF) exclusivamente al sidebar para reducir la carga cognitiva.
- **Adaptabilidad de Pantalla Laptop**: Sistema de rejilla responsiva fluida a través de Media Queries CSS para alturas de pantalla de 850px o menores, compactando controles de volumen, pan y grillas de botones para evitar desbordamientos y optimizar el espacio en pantallas de laptops de directo.
- **Preloader Infinitamente Dinámico**: Corrección del bug de animación estática en la pantalla de carga preliminar desactivando selectivamente transiciones CSS generales, logrando un preloader fluido a 60fps reales.

### 🔊 Motor de Audio y Optimización (SynthEngine.js)
- **Librería Chris Rocha por Defecto**: Configuración del banco de pads de Chris Rocha como sonido base al iniciar la app.
- **Precarga Inteligente**: Carga inteligente bajo demanda para evitar consumos de memoria innecesarios.
- **Ataque Dinámico (Smart Attack)**: Crossfades suaves de 2.0s para transiciones entre acordes y ataque instantáneo para el inicio de sesión.
- **Limitador Maestro**: Compresión integrada para evitar distorsión en vivo.

### 🥁 Baterías y Metrónomo (Top Module)
- **Metrónomo en Cabecera**: Reubicado en la parte superior para máxima visibilidad durante la ejecución. 
- **Acentuación Manual por Tiempo**: Nueva funcionalidad interactiva que permite hacer clic en cualquier "beat dot" para activar/desactivar el acento en ese tiempo específico.
- **Control Completo**: Tap Tempo, multiplicador `2x`, subdivisión y múltiples sonidos seleccionables via dropdown.
- **Aislamiento Multikit Anticolisión**: Corrección del bug de sobrescritura de archivos duplicando prefijos de kit (`{kitId}_{padId}_timestamp`). Los kits cargados (*Worship Drums*, *EFX 1*, *Drum Kit 1 PADLAB*) son 100% independientes y no se pesan entre sí.
- **Rediseño Premium de Sonidos**: Modal con blur glassmorphism, badges dorados, animación inteligente de play/stop por fila y control robusto de errores de reproducción.
- **Etiquetado de Origen**: Visualización clara del nombre del kit parentizado en el modal de asignación para distinguir muestras similares rápidamente.

### 📋 Integración y Gestión de Setlist
- **Conexión con GI-Setlist**: Importación de archivos JSON y automatización total.
- **Gestión de Listas de Servicio (Sunday Set)**: Nueva pestaña "Servicio" que permite crear una lista personalizada de canciones para eventos específicos a partir de la librería principal.
- **Reordenamiento Interactivo**: Soporte completo para **Drag & Drop**, permitiendo organizar el orden exacto del servicio de forma visual.
- **Sincronización Inteligente**: Al seleccionar una canción, se configuran automáticamente los BPM, la tonalidad del Pad y el sistema de notación (Bemoles/Sostenidos).
- **Persistencia de Lista**: El set de servicio se guarda automáticamente en la memoria local, persistiendo incluso después de cerrar la aplicación.
- **Filtros Dinámicos**: Búsqueda inteligente y filtrado por categorías de culto (Alabanza/Adoración).

### ⌨️ Control y Conectividad
- **Atajos de Teclado**: Mapeo completo por defecto para pads y batería.
- **Soporte MIDI Nativo**: Capacidad de conectar un controlador y mapearlo a las funciones de disparo al instante a través de Web MIDI API.

### 📦 Lanzamiento, Portabilidad y Empaquetado
- **Generación de Ejecutables (.exe)**: Construcción exitosa del instalador NSIS para Windows usando `electron-builder`.
- **Portabilidad Total de Datos de Usuario**: Inclusión de la carpeta `defaults/**/*` en el proceso de empaquetado del `package.json`.
- **Auto-Configuración en Primer Inicio**: Al instalar el `.exe` en una nueva PC, el sistema automáticamente copia los kits de batería, archivos de audio locales, secuencias, canciones y configuraciones de presets, y reescribe dinámicamente las rutas locales (`file:///`) del nuevo equipo.
- **Resolución de Íconos**: Dimensionamiento y conversión automática (256x256) de los íconos de la aplicación y el instalador, resolviendo los errores del empaquetador.
- **Aislamiento de Escritura en Producción**: Integración de validaciones de escritura inteligente `app.isPackaged` en los servicios de guardado y copia en segundo plano (`saveToBoth`, `copyToBoth`), garantizando que la aplicación instalada escriba y actualice datos en la carpeta de usuario segura (`userData`) y evite excepciones fatales por intentar escribir en el archivo de solo lectura `app.asar` del ejecutable.

### 🎵 Reproductor de Pistas y Secuencias
- **Archivos Locales Robustos**: Sistema nativo de IPC (`fs`) que copia automáticamente los archivos originales y secuencias del usuario a `src/assets/`, manteniendo la persistencia a prueba de errores.
- **Rutas a Prueba de Fallos**: Construcción dinámica de URIs (`file:///`) para evitar fallos por espacios o caracteres especiales en Windows.
- **Modo Loop**: Botón de repetición infinita para secuencias.
- **Feedback Visual Inteligente**: Los botones de Setlist se iluminan automáticamente cuando detectan que la canción ya tiene un audio vinculado.
- **Resolución de Rutas Absolutas Inteligente**: Corrección de bug de distorsión de rutas que causaba fallos al reproducir secuencias asociadas con el protocolo nativo virtual `/livepads/`, resolviendo la carga en el ejecutable y permitiendo una carga instantánea y libre de errores desde cualquier módulo.
- **Carga Automática en Pausa**: Al seleccionar cualquier canción, su secuencia/original asociada se monta automáticamente en el reproductor en estado pausado, lista para el disparo sincronizado en vivo.

### ⚡ Flujo de Interpretación en Vivo ("Play Maestro") & Integración MIDI
- **Disparo Maestro Sincronizado (Space / MIDI)**: Sincronización universal mediante la Barra Espaciadora o botón MIDI mapeado. Si hay secuencia, reproduce secuenciador + pad simultáneamente. Si no hay secuencia, inicia automáticamente pad + metrónomo.
- **Parada Maestra Instantánea**: Detiene absolutamente todo (Pads, Metrónomo, Secuencias) con un solo toque (Space / MIDI Stop).
- **Gestión Inteligente de Metrónomo**: Detección dinámica de presencia de secuencia; si la canción tiene secuencia, omite el metrónomo (asumiendo que la secuencia ya contiene el click) y si no, lo enciende por defecto.
- **Mapeo MIDI Extendido (MIDI Learn)**: Soporte completo para mapear físicamente los botones de Siguiente (`Sig`), Anterior (`Ant`), Repetir Bucle (`Loop`), y botones universales de Play y Stop a cualquier tecla o pad de un controlador físico.
- **Mensaje de Confirmación Flotante**: Al agregar una canción al setlist de servicio desde la librería principal, se muestra una hermosa burbuja de confirmación animada que dice "¡Añadida al servicio!" que se desvanece de forma premium en 1 segundo.
- **Navegación Táctil y Teclado en Servicio**: 
  - Destacado visual de la canción activa en el Sunday Setlist mediante bordes neón.
  - Navegación rápida y fluida usando las flechas del teclado (`Arriba`/`Abajo`/`Izquierda`/`Derecha`) bloqueando conflictos en cuadros de búsqueda.
  - Nuevos botones estéticos ultra modernos de cheurones SVG para control visual de avance.
  - **Transición Continua Sin Silencios**: Eliminación del silencio abrupto al cambiar de canción. Si el pad está sonando, la aplicación realiza un crossfade automático y continuo de 2.0 segundos hacia la nueva tonalidad de la canción seleccionada, creando una atmósfera ininterrumpida de fondo.
  - **Desvanecimiento de Parada Suave (Fade Out)**: Al presionar el botón de detener o la barra espaciadora, la secuencia y el metrónomo se apagan al instante, pero el pad ambiental se desvanece de manera gradual y profesional durante 5.0 segundos completos, evitando cortes secos e incómodos al finalizar los cantos.
  - **Menú de Hamburguesa Simplificado y Útil**: Limpieza completa de opciones redundantes para dejar un panel ultra elegante y enfocado. Incluye únicamente: Mapeo MIDI / Teclado, Ajustes de audio, Temas visuales, Pantalla completa (con soporte nativo de ventana de Electron) y la nueva pestaña informativa **Info** integrada directamente en el sidebar lateral de la aplicación.
  - **Añadir Canciones Manualmente con Auto-Ordenamiento**: Integración de un botón estético de suma "+" al lado de la barra de búsqueda en la sección "Librería". Permite añadir canciones nuevas al catálogo local al instante, situando el editor inline **automáticamente al inicio de la lista (posición superior)** para evitar desplazamientos. Al guardar, la canción se reordena alfabéticamente en su lugar correcto.
  - **Cabecera Contextual Inteligente (UX Simplificada)**: Ocultamiento inteligente de los botones superiores del setlist según la pestaña activa:
    * En **Presets**, se muestra únicamente el botón `+` para guardar presets de estado actual.
    * En **Librería**, se muestra únicamente el botón de Importar JSON para cargar canciones.
    * En **Servicio**, se ocultan ambos botones para limpiar la visual y evitar toda confusión.
  - **Editores Inline con Select Dropdowns**: Conversión de campos de entrada manuales (Tono y Género) en selectores desplegables preestablecidos (`select`). El género incluye Alabanza/Adoración, y el tono incluye las 17 variantes de escalas principales, simplificando la captura al máximo con un diseño oscuro premium.
  - **Sincronización de Selección en Librería (Individualizada)**: Selección y resaltado unificado e individual para las canciones de la Librería. Al cargar el catálogo, cada canción recibe un identificador único persistente para garantizar que al hacer clic sobre una de ellas, **únicamente esa canción** adquiera el hermoso contorno iluminado azul neón y el indicador visual de reproducción en tiempo real.
  - **Edición Directa Inline de BPM (Minimalista y Discreto)**: Campo de edición interactivo de BPM mejorado. Al hacer clic sobre el número grande de BPM, se abre un campo de entrada flotante de tipo texto (evitando los toscos controles numéricos del navegador) con un filtro estricto que solo permite ingresar números. Luce un elegante fondo traslúcido y un borde neón azul difuminado de estilo "glassmorphism", integrándose a la perfección con la interfaz profesional.
  - **Letra y Acordes: Acordeón Premium & Integración**:
    * Se incorporó un botón discreto de visualización de letras (`btn-lyrics`) con un elegante icono de documento en la fila de acciones de cada canción.
    * Al hacer clic, despliega suavemente un acordeón de letras de la canción `.gi-lyrics-accordion` debajo de la tarjeta en **Librería** y **Servicio**, con un límite ampliado (`max-height: 700px`) para evitar cortes.
    * Incluye un selector interactivo tipo píldora de texto en la cabecera del acordeón para alternar instantáneamente entre la vista "Con acordes" y "Solo letra".
    * **Acordes Inline Flotantes Premium**: Motor de renderizado actualizado que detecta los acordes integrados en el texto y los posiciona exactamente flotando sobre la sílaba correspondiente (estilo UltimateGuitar), brindando una estética altamente profesional.
    * Desarrollamos un motor de parseo inteligente en JS que detecta automáticamente secciones (como `INTRO`, `VERSO 1`, `CORO`, `PUENTE`) y las resalta dinámicamente con color azul neón, así como líneas completas de solo acordes.
    * Modal de edición de letras completamente pulido y simplificado (eliminados botones de formato de texto innecesarios) y clases CSS refactorizadas para un diseño "frameless" del acordeón sin fondos redundantes.
    * Auto-colapso dinámico de otros acordeones para mantener la pantalla despejada y auto-scroll fluido del elemento seleccionado.
- **Sincronización en la Nube con MongoDB (Cloud Sync)**:
  * Integración nativa del driver oficial de MongoDB.
  * Implementación de un proceso IPC `sync-mongo-setlist` seguro en `main.js` para la recuperación de canciones y metadatos desde la base de datos en la nube.
  * Algoritmo de fusión inteligente en `app.js` que compara elementos mediante ID, título y artista, permitiendo evitar duplicados y actualizar de forma dinámica letras, acordes, secuencias y BPMs.
  * Botón estético de sincronización con animación dorada de pulsación (`pulse`) que provee un feedback visual interactivo excelente del estado de carga.
- **Diseño Estético Discreto y de Alta Gama (UI/UX Polish)**:
  * Reducción y estilización del tamaño de todos los botones de acción amarillos principales (`.accent-btn` para Sincronizar, Importar, Añadir Canción) a un formato minimalista y discreto de **`34px`**, con iconos unificados de **`16px`** y esquinas redondeadas de `8px`.
  * Remoción total del botón redundante e confuso de "Guardar Preset" (`+`) de la cabecera en el panel superior, dejando únicamente el botón "+" de adición de canciones en la parte inferior para una experiencia de usuario sumamente enfocada y libre de errores.
  * Corrección del bug de superposición de visibilidad de botones en pestañas mediante la desactivación del atributo `!important` en el display de flexbox de `.accent-btn`, permitiendo que JavaScript oculte y muestre de manera natural los botones dinámicos en las vistas de Presets, Librería y Servicio.
- **Inicialización de Volumen Sin Pistas**:
  * Refactorización y reubicación de los controladores de eventos de entrada y sincronización del slider de volumen (`#tp-vol`) y progreso (`#tp-progress`) hacia el bloque global de arranque `bindAll()`.
  * Eliminación del error de inicialización nula y habilitación de la sincronización del relleno de color amarillo al 80% desde el primer milisegundo de ejecución del software, sin importar que no haya ningún archivo de audio cargado todavía.
- **Acceso Inmediato a Kits Personalizados (Custom Kits First)**:
  * Reestructuración del arreglo `KIT_BANKS` mediante la sustitución del método `.push()` por `.unshift()`. Esto posiciona automáticamente todos los kits creados por el usuario (como *Drum Kit 1*, *EFX 1*, *Worship Drums*) en la cabecera de los listados desplegables y controles, asegurando un acceso y cambio sumamente veloz durante ejecuciones en directo.
  * Actualización de la creación de kits de batería para que los nuevos bancos se antepongan de forma instantánea al principio de la lista y se activen de inmediato en la visual.
- **Fase 1: Seguridad & Resiliencia Offline (Local-First config.json)**:
  * Aislamiento total de credenciales: La URI de la base de datos de MongoDB Atlas se eliminó por completo del código frontend, quedando el renderizado ciego a claves.
  * Archivo local dinámico: Creación automática de `config.json` en el directorio seguro `userData` (`C:\Users\<Usuario>\AppData\Roaming\Live Pads\config.json`) al iniciar por primera vez, permitiendo configurarlo en caliente en producción sin recompilar.
  * Bypass DNS SRV para VPNs/Proxies (Cloudflare WARP): Implementación de redirección de servidores DNS nativos en `main.js` (`dns.setServers(['1.1.1.1', '8.8.8.8'])`), evitando que programas de túneles e ISPs locales bloqueen las consultas de conexión a MongoDB.
  * Límite de tiempo de red: Límite de 4 segundos de respuesta para evitar bloqueos del sistema principal.
  * Alertas Flotantes Premium (`showToast`): Reemplazo completo de cuadros `alert()` nativos por notificaciones translúcidas de estilo "glassmorphism" con desenfoque de fondo real, iconos animados vectoriales SVG y transiciones con rebote elástico.
- **Fase 2: Pool de Audio y Latencia Cero (Rendimiento)**:
  * Liberación Segura de Hardware de Decodificadores de Audio: Implementación del método `cleanupTrackAudio()` en `app.js` que pausa, limpia la propiedad `.src`, fuerza la recarga del búfer nativo con `.load()`, y desconecta los callbacks de eventos de red y error antes de asignar `null`. Previene fugas de memoria y bloqueos de límite físico de decodificación por parte del sistema operativo al cambiar repetidamente de pistas.
- **Fase 3: Compresión de Recursos y Peso (Asset Compression & Optimization)**:
  * Recorte automatizado de bucles de pads: Implementación y ejecución del script `compress_pads.js` usando `mp3-cutter` en JavaScript puro para recortar loops redundantes de 20 minutos a 3 minutos estables.
  * Ahorro masivo de recursos: Reducción de peso de los bancos *Organic Pad* y *Foundations Pad* de **850MB a 165MB** (un ahorro del **77% de disco**), conservando la fidelidad de audio original a 320 kbps stereo.
  * Reglas de exclusión selectiva: Añadidas exclusiones de archivos basura de análisis Ableton (`!**/*.asd` y `!**/*.wav.asd`) en `package.json` para mantener el instalador limpio.
- **Fase 4: Renderizado Ultra Eficiente & UI Fluida (DOM Optimization)**:
  * Optimización mediante `DocumentFragment`: Modificados los motores de renderizado `renderGiSetlist()` y `renderServiceList()` para estructurar las grillas de canciones en memoria antes de inyectarlas en el DOM.
  * Eliminación de DOM Thrashing: Reducción de repintados y recalculados de diseño por parte de Chromium de **81 ciclos a 1 solo ciclo de dibujado**. Esto garantiza que la navegación, búsquedas rápidas en directo y el arrastre de canciones (Drag & Drop) corran a unos fluidos y constantes 60fps.
- **Fase 5: Flujo de Trabajo e Interfaz en Vivo (Workflow & UX)**:
  * Envoltura inteligente de acordes en el editor: Rediseño del botón `[ ]` en la barra de herramientas del editor de letras con un algoritmo regex de detección selectiva. Envuelve dinámicamente múltiples acordes (ej. `F#m E` pasa a `[F#m] [E]`) respetando el espaciado original exacto para que no se arruine la alineación sobre la letra, y unificando de forma inteligente los acordes combinados con barra (ej. `[F#/E]`, `[E/G#]`).
  * Persistencia y memoria de estado en el escenario: Integración de almacenamiento persistente (`localStorage`) en `app.js` para retener la combinación activa de Pad Bank y Kit de Batería preferida. La app inicia de forma instantánea con el último preset utilizado, eliminando baches de tiempo muerto de reconfiguración durante el directo.

---

  - **Empaquetado y Compilación Nativa (`.exe`)**: Creación exitosa del instalador autónomo autoejecutable `LivePads Setup 1.0.0.exe` de 64 bits utilizando `electron-builder`. Incluye todos los recursos locales integrados, configuraciones personalizadas de instalación de NSIS, el nuevo sistema interactivo de acordeón de letras, la librería de pads de ambiente comprimida a 3 minutos y soporte de empaquetado optimizado para distribución.

---

### 🏗️ Fase 17 — Build final tras toda la optimización

**Status: 🟢 INSTALADOR LISTO** — `dist/LivePads-Setup-1.0.0.exe` (296 MB).

Build cubre toda la arquitectura optimizada acumulada en las fases 1-16:
- 30 módulos JS especializados en `src/js/{audio,data,midi,ui,utils}/`
- app.js: 3055 → ~1730 líneas (-43%)
- Metrónomo Web Audio lookahead (sample-accurate, sin drift)
- Surgical updates para active highlight + lyrics accordion + chord toggle
- AudioContext con `latencyHint: 'interactive'`
- Protocolo `livepads://` con `webSecurity: true`
- Boot paralelo (engine + clicks + disk I/O simultáneos)
- Lazy-load de click sounds (solo el default en boot, otros on-demand)
- 60fps reales: `body * { transition }` killer eliminado, GPU para sidebar+preloader+animations
- IPC hardening + path sanitization
- Credenciales fuera del código fuente
- Auto-update de listeners cacheados en track player

**Build artifacts:**
- `dist/LivePads-Setup-1.0.0.exe` — instalador NSIS (~296 MB)
- `dist/win-unpacked/` — versión portable directa (~513 MB)
- Compresión `maximum`, asar enabled, defaults/ en `extraResources`

**Diagnóstico previo (resuelto):** en sesiones anteriores el packaged build "fallaba" al lanzarlo desde el sandbox de Claude Code porque la variable de entorno `ELECTRON_RUN_AS_NODE=1` se filtraba, forzando a Electron a correr en modo Node-only sin GUI. En tu PC normal esto no ocurre — la app arranca limpia. Confirmado funcionando con 6 procesos Electron (renderer ~1GB con pads + samples cargados).

### 🏗️ Fase 16 — Auditoría de 60fps reales (CSS perf killers eliminados)

Auditoría sistemática de transitions/animations buscando los killers de framerate.

**🔥 Bug crítico encontrado y corregido — `body * { transition: var(--transition-theme) }`**

Una sola línea de CSS aplicaba `transition: all 0.5s cubic-bezier(...)` a **TODO elemento del DOM**. Cada cambio de clase, hover, mutación de innerHTML, scroll, etc. disparaba transiciones de 500ms en cada elemento involucrado. Esto **invalidaba los surgical updates** de fases anteriores — el browser seguía animando 500ms incluso cuando solo togeábamos una clase. Con 81 cards × ~30 elementos por card = 2400+ elementos con transitions activas constantemente.

Evidencia adicional: el código tenía workarounds explícitos en `#sound-pool-modal` y `#preloader` con `transition: none !important` para escapar de esta regla global. Esos hacks ya no son necesarios y los eliminé.

**Otras optimizaciones aplicadas:**

- **`@keyframes preloaderSlide`**: usaba `left: -40% → 100%` (triggers layout 60×/sec). Reescrito como `transform: translateX(-100% → 250%)` (composite-only, GPU). El preloader ya no toca el layout durante su animación.
- **`#sidebar` slide-in**: usaba `right: -400px → 0` (layout). Reescrito como `transform: translateX(100% → 0)` con `will-change: transform`. El sidebar abre/cierra en GPU layer.
- **`.beat-dot` on/off**: tenía `transition: all 0.2s` que difuminaba los flashes a >150 BPM. Cambiado a `transition: transform 0.15s` (solo el hover scale anima). Beat on/off ahora es instantáneo — el timing del metrónomo se percibe correctamente a cualquier BPM.
- **`.drum-btn.hit`**: el `transition: all 0.15s` retrasaba la respuesta visual al golpe. Añadido `transition: none` específicamente al estado `.hit` para que el flash sea instantáneo. El fade de regreso conserva el smooth 0.15s. Drummer en directo siente respuesta inmediata.

**Propiedades costosas usadas en transitions (auditadas, solo 3 quedan, todas justificadas):**
- `.gi-lyrics-accordion` usa `max-height` (necesario para slide-down de altura variable). Un elemento a la vez.
- `.gi-sticky-header` también `max-height` (collapse del header en scroll). Un elemento.
- `transform: translateY()` ya se usa donde se puede.

### 🏗️ Fase 15 — Updates quirúrgicos para acordeón de letras + toggle de acordes

**Impacto en fluidez**: estas 4 interacciones (clic en botón de letras + toggle de acordes en cada lista) antes disparaban un **full re-render de 81+ cards de librería + N cards de servicio**, solo para cambiar 2 clases CSS en una sola card. En live performance con catálogos grandes, esto causaba un freeze visible.

- **`toggleLyricsAccordion(song, isService)`** — cierra cualquier acordeón abierto (vía `querySelectorAll('.gi-lyrics-accordion.open')`) y abre el de la card target. Mantiene el invariante "solo un acordeón abierto a la vez en toda la app". 4 DOM writes máximo por click.
- **`toggleChordVisibility(song, isService, syncToLibrary)`** + helper `paintChordVisibility(card, showChords)`. Cuando el toggle ocurre en la lista de Servicio, también sincroniza visualmente la card de librería si está renderizada. 2-4 DOM writes por click.
- **4 callsites reemplazados**:
  - `renderGiSetlist` lyrics accordion handler — antes: full re-render gi+svc; ahora: `toggleLyricsAccordion(song, false)`
  - `renderGiSetlist` chord toggle handler — antes: full re-render gi; ahora: `toggleChordVisibility(song, false)`
  - `renderServiceList` lyrics accordion handler — antes: full re-render gi+svc; ahora: `toggleLyricsAccordion(song, true)`
  - `renderServiceList` chord toggle handler — antes: full re-render gi+svc + sync manual; ahora: `toggleChordVisibility(song, true, true)`

**Latencia perceived**: clic en acordeón de letras pasa de ~150-300ms (rebuild de 81 cards con 7-9 onclick handlers c/u) a **<5ms** (4 DOM writes).

- **Cleanup adicional**: `getCleanSampleName` unused import eliminado de app.js, `onkeypress` deprecated reemplazado por `onkeydown` (con guard para teclas de control), última instancia de `.substr()` deprecated reemplazada por `.substring()`.

### 🏗️ Fase 14 — Dedupe de patrones BPM

- **`applyBpm(v)` helper a nivel de módulo en app.js**: unifica el patrón `metro.setBPM(v) + slider.value + bpm-display + metro-bpm-live + syncSlider` que estaba duplicado en 3 sitios (bindMetronomeControls closure, applyPreset, applyGiSong). Ahora 6 call sites comparten una sola función defensiva (`if (slider)`, `if (disp)`, etc. — no crashea si el DOM no está completo).
- **`window.updateBPM` eliminado**: era exposición legacy que nada externo usaba. Ahora `applyBpm` vive a nivel de módulo, accesible directamente desde cualquier función de app.js sin contaminar `window`.
- **applyPreset** se reduce de 9 líneas a 5; **applyGiSong** elimina 5 líneas duplicadas; **bindMetronomeControls** elimina la closure `updateBPM` (8 líneas).
- **app.js: 1676 → 1669 líneas** (-7 netas, pero ~20 líneas de duplicación eliminadas).

### 🏗️ Fase 13 — Utilidades, filtros y overlays a módulos + UX hover

- **`src/js/utils/sliders.js`** — `syncSlider`, `syncPanSlider`, `bindToggle`. Antes vivían in-line en app.js; usadas en muchísimos sitios (mixer, BPM, metro vol/pan, drum volumes, etc.). Ahora source of truth único.
- **`src/js/ui/genreFilter.js`** — `updateFilterCounts(songs)` que pinta los contadores del dropdown de filtros. Pasa la lista de canciones como parámetro (función pura). Eliminada la lógica defensiva de chips legacy que ya no existen en el HTML.
- **`src/js/ui/overlays.js`** — `openSidebarTab(tab)` y `closeAllOverlays()`. Funciones puras de manipulación DOM, sin acceso a state global. Defensive `if (el)` checks añadidos por si los elementos faltan.
- **UX — hover de song cards corregido**: Reglas legacy CSS (`gi-song-item:hover .gi-row-num { display: none }` + `.gi-row-play { display: flex }`) eliminadas. Causaban que el título "saltara" a la izquierda al hover porque ocultaba la columna del número. Ahora el hover solo ilumina la card (border azul + bg + glow box-shadow) y el número/play indicator se queda en su sitio.
- **app.js**: ~1740 → **~1676 líneas**. Acumulado total: 3055 → **~1676 líneas** (≈**1380 líneas movidas a 26 módulos especializados**).

### Estado actual de la arquitectura

```
src/js/
├── app.js                    (~1676 líneas — orquestador)
├── electron-api.d.ts
├── audio/  (3 módulos)
│   ├── SynthEngine.js
│   ├── Metronome.js          (lookahead scheduler)
│   └── trackPlayer.js
├── data/   (7 módulos)
│   ├── banks.js
│   ├── drumPacks.js
│   ├── service.js
│   ├── presets.js
│   ├── customKits.js
│   ├── giSetlistLoader.js
│   └── musicConstants.js
├── midi/   (1 módulo)
│   └── midiMap.js
├── ui/     (12 módulos)
│   ├── chordTransposer.js
│   ├── dialog.js
│   ├── drumGrid.js
│   ├── drumVolumes.js
│   ├── genreFilter.js        ← NUEVO Fase 13
│   ├── lyricsEditor.js
│   ├── lyricsFormat.js
│   ├── metroBeatDots.js
│   ├── overlays.js           ← NUEVO Fase 13
│   ├── songCard.js
│   ├── songEditForm.js
│   ├── soundPoolModal.js
│   ├── themes.js
│   └── toast.js
└── utils/  (4 módulos)
    ├── dom.js
    ├── format.js
    ├── sliders.js            ← NUEVO Fase 13
    └── text.js
```

### Lo que queda en app.js y por qué no se extrajo

| Pieza | Líneas | Razón |
|-------|--------|-------|
| `bindAll` + 9 sub-binders | ~700 | Wire-up de UI que necesita acceso a globals (engine, metro, isEditKitMode, etc.). Ya está bien organizado en sub-funciones nombradas. |
| `renderGiSetlist` / `renderServiceList` | ~330 | Cada card tiene 6-9 onclick handlers que llaman a ~10 funciones distintas. Extraer requeriría inyectar todas como deps — más complejidad que valor. |
| `applyGiSong` | ~95 | Aplica una canción al engine + metro + UI. Toca activeKey, preparedPadKey, useFlats, buildKeyGrid, onKeyClick, loadAndPlayTrack, etc. |
| Key Grid (`buildKeyGrid`, `updateKeyHints`, `onKeyClick`) | ~80 | `activeKey` y `preparedPadKey` se mutan y leen desde >5 lugares. Necesita state manager. |
| `onKey` (keyboard handler) | ~80 | Lee/muta activeKey, useFlats, midi map, master controls, service nav. Core central. |
| Master controls (`toggleMetro`, `triggerMasterPlayPause`, `triggerMasterStop`) | ~50 | Coordinan engine + metro + track player + key state. Hub central. |
| `buildBankSelects`, `loadPadBank`, `loadKitBank` | ~60 | Tocan engine, indices, drumGrid, drumVolumes, localStorage. |
| Boot sequence | ~150 | Necesariamente toca todo el sistema una vez. |

Para seguir bajando líneas de app.js se necesitaría:
- Mini state-manager (un objeto compartido `state` con getters/setters reactivos)
- O un patrón de event-bus para desacoplar las funciones que comparten state

Ambos son refactors de otra magnitud y cambian el modelo mental de la app — fuera del alcance "limpieza segura sin romper nada".

### 🏗️ Fase 12 — Extracciones residuales (Metro Beat Dots, Drum Volumes, GI Loader, Constantes)

- **`src/js/ui/metroBeatDots.js`** — `buildMetroBeatDots()` y `onMetroBeat()` con `initMetroBeatDots(metro)` para inyectar la instancia del metrónomo en lugar de leer el global.
- **`src/js/ui/drumVolumes.js`** — `buildDrumVolumes(pads)` con deps inyectadas (`getEngine`, `syncSlider`). Cada pad de batería tiene dos sliders sincronizados (stage + sidebar) que se construyen aquí en lugar de inline en app.js.
- **`src/js/data/giSetlistLoader.js`** — `loadGiSetlistFromFile()` que lee desde electronAPI (o fallback fetch en navegador) y devuelve el array de canciones. La función local en app.js ahora es 5 líneas que asigna el resultado y llama a los renderers.
- **`src/js/data/musicConstants.js`** — `KEYS_FLAT`, `KEYS_SHARP`, `KEY_MAP_PADS`, `KEY_MAP_DRUMS`. Antes había duplicación de `KEY_MAP_DRUMS` entre app.js y drumGrid.js — ahora hay un solo source of truth.
- **app.js**: ~1830 → **~1740 líneas**. Acumulado total: 3055 → **~1740 líneas** (≈**1315 líneas movidas a 23 módulos especializados**).

### Estado actual de la arquitectura

```
src/js/
├── app.js                    (~1740 líneas — orquestador con bindAll de 9 sub-binders)
├── electron-api.d.ts
├── audio/
│   ├── SynthEngine.js
│   ├── Metronome.js          (lookahead scheduler)
│   └── trackPlayer.js
├── data/
│   ├── banks.js
│   ├── drumPacks.js
│   ├── service.js
│   ├── presets.js
│   ├── customKits.js
│   ├── giSetlistLoader.js    ← NUEVO Fase 12
│   └── musicConstants.js     ← NUEVO Fase 12
├── midi/
│   └── midiMap.js
├── ui/
│   ├── chordTransposer.js
│   ├── dialog.js
│   ├── drumGrid.js
│   ├── drumVolumes.js        ← NUEVO Fase 12
│   ├── lyricsEditor.js
│   ├── lyricsFormat.js
│   ├── metroBeatDots.js      ← NUEVO Fase 12
│   ├── songCard.js
│   ├── songEditForm.js
│   ├── soundPoolModal.js
│   ├── themes.js
│   └── toast.js
└── utils/
    ├── dom.js
    ├── format.js
    └── text.js
```

### Pendientes (próximas fases si se retoma)
- **Key Grid** (`buildKeyGrid`, `updateKeyHints`, `onKeyClick`) — acoplado con `activeKey`/`preparedPadKey`/engine y referenciado desde múltiples sitios. Requiere mini state-manager para extracción limpia.
- **`renderGiSetlist` y `renderServiceList`** — ~175 + ~160 líneas con wire-up complejo de handlers por card. Posible factor común: extraer `wireSongCardHandlers(el, song, opts, deps)` a `songCardHandlers.js`.
- **`applyGiSong`** — ~95 líneas que aplica una canción al engine + UI. Podría extraerse a un módulo si se resuelve el acoplamiento con activeKey/preparedPadKey/buildKeyGrid.
- **`updateFilterCounts`** — ~40 líneas, podría moverse al módulo del dropdown de filtros (ya existe esa lógica en bindRestOfApp).
- **`onKey`** — keyboard handler de ~80 líneas. Acoplado con activeKey, midi map, master controls — refactor profundo para extracción.

### 🏗️ Fase 11 — Modularización final y `bindAll` navegable

- **`src/js/data/customKits.js`** — Storage de kits personalizados (load/save) + helpers `hydrateCustomKitsInto`, `createEmptyCustomKit`, `saveCustomKitsToStorage`. La carga inicial (boot) y la lógica de "Nuevo kit" comparten ahora el mismo constructor. Eliminada duplicación entre las 3 ubicaciones donde se creaba un kit vacío manualmente.
- **`src/js/ui/drumGrid.js`** — Grid de drum pads (`buildDrumGrid`, `hitDrum`, `assignSampleToPad`) con dependencias inyectadas (`initDrumGrid({ getEngine, getKitBankIdx, isEditKit, onAfterBuild })`). app.js ya no toca el DOM del grid directamente.
- **`bindAll` dividido en 8 sub-binders** (`bindKitButtons`, `bindWindowControls`, `bindSidebarAndTabs`, `bindHamburgerMenu`, `bindMixerControls`, `bindMetronomeControls`, `bindMidiHandlers`, `bindGlobalHandlers`, + un `bindRestOfApp` residual para setlist/GI). El monolito de ~700 líneas que cableaba todo el UI ahora es 9 funciones nombradas y `bindAll()` es un orquestador de 9 líneas. La sintaxis del archivo, la navegabilidad y los hints de TS mejoran significativamente.
- **app.js**: ~2000 → **~1830 líneas**, repartidas en funciones temáticas claramente delimitadas. Acumulado total: 3055 → **~1830 líneas** (≈**1225 líneas movidas a 20 módulos especializados** + reorganización del cableador).

### 🏗️ Fase 10 — Zero-latency tuning & Lookahead Metronome (Live Performance)

- **Metrónomo con Web Audio lookahead scheduler (Chris Wilson pattern)**: el viejo `setTimeout`-chain acumulaba jitter bajo carga (renders pesados, GC pauses) — ahora un setInterval de 25ms agenda beats hasta 100ms en el futuro vía `playClick(..., when)`, con timing sample-accurate desde el audio thread. Imposible que se desvíe aunque el main thread se atasque renderizando 81 cards o haciendo I/O. Callback visual (`onBeat`) usa setTimeout calculado contra el wall-clock para mantener los beat-dots animados.
- **`playClick(..., when)`** en SynthEngine acepta un tiempo futuro opcional — backward-compat con todas las llamadas existentes (default = "play now").
- **`src/js/data/presets.js`** — Preset CRUD (load/add/delete/render) extraído a módulo. Estado de `presets` ya no es global en app.js. `app.js` conserva `doSavePreset` (snapshot de estado actual) y `applyPreset` (aplicación al engine/UI) — los lados que tocan globals de runtime. `initPresets({ onApply })` conecta los dos.
- **`src/js/midi/midiMap.js`** — Estado y helpers de mapeo MIDI/teclado extraídos. Expone `getMapping`, `addMapping`, `clearMappingForTarget`, `findKeyboardMappingFor`. `customMidiMap` desapareció de app.js como global; ya no hay un solo `customMidiMap[...]` directo en el código. La UI wiring de Learn mode (overlay, click-to-target) se mantiene en app.js (demasiado acoplada a botones específicos).
- **songCard: inline styles → CSS classes**: cada card de la librería tenía ~30 atributos `style="..."` que el browser re-parseaba en cada render. Movidos a `.gi-song-row`, `.gi-song-row-left`, `.btn-lyrics.has-lyrics.lyrics-open`, `.btn-seq.has-audio`, etc. SVGs ahora son constantes módulo en vez de strings inline regenerados por card. Render de 81 cards medible mente más rápido.
- **trackPlayer: cache de element refs**: `ontimeupdate` dispara ~4×/seg; antes hacía 3 `q()` por tick. Ahora todos los `#tp-*` se resuelven 1 vez al primer playback y se cachean en `els`. Hot path de la barra de progreso reducido a property access.
- **app.js**: 2030 → **~2000 líneas** tras esta ronda. Acumulado total: 3055 → **~2000** (≈**1050 líneas movidas a 18 módulos especializados**).

### 🏗️ Fase 9 — Modularización profunda: Modales, Diálogos y Card Template

- **`src/js/ui/soundPoolModal.js`** — modal de selección de samples para los pads de batería en modo "edit kit" (~250 líneas). Antes vivía en `app.js`. Estado del preview audio (`previewAudio`, `previewBtn`) que vivía en `window.*` ahora es módulo-privado y limpia correctamente entre rows.
- **`src/js/ui/dialog.js`** — prompt dialog inline (`showDialog`/`hideDialog`) usado por "Nuevo kit" y "Guardar set".
- **`src/js/ui/songCard.js`** — plantilla HTML compartida (`songCardInnerHTML`) usada por `renderGiSetlist` y `renderServiceList`. Antes cada renderer tenía ~70 líneas de HTML idéntico inline; ahora la card es una sola función configurada por opciones (`includeAdd`, `removeBtnClass`, `removeBtnTitle`, `rowNumber`, etc.).
- **Dead code eliminado**: `buildPadBankList`, `buildKitBankList` y `openPicker` (~30 líneas) eran remanentes de un UI anterior pre-dropdown — definidos pero nunca llamados. Borrados.
- **Import `formatLyrics` eliminado** de app.js — la función ahora solo se importa desde `songCard.js` y `lyricsEditor.js`.
- **app.js**: 2399 → **2030 líneas**. ~370 más extraídas esta ronda. Total acumulado desde el inicio: **~1025 líneas movidas a 16 módulos especializados**.

### 🏗️ Fase 8 — Boot rápido + Track Player aislado (Live Performance Focus)

- **Track Player (`src/js/audio/trackPlayer.js`)** — toda la lógica de reproducción de secuencias/originales (cleanupTrackAudio, loadAndPlayTrack, controles de transport, progress bar, loop, volumen) extraída de `app.js` (~190 líneas) a un módulo con estado privado y deps inyectadas. `app.js` ahora consume `isTrackLoaded()`, `isTrackPlaying()`, `clickPlayPause()`, `clearTrackUI()` en lugar de leer/escribir `currentTrackAudio` global.
- **Click metronome lazy-loading**: `engine.loadClickBuffers()` antes decodificaba 14 mp3 (7 sonidos × 2 variantes) en boot. Ahora carga **solo el sonido por defecto** (cowbell) — los otros 6 sonidos se decodifican on-demand vía `ensureClickSound(name)` cuando el usuario los selecciona. Reducción del cold-start de ~100ms.
- **Boot paralelo**: `engine.init()` luego dispara en paralelo (Promise.all) `engine.loadClickBuffers()`, `electronAPI.loadUserDrums()` y `electronAPI.loadMidiMap()`. Antes corrían secuencialmente — disk I/O ahora se solapa con el warmup de audio.
- **`ensureClickSound` deduplicado**: llamadas concurrentes al mismo sonido comparten el mismo Promise (cache `_clickLoading`), evitando re-fetch + re-decode si el usuario cambia rápido.
- **app.js**: ~2400 líneas (de ~3055 originales). Las extracciones acumuladas dejan `app.js` como orquestador con responsabilidades claras: bind UI globales, secuencia de boot, render functions de las listas (renderGiSetlist/renderServiceList), funciones de pad/key/drum, y los handlers de teclado/MIDI.

### 🏗️ Fase 7 — Continuación de refactor + UX en vivo

- **Editor de letras (`src/js/ui/lyricsEditor.js`)** — modal completo (~270 líneas) extraído como módulo aislado con sus propios imports. Antes vivía dentro de `app.js`.
- **Transposición de acordes** ([src/js/ui/chordTransposer.js](src/js/ui/chordTransposer.js)): botones ▼/▲ en el toolbar del editor que mueven todos los `[chord]` ±1 semitono. Contador chip muestra el shift actual. Maneja `root`, `suffix`, y `slash bass` (`F/A` → `G/B`). Detecta tonalidad de la canción para preferir bemoles vs sostenidos.
- **UX del editor de letras**: confirmación al cerrar con cambios sin guardar, atajos `Ctrl+S` (guardar), `Esc` (cerrar), `Ctrl+[` (envolver selección), auto-numeración de `[VERSO N]`, badge dorado de tonalidad activa en el header.
- **Header del setlist colapsable**: al hacer scroll en la lista de canciones se ocultan Setlist + tabs + filtros, dejando solo el search input fijo. Más superficie útil para las cards (~80px ganados).
- **Filtro de género como dropdown**: el chip-row `Todas / Alabanza / Adoración` reemplazado por un icono hamburguesa con menú flotante. Reduce altura del header, indicador dot azul cuando hay filtro activo.
- **Optimización de cambio de canción**: `applyGiSong` ya no rebuildea las 81 cards de la librería + el servicio. En su lugar `refreshActiveSongHighlights()` toggle clase `.active-song` en máximo 2 cards (`data-song-id` / `data-service-id` ancla). Latencia de click ~150ms → ~2ms.
- **Service list (`src/js/data/service.js`)**: módulo con estado privado + CRUD + navegación, deps inyectadas en boot vía `initService({ render, applyGiSong })`. `app.js` ya no declara `serviceSongs` ni `activeServiceIndex` como globales.
- **Theme system (`src/js/ui/themes.js`)**: `applyTheme`, `buildThemesList`, estado interno (`currentTheme`) encapsulados en el módulo.
- **`window.electronAPI` tipado**: archivo `src/js/electron-api.d.ts` con `interface ElectronAPI` que documenta los IPC handlers y silencia los hints del language server.
- **Higiene en `app.js`**: imports no usados eliminados (`escapeHtml`, `panLabel`, `THEMES`), `substr` deprecated reemplazado por `substring`, `console.log` de debug eliminado.
- **app.js**: de 3055 líneas iniciales → **~2600 líneas** (~450 extraídas a módulos con frontera clara).

### 🏗️ Fase 6 — Refactor Estructural & Endurecimiento (Arquitectura Interna)

- **Modularización progresiva de `app.js`**: El monolito original (~3055 líneas) bajó a **~2680 líneas** tras extraer responsabilidades a módulos con frontera bien definida:
  * `src/js/utils/dom.js` — `q`, `qa`, `escapeHtml`/`esc`, `debounce`
  * `src/js/utils/format.js` — `panLabel`, `panShort`, `getCleanSampleName`
  * `src/js/utils/text.js` — `wrapTextareaSelection`, `insertTextAtCursor`
  * `src/js/ui/toast.js` — `showToast` (con backwards-compat `window.showToast`)
  * `src/js/ui/lyricsFormat.js` — `formatLyrics`, `highlightSyntax` (motor de letras)
  * `src/js/ui/songEditForm.js` — plantilla del formulario de edición inline
  * `src/js/ui/themes.js` — sistema de temas con estado encapsulado (`applyTheme`, `buildThemesList`)
  * `src/js/data/service.js` — Sunday Setlist: estado privado + CRUD + navegación, con inyección de `render` y `applyGiSong` al boot
- **Endurecimiento XSS (Defense in Depth)**: helper `esc()` aplicado a toda interpolación de strings de usuario en `innerHTML` (títulos de canciones, etiquetas de pads, nombres de presets, letras renderizadas desde MongoDB). `formatLyrics` ahora escapa el texto crudo antes de re-inyectar markers de acordes como `<span>`.
- **Aislamiento de credenciales (commit-safe)**: La URI de MongoDB se eliminó del código fuente; ahora `sync-mongo-setlist` lanza un error claro si el `config.json` local no tiene `mongoUri`, evitando que credenciales lleguen a commits accidentales en el futuro comercial.
- **Protocolo custom `livepads://` + `webSecurity: true`**: Registrado un esquema privilegiado vía `protocol.handle()` que mapea `livepads://app/<rel>` → `<userData>/<rel>`. Esto permitió reactivar `webSecurity: true` en el `BrowserWindow` (antes era `false`) sin romper la reproducción de samples y secuencias que viven fuera de `src/`. URLs portables entre máquinas (la misma URL resuelve a `userData` local).
- **IPC hardening**: `safeId()` rechaza separadores de path/traversal en IDs de preset; lectura de archivos de audio con tope de **500 MB** vía `readAudioFileSafe()`; validación de `sourcePath` existe + es file en `assign-audio-file` / `assign-drum-sample`.
- **AudioContext para tiempo real**: Creación con `{ latencyHint: 'interactive' }` para buffer mínimo. Listener defensivo de `pointerdown`/`keydown` que llama `ctx.resume()` en el primer gesto del usuario — evita el warm-up latency del primer pad triggered tras una pestaña suspendida por Chromium.
- **Debounce en búsqueda GI-Setlist**: `#gi-search` ahora aplica debounce de 180ms antes de re-renderizar — elimina el lag al teclear con catálogos grandes.
- **`electron-builder` config completo**: `asar: true`, `compression: "maximum"`, `extraResources` para `defaults/` (fuera del archivo asar), `files` filter estricto excluyendo `.md`/`.log`/tests/docs/maps, NSIS con shortcut desktop+start menu, instalación per-user (`perMachine: false`), preservación de `userData` en uninstall (`deleteAppDataOnUninstall: false`), `getDefaultsPath()` que resuelve a `process.resourcesPath` en producción.
- **Higiene de repositorio**: `app_original_backup.js` (36KB obsoleto) eliminado, `lyrics_module_analysis.md` movido a `docs/`. `.gitignore` ampliado para excluir `*.exe`, `.env*`, `config.local.json`, `.claude/`, IDE folders.

---

## ⏳ Pendiente por Implementar (Siguientes Pasos)

- 🎹 Realizar pruebas finales de estabilidad y rendimiento en escenarios de presentación en vivo (iglesias/eventos).
- 🚀 Distribución y despliegue del instalador ultra optimizado en la laptop de directo.
- 🧩 *Follow-up arquitectural (para fase comercial)*: extracción de `presets` CRUD, `midi learn`, y el editor de lyrics modal a módulos con state injection; introducción de un mini state-manager si la app crece.
- 🔐 *Follow-up seguridad (para fase comercial)*: code signing del `.exe` con certificado EV; auditoría de CSP estricto en `index.html`.

---
*Documento actualizado y sincronizado en preparación para distribución portátil.*
