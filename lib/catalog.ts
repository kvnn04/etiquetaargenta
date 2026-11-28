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
 * Coordenadas del termo/botella: mm absolutos desde la base apoyada en Y=0. Los
 * perfiles se derivan de `3d_termo_matero_media_manija.html`,
 * `termo_system_1L_3d.html` y `3d_botella_bowling.html` con escala 36 mm/unidad;
 * la Deportiva usa 49.08 mm/unidad y el mate cónico 33.33 mm/unidad (90 mm de
 * alto total, como su prototipo `mate_acero_inoxidable_3d.html`).
 * ============================================================================ */

export const CATALOG_VERSION = 6;

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
  { id: 'mates', label: 'Mates', description: 'Camionero, Imperial y mates térmicos' },
  { id: 'termos', label: 'Termos', description: 'Acero, manija lateral y grabado' },
  { id: 'vasos', label: 'Vasos térmicos', description: 'Próximamente' },
  { id: 'botellas', label: 'Botellas', description: 'Bowling y Deportiva 500 ml' },
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

/** Variante de geometría procedural del termo/botella/mate térmico. */
export type ThermoGeometry =
  | 'media-manija'
  | 'system'
  | 'bowling'
  | 'sport'
  | 'recto'
  | 'clasico';

/** Las botellas comparten el frente fijo y la ausencia de manija lateral. */
export function isBottleGeometry(geometry: ThermoGeometry): boolean {
  return geometry === 'bowling' || geometry === 'sport';
}

/**
 * Mates térmicos de acero inoxidable: cuerpo pintado, boca de acero y grabado
 * frontal. `recto` es el de pared cilíndrica; `clasico`, el cónico con virola.
 */
export function isMateThermoGeometry(geometry: ThermoGeometry): boolean {
  return geometry === 'recto' || geometry === 'clasico';
}

/**
 * Productos sin manija lateral cuyo grabado vive en un frente fijo (no dan la
 * vuelta al cuerpo): botellas y mates térmicos.
 */
export function hasFixedFrontGeometry(geometry: ThermoGeometry): boolean {
  return isBottleGeometry(geometry) || isMateThermoGeometry(geometry);
}

/** Contrato geométrico del termo/botella, en mm desde la base apoyada en Y=0. */
export interface ThermoSpec {
  /** Variante de perfil/manija que construye `three/thermo-builder`. */
  geometry: ThermoGeometry;
  /** Radio del cuerpo pintado. */
  radiusMm: number;
  /** Radio del cuello (botellas: alimenta hombro, aro y tapa). */
  neckRadiusMm: number;
  /** Altura total (base inferior → centro del domo de la tapa). */
  totalHeightMm: number;
  /** Zócalo de acero: base apoyada y unión con el cuerpo. */
  baseBottomMm: number;
  baseTopMm: number;
  /** Cuerpo pintado (cilindro recto o perfil cónico). */
  bodyBottomMm: number;
  bodyTopMm: number;
  shoulderTopMm: number;
  /** Collarín negro (termos), aro de silicona (Bowling) o cuello de acero (Deportiva). */
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
  /** Arco bloqueado por la manija (~37°). En botellas/mates: el dorso. */
  handleBlockedArcRad: number;
  /** Radio nominal de la malla de grabado (cuerpo + ε; en el cónico, el centro). */
  engraveRadiusMm: number;
  /** Escala de grabado por defecto y rango del control. */
  defaultScalePct: number;
  minScalePct: number;
  maxScalePct: number;
  /** Capacidad comercial impresa en la ficha y el visor. */
  capacityLabel: string;
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
  category: 'termos' | 'botellas' | 'mates';
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
  geometry: 'media-manija',
  radiusMm: THERMO_UNIT.radius * THERMO_MM_PER_UNIT,
  neckRadiusMm: (THERMO_UNIT.radius - 0.035) * THERMO_MM_PER_UNIT,
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
  capacityLabel: '1.0 L',
};

