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
- **Resolución de Rutas Absolutas Inteligente**: Corrección del bug de distorsión de rutas que causaba fallos al reproducir secuencias asociadas con el protocolo nativo `file:///`, permitiendo una carga instantánea y libre de errores desde cualquier módulo.

---

## ⏳ Pendiente por Implementar (Siguientes Pasos)

- 🔍 Pruebas finales de estabilidad y rendimiento en escenarios reales.
- 🎹 Expansión de funciones avanzadas de sincronización de clock en metrónomos externos.

---
*Documento actualizado y sincronizado en preparación para distribución portátil.*
