# Estado del Proyecto - LivePads 🎛️

Un software profesional y ligero para la reproducción de pads ambientales y disparadores de batería en vivo, diseñado específicamente para iglesias y presentaciones musicales.

**Repositorio Oficial**: [https://github.com/josemontilladev/Live-Pads.git](https://github.com/josemontilladev/Live-Pads.git)

---

## 🚀 Implementado con Éxito

### 🎨 Diseño y UI (Aesthetics & UX)
- **Grilla de Estilo "Bento" Premium**: Layout limpio y ordenado para los 12 tonos de pads y batería. Los módulos superiores (Bancos y Metrónomo) ahora están integrados en una grilla de 2 columnas con bordes redondeados y estilo unificado.
- **Modernización de Controles**: Reemplazo de botones y flechas por selectores dinámicos (`dropdowns`) para bancos de sonidos, compases y notación, logrando una interfaz más profesional y uniforme.
- **Sistema de Temas Dinámico**: Implementación de 6 temas completos que afectan fondos, tarjetas y textos, con adaptación inteligente de contrastes.
- **Feedback Visual Avanzado**: Los botones tienen animaciones sutiles y los pads de batería muestran un indicador visual (dot) cuando el sample real está cargado.
- **Optimización de Espacio**: Limpieza de la bandeja de ajustes del pad (volumen/pan), moviendo controles avanzados (filtro LPF) exclusivamente al sidebar para reducir la carga cognitiva.

### 🔊 Motor de Audio y Optimización (SynthEngine.js)
- **Librería Chris Rocha por Defecto**: Configuración del banco de pads de Chris Rocha como sonido base al iniciar la app.
- **Precarga Inteligente**: Eliminación de picos de CPU mediante carga secuencial de samples.
- **Ataque Dinámico (Smart Attack)**: Crossfades suaves de 2.0s para transiciones entre acordes y ataque instantáneo para el inicio de sesión.
- **Limitador Maestro**: Compresión integrada para evitar distorsión en vivo.

### 🥁 Baterías y Metrónomo (Top Module)
- **Metrónomo en Cabecera**: Reubicado en la parte superior para máxima visibilidad durante la ejecución. 
- **Acentuación Manual por Tiempo**: Nueva funcionalidad interactiva que permite hacer clic en cualquier "beat dot" para activar/desactivar el acento en ese tiempo específico.
- **Control Completo**: Tap Tempo, multiplicador `2x`, subdivisión y múltiples sonidos seleccionables via dropdown.

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

### 📦 Lanzamiento y Empaquetado
- **Generación de Ejecutables (.exe)**: Construcción exitosa del instalador NSIS para Windows usando `electron-builder`.
- **Resolución de Íconos**: Dimensionamiento y conversión automática (256x256) de los íconos de la aplicación y el instalador, resolviendo los errores del empaquetador.

### 🎵 Reproductor de Pistas y Secuencias
- **Archivos Locales Robustos**: Sistema nativo de IPC (`fs`) que copia automáticamente los archivos originales y secuencias del usuario a `src/assets/`, manteniendo la persistencia a prueba de errores.
- **Rutas a Prueba de Fallos**: Construcción dinámica de URIs (`file:///`) para evitar fallos por espacios o caracteres especiales en Windows.
- **Modo Loop**: Botón de repetición infinita para secuencias.
- **Feedback Visual Inteligente**: Los botones de Setlist se iluminan automáticamente cuando detectan que la canción ya tiene un audio vinculado.

---

## ⏳ Pendiente por Implementar (Siguientes Pasos)

### 🎛️ 1. Mapeo Personalizado de Controles (MIDI/Teclado)
**Fase 1: Integración del Motor MIDI (Web MIDI API)**
- Conectar la aplicación con los puertos USB de la PC para detectar controladores físicos.
- Lectura en tiempo real de señales `Note On`, `Note Off` y `Control Change`.

**Fase 2: Modo "MIDI Learn" (Mapeo Interactivo visual)**
- Botón global para entrar en "Modo Edición/Mapeo".
- Flujo click-to-map: Clic en el botón de la app -> Presionar tecla en el controlador -> Enlace creado.

**Fase 3: Persistencia y Atajos QWERTY**
- Mapeo nativo del teclado de la laptop (ej. números para pads, espacio para play/stop) como fallback.
- Guardar el diccionario de mapeo en disco (`JSON`) para que sobreviva a los reinicios.

### 📂 2. Gestión de Samples del Usuario (¡COMPLETADO!)
- ✅ Interfaz gráfica de edición con un clic en los pads para buscar y asignar sonidos `.wav` personalizados.
- ✅ Persistencia automática en `UserDrums` a través del `SynthEngine` y `main.js`.

---
*Documento actualizado en preparación para el mapeo MIDI avanzado.*
