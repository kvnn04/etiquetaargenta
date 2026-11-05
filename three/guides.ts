/* ============================================================================
 * GUIAS DE SIMETRÍA — ÚNICA FUENTE: spec_tecnica_geometrica §3-R4/R5
 * ----------------------------------------------------------------------------
 * Capa vectorial sobre la corona superior plana (horizontal en plano X-Z):
 * cada trazo se genera a partir del MISMO ancla UV que define 0° = costura
 * (LATHE_SEAM_PHI_START, contrato de three/README). Así giran con la virola
 * al orbitar (independientes de la cámara), permanecen fijas mientras el
 * diseño rota por debajo (pos 6) y la cámara nunca las desplaza de su
 * posición relativa al producto.
 *
 * R5 — tabla canónica de guías coplanares sobre la corona superior:
 *   Bordes de Chapa            punteado 4-3  #4FC3F7 (2 círculos: R_int y R_ext)
 *   Línea Central de Posición  punteado 6-4  #FFC84A (1 círculo: R_centro)
 *   Ejes Simétricos 12h/6h     trazo fino + ticks  #FF7043 (2 radios de R_int a R_ext)
 *   …todas con DOBLE TRAZO (contorno translúcido oscuro debajo) para
 *   legibilidad sobre cualquier acabado — incluida una virola #1A1A1A.
 *
 * Coplanaridad (pos 4 · spec actualizada): las curvas se dibujan sobre la
 * CORONA SUPERIOR PLANA (plano X-Z con offset Y = Y_top + ε) entre los radios
 * D_int/2 y D_ext/2. Los faldones y paredes laterales NO llevan guías.
 *
 * R5 (desborde): el flash rojo de 500 ms de la spec de escala (pos 7) PREVALECE
 * sobre estos colores mientras dure el estado — el motor de desborde montará
 * su overlay encima de esta capa.
 * ============================================================================ */

import { Vector3 } from 'three';
import { GUIDE_COLORS, type GuideKey } from '@/lib/virola';
import { LATHE_SEAM_PHI_START } from './visual-skeleton';

/** R5: colores de guías — tabla canónica definida en lib/virola.ts. */
export { GUIDE_COLORS };
export type { GuideKey };

/** R5: patrones de punteado en mm (= unidades de escena): 4-3 y 6-4. */
export const BORDES_DASH_MM = { dashSize: 4, gapSize: 3 } as const;
export const CENTRO_DASH_MM = { dashSize: 6, gapSize: 4 } as const;

/** R5/QA3: doble trazo — contorno oscuro translúcido bajo la línea de color. */
export const GUIDE_BACK_STROKE = { widthPx: 5, color: '#000000', opacity: 0.5 } as const;
export const GUIDE_FRONT_STROKE = { widthPx: 1.7 } as const;
/** Trazo fino de los ejes, un poco más austero que el punteado. */
export const GUIDE_AXIS_STROKE = { widthPx: 1.25 } as const;

/** Elevación ε sobre la corona superior para evitar z-fighting con el metal (mm). */
export const GUIDE_SURFACE_OFFSET_MM = 0.2;
/** Largo de cada tick transversal de los ejes (mm). */
export const GUIDE_TICK_LENGTH_MM = 1.6;

/** Contrato de anclaje: ángulo mundo (rad) de un ángulo UV — 0° UV = costura. */
export function uvToWorldPhi(uvRad = 0): number {
  return LATHE_SEAM_PHI_START + uvRad;
}

/**
 * Círculo guía coplanar sobre la corona superior (radio y cota Y en mm). El primer
 * punto ES el origen UV (costura) — misma fase para todos los trazos.
 */
export function guideCirclePoints(radiusMm: number, yMm: number, segments = 128): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const phi = uvToWorldPhi((i / segments) * Math.PI * 2);
    pts.push(new Vector3(Math.sin(phi) * radiusMm, yMm, Math.cos(phi) * radiusMm));
  }
  return pts;
}

/**
 * Eje radial sobre la corona superior plana (de radio interior a exterior) a la cota Y.
 * `uvRad = 0` cae sobre la costura (12h, dorso); el opuesto (π) es el frente (6h).
 * Juntos dividen el carril anular en 7 IZQ / 7 DER (R4).
 */
export function guideRadialAxisPoints(
  rInnerMm: number,
  rOuterMm: number,
  yMm: number,
  uvRad = 0,
): [Vector3, Vector3] {
  const phi = uvToWorldPhi(uvRad);
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  return [
    new Vector3(sin * rInnerMm, yMm, cos * rInnerMm),
    new Vector3(sin * rOuterMm, yMm, cos * rOuterMm),
  ];
}

/**
 * Ticks del eje radial (R5: "trazo fino + ticks"): segmentos cortos transversales
 * coplanares sobre la corona superior, repartidos a lo largo del ancho del carril.
 * Pares [inicio, fin] (para drei <Line segments>).
 */
export function guideRadialAxisTicks(
  rInnerMm: number,
  rOuterMm: number,
  yMm: number,
  uvRad = 0,
  tickCount = 5,
  tickLengthMm = GUIDE_TICK_LENGTH_MM,
): Vector3[] {
  const phi = uvToWorldPhi(uvRad);
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  // Vector transversal ortogonal en el plano X-Z
  const tanX = cos * (tickLengthMm / 2);
  const tanZ = -sin * (tickLengthMm / 2);

  const pts: Vector3[] = [];
  for (let i = 1; i <= tickCount; i++) {
    const r = rInnerMm + ((rOuterMm - rInnerMm) * i) / (tickCount + 1);
    const cx = sin * r;
    const cz = cos * r;
    pts.push(new Vector3(cx - tanX, yMm, cz - tanZ));
    pts.push(new Vector3(cx + tanX, yMm, cz + tanZ));
  }
  return pts;
}

/** Retrocompatibilidad de imports */
export const guideAxisPoints = guideRadialAxisPoints;
export const guideAxisTicks = guideRadialAxisTicks;
