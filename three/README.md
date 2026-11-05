# three/ — Motor 3D (posiciones 3–7)

Este directorio alojará el motor Three.js según `guia_de_tecnologias.md §4`:

- `latheBuilder.ts` — `LatheGeometry` desde el JSON `latheProfiles` (`spec_tipo_de_mate.md`), con `thetaStart` fijado para que el **UV 0° caiga en la costura** (contrato único con rotación y guías).
- `guides.ts` — capas de guías `#4FC3F7 / #FFC84A / #FF7043` con doble contorno (`spec_tecnica_geometrica_...` R5).
- `materials.ts` — tabla PBR única + tinte `virolaColor` (`spec_seleccion_de_color.md` R1).
- `adaptiveBurn.ts` — patch `onBeforeCompile` threshold luminancia 0.55 (R4).
- `overflowScan.ts` — escaneo polar 512² α≥128 ≤25 ms (compartido; `spec_escala_...` R3/R4) — **absorbido por `lib/overflow.ts` en la pos 7**.
- `makeQuoteCanvas.ts` — compositor 2D ≥2160 px (posición 9).

**Ya implementado (posiciones 3, 4 y 5):**
- `lathe-builder.ts`:
  - Geometría del cuerpo desde catálogo (`buildBodyGeometry`).
  - Virola formal en 3 mallas: `buildVirolaTopGeometry` (corona superior anular plana para grabado/guías, normales +Y, mapeo UV polar), `buildVirolaOuterWallGeometry` (faldón exterior liso que cubre labio anti-fuga) y `buildVirolaInnerWallGeometry` (pared interior de la boca).
- `guides.ts`: capas de guías de simetría coplanares sobre la corona superior (`#4FC3F7` bordes chapa, `#FFC84A` línea central, `#FF7043` ejes radiales 12h/6h con ticks), con doble trazo (contorno oscuro translúcido debajo).
- `visual-skeleton.ts`: constantes visuales y contrato único `LATHE_SEAM_PHI_START = Math.PI`.

**Resuelto por la posición 5 (nota de alcance):** los módulos `materials.ts` / `adaptiveBurn.ts`
planeados acá quedaron absorbidos por **`lib/color.ts`** (tabla PBR + `adaptiveLaserBurn()` con
threshold L 0.55, testeada): la escena consume `resolveVirolaPbr` / `resolveBodyPbr` en un solo
material memoizado y no hizo falta un módulo three/ extra. El **tono de quemado** se dibuja sobre la
capa de grabado que llega con la posición 6 (corona superior, UV polar).

**Ya implementado (posición 6):** la capa de grabado vive en `components/studio/studio-scene.tsx`
(`DesignEngravingLayer` + `composeEngravingCanvas`) — CanvasTexture **viva 1024²** sobre la MISMA
geometría cacheada de `buildVirolaTopGeometry` (comparte buffers; el ángulo jamás reconstruye la
virola): máscara anular `destination-in` entre R_int y R_ext, tinte único con el tono de quemado de
pos 5, `rotate(+θ)` canvas ≡ `rotateY(+θ)` mundo (presets 0° Frente / 90° Der / 180° Dorso / 270°
Izq). La lógica angular pura está en **`lib/design.ts`** (testada).

**Ya implementado (posición 7):** el motor de desborde quedó FUERA del motor 3D, absorbido por
**`lib/overflow.ts`** (como los materiales en la pos 5): escaneo polar de la envolvente de tinta
(máscara alfa 512², α ≥ 128, R4 — ≤ 25 ms) y evaluación O(1) por escala/D_ext/D_int/carga de
diseño, jamás por ángulo/espejo (invariancia polar R3). El compositor completó el pipeline
canónico **ESCALA → ESPEJO → ROTACIÓN** al mismo pivote con la **base congelada** al cargar el
asset (R1: `baseSideMm`, dibujo FULL-canvas — el fit provisional de inscripción de pos 6 era el
bug del "SVG invisible"). La **alerta visual** es un overlay de guías (`PulseGuideLine`): los
bordes de chapa afectados pulsan en `#FF3B30` (nota anotada) a 500 ms mientras dura el estado.

Dependencias (`three`, `@react-three/fiber`, `@react-three/drei` + `zustand` para el store)
quedan instaladas desde la posición 3.
