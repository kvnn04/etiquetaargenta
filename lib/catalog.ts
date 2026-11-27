/* ============================================================================
 * CATÁLOGO DE PRODUCTOS — familias + productos
 * ----------------------------------------------------------------------------
 * El catálogo deja de ser una lista plana de mates: cada entrada declara su
 * FAMILIA y su CATEGORÍA. Los mates conservan exactamente el contrato histórico
 * (perfil de torno, anclaje a D_int, virola y grabado en corona). El termo
 * suma su propia geometría procedural y su zona de grabado lateral.
 *
 * Coordenadas de los mates (sin cambios):
 *   x = radio relativo a la boca (x=1.00 ⇒ R_boca = D_int/2)
 *   y = altura absoluta en mm desde la costura de la boca (0) a la base.
 *
 * Coordenadas del termo: mm absolutos desde la base apoyada en Y=0. El perfil
 * se deriva del HTML `3d_termo_matero_media_manija.html` con escala 36 mm/unidad.
 * ============================================================================ */

export const CATALOG_VERSION = 2;

export type ProductFamily = 'mate' | 'thermo';

export type ProductCategoryId =
  | 'mates'
  | 'termos'
  | 'vasos'
  | 'botellas'
  | 'tablas'
  | 'cajas';

export interface ProductCategory {
  id: ProductCategoryId;
  label: string;
  description: string;
}

/** Orden de presentación del catálogo. Las categorías vacías no se muestran. */
export const PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  { id: 'mates', label: 'Mates', description: 'Camionero e Imperial' },
  { id: 'termos', label: 'Termos', description: 'Acero, media manija y grabado lateral' },
  { id: 'vasos', label: 'Vasos térmicos', description: 'Próximamente' },
  { id: 'botellas', label: 'Botellas', description: 'Próximamente' },
  { id: 'tablas', label: 'Tablas de asado', description: 'Próximamente' },
  { id: 'cajas', label: 'Cajas de presentación', description: 'Próximamente' },
];

/** Ids del catálogo (cualquier string nuevo que se agregue al registro). */
export type MateModelId = string;

export interface MateShapePoint {
  /** Radio relativo a la boca: 1.00 = R_boca = D_int / 2. */
  x: number;
  /** Altura en mm desde la costura de la boca (0) hacia la base. */
  y: number;
}

export interface MateShape {
  totalHeightMm: number;
  /** 'intDiameter': la boca escala con D_int vigente. */
  anchor: 'intDiameter';
  /** mm del cuerpo ocultos bajo la virola para que nunca se vea una ranura. */
  sealOverlapMm: number;
  points: MateShapePoint[];
}

/** Contrato geométrico del termo, en mm desde la base apoyada en Y=0. */
export interface ThermoSpec {
  /** Radio del cuerpo pintado. */
  radiusMm: number;
  /** Altura total (base inferior → centro del domo de la tapa). */
  totalHeightMm: number;
  /** Zócalo de acero: base apoyada y unión con el cuerpo. */
  baseBottomMm: number;
  baseTopMm: number;
  /** Cuerpo pintado (cilindro recto). */
  bodyBottomMm: number;
  bodyTopMm: number;
  shoulderTopMm: number;
  /** Collarín negro. */
  collarBottomMm: number;
  collarTopMm: number;
  /** Tapa-vaso de acero. */
  lidBottomMm: number;
  lidTopMm: number;
  /** Zona vertical útil del grabado lateral. */
  engraveMinYMm: number;
  engraveMaxYMm: number;
  /** Ángulo del centro de la media manija (-π/2 = -X). */
  handleAngleRad: number;
  /** Arco bloqueado por la manija (~37°). */
  handleBlockedArcRad: number;
  /** Radio de la malla de grabado (cuerpo + ε). */
  engraveRadiusMm: number;
  /** Escala de grabado por defecto y rango del control. */
  defaultScalePct: number;
  minScalePct: number;
  maxScalePct: number;
}

export interface CatalogProductBase {
  id: MateModelId;
  label: string;
  description: string;
  /** Productos futuros tras el paywall; los vigentes son FREE. */
  pro: boolean;
  family: ProductFamily;
  category: ProductCategoryId;
}

