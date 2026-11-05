/* ============================================================================
 * VIROLA — ÚNICA FUENTE: spec_tecnica_geometrica_guias_y_rotacion_360.md
 * ----------------------------------------------------------------------------
 * R1: restricciones duras de diámetros — D_ext ∈ [70.0, 180.0] mm, D_int ∈
 *     [50.0, 150.0] mm, paso 0.5, y la chapa mínima W = (Dext−Dint)/2 ≥ 4.0 mm
 *     (⇔ Dint ≤ Dext − 8.0). De ahí derivan RANGOS DINÁMICOS que re-mapean al
 *     vuelo: Dint^max = min(150, Dext−8) y Dext^min = max(70, Dint+8). Valores
 *     fuera de rango se ACOTAN (clamp) con aviso inline — jamás un error rojo.
 * R2: métricas auto-calculadas — Dcentro = (Dext+Dint)/2 y Wbanda =
 *     (Dext−Dint)/2, 1 decimal en mm (las tarjetas de la Ficha, pos 9, leerán
 *     de acá vía los mismos campos del estado).
 * R6: triada de guías persistida por proyecto en `projects.state.guidesState`
 *     (default true×3; control de dispositivo, jamás en fichas ni links).
 * R7: auto-giro diferenciado — editor 0.75 RPM (Modo Cliente 0.5 RPM, pos 10).
 *
 * Todo acá es PURO (tests + motor + UI). El evento único
 * `virola.dimensionsChanged` vive en `lib/virola/cascade.ts` (R3).
 * ============================================================================ */

import { DEFAULT_EXT_DIAMETER_MM, DEFAULT_INT_DIAMETER_MM } from '@/three/visual-skeleton';

/** R1: rangos globales de los diámetros (mm). */
export const EXT_DIAMETER_RANGE_MM = { min: 70.0, max: 180.0 } as const;
export const INT_DIAMETER_RANGE_MM = { min: 50.0, max: 150.0 } as const;

/** R1: paso obligatorio en todos los inputs (teclado, ± y sliders), en mm. */
export const DIAMETER_STEP_MM = 0.5;

/** R1: chapa mínima — W = (Dext − Dint)/2 ≥ 4.0 mm (⇔ Dint ≤ Dext − 8.0). */
export const MIN_BAND_WIDTH_MM = 4.0;

export interface Diameters {
  extDiameter: number;
  intDiameter: number;
}

/* -------------------------------------------------------------------------- */
/* R5 — tabla canónica de guías (colores y tipos)                             */
/* -------------------------------------------------------------------------- */

/**
 * R5: colores hex DEFINIDOS EN LA SPEC. Viven en esta librería (pura) porque
 * los consumen el motor (three/guides.ts) y la tarjeta de Medidas — sin
 * duplicar la tabla.
 */
export const GUIDE_COLORS = {
  bordes: '#4FC3F7',
  centro: '#FFC84A',
  ejes: '#FF7043',
} as const;

export type GuideKey = keyof typeof GUIDE_COLORS;

/* -------------------------------------------------------------------------- */
/* R7 — auto-giro por contexto                                                */
/* -------------------------------------------------------------------------- */

/** R7: velocidad del editor (spec §3). El Modo Cliente gira a 0.5 RPM (pos 10). */
export const EDITOR_AUTO_SPIN_RPM = 0.75;
/** R7: velocidad del Modo Cliente — declarada acá; su consumo llega con la pos 10. */
export const CLIENT_MODE_AUTO_SPIN_RPM = 0.5;

/** 1 RPM ⇒ 6°/s. 0.75 RPM ⇒ 4.5°/s (rad/s ≈ 0.0785). */
export function rpmToRadPerSec(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

/* -------------------------------------------------------------------------- */
/* R6 — estado de guías (persistido por proyecto)                             */
/* -------------------------------------------------------------------------- */

export interface GuidesState {
  /** Bordes de Chapa (Ext e Int) — #4FC3F7 */
  bordes: boolean;
  /** Línea Central de Posición — #FFC84A */
  centro: boolean;
  /** Ejes Simétricos 12h/6h — #FF7043 */
  ejes: boolean;
}

/** R6: en proyecto nuevo las tres guías nacen activas (true×3). */
export const DEFAULT_GUIDES_STATE: GuidesState = { bordes: true, centro: true, ejes: true };

/**
 * Normaliza el jsonb de `projects.state.guidesState` (R6/§6): claves ausentes,
 * no booleanas o jsonb corrupto ⇒ default `true` de la spec. Nunca rompe la carga.
 */
export function normalizeGuidesState(raw: unknown): GuidesState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_GUIDES_STATE };
  const o = raw as Partial<Record<keyof GuidesState, unknown>>;
  const flag = (v: unknown): boolean => (typeof v === 'boolean' ? v : true);
  return { bordes: flag(o.bordes), centro: flag(o.centro), ejes: flag(o.ejes) };
}

