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

import { BufferGeometry, Float32BufferAttribute, LatheGeometry, Vector2 } from 'three';
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
 * 1. CORONA SUPERIOR ANULAR PLANA (spec_tecnica_geometrica §3-R1 / prototipo v1):
 * Disco plano horizontal en el plano X-Z entre R_int y R_ext.
 * ÚNICA superficie receptora de diseño vectorial (grabado) y de guías de simetría.
 * Normales orientadas hacia +Y (arriba). Mapeo UV polar centrado en (0.5, 0.5)
 * anclado a LATHE_SEAM_PHI_START.
 */
export function buildVirolaTopGeometry(
  intDiameterMm: number,
  extDiameterMm: number,
  radialSegments = 128,
): BufferGeometry {
  const rOut = extDiameterMm / 2;
  const rIn = intDiameterMm / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= radialSegments; i++) {
    const phi = LATHE_SEAM_PHI_START + (i / radialSegments) * Math.PI * 2;
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);

    const outerX = rOut * sin;
    const outerZ = rOut * cos;
    const innerX = rIn * sin;
    const innerZ = rIn * cos;

    // Vértice exterior (índice 2*i)
    positions.push(outerX, 0, outerZ);
    normals.push(0, 1, 0);
    uvs.push(outerX / (rOut * 2) + 0.5, outerZ / (rOut * 2) + 0.5);

    // Vértice interior (índice 2*i + 1)
    positions.push(innerX, 0, innerZ);
    normals.push(0, 1, 0);
    uvs.push(innerX / (rOut * 2) + 0.5, innerZ / (rOut * 2) + 0.5);
  }

  for (let i = 0; i < radialSegments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    // Winding counter-clockwise visto desde arriba (+Y)
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * 2. FALDÓN EXTERIOR (spec_tecnica_geometrica §3-R1 / prototipo v1):
 * Pared de caída cilíndrica/cónica que desciende desde R_ext cubriendo
 * el labio anti-fuga del cuerpo del mate (sin grabado ni guías).
 */
export function buildVirolaOuterWallGeometry(
  extDiameterMm: number,
  topY: number,
  bottomY: number,
  segments = LATHE_SEGMENTS,
): LatheGeometry {
  const rOut = extDiameterMm / 2;
  const profile = [
    new Vector2(rOut * 0.985, bottomY),
    new Vector2(rOut, topY),
  ];
  return new LatheGeometry(profile, segments, LATHE_SEAM_PHI_START);
}

/**
 * 3. PARED INTERIOR / BOCA (spec_tecnica_geometrica §3-R1 / prototipo v1):
 * Pared cilíndrica que desciende desde R_int hacia el interior del mate
 * (sin grabado ni guías).
 */
export function buildVirolaInnerWallGeometry(
  intDiameterMm: number,
  topY: number,
  bottomY: number,
  segments = LATHE_SEGMENTS,
): LatheGeometry {
  const rIn = intDiameterMm / 2;
  const profile = [
    new Vector2(rIn, bottomY),
    new Vector2(rIn, topY),
  ];
  return new LatheGeometry(profile, segments, LATHE_SEAM_PHI_START);
}

/**
 * @deprecated Posición 4: Reemplazada por la anatomía de 3 mallas (buildVirolaTopGeometry,
 * buildVirolaOuterWallGeometry, buildVirolaInnerWallGeometry). Se conserva por compatibilidad.
 */
export function buildVirolaGeometry(
  intDiameterMm: number,
  extDiameterMm: number,
  bandHeightMm: number,
  fitGapMm = 0.15,
): LatheGeometry {
  const rIn = intDiameterMm / 2 + fitGapMm;
  const rOut = Math.max(extDiameterMm / 2, rIn + BODY_WALL_MM);
  const cross = [
    new Vector2(rIn, 0),
    new Vector2(rOut, 0),
    new Vector2(rOut, bandHeightMm),
    new Vector2(rIn, bandHeightMm),
  ];
  return new LatheGeometry(cross, LATHE_SEGMENTS, LATHE_SEAM_PHI_START);
}
