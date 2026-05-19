# Análisis: Módulo de Letra y Acordes — LivePads

## Diagnóstico General

El módulo funciona bien como base técnica — el parseo es inteligente, la edición en panel lateral es elegante, y la separación de acordes inline vs. línea de acordes separada es correcta. Sin embargo, hay **fricciones visuales y de UX** que le quitan el toque premium que el resto de la app ya tiene.

---

## 🔴 Problemas Críticos (rompen la sensación premium)

### 1. El header del acordeón ("LETRA Y ACORDES") es ruidoso
El texto en mayúsculas dorado `#fbae00` en uppercase + los dos botones (editar y toggle acordes) crean una barra de herramientas que compite visualmente con el contenido que está debajo. La frase "LETRA Y ACORDES" **es redundante** — el usuario ya sabe que está viendo la letra porque la abrió él mismo.

**Propuesta**: Eliminar el label de texto completamente. Dejar solo los dos iconos (editar + acordes) alineados a la derecha, extremadamente sutiles. El acordeón debe "desaparecer" y dejar que el contenido respire.

---

### 2. Los acordes inline se ven pequeños y pegados a la letra
En el renderizado actual, los acordes `[Dm]` dentro de una línea de letra aparecen como `<span class="inline-chord">` con la misma línea de texto. Visualmente quedan aplastados contra la letra que les sigue, sin suficiente separación vertical.

**Propuesta**: Cambiar la estrategia de presentación:
- Los **acordes inline** (dentro de la misma línea) deben mostrarse **encima** de la sílaba correspondiente usando `position: relative` + un span flotante arriba. Esto es el estándar de todas las apps de acordes (UltimateGuitar, Cifras, etc.).
- Si ese nivel de complejidad es excesivo por ahora, al menos añadir `display: block` a los inline-chords para que sean su propia línea encima del texto, con `margin-bottom: -2px` para mantener la proximidad.

---

### 3. El modal de edición tiene botones B, I, U que no se usan en el formato real
El editor incluye botones de **Negrita (B)**, **Itálica (I)** y **Subrayado (U)** que envuelven texto en `**`, `*` y `__`. Pero el parser `formatLyrics` **no interpreta estos marcadores** — los trata como texto literal de letra. Son botones que no hacen nada visible en la vista de lectura.

**Propuesta**: Eliminar los botones B, I, U del toolbar del editor. El formato real del módulo es acordes entre `[]` y secciones entre `[]` — eso es todo. Simplificar el toolbar a solo:
- `[ ]` — Convertir selección en acorde
- `+ SECCIÓN` — Dropdown de secciones
- `Limpiar (Tx)` — Quitar formato de selección
- `Vista Previa` — Toggle

---

### 4. El acordeón tiene animación de apertura brusca
El acordeón usa `display: none` / `display: block`. No hay transición de altura. En una app premium, esto debe ser `max-height` animado con `overflow: hidden` y `transition: max-height 0.3s ease`.

---

## 🟡 Problemas Secundarios (reducen la coherencia visual)

### 5. El acordeón tiene un fondo y borde propio que lo hace parecer un widget aparte
En el CSS, `.gi-lyrics-accordion` tiene `background: rgba(0,0,0,0.25)`, `box-shadow: inset...`, y `border-radius: 12px`. Visualmente se siente como una tarjeta dentro de una tarjeta, lo que añade capas innecesarias de profundidad.

**Propuesta**: Simplificar el acordeón a **sin fondo propio**. Solo un `border-top: 1px solid var(--border)` y un `padding-top: 12px`. El texto de letra debe respirar sobre el mismo fondo de la tarjeta, sin cajas adicionales.

---

### 6. El toggle de acordes usa un icono de "pentagrama" que no comunica su función intuitivamente
El botón para mostrar/ocultar acordes usa un icono de notas musicales con líneas. No es obvio que activa/desactiva los acordes si no lo has usado antes.

**Propuesta**: Reemplazar el icono por un toggle pill de texto: `Con acordes` / `Solo letra`. Pequeño (10px, uppercase, en la esquina derecha del header). Más claro, más elegante, más alineado con la UI de la app.

---

### 7. El `max-height: 420px` del acordeón es arbitrario y puede cortar canciones largas sin señal clara
Una canción larga simplemente queda cortada visualmente. El usuario podría no notar que hay más contenido debajo.

**Propuesta**: Aumentar a `max-height: 500px` o dejarlo sin límite (usando el scroll del panel setlist que ya existe). Si se mantiene el límite, añadir un gradiente `::after` en el fondo del acordeón cuando hay overflow, indicando que hay más contenido.

---

### 8. El header del modal de edición usa colores hardcoded y estilos inline
El título `EDITAR LETRA Y ACORDES` está en `color:var(--blue)` y construido con estilos inline directamente en el `createElement`. Si el usuario cambia el tema de la app (hay 6 temas disponibles), el modal no reacciona correctamente a todos los tokens CSS.

**Propuesta**: Mover todos los estilos del modal a clases CSS dedicadas en `index.css`. Usar solo `var()` tokens.

---

## 🟢 Lo que sí funciona bien (mantener)

- ✅ El panel lateral deslizante del editor — la animación `slideIn` es elegante y no modal-bloqueante.
- ✅ El dropdown `+ SECCIÓN` que inserta headers correctamente.
- ✅ El sistema de resaltado de sintaxis en tiempo real en el editor (highlight dual con textarea).
- ✅ La detección automática de líneas de acordes vs. líneas de letra (algoritmo inteligente).
- ✅ El auto-colapso de acordeones al abrir uno nuevo.
- ✅ La sincronización de letra entre Librería y Servicio.

---

## Plan de Implementación Sugerido (priorizado)

| # | Cambio | Impacto Visual | Complejidad |
|---|--------|---------------|-------------|
| 1 | Quitar label "LETRA Y ACORDES" del acordeón header | 🔴 Alto | Baja |
| 2 | Eliminar fondo/borde/sombra del acordeón | 🔴 Alto | Baja |
| 3 | Reemplazar toggle icono → pill de texto "Con acordes / Solo letra" | 🟡 Medio | Baja |
| 4 | Animación de apertura del acordeón (`max-height` transition) | 🟡 Medio | Media |
| 5 | Quitar botones B, I, U del toolbar del editor | 🟡 Medio | Baja |
| 6 | Mover estilos inline del modal a clases CSS | 🟢 Bajo | Media |
| 7 | Acordes inline encima de la sílaba (estilo UltimateGuitar) | 🔴 Alto | Alta |

> [!IMPORTANT]
> Los cambios 1–5 son los de mayor ROI. Con ellos solos el módulo pasa de "funcional" a "premium". Los cambios 6–7 son para una segunda iteración.

> [!TIP]
> El cambio #7 (acordes sobre sílabas) requeriría reformatear el parser para generar HTML con posicionamiento CSS. Es el cambio más impactante visualmente pero el más complejo de implementar correctamente. ¿Quieres que lo planifiquemos como una fase separada?
