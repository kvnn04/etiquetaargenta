/* ============================================================================
 * LATHE BUILDER — spec_tipo_de_mate.md §3 (R2/R4/R5) + contrato de costura UV
 * (three/README.md): la lathe se genera con phiStart fijado para que el UV 0°
 * caiga en LA COSTURA (ancla común de guías y rotación del diseño — pos 4–6).
 * ---------------------------------------------------------------------------- *
 * Mapeo R2: radius = x · (D_int / 2). El catálogo mide altura desde la
 * costura de la boca (y=0) hasta el centro de la base (y=totalHeightMm);
 * en el mundo 3D la base se apoya en Y=0 y la costura queda arriba.
 *
 * R4 ANTI-FUGA: el cuerpo termina en un labio que sube `sealOverlapMm` por
 * ENCIMA de la costura; la banda metálica (virola del esqueleto visual)
 * cubre ese labio ⇒ nunca hay ranura visible entre metal y cuerpo para
 * D_int ∈ [50, 150] mm (cotas de la spec geométrica R1).
 *
 * R3: el swap de producto reconstruye SOLO esta geometría. La virola y los
 * materiales viven en módulos aparte y no se tocan acá (aislamiento).
 * ============================================================================ */

import { LatheGeometry, Vector2 } from 'three';
import type { MateProduct, MateShape } from '@/lib/catalog';
import {
  BODY_WALL_MM,
  LATHE_SEAM_PHI_START,
  LATHE_SEGMENTS,
} from './visual-skeleton';

/**
 * Polilínea del perfil en coordenadas de mundo (mm): centro base → pared
 * exterior → labio R4. La VirolaMesh y la cámara encuadran a partir de acá.
 */
export function bodyLatheProfile(shape: MateShape, intDiameterMm: number): Vector2[] {
  const r = intDiameterMm / 2;
  const h = shape.totalHeightMm;
  const seal = shape.sealOverlapMm;

  const pts: Vector2[] = [];

  // 1) centro de la base (la superficie de torno genera desde el eje)
  pts.push(new Vector2(0, 0));

  // 2) pared exterior: catálogo boca→base invertido; en mundo Y sube.
  //    (ojo: el primer punto del catálogo con y=0 se salta — el labio de paso 3
  //    lo cubre con el mismo radio).
  const outline = shape.points;
  for (let i = outline.length - 1; i >= 1; i--) {
    const p = outline[i]!;
    pts.push(new Vector2(Math.max(0, p.x) * r, h - p.y));
  }

  // 3) labio anti-fuga (R4): mismo radio que la boca, sube `seal` mm por sobre
  //    la costura — queda oculto dentro de la virola.
  pts.push(new Vector2(r, h + seal));

  return pts;
}

/**
 * Geometría del CUERPO (pos 3). `intDiameterMm` es la D_int vigente: al
 * cambiar en la posición 4 el re-anclaje sale de acá mismo (R4 geométrica).
 */
export function buildBodyGeometry(product: MateProduct, intDiameterMm: number): LatheGeometry {
  const profile = bodyLatheProfile(product.shape, intDiameterMm);
  return new LatheGeometry(profile, LATHE_SEGMENTS, LATHE_SEAM_PHI_START);
}

/**
 * Banda metálica (esqueleto visual de la virola, pos 3): sección rectangular
 * cerrada girada 360°. La posición 4 la reemplaza por su implementación con
 * métricas y guías; misma cola de constantes y mismo phiStart.
 */
export function buildVirolaGeometry(
  intDiameterMm: number,
  extDiameterMm: number,
  bandHeightMm: number,
  fitGapMm = 0.15,
): LatheGeometry {
  const rIn = intDiameterMm / 2 + fitGapMm; // holgura mínima: evita z-fighting
  const rOut = Math.max(extDiameterMm / 2, rIn + BODY_WALL_MM);
  const cross = [
    new Vector2(rIn, 0),
    new Vector2(rOut, 0),
    new Vector2(rOut, bandHeightMm),
    new Vector2(rIn, bandHeightMm),
  ];
  return new LatheGeometry(cross, LATHE_SEGMENTS, LATHE_SEAM_PHI_START);
}