export interface MateProduct extends CatalogProductBase {
  family: 'mate';
  category: 'mates';
  shape: MateShape;
}

export interface ThermoProduct extends CatalogProductBase {
  family: 'thermo';
  category: 'termos';
  thermo: ThermoSpec;
}

export type CatalogProduct = MateProduct | ThermoProduct;

export interface MateCatalog {
  catalogVersion: number;
  products: CatalogProduct[];
}

/* -------------------------------------------------------------------------- */
/* Perfiles existentes (sin cambios)                                          */
/* -------------------------------------------------------------------------- */

const CAMIONERO_SHAPE: MateShape = {
  totalHeightMm: 132,
  anchor: 'intDiameter',
  sealOverlapMm: 1.0,
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
};

const IMPERIAL_SHAPE: MateShape = {
  totalHeightMm: 120,
  anchor: 'intDiameter',
  sealOverlapMm: 1.0,
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
};

/* -------------------------------------------------------------------------- */
/* Termo Matero Media Manija 1 L                                              */
/* -------------------------------------------------------------------------- */

/** Escala del prototipo HTML: 1 unidad = 36 mm. */
export const THERMO_MM_PER_UNIT = 36;

const THERMO_UNIT = {
  radius: 1.12,
  baseBottom: -3.38,
  baseTop: -2.91,
  bodyBottom: -2.84,
  bodyTop: 1.72,
  shoulderTop: 1.96,
  collarBottom: 1.95,
  collarTop: 2.37,
  lidBottom: 2.36,
  lidTop: 3.59,
  marginY: 0.14,
  handleAngle: -Math.PI / 2,
  handleBlockedArc: 0.64,
  engraveRadius: 1.1225,
} as const;

const THERMO_ENGRAVE_MIN_U = THERMO_UNIT.bodyBottom + THERMO_UNIT.marginY;
const THERMO_ENGRAVE_MAX_U = THERMO_UNIT.bodyTop - THERMO_UNIT.marginY;

