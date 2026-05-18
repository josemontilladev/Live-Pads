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

---

  - **Empaquetado y Compilación Nativa (`.exe`)**: Creación exitosa del instalador autónomo autoejecutable `LivePads Setup 1.0.0.exe` de 64 bits utilizando `electron-builder`. Incluye todos los recursos locales integrados, configuraciones personalizadas de instalación de NSIS, el nuevo sistema interactivo de acordeón de letras y soporte de empaquetado optimizado para distribución.

---

## ⏳ Pendiente por Implementar (Siguientes Pasos)

- 🎹 Realizar pruebas finales de estabilidad y rendimiento en escenarios de presentación en vivo (iglesias/eventos).

---
*Documento actualizado y sincronizado en preparación para distribución portátil.*