/* -------------------------------------------------------------------------- */
/* Helpers numéricos                                                          */
/* -------------------------------------------------------------------------- */

function saneNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Limpia polvo de floats: 123.00000000003 ⇒ 123 (multiple de 0.5 ⇒ 2 decimales bastan). */
function cleanNumber(v: number): number {
  return Number(v.toFixed(2));
}

/**
 * §6: decimales no válidos de paso ⇒ redondeo al MÚLTIPLO DE 0.5 MÁS CERCANO
 * (spec literal: 123.3 ⇒ 123.5).
 */
export function snapToStepMm(v: number, step = DIAMETER_STEP_MM): number {
  return cleanNumber(Math.round(v / step) * step);
}

/** Detrás de los inputs: acepta coma o punto decimal (es-AR) y rechaza basura. */
export function parseDiameterText(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null; // "abc", "12a3", "" ⇒ inválido
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* -------------------------------------------------------------------------- */
/* R1 — rangos dinámicos (re-mapean al vuelo, §6: "sin puntos muertos")       */
/* -------------------------------------------------------------------------- */

/** Dint^max = min(150.0, Dext − 8.0)  ·  QA1: con Dext 123.0 ⇒ 115.0. */
export function intDiameterMaxMm(extDiameterMm: number): number {
  return Math.min(INT_DIAMETER_RANGE_MM.max, cleanNumber(extDiameterMm - 2 * MIN_BAND_WIDTH_MM));
}

/** Dext^min = max(70.0, Dint + 8.0)  ·  §6: con Dint 150.0 ⇒ 158.0. */
export function extDiameterMinMm(intDiameterMm: number): number {
  return Math.max(EXT_DIAMETER_RANGE_MM.min, cleanNumber(intDiameterMm + 2 * MIN_BAND_WIDTH_MM));
}

export interface DiameterRange {
  min: number;
  max: number;
}

/** Rango (re-mapeado) del input D_int contra la D_ext vigente. */
export function intRangeFor(extDiameterMm: number): DiameterRange {
  return { min: INT_DIAMETER_RANGE_MM.min, max: intDiameterMaxMm(extDiameterMm) };
}

/** Rango (re-mapeado) del input D_ext contra la D_int vigente. */
export function extRangeFor(intDiameterMm: number): DiameterRange {
  return { min: extDiameterMinMm(intDiameterMm), max: EXT_DIAMETER_RANGE_MM.max };
}

/* -------------------------------------------------------------------------- */
/* R1 — régene único de todo Cambio de medida (inputs, sliders y restauración)*/
/* -------------------------------------------------------------------------- */

export type ClampReason = 'rango' | 'chapa' | null;

export interface FieldClamp {
  value: number;
  adjusted: boolean;
  reason: ClampReason;
}

export interface ReconciledDiameters extends Diameters {
  extAdjusted: boolean;
  intAdjusted: boolean;
  extReason: ClampReason;
  intReason: ClampReason;
}

function clampTo(v: number, r: DiameterRange): number {
  return cleanNumber(Math.min(Math.max(v, r.min), r.max));
}

/** R1: D_int fuera de su rango (global o dinámico) ⇒ clamp al extremo válido. */
function clampIntField(intRaw: number, ext: number): FieldClamp {
  const r = intRangeFor(ext);
  if (intRaw >= r.min && intRaw <= r.max) return { value: intRaw, adjusted: false, reason: null };
  if (intRaw < INT_DIAMETER_RANGE_MM.min || intRaw > INT_DIAMETER_RANGE_MM.max) {
    return { value: clampTo(intRaw, r), adjusted: true, reason: 'rango' };
  }
  // Dentro del rango global pero viola Dint ≤ Dext − 8 ⇒ chapa mínima (QA1).
  return { value: clampTo(intRaw, r), adjusted: true, reason: 'chapa' };
}

/** R1: D_ext fuera de SU rango (global o dinámico Dint+8) ⇒ clamp al extremo. */
function clampExtField(extRaw: number, int: number): FieldClamp {
  const r = extRangeFor(int);
  if (extRaw >= r.min && extRaw <= r.max) return { value: extRaw, adjusted: false, reason: null };
  if (extRaw < EXT_DIAMETER_RANGE_MM.min || extRaw > EXT_DIAMETER_RANGE_MM.max) {
    return { value: clampTo(extRaw, r), adjusted: true, reason: 'rango' };
  }
  return { value: clampTo(extRaw, r), adjusted: true, reason: 'chapa' };
}

/** Solo rango GLOBAL de D_ext (70–180) — lo usa la restauración (orden §6). */
function clampExtGlobal(extRaw: number): FieldClamp {
  const r: DiameterRange = { min: EXT_DIAMETER_RANGE_MM.min, max: EXT_DIAMETER_RANGE_MM.max };
  if (extRaw >= r.min && extRaw <= r.max) return { value: extRaw, adjusted: false, reason: null };
  return { value: clampTo(extRaw, r), adjusted: true, reason: 'rango' };
}

/**
 * R1 completo (§6): el campo TOCADO manda; el otro se re-acota contra su rango
 * dinámico. Al restaurar estado (sin campo tocado) el orden canónico es ext ⇒
 * int (los literales de §6: "Dext=70 ⇒ Dint se limita a ≤62"; "Dint=150 ⇒
 * Dext exige ≥158"). Idempotente: el resultado vuelve a dar el mismo valor.
 * Texto inválido (NaN/pesado) ⇒ default del proyecto (§2: 123.0/95.0).
 */
export function reconcileDiameters(raw: Diameters, touched?: 'ext' | 'int'): ReconciledDiameters {
  const extRaw = snapToStepMm(saneNumber(raw.extDiameter, DEFAULT_EXT_DIAMETER_MM));
  const intRaw = snapToStepMm(saneNumber(raw.intDiameter, DEFAULT_INT_DIAMETER_MM));

  if (touched === undefined) {
    // Restauración (jsonb/live) — orden canónico §6: D_ext contra su rango
    // global, y D_int re-acotado al carril dinámico del D_ext final
    // ("Dext=70 ⇒ Dint se limita a ≤62").
    const e = clampExtGlobal(extRaw);
    const i = clampIntField(intRaw, e.value);
    return {
      extDiameter: e.value,
      intDiameter: i.value,
      extAdjusted: e.adjusted,
      intAdjusted: i.adjusted,
      extReason: e.reason,
      intReason: i.reason,
    };
  }

  if (touched === 'int') {
    const i = clampIntField(intRaw, extRaw);
    const e = clampExtField(extRaw, i.value); // guarda de invariante (no-op en práctica)
    return {
      extDiameter: e.value,
      intDiameter: i.value,
      extAdjusted: e.adjusted,
      intAdjusted: i.adjusted,
      extReason: e.reason,
      intReason: i.reason,
    };
  }

  const e = clampExtField(extRaw, intRaw);
  const i = clampIntField(intRaw, e.value); // re-acota D_int al nuevo carril (R1)
  return {
    extDiameter: e.value,
    intDiameter: i.value,
    extAdjusted: e.adjusted,
    intAdjusted: i.adjusted,
    extReason: e.reason,
    intReason: i.reason,
  };
}

/* -------------------------------------------------------------------------- */
/* R2 — métricas auto-calculadas (formato 1 decimal, sincronizadas con ficha) */
/* -------------------------------------------------------------------------- */

export interface VirolaMetrics {
  /** Dcentro = (Dext + Dint)/2 — línea media para centrado de isotipos. */
  centerDiameterMm: number;
  /** Wbanda = (Dext − Dint)/2 — ancho de la chapa plana (≥ 4.0 mm por R1). */
  bandWidthMm: number;
}

function round1(v: number): number {
  return Number(v.toFixed(1));
}

export function virolaMetrics(d: Diameters): VirolaMetrics {
  return {
    centerDiameterMm: round1((d.extDiameter + d.intDiameter) / 2),
    bandWidthMm: round1((d.extDiameter - d.intDiameter) / 2),
  };
}