const THERMO_SPEC: ThermoSpec = {
  radiusMm: THERMO_UNIT.radius * THERMO_MM_PER_UNIT,
  totalHeightMm: (THERMO_UNIT.lidTop - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  baseBottomMm: 0,
  baseTopMm: (THERMO_UNIT.baseTop - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  bodyBottomMm: (THERMO_UNIT.bodyBottom - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  bodyTopMm: (THERMO_UNIT.bodyTop - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  shoulderTopMm: (THERMO_UNIT.shoulderTop - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  collarBottomMm: (THERMO_UNIT.collarBottom - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  collarTopMm: (THERMO_UNIT.collarTop - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  lidBottomMm: (THERMO_UNIT.lidBottom - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  lidTopMm: (THERMO_UNIT.lidTop - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  engraveMinYMm: (THERMO_ENGRAVE_MIN_U - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  engraveMaxYMm: (THERMO_ENGRAVE_MAX_U - THERMO_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  handleAngleRad: THERMO_UNIT.handleAngle,
  handleBlockedArcRad: THERMO_UNIT.handleBlockedArc,
  engraveRadiusMm: THERMO_UNIT.engraveRadius * THERMO_MM_PER_UNIT,
  defaultScalePct: 45,
  minScalePct: 10,
  maxScalePct: 100,
};

const RAW_CATALOG: MateCatalog = {
  catalogVersion: CATALOG_VERSION,
  products: [
    {
      id: 'camionero',
      label: 'Camionero',
      description: 'Cintura alta, panza generosa y pie angosto',
      pro: false,
      family: 'mate',
      category: 'mates',
      shape: CAMIONERO_SHAPE,
    },
    {
      id: 'imperial',
      label: 'Imperial',
      description: 'Panza amplia, cuello corto y pie asentado',
      pro: false,
      family: 'mate',
      category: 'mates',
      shape: IMPERIAL_SHAPE,
    },
    {
      id: 'termo-media-manija-1l',
      label: 'Termo Matero Media Manija 1L',
      description: 'Cuerpo pintado, acero y grabado lateral',
      pro: false,
      family: 'thermo',
      category: 'termos',
      thermo: THERMO_SPEC,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Validación: una entrada corrupta se descarta y jamás deja la escena vacía. */
/* -------------------------------------------------------------------------- */

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isValidMateProduct(p: MateProduct): boolean {
  if (!p.shape || typeof p.shape !== 'object') return false;
  const { points, totalHeightMm, sealOverlapMm } = p.shape;
  if (!Array.isArray(points) || points.length < 3) return false;
  if (!isPositiveNumber(totalHeightMm)) return false;
  if (typeof sealOverlapMm !== 'number' || sealOverlapMm < 0) return false;
  return points.every(
    (pt) =>
      typeof pt?.x === 'number' &&
      Number.isFinite(pt.x) &&
      typeof pt?.y === 'number' &&
      Number.isFinite(pt.y) &&
      pt.y >= 0,
  );
}

function isValidThermoProduct(p: ThermoProduct): boolean {
  const t = p.thermo;
  if (!t || typeof t !== 'object') return false;
  return (
    isPositiveNumber(t.radiusMm) &&
    isPositiveNumber(t.totalHeightMm) &&
    isPositiveNumber(t.engraveRadiusMm) &&
    isPositiveNumber(t.minScalePct) &&
    isPositiveNumber(t.maxScalePct) &&
    t.maxScalePct > t.minScalePct &&
    t.engraveMaxYMm > t.engraveMinYMm &&
    t.engraveMinYMm >= 0 &&
    t.engraveMaxYMm <= t.totalHeightMm
  );
}

function isValidProduct(p: unknown): p is CatalogProduct {
  if (typeof p !== 'object' || p === null) return false;
  const prod = p as Partial<CatalogProduct>;
  if (typeof prod.id !== 'string' || prod.id.length === 0) return false;
  if (typeof prod.label !== 'string' || prod.label.trim() === '') return false;
  if (prod.family === 'mate') return isValidMateProduct(prod as MateProduct);
  if (prod.family === 'thermo') return isValidThermoProduct(prod as ThermoProduct);
  return false;
}

export interface ValidatedCatalog {
  products: CatalogProduct[];
  dropped: string[];
}

export function validateCatalog(catalog: MateCatalog): ValidatedCatalog {
  const products: CatalogProduct[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  for (const p of catalog.products) {
    if (!isValidProduct(p) || seen.has(p.id)) {
      dropped.push(
        typeof p === 'object' && p !== null && 'id' in p ? String((p as CatalogProduct).id) : '?',
      );
      continue;
    }
    seen.add(p.id);
    products.push(p);
  }
  return { products, dropped };
}

/** Catálogo listo al arranque (JSON estático). */
export const CATALOG: CatalogProduct[] = (() => {
  const { products, dropped } = validateCatalog(RAW_CATALOG);
  if (dropped.length > 0) {
    console.warn('[catalog] entradas corruptas descartadas:', dropped);
  }
  return products;
})();

export function isMateProduct(p: CatalogProduct): p is MateProduct {
  return p.family === 'mate';
}

export function isThermoProduct(p: CatalogProduct): p is ThermoProduct {
  return p.family === 'thermo';
}

/** Producto de cualquier familia. Fallback del catálogo: camionero. */
export function getCatalogProduct(id: MateModelId): CatalogProduct | null {
  return CATALOG.find((p) => p.id === id) ?? null;
}

/** Compatibilidad histórica: sólo devuelve mates. */
export function getProduct(id: MateModelId): MateProduct | null {
  const p = getCatalogProduct(id);
  return p && isMateProduct(p) ? p : null;
}

/** Fallback del catálogo: producto por defecto de un proyecto nuevo. */
export const DEFAULT_MATE_MODEL: MateModelId = 'camionero';

/** Id del termo (atajo para el editor y la UI). */
export const THERMO_MODEL_ID = 'termo-media-manija-1l';

/**
 * Resuelve cualquier producto del catálogo. Un id de termo devuelve el termo;
 * un id desconocido cae al mate por defecto.
 */
export function resolveProduct(id: string | null | undefined): CatalogProduct {
  return getCatalogProduct(id ?? '') ?? getCatalogProduct(DEFAULT_MATE_MODEL)!;
}

/**
 * Compatibilidad con el motor de mates: si el id pertenece a otra familia,
 * devuelve el mate por defecto. Los consumidores nuevos usan resolveProduct.
 */
export function resolveMateModel(id: string | null | undefined): MateProduct {
  const p = getCatalogProduct(id ?? '');
  if (p && isMateProduct(p)) return p;
  return getProduct(DEFAULT_MATE_MODEL)!;
}

export function resolveThermoProduct(id: string | null | undefined): ThermoProduct {
  const p = getCatalogProduct(id ?? '');
  if (p && isThermoProduct(p)) return p;
  return getCatalogProduct(THERMO_MODEL_ID) as ThermoProduct;
}

/* -------------------------------------------------------------------------- */
/* Geometría de referencia de los mates                                       */
/* -------------------------------------------------------------------------- */

/** R_boca = D_int / 2 (x=1.00 ancla a la D_int vigente). */
export function bodyTopRadiusMm(product: MateProduct, intDiameterMm: number): number {
  return (product.shape.points[0]!.x * intDiameterMm) / 2;
}

/** Radio (mm) del perfil a una altura `yMm` desde la costura. */
export function radiusAtHeightMm(
  product: MateProduct,
  yMm: number,
  intDiameterMm: number,
): number {
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
/* Silueta SVG para las cards                                                 */
/* -------------------------------------------------------------------------- */

export interface Silhouette {
  path: string;
  viewBox: string;
  usedWidthPx: number;
}

function thermoSilhouette(product: ThermoProduct, width: number, height: number, pad: number): Silhouette {
  const t = product.thermo;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const maxR = t.radiusMm * 1.32; // deja aire para la manija
  const yPx = (y: number) => pad + (1 - y / t.totalHeightMm) * usableH;
  const xPx = (x: number) => width / 2 + (x / maxR) * (usableW / 2);
  const r = t.radiusMm;
  const shoulder = t.bodyTopMm;
  const pts: Array<[number, number]> = [
    [-r, t.baseBottomMm + 8],
    [-r, t.bodyBottomMm],
    [-r, shoulder],
    [-r * 0.72, t.shoulderTopMm],
    [-r * 0.72, t.collarTopMm],
    [-r * 0.92, t.lidBottomMm],
    [-r * 0.92, t.lidTopMm - 18],
    [-r * 0.62, t.lidTopMm],
    [0, t.lidTopMm],
    [r * 0.62, t.lidTopMm],
    [r * 0.92, t.lidTopMm - 18],
    [r * 0.92, t.lidBottomMm],
    [r * 0.72, t.collarTopMm],
    [r * 0.72, t.shoulderTopMm],
    [r, shoulder],
    [r, t.bodyBottomMm],
    [r, t.baseBottomMm + 8],
  ];
  const path = `M ${pts.map(([x, y]) => `${xPx(x).toFixed(2)},${yPx(y).toFixed(2)}`).join(' L ')} Z`;
  return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
}

export function silhouetteOf(
  product: CatalogProduct,
  { width = 64, height = 80, pad = 6 }: { width?: number; height?: number; pad?: number } = {},
): Silhouette {
  if (isThermoProduct(product)) return thermoSilhouette(product, width, height, pad);

  const shape = product.shape;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  const yPx = (yMm: number) => pad + (yMm / shape.totalHeightMm) * usableH;
  const maxRel = Math.max(
    ...CATALOG.filter(isMateProduct).flatMap((p) => p.shape.points.map((p2) => p2.x)),
  );
  const xPx = (x: number) => width / 2 + (x / maxRel) * (usableW / 2);

  const outline = shape.points;
  const right: string[] = [];
  const left: string[] = [];
  for (const p of outline) right.push(`${xPx(p.x).toFixed(2)},${yPx(p.y).toFixed(2)}`);
  for (const p of [...outline].reverse()) left.push(`${xPx(-p.x).toFixed(2)},${yPx(p.y).toFixed(2)}`);
  const path = `M ${[...right, ...left].join(' L ')} Z`;
  return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
}