/* -------------------------------------------------------------------------- */
/* Termo Matero System 1 L                                                    */
/* -------------------------------------------------------------------------- */

/** Misma escala del prototipo `termo_system_1L_3d.html`: 1 unidad = 36 mm. */
const THERMO_SYSTEM_UNIT = {
  radius: 1.18,
  baseBottom: -3.38,
  baseTop: -2.95,
  bodyBottom: -2.86,
  bodyTop: 1.56,
  shoulderTop: 1.92,
  lidBottom: 1.9,
  lidTop: 3.92,
  marginY: 0.14,
  handleAngle: Math.PI / 2,
  handleBlockedArc: 0.72,
  engraveRadius: 1.1825,
} as const;

const THERMO_SYSTEM_ENGRAVE_MIN_U = THERMO_SYSTEM_UNIT.bodyBottom + THERMO_SYSTEM_UNIT.marginY;
const THERMO_SYSTEM_ENGRAVE_MAX_U = THERMO_SYSTEM_UNIT.bodyTop - THERMO_SYSTEM_UNIT.marginY;

const THERMO_SYSTEM_SPEC: ThermoSpec = {
  geometry: 'system',
  radiusMm: THERMO_SYSTEM_UNIT.radius * THERMO_MM_PER_UNIT,
  neckRadiusMm: (THERMO_SYSTEM_UNIT.radius - 0.19) * THERMO_MM_PER_UNIT,
  totalHeightMm: (THERMO_SYSTEM_UNIT.lidTop - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  baseBottomMm: 0,
  baseTopMm: (THERMO_SYSTEM_UNIT.baseTop - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  bodyBottomMm:
    (THERMO_SYSTEM_UNIT.bodyBottom - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  bodyTopMm: (THERMO_SYSTEM_UNIT.bodyTop - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  shoulderTopMm:
    (THERMO_SYSTEM_UNIT.shoulderTop - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  // El System no tiene collarín negro: la tapa-vaso apoya directo en el hombro.
  collarBottomMm:
    (THERMO_SYSTEM_UNIT.lidBottom - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  collarTopMm:
    (THERMO_SYSTEM_UNIT.lidBottom - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  lidBottomMm:
    (THERMO_SYSTEM_UNIT.lidBottom - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  lidTopMm: (THERMO_SYSTEM_UNIT.lidTop - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  engraveMinYMm:
    (THERMO_SYSTEM_ENGRAVE_MIN_U - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  engraveMaxYMm:
    (THERMO_SYSTEM_ENGRAVE_MAX_U - THERMO_SYSTEM_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  handleAngleRad: THERMO_SYSTEM_UNIT.handleAngle,
  handleBlockedArcRad: THERMO_SYSTEM_UNIT.handleBlockedArc,
  engraveRadiusMm: THERMO_SYSTEM_UNIT.engraveRadius * THERMO_MM_PER_UNIT,
  defaultScalePct: 45,
  minScalePct: 10,
  maxScalePct: 100,
  capacityLabel: '1.0 L',
};

/* -------------------------------------------------------------------------- */
/* Botella Térmica Bowling 500 ml                                             */
/* -------------------------------------------------------------------------- */

/** Misma escala del prototipo `3d_botella_bowling.html`: 1 unidad = 36 mm. */
const BOTTLE_UNIT = {
  radius: 1.08,
  neckRadius: 0.56,
  baseBottom: -3.95,
  baseTop: -3.4,
  bodyBottom: -3.32,
  bodyTop: 0.82,
  neckStart: 2.78,
  neckEnd: 3.24,
  capStart: 3.32,
  capTop: 4.1,
  marginY: 0.22,
  engraveRadius: 1.0825,
  /** Frente fijo del prototipo: 114°. */
  frontArcDeg: 114,
} as const;

const BOTTLE_ENGRAVE_MIN_U = BOTTLE_UNIT.bodyBottom + BOTTLE_UNIT.marginY;
const BOTTLE_ENGRAVE_MAX_U = BOTTLE_UNIT.bodyTop - BOTTLE_UNIT.marginY;

const BOTTLE_SPEC: ThermoSpec = {
  geometry: 'bowling',
  radiusMm: BOTTLE_UNIT.radius * THERMO_MM_PER_UNIT,
  neckRadiusMm: BOTTLE_UNIT.neckRadius * THERMO_MM_PER_UNIT,
  totalHeightMm: (BOTTLE_UNIT.capTop - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  baseBottomMm: 0,
  baseTopMm: (BOTTLE_UNIT.baseTop - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  bodyBottomMm: (BOTTLE_UNIT.bodyBottom - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  bodyTopMm: (BOTTLE_UNIT.bodyTop - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  shoulderTopMm: (BOTTLE_UNIT.neckStart - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  // La botella no tiene collarín: esta banda es el aro de silicona.
  collarBottomMm: (BOTTLE_UNIT.neckEnd - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  collarTopMm: (BOTTLE_UNIT.capStart - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  lidBottomMm: (BOTTLE_UNIT.capStart - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  lidTopMm: (BOTTLE_UNIT.capTop - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  engraveMinYMm: (BOTTLE_ENGRAVE_MIN_U - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  engraveMaxYMm: (BOTTLE_ENGRAVE_MAX_U - BOTTLE_UNIT.baseBottom) * THERMO_MM_PER_UNIT,
  // El "arco bloqueado" es todo el dorso: el diseño vive en el frente fijo.
  handleAngleRad: Math.PI,
  handleBlockedArcRad: ((360 - BOTTLE_UNIT.frontArcDeg) * Math.PI) / 180,
  engraveRadiusMm: BOTTLE_UNIT.engraveRadius * THERMO_MM_PER_UNIT,
  defaultScalePct: 72,
  minScalePct: 15,
  maxScalePct: 100,
  capacityLabel: '500 ml',
};

/* -------------------------------------------------------------------------- */
/* Botella Deportiva con Pico y Mosquetón 500 ml                              */
/* -------------------------------------------------------------------------- */

/**
 * Escala del prototipo `botella térmica deportiva ..._3d.html`.
 * El HTML declara 165 mm de altura útil y el cuerpo abarca 4.1 unidades con
 * márgenes V 0.09–0.91 (3.362 unidades): 165 / 3.362 = 49.08 mm/unidad.
 * El resto de los prototipos usa 36 mm/unidad.
 */
export const SPORT_MM_PER_UNIT = 49.08;

const SPORT_UNIT = {
  /** Radio máximo del cuerpo (0.72 base + 0.0075 de conicidad). */
  radiusMax: 0.7275,
  bodyRadius: 0.72,
  neckRadius: 0.635,
  baseBottom: -2.35,
  bodyTop: 1.75,
  neckTop: 1.93,
  capTop: 2.42,
  /** Incluye el bisel del asa (0.028 u) sobre el arco de 1.01 u. */
  handleTop: 2.97,
  waist: 0.048,
  taper: 0.015,
  engraveVMin: 0.09,
  engraveVMax: 0.91,
  /** Frente fijo del prototipo: 114°. */
  frontArcDeg: 114,
} as const;

const SPORT_BODY_HEIGHT_U = SPORT_UNIT.bodyTop - SPORT_UNIT.baseBottom; // 4.1 u

/** Radio del cuerpo deportivo en unidades del prototipo (t=0 base, t=1 hombro). */
export function sportUnitRadiusAt(t: number): number {
  if (t < 0.03) {
    const bt = t / 0.03;
    return 0.65 + 0.07 * Math.sin(bt * Math.PI * 0.5);
  }
  if (t > 0.94) {
    const tt = (t - 0.94) / 0.06;
    return 0.72 - 0.09 * (1 - Math.cos(tt * Math.PI * 0.5));
  }
  const norm = (t - 0.03) / 0.91;
  const waist = Math.sin(norm * Math.PI) * SPORT_UNIT.waist;
  const slightTaper = (norm - 0.5) * SPORT_UNIT.taper;
  return SPORT_UNIT.bodyRadius - waist + slightTaper;
}

const SPORT_ENGRAVE_MIN_U =
  SPORT_UNIT.baseBottom + (1 - SPORT_UNIT.engraveVMax) * SPORT_BODY_HEIGHT_U;
const SPORT_ENGRAVE_MAX_U =
  SPORT_UNIT.baseBottom + (1 - SPORT_UNIT.engraveVMin) * SPORT_BODY_HEIGHT_U;
const SPORT_ENGRAVE_CENTER_U = (SPORT_ENGRAVE_MIN_U + SPORT_ENGRAVE_MAX_U) / 2;
const SPORT_ENGRAVE_RADIUS_U = sportUnitRadiusAt(
  (SPORT_ENGRAVE_CENTER_U - SPORT_UNIT.baseBottom) / SPORT_BODY_HEIGHT_U,
);

const SPORT_SPEC: ThermoSpec = {
  geometry: 'sport',
  radiusMm: SPORT_UNIT.radiusMax * SPORT_MM_PER_UNIT,
  neckRadiusMm: SPORT_UNIT.neckRadius * SPORT_MM_PER_UNIT,
  totalHeightMm: (SPORT_UNIT.handleTop - SPORT_UNIT.baseBottom) * SPORT_MM_PER_UNIT,
  baseBottomMm: 0,
  baseTopMm: 0.03 * SPORT_BODY_HEIGHT_U * SPORT_MM_PER_UNIT,
  bodyBottomMm: 0,
  bodyTopMm: SPORT_BODY_HEIGHT_U * SPORT_MM_PER_UNIT,
  // El hombro está incluido en el cuerpo; el cuello de acero arranca arriba.
  shoulderTopMm: SPORT_BODY_HEIGHT_U * SPORT_MM_PER_UNIT,
  collarBottomMm: SPORT_BODY_HEIGHT_U * SPORT_MM_PER_UNIT,
  collarTopMm: (SPORT_UNIT.neckTop - SPORT_UNIT.baseBottom) * SPORT_MM_PER_UNIT,
  lidBottomMm: (SPORT_UNIT.neckTop - SPORT_UNIT.baseBottom) * SPORT_MM_PER_UNIT,
  lidTopMm: (SPORT_UNIT.capTop - SPORT_UNIT.baseBottom) * SPORT_MM_PER_UNIT,
  engraveMinYMm: (SPORT_ENGRAVE_MIN_U - SPORT_UNIT.baseBottom) * SPORT_MM_PER_UNIT,
  engraveMaxYMm: (SPORT_ENGRAVE_MAX_U - SPORT_UNIT.baseBottom) * SPORT_MM_PER_UNIT,
  // El "arco bloqueado" es todo el dorso: el diseño vive en el frente fijo.
  handleAngleRad: Math.PI,
  handleBlockedArcRad: ((360 - SPORT_UNIT.frontArcDeg) * Math.PI) / 180,
  // Radio del cuerpo a la altura del centro del grabado (cintura cóncava).
  engraveRadiusMm: SPORT_ENGRAVE_RADIUS_U * SPORT_MM_PER_UNIT,
  defaultScalePct: 72,
  minScalePct: 15,
  maxScalePct: 100,
  capacityLabel: '500 ml',
};

/* -------------------------------------------------------------------------- */
/* Mate Recto Térmico de Acero Inoxidable                                     */
/* -------------------------------------------------------------------------- */

/**
 * Escala del prototipo `3d_mate_recto.html`: el cuerpo mide 2.33 unidades y el
 * total 2.50 unidades. Con 90 mm de alto total ⇒ 36 mm/unidad, el mismo factor
 * de los termos. El diámetro queda en 75.6 mm (radio 1.05 u).
 */
export const RECTO_MM_PER_UNIT = 36;

const RECTO_UNIT = {
  radius: 1.05,
  baseBottom: -1.25,
  bodyBottom: -0.68,
  bodyTop: 1.08,
  rimTop: 1.25,
  /** Zona segura del prototipo sobre la textura del cuerpo. */
  safeVMin: 0.25,
  safeVMax: 0.91,
  /** Frente fijo del prototipo: ±45° (90° en total). */
  frontArcDeg: 90,
  engraveRadius: 1.0525,
} as const;

const RECTO_BODY_HEIGHT_U = RECTO_UNIT.bodyTop - RECTO_UNIT.baseBottom;
const RECTO_ENGRAVE_MIN_U =
  RECTO_UNIT.baseBottom + RECTO_UNIT.safeVMin * RECTO_BODY_HEIGHT_U;
const RECTO_ENGRAVE_MAX_U =
  RECTO_UNIT.baseBottom + RECTO_UNIT.safeVMax * RECTO_BODY_HEIGHT_U;

const RECTO_SPEC: ThermoSpec = {
  geometry: 'recto',
  radiusMm: RECTO_UNIT.radius * RECTO_MM_PER_UNIT,
  // Radio interior del labio (0.99 u): la boca de acero no supera el cuerpo.
  neckRadiusMm: 0.99 * RECTO_MM_PER_UNIT,
  totalHeightMm: (RECTO_UNIT.rimTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  baseBottomMm: 0,
  baseTopMm: 0,
  bodyBottomMm: (RECTO_UNIT.bodyBottom - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  bodyTopMm: (RECTO_UNIT.bodyTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  // Sin hombro ni collarín: el labio de acero ocupa el tramo superior.
  shoulderTopMm: (RECTO_UNIT.bodyTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  collarBottomMm: (RECTO_UNIT.bodyTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  collarTopMm: (RECTO_UNIT.rimTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  // El mate no tiene tapa: las geometrías de tapa quedan vacías.
  lidBottomMm: (RECTO_UNIT.rimTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  lidTopMm: (RECTO_UNIT.rimTop - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  engraveMinYMm: (RECTO_ENGRAVE_MIN_U - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  engraveMaxYMm: (RECTO_ENGRAVE_MAX_U - RECTO_UNIT.baseBottom) * RECTO_MM_PER_UNIT,
  // El "arco bloqueado" es todo el dorso: el diseño vive en el frente fijo.
  handleAngleRad: Math.PI,
  handleBlockedArcRad: ((360 - RECTO_UNIT.frontArcDeg) * Math.PI) / 180,
  engraveRadiusMm: RECTO_UNIT.engraveRadius * RECTO_MM_PER_UNIT,
  defaultScalePct: 65,
  minScalePct: 15,
  maxScalePct: 100,
  // Producto sin capacidad declarada: la ficha imprime alto y diámetro.
  capacityLabel: '—',
};

/* -------------------------------------------------------------------------- */
/* Mate Térmico de Acero Inoxidable (cónico, virola plateada)                 */
/* -------------------------------------------------------------------------- */

/**
 * Escala del prototipo `mate_acero_inoxidable_3d.html`: el cuerpo mide 2.47
 * unidades y el total 2.70. Con 90 mm de alto total ⇒ 33.333 mm/unidad; el
 * diámetro máximo (1.12 u) queda en 74.67 mm, la misma proporción que la foto.
 */
export const ACERO_MM_PER_UNIT = 90 / 2.7;

const ACERO_UNIT = {
  radius: 1.12,
  baseBottom: -1.35,
  bodyTop: 1.12,
  rimTop: 1.35,
  /**
   * Zona segura del prototipo sobre la textura del cuerpo. El spline del
   * prototipo se evalúa en V=0.255/0.775: esos cortes caen a 0.3134 u y
   * 2.2286 u sobre la base, entre la curva inferior y la garganta del cuello.
   */
  engraveMinU: 0.3134,
  engraveMaxU: 2.2286,
  /** Radio del cuerpo a la altura del centro del grabado + 0.12 mm de lift. */
  engraveRadius: 1.0416,
  /** Frente fijo del prototipo: ±45° (90° en total). */
  frontArcDeg: 90,
} as const;

const ACERO_SPEC: ThermoSpec = {
  geometry: 'clasico',
  radiusMm: ACERO_UNIT.radius * ACERO_MM_PER_UNIT,
  // Radio interior de la virola (1.00 u): la boca de acero queda por dentro.
  neckRadiusMm: 1.0 * ACERO_MM_PER_UNIT,
  totalHeightMm: (ACERO_UNIT.rimTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  baseBottomMm: 0,
  baseTopMm: 0,
  // La base redondeada forma parte del cuerpo; no hay zócalo separado.
  bodyBottomMm: 0,
  bodyTopMm: (ACERO_UNIT.bodyTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  // Sin hombro ni collarín: la virola de acero ocupa el tramo superior.
  shoulderTopMm: (ACERO_UNIT.bodyTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  collarBottomMm: (ACERO_UNIT.bodyTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  collarTopMm: (ACERO_UNIT.rimTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  // El mate no tiene tapa: las geometrías de tapa quedan vacías.
  lidBottomMm: (ACERO_UNIT.rimTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  lidTopMm: (ACERO_UNIT.rimTop - ACERO_UNIT.baseBottom) * ACERO_MM_PER_UNIT,
  engraveMinYMm: ACERO_UNIT.engraveMinU * ACERO_MM_PER_UNIT,
  engraveMaxYMm: ACERO_UNIT.engraveMaxU * ACERO_MM_PER_UNIT,
  // El "arco bloqueado" es todo el dorso: el diseño vive en el frente fijo.
  handleAngleRad: Math.PI,
  handleBlockedArcRad: ((360 - ACERO_UNIT.frontArcDeg) * Math.PI) / 180,
  engraveRadiusMm: ACERO_UNIT.engraveRadius * ACERO_MM_PER_UNIT,
  defaultScalePct: 65,
  minScalePct: 15,
  maxScalePct: 100,
  // Producto sin capacidad declarada: la ficha imprime alto y diámetro.
  capacityLabel: '—',
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
      id: 'mate-recto-termico',
      label: 'Mate Recto Térmico',
      description: 'Acero inoxidable, cuerpo pintado y grabado frontal',
      pro: false,
      family: 'thermo',
      category: 'mates',
      thermo: RECTO_SPEC,
    },
    {
      id: 'mate-acero-inoxidable',
      label: 'Mate Térmico de Acero Inoxidable',
      description: 'Cuerpo cónico, virola plateada y grabado frontal',
      pro: false,
      family: 'thermo',
      category: 'mates',
      thermo: ACERO_SPEC,
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
    {
      id: 'termo-system-1l',
      label: 'Termo Matero System 1L',
      description: 'Cuerpo alto, tapa-vaso y manija táctica',
      pro: false,
      family: 'thermo',
      category: 'termos',
      thermo: THERMO_SYSTEM_SPEC,
    },
    {
      id: 'botella-bowling-500ml',
      label: 'Botella Térmica Bowling 500 ml',
      description: 'Hombro bowling, aro de silicona y tapa de acero',
      pro: false,
      family: 'thermo',
      category: 'botellas',
      thermo: BOTTLE_SPEC,
    },
    {
      id: 'botella-deportiva-500ml',
      label: 'Botella Deportiva con Pico y Mosquetón 500 ml',
      description: 'Cintura deportiva, tapa negra, pico rebatible y mosquetón',
      pro: false,
      family: 'thermo',
      category: 'botellas',
      thermo: SPORT_SPEC,
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
    isPositiveNumber(t.neckRadiusMm) &&
    t.neckRadiusMm < t.radiusMm &&
    isPositiveNumber(t.totalHeightMm) &&
    isPositiveNumber(t.engraveRadiusMm) &&
    isPositiveNumber(t.minScalePct) &&
    isPositiveNumber(t.maxScalePct) &&
    t.maxScalePct > t.minScalePct &&
    isPositiveNumber(t.defaultScalePct) &&
    t.defaultScalePct >= t.minScalePct &&
    t.defaultScalePct <= t.maxScalePct &&
    typeof t.capacityLabel === 'string' &&
    t.capacityLabel.trim().length > 0 &&
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

/** Ids de los termos/botella (atajo para el editor y la UI). */
export const THERMO_MODEL_ID = 'termo-media-manija-1l';
export const THERMO_SYSTEM_MODEL_ID = 'termo-system-1l';
export const BOTTLE_MODEL_ID = 'botella-bowling-500ml';
export const SPORT_BOTTLE_MODEL_ID = 'botella-deportiva-500ml';
export const RECTO_MATE_MODEL_ID = 'mate-recto-termico';
export const ACERO_MATE_MODEL_ID = 'mate-acero-inoxidable';

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
  const maxR =
    isBottleGeometry(t.geometry) || isMateThermoGeometry(t.geometry)
      ? t.radiusMm * 1.06 // sin manija lateral: el cuerpo manda
      : t.radiusMm * 1.32; // aire para la manija
  const yPx = (y: number) => pad + (1 - y / t.totalHeightMm) * usableH;
  const xPx = (x: number) => width / 2 + (x / maxR) * (usableW / 2);
  const r = t.radiusMm;
  const shoulder = t.bodyTopMm;

  if (t.geometry === 'sport') {
    const S = SPORT_MM_PER_UNIT;
    const rn = t.neckRadiusMm;
    const bodyH = t.bodyTopMm - t.baseBottomMm;
    const right: Array<[number, number]> = [
      [0, t.baseBottomMm],
      [r * 0.9, t.baseBottomMm],
    ];
    // Cuerpo acinturado: muestrea el mismo perfil que la malla 3D.
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      right.push([
        (sportUnitRadiusAt(u) / SPORT_UNIT.radiusMax) * r,
        t.baseBottomMm + bodyH * u,
      ]);
    }
    // Cuello de acero y tapa negra.
    right.push(
      [rn, t.collarTopMm],
      [rn * 0.97, t.lidBottomMm],
      [rn * 0.93, t.lidTopMm],
      // Asa superior (arco macizo en la silueta).
      [rn * 1.02, t.lidBottomMm + 0.78 * S],
      [rn * 0.9, t.lidBottomMm + 0.98 * S],
      [rn * 0.55, t.lidBottomMm + 1.03 * S],
      [0, t.totalHeightMm],
    );
    const pts = [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    const path = `M ${pts.map(([x, y]) => `${xPx(x).toFixed(2)},${yPx(y).toFixed(2)}`).join(' L ')} Z`;
    return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
  }

  if (t.geometry === 'recto') {
    const r = t.radiusMm;
    const yBody = t.bodyBottomMm;
    const yTop = t.bodyTopMm;
    // Base redondeada, pared recta y labio de acero que se curva hacia adentro.
    const right: Array<[number, number]> = [
      [0, t.baseBottomMm],
      [r * 0.686, t.baseBottomMm],
      [r * 0.838, t.baseBottomMm + 2.52],
      [r * 0.962, t.baseBottomMm + 10.44],
      [r, yBody],
      [r, yTop],
      [r * 1.033, yTop + 1.08],
      [r * 1.052, yTop + 3.24],
      [r * 1.005, t.totalHeightMm],
      [r * 0.62, t.totalHeightMm - 1.2],
      [0, t.totalHeightMm - 2.4],
    ];
    const pts = [
      ...right,
      ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number]),
    ];
    const path = `M ${pts.map(([x, y]) => `${xPx(x).toFixed(2)},${yPx(y).toFixed(2)}`).join(' L ')} Z`;
    return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
  }

  if (t.geometry === 'clasico') {
    const r = t.radiusMm;
    // Unidades del prototipo: 1.12 u = radio máximo del cuerpo.
    const S = r / 1.12;
    const y0 = t.baseBottomMm;
    /* Perfil del spline del prototipo, muestreado a 20 tramos. x ya está
     * normalizado al radio máximo; y va en unidades desde la base. */
    const bodyProfile: ReadonlyArray<readonly [number, number]> = [
      [0.7679, 0.0],
      [0.8063, 0.0196],
      [0.86, 0.0522],
      [0.9077, 0.1101],
      [0.9505, 0.1912],
      [0.9863, 0.2992],
      [1.0014, 0.4476],
      [0.9911, 0.6468],
      [0.9683, 0.872],
      [0.9458, 1.0966],
      [0.9196, 1.3338],
      [0.8934, 1.5623],
      [0.8714, 1.758],
      [0.85, 1.9299],
      [0.8389, 2.0746],
      [0.8494, 2.1837],
      [0.8779, 2.2593],
      [0.9074, 2.3211],
      [0.9298, 2.3823],
      [0.9502, 2.4345],
      [0.9643, 2.47],
    ];
    const right: Array<[number, number]> = [[0, y0]];
    for (const [xr, yu] of bodyProfile) right.push([xr * r, y0 + yu * S]);
    // Virola de acero: banda exterior, borde superior y labio interior.
    right.push(
      [(1.095 / 1.12) * r, y0 + 2.48 * S],
      [(1.095 / 1.12) * r, y0 + 2.68 * S],
      [(1.075 / 1.12) * r, y0 + 2.7 * S],
      [(1.02 / 1.12) * r, y0 + 2.7 * S],
      [(1.0 / 1.12) * r, y0 + 2.67 * S],
      [(0.85 / 1.12) * r, y0 + 2.55 * S],
      [0, y0 + 2.51 * S],
    );
    const pts = [
      ...right,
      ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number]),
    ];
    const path = `M ${pts.map(([x, y]) => `${xPx(x).toFixed(2)},${yPx(y).toFixed(2)}`).join(' L ')} Z`;
    return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
  }

  if (t.geometry === 'bowling') {
    const rn = t.neckRadiusMm;
    const capR = rn + 1.008;
    const right: Array<[number, number]> = [
      [0, t.baseBottomMm],
      [r * 0.78, t.baseBottomMm],
      [r, t.baseTopMm],
      [r, t.bodyTopMm],
    ];
    for (let i = 1; i <= 6; i++) {
      const s = i / 6;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * s);
      right.push([
        r - (r - rn) * Math.pow(ease, 0.92),
        t.bodyTopMm + (t.shoulderTopMm - t.bodyTopMm) * s,
      ]);
    }
    right.push(
      [rn, t.shoulderTopMm + 5.4],
      [rn + 0.54, t.shoulderTopMm + 10.8],
      [rn + 0.54, t.collarBottomMm],
      [capR, t.lidBottomMm],
      [capR, t.lidTopMm - 6.48],
      [capR * 0.7, t.lidTopMm],
      [0, t.lidTopMm],
    );
    const pts = [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    const path = `M ${pts.map(([x, y]) => `${xPx(x).toFixed(2)},${yPx(y).toFixed(2)}`).join(' L ')} Z`;
    return { path, viewBox: `0 0 ${width} ${height}`, usedWidthPx: usableW };
  }

  const pts: Array<[number, number]> =
    t.geometry === 'system'
      ? [
          [-r * 0.99, t.baseBottomMm + 6],
          [-r * 0.99, t.bodyBottomMm],
          [-r, t.bodyBottomMm],
          [-r, shoulder],
          [-r * 0.85, t.shoulderTopMm],
          [-r * 0.82, t.lidBottomMm],
          [-r * 0.885, t.lidBottomMm],
          [-r * 0.82, t.lidBottomMm + 12.6],
          [-r * 0.593, t.lidTopMm],
          [0, t.lidTopMm],
          [r * 0.593, t.lidTopMm],
          [r * 0.82, t.lidBottomMm + 12.6],
          [r * 0.885, t.lidBottomMm],
          [r * 0.82, t.lidBottomMm],
          [r * 0.85, t.shoulderTopMm],
          [r, shoulder],
          [r, t.bodyBottomMm],
          [r * 0.99, t.bodyBottomMm],
          [r * 0.99, t.baseBottomMm + 6],
        ]
      : [
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
