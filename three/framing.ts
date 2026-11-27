/* ============================================================================
 * ENCUADRE DE PRODUCTO — una sola fórmula de distancia para editor, visor y
 * ficha; cada vista elige su dirección y su punto de mira.
 * ----------------------------------------------------------------------------
 * · Editor/visor: cámara 3/4 casi de frente mirando al centro visual del mate
 *   (`CAMERA_TARGET_Y_MM`), para leer la silueta completa.
 * · Ficha/Foto HD: cámara cenital (≈15°) mirando la corona, donde vive el
 *   grabado; el cuerpo queda como referencia inferior.
 * La distancia se calcula con el radio del sujeto y el MENOR de los dos campos
 * de visión (vertical/horizontal según el aspecto real del lienzo). Así el
 * producto entra completo tanto en el panel ancho del editor como en la ficha.
 * ============================================================================ */

import type { MateProduct, ThermoSpec } from '@/lib/catalog';
import { THERMO_MM_PER_UNIT } from '@/lib/catalog';

export const CAMERA_FOV_DEG = 34;

/** Centro visual del producto (mm sobre la base). */
export const CAMERA_TARGET_Y_MM = 63;

/** Aire alrededor de la esfera envolvente (6 %). */
export const CAMERA_FIT_MARGIN = 1.06;

/**
 * Dirección de cámara por defecto del EDITOR/VISOR, relativa al punto de mira:
 * casi de frente (≈13° de altura) para leer la silueta del mate.
 */
export const CAMERA_OFFSET_MM: readonly [number, number, number] = [0, 40, 260];

/**
 * Dirección de la FICHA TÉCNICA / FOTO HD: vista cenital con ≈15° de
 * inclinación. El grabado vive en la corona (anillo de la virola); desde el
 * frente quedaba de canto e invisible. El editor y el visor conservan su
 * cámara 3/4 interactiva.
 */
export const TOP_VIEW_OFFSET_MM: readonly [number, number, number] = [0, 300, 80];

/**
 * Aire de la vista cenital: la corona es el sujeto y el cuerpo se proyecta
 * hacia abajo por la inclinación; 12 % evita que el borde toque el marco.
 */
export const TOP_VIEW_FIT_MARGIN = 1.12;

/**
 * Aire de la VISTA DE GRABADO del editor: encuadra el anillo de la corona
 * (no el producto completo) con la misma inclinación cenital de la ficha, para
 * leer el trazado de canto sin perder la referencia del cuerpo.
 */
export const ENGRAVING_VIEW_FIT_MARGIN = 1.18;

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
 * Encuadre del TERMO: sujeto vertical (alto total) con la manija sobresaliendo
 * del radio del cuerpo. Devuelve el centro y el radio de la esfera envolvente
 * respecto del punto de mira (centro del producto), listo para
 * `fitCameraDistanceMm`.
 */
export function thermoFramingMm(spec: ThermoSpec): {
  centerYMm: number;
  maxRadiusMm: number;
  sphereRadiusMm: number;
} {
  const centerYMm = spec.totalHeightMm / 2;
  const maxRadiusMm = Math.max(
    spec.radiusMm + 0.55 * THERMO_MM_PER_UNIT, // manija en -X
    spec.radiusMm,
  );
  const halfSpanY = spec.totalHeightMm / 2;
  return {
    centerYMm,
    maxRadiusMm,
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

/**
 * Pose de la VISTA DE GRABADO del editor: cámara cenital (misma dirección que
 * la ficha) apuntando a la corona y encuadrando el anillo R_int → R_ext. El
 * cuerpo queda como referencia inferior; el trazado deja de verse de canto.
 *
 * Devuelve el punto de mira y la posición ABSOLUTA de cámara en mm (mundo:
 * base en Y=0), lista para animar desde/hacia la vista de producto.
 */
export function engravingViewPoseMm(
  product: MateProduct,
  extDiameterMm: number,
  aspect: number,
  fovDeg = CAMERA_FOV_DEG,
): { target: [number, number, number]; position: [number, number, number]; distance: number } {
  const targetY = product.shape.totalHeightMm + product.shape.sealOverlapMm;
  const distance = fitCameraDistanceMm(
    extDiameterMm / 2,
    aspect,
    fovDeg,
    ENGRAVING_VIEW_FIT_MARGIN,
  );
  const [ox, oy, oz] = TOP_VIEW_OFFSET_MM;
  const len = Math.hypot(ox, oy, oz) || 1;
  return {
    target: [0, targetY, 0],
    position: [(ox / len) * distance, targetY + (oy / len) * distance, (oz / len) * distance],
    distance,
  };
}
