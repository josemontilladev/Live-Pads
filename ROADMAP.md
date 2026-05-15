# Estado del Proyecto - LivePads 🎛️

Un software profesional y ligero para la reproducción de pads ambientales y disparadores de batería en vivo, diseñado específicamente para iglesias y presentaciones musicales.

**Repositorio Oficial**: [https://github.com/jmdesign2911/Live-Pads.git](https://github.com/jmdesign2911/Live-Pads.git)

---

## 🚀 Implementado con Éxito

### 🎨 Diseño y UI (Aesthetics & UX)
- **Sistema de Temas Premium**: Implementación de 6 temas completos que afectan fondos, tarjetas, textos e iluminación dinámica (ej. *Midnight Aurora*, *Clean Worship*, *GI.Setlist*, etc.).
- **Compatibilidad Light/Dark**: Adaptación inteligente de textos y contrastes dependiendo de si el tema seleccionado es claro u oscuro.
- **Grilla de Estilo "Bento"**: Layout limpio y ordenado para los 12 tonos de pads y los pads de batería, con sombras adaptativas y transiciones fluidas de 0.5s.
- **Sidebar Dinámico y Resuelto**: Panel lateral para ajustes con sistema anti-bloqueo (corrección de *drag regions* e interacciones de `z-index`).
- **Feedback Visual Avanzado**: Los botones tienen animaciones sutiles y reflejan el color de acento del tema. Además, los pads de batería muestran un punto visual (dot) cuando cargan un sample real exitosamente.

### 🔊 Motor de Audio y Optimización (SynthEngine.js)
- **Precarga Inteligente (Asíncrona y Secuencial)**: Eliminación de picos de CPU y cuelgues al cambiar de banco mediante un cargador secuencial que da respiros de 50ms al procesador.
- **Ataque Dinámico (Smart Attack)**: Si no hay pads sonando, el ataque es casi instantáneo (0.5s); si se está transicionando entre acordes, se aplica un crossfade suave y profesional (2.0s).
- **Samples Reales en Batería y Pads**: Integración de archivos `.wav` y `.mp3` desde carpetas locales (`Foundations Pad`, `Organic Pad`, `Chris Rocha`, y librerías de batería), con fallback transparente a sintetizador en caso de fallo.
- **Limitador Maestro (Anti-Clipping)**: Prevención de distorsión en vivo usando compresión dinámica integrada.

### 🥁 Baterías y Metrónomo
- **Pads Interactivos**: Disparadores visuales con mapeo independiente de volumen y paneo.
- **Metrónomo Completo**: Tap Tempo, compases (2/4, 3/4, 4/4, 6/8), multiplicador `2x`, subdivisión y múltiples sonidos seleccionables (Clásico, Cowbell, Woodblock, etc.).

### ⌨️ Control y Conectividad
- **Atajos de Teclado**: Mapeo completo por defecto para pads y batería.
- **Soporte MIDI Nativo**: Capacidad de conectar un controlador y mapearlo a las funciones de disparo al instante a través de Web MIDI API.

---

## ⏳ Pendiente por Implementar (Siguientes Pasos)

### 📂 1. Gestión de Samples del Usuario
- Construir una interfaz gráfica para que el usuario pueda arrastrar y soltar (`Drag & Drop`) sus propios `.wav` y organizarlos en sus propios presets.

### 🎛️ 2. Mapeo Personalizado de Controles (MIDI/Teclado)
- Panel visual para editar el mapeo nativo: permitir asignar libremente qué tecla física o nota MIDI dispara qué acción o pad específico.

### 📝 3. Gestión Avanzada de Setlist
- Reordenamiento visual de canciones (`Drag & Drop`) dentro del Setlist para preparar el orden exacto del evento o servicio.

### 📦 4. Lanzamiento y Empaquetado
- Solucionar bloqueos de enlaces simbólicos en Electron Builder (Windows).
- Generar el instalador `.exe` (NSIS) final pulido con el ícono y metadatos correctos para distribución general.

---
*Documento actualizado en preparación para el primer commit oficial en GitHub.*
