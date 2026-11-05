# three/ — Motor 3D (posiciones 3–7)

Este directorio alojará el motor Three.js según `guia_de_tecnologias.md §4`:

- `latheBuilder.ts` — `LatheGeometry` desde el JSON `latheProfiles` (`spec_tipo_de_mate.md`), con `thetaStart` fijado para que el **UV 0° caiga en la costura** (contrato único con rotación y guías).
- `guides.ts` — capas de guías `#4FC3F7 / #FFC84A / #FF7043` con doble contorno (`spec_tecnica_geometrica_...` R5).
- `materials.ts` — tabla PBR única + tinte `virolaColor` (`spec_seleccion_de_color.md` R1).
- `adaptiveBurn.ts` — patch `onBeforeCompile` threshold luminancia 0.55 (R4).
- `overflowScan.ts` — escaneo polar 512² α≥128 ≤25 ms (compartido; `spec_escala_...` R3/R4).
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

Dependencias (`three`, `@react-three/fiber`, `@react-three/drei` + `zustand` para el store)
quedan instaladas desde la posición 3.
