/* ============================================================================
 * CATÁLOGO DE PRODUCTOS — ÚNICA FUENTE: spec_tipo_de_mate.md §3-R1
 * ----------------------------------------------------------------------------
 * Registro Central de Productos: toda silueta proviene de acá. El motor NO
 * contiene ramas codificadas a mano por modelo (R1): agregar un producto
 * futuro exige únicamente una entrada nueva en este array.
 *
 * Coordenadas (R2): x = radio relativo a la boca (x=1.00 ⇒ R_boca = D_int/2),
 *                    y = altura absoluta en mm desde la costura de la boca
 *                        (y=0) hasta el centro de la base (y=totalHeightMm).
 * Son "coordenadas de referencia" ajustables por diseño comercial.
 *
 * El FALLBACK de producto desconocido es `camionero` (R8) — resolví acá.
 * ============================================================================ */

export const CATALOG_VERSION = 1;

/** Ids del catálogo (futuros: cualquier string nuevo que se agregue a R1). */
export type MateModelId = string;

export interface MateShapePoint {
  /** Radio relativo a la boca: 1.00 = R_boca = D_int / 2 (R2). */
  x: number;
  /** Altura en mm desde la costura de la boca (0) hacia la base. */
  y: number;
}

export interface MateShape {
  totalHeightMm: number;
  /** 'intDiameter': la boca escala con D_int vigente (R2/R4 de la spec geométrica). */
  anchor: 'intDiameter';
  /** mm del cuerpo ocultos bajo la virola para que nunca se vea una ranura (R4). */
  sealOverlapMm: number;
  points: MateShapePoint[];
}

export interface MateProduct {
  id: MateModelId;
  label: string;
  description: string;
  /** Productos futuros tras el paywall; los vigentes son false (demo FREE). */
  pro: boolean;
  shape: MateShape;
}

/** R1 textual — coordenadas de referencia de la spec. */
export interface MateCatalog {
  catalogVersion: number;
  products: MateProduct[];
}

