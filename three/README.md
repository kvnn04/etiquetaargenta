# three/ — Motor 3D (posiciones 3–7)

Este directorio alojará el motor Three.js según `guia_de_tecnologias.md §4`:

- `latheBuilder.ts` — `LatheGeometry` desde el JSON `latheProfiles` (`spec_tipo_de_mate.md`), con `thetaStart` fijado para que el **UV 0° caiga en la costura** (contrato único con rotación y guías).
- `guides.ts` — capas de guías `#4FC3F7 / #FFC84A / #FF7043` con doble contorno (`spec_tecnica_geometrica_...` R5).
- `materials.ts` — tabla PBR única + tinte `virolaColor` (`spec_seleccion_de_color.md` R1).
- `adaptiveBurn.ts` — patch `onBeforeCompile` threshold luminancia 0.55 (R4).
- `overflowScan.ts` — escaneo polar 512² α≥128 ≤25 ms (compartido; `spec_escala_...` R3/R4).
- `makeQuoteCanvas.ts` — compositor 2D ≥2160 px (posición 9).

**Ya implementado (posición 3):** `latheBuilder` y el esqueleto visual viven como
`lathe-builder.ts` (cuerpo + banda, phiStart de la costura) y `visual-skeleton.ts`
(constantes provisionales + `LATHE_SEAM_PHI_START`). El resto llega con su posición.

Dependencias (`three`, `@react-three/fiber`, `@react-three/drei` + `zustand` para el store)
quedan instaladas desde la posición 3.
