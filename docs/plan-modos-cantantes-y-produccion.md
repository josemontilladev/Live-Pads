# Plan de implementación — Modo Cantantes y Modo Producción (Holyrics)

> **Estado: PROPUESTA — pendiente de validación.** Redactado 2026-07-13.
> Dos audiencias nuevas dentro de LivePads: **cantantes** (letra + tono + tempo,
> manos libres) y **producción audiovisual** (letra limpia para proyectar en
> Holyrics). Ambos planes REUSAN piezas que ya existen; nada de motores nuevos.

---

## Plan B — Modo Cantantes 🎤

### Objetivo
Que un cantante tenga en una sola vista, sin distracciones: **la letra grande**,
**la canción** (reproducir/pausar la secuencia u original), **el metrónomo** y
**subir/bajar de tono** — y que al transponer, acordes, pista y pad vayan juntos.

### Lo que ya existe (se reusa, no se reconstruye)
| Pieza | Dónde | Estado |
|---|---|---|
| Letra a pantalla completa con A+/A− (18–56px persistido) y toggle de acordes | `src/js/ui/lyricsFullscreen.js` | ✅ |
| Transposición de acordes EN VIVO (± semitonos por sesión) + badge de tono | `lyricsFullscreen.js` + `chordTransposer.js` | ✅ |
| Transposición de AUDIO ±12 st sin cambiar tempo (SoundTouch) | `trackPlayer.js` → `setTrackPitch()` | ✅ |
| Pad de notas que sigue la transposición | `app.js` → `applyNotepadPitchShift()` | ✅ |
| Metrónomo independiente (modal flotante) | `ui/metronomeModal.js` | ✅ |
| **Companion**: visor LAN en el MÓVIL con QR (título/artista/tono/BPM/letra en vivo) | `companion/` + `companionPanel.js` | ✅ letra+acordes; ❌ sin transpose ni metrónomo |

### Fase 1 — "Vista Cantante" en el escritorio (esfuerzo: medio)
Evolucionar `lyricsFullscreen` a un modo cantante completo:
1. **Mini-transporte dentro del overlay**: botón Play/Pausa de la pista
   (secuencia u original) + tiempo restante. Reusa el track player; solo es UI.
2. **Transposición UNIFICADA**: los botones ▲/▼ del overlay mueven a la vez los
   acordes de la letra (ya lo hacen), el `setTrackPitch()` del audio y el pad
   (`applyNotepadPitchShift`). Hoy van por separado; se unifica con un flag
   "seguir tono" (on por defecto en esta vista).
3. **Metrónomo embebido**: fila compacta (play/stop + BPM + tap) dentro del
   overlay, conectada al metrónomo existente. El BPM viene de la canción.
4. **Auto-scroll opcional** de la letra (velocidad ajustable, pensado para
   manos ocupadas). Toggle + 3 velocidades; pausa al tocar la pantalla.
5. Acceso: botón "🎤 Modo cantante" en la card de canción y atajo mapeable.

### Fase 2 — Cantantes en su MÓVIL vía Companion (esfuerzo: medio-alto)
El diferencial real: cada cantante con su teléfono, sin tocar la cabina.
1. **Transposición POR DISPOSITIVO** en el cliente companion: cada cantante
   sube/baja el tono en SU teléfono (solo re-renderiza los acordes localmente;
   no toca el master). Portar `transposeAll()` al cliente (es JS puro).
2. **A+/A− y toggle de acordes** en el companion (mismo patrón que fullscreen).
3. **Metrónomo visual** en el móvil: pulso parpadeante sincronizado al BPM de la
   canción publicada (sin audio: WebAudio en segundo plano móvil es frágil y el
   click real ya suena en la cabina).
4. (Opcional) rol "cantante" en el QR: URL con `?vista=cantante` que abre el
   companion directo en letra grande.

### Fuera de alcance (v1)
- Audio de la pista en el teléfono (streaming LAN = latencia/complejidad).
- Cuentas/identidad por cantante.

### Riesgos
- El overlay fullscreen captura Espacio/atajos: cuidar que Play del overlay no
  choque con el Play maestro (mismo patrón que ya usa el banner).
- Transponer audio en vivo tiene coste de CPU (SoundTouch) — ya conocido y
  aceptado en el player actual.

---

## Plan C — Modo Producción audiovisual (Holyrics) 📺

### Objetivo
Que la persona de proyección copie en 1 clic la **letra limpia** (sin acordes,
sin corchetes, con bloques bien separados) de cualquier canción del servicio,
lista para pegar en **Holyrics**.

### Contexto de formato
- LivePads guarda letra en texto plano con acordes `[G]` inline o en líneas
  propias, y secciones tipo `[CORO]` / `VERSO 1:`.
- Holyrics separa diapositivas por **líneas en blanco** y no quiere acordes ni
  etiquetas técnicas. Pega directo desde el portapapeles.

### Implementación
1. **Util `stripLyricsForProjection(lyrics, opts)`** (nuevo, `utils/text.js`):
   - Quita todos los tokens `[...]` de acorde; elimina líneas que queden vacías
     (las líneas que eran solo acordes desaparecen enteras).
   - Opción `keepSections` (default OFF): conserva o elimina `[CORO]`/`VERSO:`.
     En OFF, la etiqueta se elimina pero se garantiza **línea en blanco** entre
     bloques → Holyrics corta las diapositivas justo ahí.
   - Colapsa 3+ saltos en 2 (bloques limpios) y recorta espacios colgantes.
   - ~40 líneas + tests mentales con las letras reales de la librería.
2. **Botón "Copiar letra (proyección)"** en el menú ⋯ de cada card (Librería y
   Servicio): copia al portapapeles + toast "Letra lista para Holyrics".
3. **Panel "Producción"** (nuevo, ligero): pestaña/panel que lista las canciones
   del SERVICIO actual en orden, cada una con su botón de copiar y una
   vista previa de la letra limpia. Acceso desde el menú ☰. Un clic por canción
   y va pegando en Holyrics; cero fricción en domingo.
4. **(Opcional) Exportar .txt por lote**: un archivo por canción
   (`01 - Título.txt`) en una carpeta elegida — Holyrics también importa
   archivos; útil para preparar el set completo de una vez.

### Esfuerzo estimado
- Pasos 1–2: bajo (una sesión corta).
- Paso 3: medio (UI nueva pero simple, reusa las cards/estilos existentes).
- Paso 4: bajo, tras el 1.

### Riesgos
- Letras con formatos raros (acordes sin corchetes tipo `C  G  Am` en línea
  propia): la primera versión detecta "línea solo-acordes" con la misma regex
  de acordes de `chordTransposer.js`; si algo se escapa, se pule con ejemplos
  reales de la librería (104 canciones para probar).

---

## Orden sugerido de ejecución (si se aprueban)
1. **Plan C pasos 1–2** (valor inmediato para producción, esfuerzo mínimo).
2. **Plan B Fase 1** (vista cantante en escritorio).
3. **Plan C paso 3** (panel Producción).
4. **Plan B Fase 2** (companion por dispositivo) — el más vistoso, tras validar
   la Fase 1 con los cantantes reales.