const RAW_CATALOG: MateCatalog = {
  catalogVersion: 1,
  products: [
    {
      id: 'camionero',
      label: 'Camionero',
      description: 'Cuerpo recto clásico',
      pro: false,
      shape: {
        totalHeightMm: 110,
        anchor: 'intDiameter',
        sealOverlapMm: 1.0,
        points: [
          { x: 1.0, y: 0 },
          { x: 1.01, y: 5 },
          { x: 1.02, y: 30 },
          { x: 1.04, y: 60 },
          { x: 1.08, y: 96 },
          { x: 1.08, y: 107 },
          { x: 0.0, y: 110 },
        ],
      },
    },
    {
      id: 'imperial',
      label: 'Imperial',
      description: 'Panza ancha y cintura cerrada',
      pro: false,
      shape: {
        totalHeightMm: 94,
        anchor: 'intDiameter',
        sealOverlapMm: 1.0,
        points: [
          { x: 1.0, y: 0 },
          { x: 0.92, y: 8 },
          { x: 0.9, y: 12 },
          { x: 1.05, y: 30 },
          { x: 1.3, y: 55 },
          { x: 1.15, y: 75 },
          { x: 0.95, y: 88 },
          { x: 0.9, y: 92 },
          { x: 0.0, y: 94 },
        ],
      },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Validación (§6 edge case): entrada corrupta ⇒ se descarta con aviso en      */
/* consola y la escena JAMÁS queda vacía (se mantiene el producto activo).     */
/* -------------------------------------------------------------------------- */

function isValidProduct(p: unknown): p is MateProduct {
  if (typeof p !== 'object' || p === null) return false;
  const prod = p as MateProduct;
  if (typeof prod.id !== 'string' || prod.id.length === 0) return false;
  if (typeof prod.label !== 'string' || prod.label.trim() === '') return false;
  if (!prod.shape || typeof prod.shape !== 'object') return false;
  const { points, totalHeightMm, sealOverlapMm } = prod.shape;
  if (!Array.isArray(points) || points.length < 3) return false; // §6: <3 coordenadas
  if (typeof totalHeightMm !== 'number' || !(totalHeightMm > 0)) return false;
  if (typeof sealOverlapMm !== 'number' || sealOverlapMm < 0) return false;
  return points.every(
    (pt) =>
      typeof pt?.x === 'number' && typeof pt?.y === 'number' && pt.y >= 0, // §6: alturas ≥ 0
  );
}

export interface ValidatedCatalog {
  products: MateProduct[];
  /** Ids descartados por corrupción (consola). */
  dropped: string[];
}

export function validateCatalog(catalog: MateCatalog): ValidatedCatalog {
  const products: MateProduct[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  for (const p of catalog.products) {
    if (!isValidProduct(p) || seen.has(p.id)) {
      dropped.push(typeof p === 'object' && p !== null && 'id' in p ? String((p as MateProduct).id) : '?');
      continue;
    }
    seen.add(p.id);
    products.push(p);
  }
  return { products, dropped };
}

/** Catálogo listo al arranque (JSON estático — §5). */
export const CATALOG: MateProduct[] = (() => {
  const { products, dropped } = validateCatalog(RAW_CATALOG);
  if (dropped.length > 0) {
    console.warn('[catalog] entradas corruptas descartadas:', dropped);
  }
  return products;
})();

export function getProduct(id: MateModelId): MateProduct | null {
  return CATALOG.find((p) => p.id === id) ?? null;
}

/** Fallback del catálogo (R8): producto por defecto de un proyecto nuevo. */
export const DEFAULT_MATE_MODEL: MateModelId = 'camionero';

/**
 * R8: id desconocido (o ausente) ⇒ fallback "camionero", sin abortar el
 * resto de la carga del estado o payload.
 */
export function resolveMateModel(id: string | null | undefined): MateProduct {
  return getProduct(id ?? '') ?? getProduct(DEFAULT_MATE_MODEL)!;
}

/* -------------------------------------------------------------------------- */
/* Geometría de referencia (R2/R4) — pureza total para tests y motor.          */
/* -------------------------------------------------------------------------- */

/** R_boca = D_int / 2 (R2: x=1.00 ancla a la D_int vigente). */
export function bodyTopRadiusMm(product: MateProduct, intDiameterMm: number): number {
  return (product.shape.points[0]!.x * intDiameterMm) / 2;
}

/**
 * Radio (mm) del perfil a una altura `yMm` desde la costura (interpolación
 * lineal entre puntos). QA1: permite comparar la panza del Imperial contra
 * el cuerpo recto del Camionero.
 */
export function radiusAtHeightMm(product: MateProduct, yMm: number, intDiameterMm: number): number {
  const pts = product.shape.points;
  const r = intDiameterMm / 2;
  const clamped = Math.min(Math.max(yMm, 0), product.shape.totalHeightMm);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (clamped >= a.y && clamped <= b.y) {
      const t = b.y === a.y ? 0 : (clamped - a.y) / (b.y - a.y);
      return (a.x + t * (b.x - a.x)) * r;
    }
  }
  return pts[pts.length - 1]!.x * r;
}

/** Radio máximo del perfil (encuadre de cámara / análisis visual). */
export function maxRadiusMm(product: MateProduct, intDiameterMm: number): number {
  const r = intDiameterMm / 2;
  return Math.max(...product.shape.points.map((p) => p.x)) * r;
}

/* -------------------------------------------------------------------------- */
/* Silueta SVG para las cards del selector (§4: thumbnail 64×80, sin           */
/* mini-renders 3D). Derivada del perfil: solo-datos también en la UI.         */
/* -------------------------------------------------------------------------- */

export interface Silhouette {
  path: string;
  viewBox: string;
  /** Radio máximo relativo (0..~1.3) para centrar el dibujo dentro del viewBox. */
  usedWidthPx: number;
}

export function silhouetteOf(
  product: MateProduct,
  { width = 64, height = 80, pad = 6 }: { width?: number; height?: number; pad?: number } = {},
): Silhouette {
  const shape = product.shape;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  // Altura ⇒ escala vertical fija (y=0 arriba, base abajo).
  const yPx = (yMm: number) => pad + (yMm / shape.totalHeightMm) * usableH;
  // Radio: el mayor de todo el catálogo define la escala horizontal común,
  // para que dos siluetas sean COMPARABLES entre sí (panza vs recto).
  const maxRel = Math.max(...CATALOG.flatMap((p) => p.shape.points.map((p2) => p2.x)));
  const xPx = (x: number) => width / 2 + (x / maxRel) * (usableW / 2);

  const outline = shape.points; // boca (y=0) → base (y=H)
  const right: string[] = [];
  const left: string[] = [];
  for (const p of outline) {
    right.push(`${xPx(p.x).toFixed(2)},${yPx(p.y).toFixed(2)}`);
  }
  for (const p of [...outline].reverse()) {
    left.push(`${xPx(-p.x).toFixed(2)},${yPx(p.y).toFixed(2)}`);
  }
  const path = `M ${[...right, ...left].join(' L ')} Z`;
  return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
}
