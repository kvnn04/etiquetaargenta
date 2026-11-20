/* ============================================================================
 * ENCUADRE DE PRODUCTO — una sola fórmula para editor, visor y ficha.
 * ----------------------------------------------------------------------------
 * La cámara mira al centro visual del mate (no a la base): `CAMERA_TARGET_Y_MM`
 * queda entre los centros de las siluetas del catálogo. La distancia se calcula
 * con la esfera envolvente del producto y el MENOR de los dos campos de visión
 * (vertical/horizontal según el aspecto real del lienzo). Así el mate entra
 * completo tanto en el panel ancho del editor como en una ficha vertical.
 * ============================================================================ */

import type { MateProduct } from '@/lib/catalog';

export const CAMERA_FOV_DEG = 34;

/** Centro visual del producto (mm sobre la base). */
export const CAMERA_TARGET_Y_MM = 63;

/** Aire alrededor de la esfera envolvente (6 %). */
export const CAMERA_FIT_MARGIN = 1.06;

/**
 * Dirección de cámara por defecto, relativa al punto de mira: casi de frente
 * (≈13° de altura) para leer la silueta y, a la vez, ver la corona grabada.
 */
export const CAMERA_OFFSET_MM: readonly [number, number, number] = [0, 40, 260];

export interface ProductFramingMm {
  /** Radio máximo real del conjunto cuerpo + virola. */
  maxRadiusMm: number;
  /** Altura de la boca (el labio R4 incluido). */
  heightTopMm: number;
  /** Radio de la esfera que contiene al producto respecto del punto de mira. */
  sphereRadiusMm: number;
}

export function productFramingMm(
  product: MateProduct,
  intDiameterMm: number,
  extDiameterMm: number,
): ProductFramingMm {
  const maxRadiusMm = Math.max(
    extDiameterMm / 2, // la virola crece sólo hacia fuera (R1: Dext ≥ Dint+8)
    ...product.shape.points.map((p) => Math.max(0, p.x) * (intDiameterMm / 2)),
  );
  const heightTopMm = product.shape.totalHeightMm + product.shape.sealOverlapMm;
  // Se mide contra el punto de mira para cubrir también el pequeño desfase
  // entre el centro geométrico del producto y el centro visual de cámara.
  const halfSpanY = Math.max(heightTopMm - CAMERA_TARGET_Y_MM, CAMERA_TARGET_Y_MM);
  return {
    maxRadiusMm,
    heightTopMm,
    sphereRadiusMm: Math.hypot(maxRadiusMm, halfSpanY),
  };
}

/**
 * Distancia de cámara al punto de mira para que la esfera envolvente entre
 * completa en el frustum. `aspect` = ancho / alto del lienzo.
 */
export function fitCameraDistanceMm(
  sphereRadiusMm: number,
  aspect: number,
  fovDeg = CAMERA_FOV_DEG,
  margin = CAMERA_FIT_MARGIN,
): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.05));
  const halfFov = Math.min(vFov, hFov) / 2;
  return (sphereRadiusMm * margin) / Math.sin(halfFov);
}
