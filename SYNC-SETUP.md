# Sincronización entre PCs vía OneDrive — LivePads

Guía para trabajar la **misma librería** (canciones + audios) desde dos (o más)
computadoras, sin re-subir nada. Todo vive en una sola carpeta de OneDrive y se
sincroniza solo.

> Disponible desde **v1.0.32**.

---

## Cómo funciona (en 30 segundos)

Una sola carpeta de OneDrive (`LivePads-Audios`) contiene **toda** la librería:

```
LivePads-Audios/
├── Datos/
│   └── canciones_app.json     ← la base de datos (qué canción usa qué audio)
├── Sequences/                 ← audios de secuencia
└── Original Tracks/           ← audios originales
```

OneDrive sincroniza esa carpeta entre las máquinas. La app, en cada PC, apunta a
ella. Como la **referencia** (canción → audio) y el **archivo** viajan juntos,
lo que subís en una PC aparece en la otra.

Detalles que lo hacen robusto:

- **La preferencia de carpeta es por máquina** (no se sincroniza): hay que
  configurarla en **cada** PC. Esto es a propósito — cada equipo puede tener la
  carpeta en una ruta distinta.
- **Nombres por contenido** (`intro__a3f9c2d1.mp3`): subir audios desde ambas
  PCs nunca se pisa; el mismo archivo se deduplica solo.
- **Validación al arranque**: si la carpeta no está disponible (OneDrive no
  sincronizó aún), la app avisa en rojo y usa la carpeta interna como respaldo,
  en vez de parecer que "se perdieron" los audios.
- **Conflictos**: si editás en las dos PCs estando offline, OneDrive crea copias
  en conflicto; la app las **detecta y ofrece fusionarlas sin perder datos**.

---

## Preparación (una vez, en AMBAS PCs)

1. **Misma cuenta de OneDrive** en las dos PCs (la que tiene `LivePads-Audios`).
   Sin esto, la carpeta no sincroniza entre máquinas.
2. **Instalá v1.0.32 o superior** en ambas. (El auto-update mantiene al día; solo
   asegurate de que ninguna quede por debajo de 1.0.32.)

---

## En la SEGUNDA PC (primera configuración)

1. **Esperá a que OneDrive sincronice** la carpeta `LivePads-Audios` completa.
   En el Explorador, entrá a
   `C:\Users\<tu-usuario>\OneDrive\LivePads-Audios` y confirmá que ves
   `Datos\`, `Sequences\`, `Original Tracks\` con **✓ verdes** (no nubes ☁️).

2. **Clic derecho en `LivePads-Audios` → "Conservar siempre en este
   dispositivo".**
   ⚠️ **Paso clave:** hace que OneDrive **descargue los audios de verdad** en
   lugar de dejar "placeholders" en la nube (que darían audio mudo). Esperá a
   que terminen de bajar.

3. **Abrí LivePads.**

4. **Ajustes (⚙️) → Biblioteca de audios → "Cambiar carpeta…"** y seleccioná esa
   misma carpeta `…\OneDrive\LivePads-Audios`.
   - Si pregunta por migrar audios existentes, podés decir **no** (ya están ahí).

5. **Reiniciá la app.** Al arrancar debe **cargar tu librería completa** desde
   `Datos\canciones_app.json`.

---

## Verificar que funciona

- En la 2da PC, abrí una canción que tenga audio asignado en la 1ra → **debe
  reproducir**.
- **Prueba de ida y vuelta:** subí un audio nuevo a una canción en la PC-A →
  esperá los ✓ verdes en OneDrive → en la PC-B **cerrá y reabrí la app** → la
  canción debe aparecer con su audio.

---

## Flujo de trabajo diario

**Regla de oro: una PC a la vez, y dejá que OneDrive sincronice antes de
cambiar de máquina.**

- Antes de cerrar en una PC: confirmá que OneDrive tenga ✓ verdes (terminó de
  subir).
- No edites la librería en las dos PCs al mismo tiempo si alguna está offline.
- Si igual pasa: al abrir, la app te ofrece **"Fusionar copias en conflicto"** —
  une las canciones y rellena los audios faltantes sin perder nada (las copias
  se archivan en `Datos\_conflictos_resueltos\`).

---

## Si algo sale raro

| Síntoma | Qué hacer |
|---|---|
| Banner rojo **"Carpeta configurada no disponible — usando la interna"** | OneDrive aún no montó la carpeta en esa PC. Esperá la sync, o reconfigurá la ruta en Ajustes → Biblioteca de audios. |
| Una canción no suena / "audio en la nube" | Ajustes → Biblioteca de audios → **"Revisar audios…"**: detecta placeholders sin bajar y referencias rotas. |
| Audios que no quedaron vinculados a su canción | **"Revisar audios…" → Reparar**: vincula los huérfanos a su canción por nombre y limpia las referencias rotas. |
| Audio "en la nube" que no baja | Clic derecho en la carpeta/archivo → **"Conservar siempre en este dispositivo"**. |

---

## Resumen

> En la 2da PC: esperá la sync de OneDrive → "Conservar siempre en este
> dispositivo" → en la app apuntá la Biblioteca a la misma carpeta → reiniciá →
> listo. Después, una PC a la vez y dejá que sincronice antes de cambiar.
