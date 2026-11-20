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
      description: 'Cintura alta, panza generosa y pie angosto',
      pro: false,
      shape: {
        totalHeightMm: 132,
        anchor: 'intDiameter',
        sealOverlapMm: 1.0,
        /* Perfil de torno real del camionero (coordenadas R2), calibrado con
         * el scan `mate camionero.glb` y la lámina de cotas:
         *  · los primeros 13 mm quedan ocultos bajo el faldón de la virola;
         *    ahí el cuerpo se abre desde la boca (x=1.00) al hombro visible;
         *  · el scan NO tiene cintura bajo el faldón: el hombro arranca en
         *    x≈1.18 y sube en curva continua hasta la panza;
         *  · panza máxima a 1/2 de altura (121 mm ⌀ con D_int 95);
         *  · tobillo con leve rehundido (x≈0.965) y pie de 95 mm ⌀ que
         *    vuelve a abrirse antes del canto redondeado de la base. */
        points: [
          { x: 1.0, y: 0 },
          { x: 1.05, y: 2 },
          { x: 1.12, y: 5 },
          { x: 1.165, y: 9 },
          { x: 1.18, y: 13 },
          { x: 1.18, y: 22 },
          { x: 1.19, y: 28 },
          { x: 1.205, y: 35 },
          { x: 1.222, y: 42 },
          { x: 1.24, y: 48 },
          { x: 1.258, y: 55 },
          { x: 1.266, y: 62 },
          { x: 1.268, y: 68 },
          { x: 1.262, y: 74 },
          { x: 1.25, y: 80 },
          { x: 1.226, y: 87 },
          { x: 1.19, y: 93 },
          { x: 1.13, y: 99 },
          { x: 1.05, y: 105 },
          { x: 1.005, y: 109 },
          { x: 0.965, y: 113 },
          { x: 0.97, y: 118 },
          { x: 0.99, y: 123 },
          { x: 1.0, y: 126 },
          { x: 0.997, y: 129 },
          { x: 0.99, y: 130.8 },
          { x: 0.97, y: 131.7 },
          { x: 0.97, y: 132 },
          { x: 0.0, y: 132 },
        ],
      },
    },
    {
      id: 'imperial',
      label: 'Imperial',
      description: 'Panza amplia, cuello corto y pie asentado',
      pro: false,
      shape: {
        totalHeightMm: 120,
        anchor: 'intDiameter',
        sealOverlapMm: 1.0,
        /* Imperial: boca recogida bajo la virola, hombro que se abre en una
         * panza baja de gran diámetro y pie ancho y estable. El contorno sale
         * del scan `mate imperial.glb`:
         *  · boca visible ≈109 mm ⌀, panza ≈122 mm ⌀ a 1/2 de altura;
         *  · el pie NO es un huevo: se mantiene ancho (≈105 mm ⌀) hasta
         *    y≈113 y recién ahí se redondea hacia una base asentada de
         *    ≈93 mm ⌀ (efecto "pie asentado" del imperial). */
        points: [
          { x: 1.0, y: 0 },
          { x: 1.05, y: 2 },
          { x: 1.1, y: 5 },
          { x: 1.13, y: 9 },
          { x: 1.15, y: 13 },
          { x: 1.17, y: 18 },
          { x: 1.2, y: 24 },
          { x: 1.232, y: 33 },
          { x: 1.258, y: 44 },
          { x: 1.274, y: 54 },
          { x: 1.285, y: 62 },
          { x: 1.282, y: 70 },
          { x: 1.265, y: 78 },
          { x: 1.238, y: 86 },
          { x: 1.2, y: 94 },
          { x: 1.16, y: 100 },
          { x: 1.125, y: 105 },
          { x: 1.105, y: 109 },
          { x: 1.105, y: 113 },
          { x: 1.1, y: 115 },
          { x: 1.08, y: 117 },
          { x: 1.04, y: 118.4 },
          { x: 0.99, y: 119.3 },
          { x: 0.98, y: 120 },
          { x: 0.0, y: 120 },
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
