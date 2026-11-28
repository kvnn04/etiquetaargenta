/* ============================================================================
 * TERMO MATERO MEDIA MANIJA 1 L — estado, límites y materiales
 * ----------------------------------------------------------------------------
 * El termo NO comparte la semántica del mate: el grabado vive en la pared
 * lateral pintada (no en la corona) y la manija lateral bloquea un arco del
 * cuerpo. Este módulo concentra:
 *   · el estado persistible propio (`thermo`: posición vertical, invertido y
 *     acabado) — rotación/escala/espejo siguen viviendo en `design`;
 *   · la paleta y los PBR del cuerpo/acabado;
 *   · los límites angulares/verticales y el chequeo de margen lateral.
 * Es PURO: lo consumen editor, ficha, visor y tests sin tocar three.
 * ============================================================================ */

import type { ThermoProduct, ThermoSpec } from '@/lib/catalog';
import { normalizeRotation } from '@/lib/design';
import { normalizeHex } from '@/lib/color';
import type { OverflowCheck } from '@/lib/overflow';

export type ThermoFinish = 'matte' | 'satin' | 'brushed';

/** Estado del termo que viaja en `projects.state.thermo`. */
export interface ThermoConfig {
  /** Posición vertical del centro del grabado: -100 (abajo) … 100 (arriba). */
  offsetYPct: number;
  /** Grabado invertido (negative space), como el prototipo. */
  invert: boolean;
  /** Acabado del cuerpo pintado. */
  finish: ThermoFinish;
}

export const DEFAULT_THERMO_CONFIG: ThermoConfig = {
  offsetYPct: 0,
  invert: false,
  finish: 'matte',
};

/** Color de cuerpo por defecto del termo (Negro Mate del prototipo). */
export const THERMO_DEFAULT_BODY_COLOR = '#181A1F';

export const THERMO_SCALE_RANGE = { min: 10, max: 100 } as const;
export const THERMO_SCALE_STEP_PCT = 0.5;
export const THERMO_OFFSET_STEP_PCT = 1;

export interface ThermoPaletteColor {
  name: string;
  hex: string;
  /** Acero inoxidable: PBR metálico aunque el acabado sea pintado. */
  steel?: boolean;
}

/** Paleta comercial del prototipo (mismos HEX). */
export const THERMO_PALETTE: readonly ThermoPaletteColor[] = [
  { name: 'Acero Inoxidable', hex: '#CFD4DA', steel: true },
  { name: 'Negro Mate', hex: '#181A1F' },
  { name: 'Blanco Tiza', hex: '#F2F3F5' },
  { name: 'Verde Oliva', hex: '#2E4436' },
  { name: 'Azul Marino', hex: '#1B365D' },
  { name: 'Terracota', hex: '#B55239' },
  { name: 'Borravino', hex: '#6B1D2F' },
  { name: 'Arena', hex: '#D5C7B2' },
];

export const THERMO_FINISH_OPTIONS: ReadonlyArray<{ id: ThermoFinish; label: string }> = [
  { id: 'matte', label: 'Mate Rugoso' },
  { id: 'satin', label: 'Satinado' },
  { id: 'brushed', label: 'Metálico' },
];

/** PBR del cuerpo pintado según acabado (el acero manda metalness alto). */
export function thermoBodyPbr(
  finish: ThermoFinish,
  color: string | null,
): { color: string; metalness: number; roughness: number } {
  const hex = normalizeHex(color ?? '') ?? THERMO_DEFAULT_BODY_COLOR;
  const steel = THERMO_PALETTE.some((p) => p.steel && p.hex === hex);
  if (steel) return { color: hex, metalness: 0.92, roughness: 0.22 };
  switch (finish) {
    case 'satin':
      return { color: hex, metalness: 0.35, roughness: 0.42 };
    case 'brushed':
      return { color: hex, metalness: 0.65, roughness: 0.3 };
    default:
      return { color: hex, metalness: 0.18, roughness: 0.72 };
  }
}

export function thermoFinishLabel(finish: ThermoFinish): string {
  return THERMO_FINISH_OPTIONS.find((f) => f.id === finish)?.label ?? 'Mate Rugoso';
}

export function thermoColorName(hex: string | null): string {
  const norm = normalizeHex(hex ?? '');
  if (!norm) return 'Negro Mate';
  return THERMO_PALETTE.find((p) => p.hex === norm)?.name ?? 'Color Libre';
}

/** Tono del grabado: sobre cuerpo claro se quema oscuro; sobre oscuro, plata. */
export function thermoLaserBurn(color: string | null): { color: string; opacity: number } {
  const norm = normalizeHex(color ?? '') ?? THERMO_DEFAULT_BODY_COLOR;
  const steel = THERMO_PALETTE.some((p) => p.steel && p.hex === norm);
  if (steel) return { color: '#23272E', opacity: 0.9 };
  const n = parseInt(norm.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum >= 0.55
    ? { color: '#2B2118', opacity: 0.88 }
    : { color: '#C9CCCF', opacity: 0.92 };
}

/* -------------------------------------------------------------------------- */
/* Normalizadores tolerantes (jsonb / payload / UI)                            */
/* -------------------------------------------------------------------------- */

export function normalizeThermoScale(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 45;
  const clamped = Math.min(Math.max(raw, THERMO_SCALE_RANGE.min), THERMO_SCALE_RANGE.max);
  const stepped = Math.round(clamped / THERMO_SCALE_STEP_PCT) * THERMO_SCALE_STEP_PCT;
  return Number(
    Math.min(Math.max(stepped, THERMO_SCALE_RANGE.min), THERMO_SCALE_RANGE.max).toFixed(2),
  );
}

/**
 * Escala canónica del spec vigente: usa SU default y SU rango (el termo
 * 10–100 / 45 %, la botella 15–100 / 72 %). Sin esto un proyecto de botella
 * sin escala arrancaría en 45 % y un valor viejo de 10 % quedaría fuera del
 * mínimo del prototipo.
 */
export function normalizeThermoScaleFor(spec: ThermoSpec, raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return spec.defaultScalePct;
  const clamped = Math.min(Math.max(raw, spec.minScalePct), spec.maxScalePct);
  const stepped = Math.round(clamped / THERMO_SCALE_STEP_PCT) * THERMO_SCALE_STEP_PCT;
  return Number(
    Math.min(Math.max(stepped, spec.minScalePct), spec.maxScalePct).toFixed(2),
  );
}

export function normalizeThermoOffset(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const clamped = Math.min(100, Math.max(-100, raw));
  return Number((Math.round(clamped / THERMO_OFFSET_STEP_PCT) * THERMO_OFFSET_STEP_PCT).toFixed(0));
}

export function normalizeThermoFinish(raw: unknown): ThermoFinish {
  return raw === 'satin' || raw === 'brushed' || raw === 'matte'
    ? raw
    : DEFAULT_THERMO_CONFIG.finish;
}

export function normalizeThermoConfig(raw: unknown): ThermoConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_THERMO_CONFIG };
  }
  const o = raw as { offsetYPct?: unknown; invert?: unknown; finish?: unknown };
  return {
    offsetYPct: normalizeThermoOffset(o.offsetYPct),
    invert: o.invert === true,
    finish: normalizeThermoFinish(o.finish),
  };
}

export function formatThermoScaleLabel(pct: number): string {
  const norm = normalizeThermoScale(pct);
  return Number.isInteger(norm) ? `${norm}%` : `${norm.toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/* Geometría de la zona de grabado                                             */
/* -------------------------------------------------------------------------- */

export interface ThermoSurface {
  /** Perímetro completo del cuerpo a la altura del grabado. */
  widthMm: number;
  /** Ancho del arco libre (perímetro menos la franja de la manija). */
  usableWidthMm: number;
  /** Alto útil entre zócalo y collarín (con margen del prototipo). */
  heightMm: number;
  centerYMm: number;
  minYMm: number;
  maxYMm: number;
}

export function thermoSurface(spec: ThermoSpec): ThermoSurface {
  const widthMm = 2 * Math.PI * spec.engraveRadiusMm;
  return {
    widthMm,
    usableWidthMm: Math.max(0, widthMm - spec.engraveRadiusMm * spec.handleBlockedArcRad),
    heightMm: spec.engraveMaxYMm - spec.engraveMinYMm,
    centerYMm: (spec.engraveMinYMm + spec.engraveMaxYMm) / 2,
    minYMm: spec.engraveMinYMm,
    maxYMm: spec.engraveMaxYMm,
  };
}

/** Tamaño físico del diseño (mm) al 100 %, contain-fit con el aspecto real. */
export function thermoDesignSizeMm(
  spec: ThermoSpec,
  aspect: number,
  scalePct: number,
): { widthMm: number; heightMm: number } {
  const surface = thermoSurface(spec);
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // El prototipo ajusta el 100 % al ARCO LIBRE (no al perímetro completo):
  // la media manija nunca forma parte de la superficie de grabado.
  let maxW = surface.usableWidthMm * 0.96;
  let maxH = surface.heightMm * 0.96;
  if (maxW / maxH > a) maxW = maxH * a;
  else maxH = maxW / a;
  const k = normalizeThermoScaleFor(spec, scalePct) / 100;
  return { widthMm: maxW * k, heightMm: maxH * k };
}

export interface ThermoAngleBounds {
  /** Centro del arco libre (grados canónicos desde el frente +Z). */
  centerDeg: number;
  /** Rango continuo permitido del centro del diseño. */
  minDeg: number;
  maxDeg: number;
  /** Arco bloqueado por la manija (grados canónicos). */
  blockedMinDeg: number;
  blockedMaxDeg: number;
}

export function thermoAngleBounds(
  spec: ThermoSpec,
  scalePct: number,
  aspect = 1,
): ThermoAngleBounds {
  const surface = thermoSurface(spec);
  const size = thermoDesignSizeMm(spec, aspect, scalePct);
  const halfArcDeg = ((size.widthMm / 2) / spec.engraveRadiusMm) * (180 / Math.PI);
  const blockedArcDeg = (spec.handleBlockedArcRad * 180) / Math.PI;
  const centerDeg = normalizeRotation((spec.handleAngleRad * 180) / Math.PI + 180);
  const halfUsable = (360 - blockedArcDeg) / 2;
  const halfRange = Math.max(0, halfUsable - halfArcDeg);
  const minDeg = centerDeg - halfRange;
  const maxDeg = centerDeg + halfRange;
  return {
    centerDeg,
    minDeg,
    maxDeg,
    blockedMinDeg: normalizeRotation((spec.handleAngleRad * 180) / Math.PI - blockedArcDeg / 2),
    blockedMaxDeg: normalizeRotation((spec.handleAngleRad * 180) / Math.PI + blockedArcDeg / 2),
  };
}

/** Distancia angular mínima entre dos ángulos (envolvente 360°). */
function circularDistanceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Lleva un ángulo canónico [0,360) al representante CONTINUO del rango
 * permitido más cercano (el rango puede cruzar 0°). Es el valor que usan el
 * slider y los presets del termo; el store sigue guardando canónico.
 */
export function thermoContinuousAngle(
  spec: ThermoSpec,
  angleDeg: number,
  scalePct: number,
  aspect = 1,
): number {
  const bounds = thermoAngleBounds(spec, scalePct, aspect);
  const raw = normalizeRotation(angleDeg);
  let best = bounds.minDeg;
  let bestDist = Infinity;
  for (const candidate of [raw, raw - 360, raw + 360]) {
    const clamped = Math.min(Math.max(candidate, bounds.minDeg), bounds.maxDeg);
    const dist = circularDistanceDeg(clamped, raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = clamped;
    }
  }
  return best;
}

/**
 * Lleva un ángulo canónico [0,360) al rango permitido y lo devuelve canónico.
 * Evita que el diseño entre en el arco de la manija.
 */
export function clampThermoRotation(
  spec: ThermoSpec,
  angleDeg: number,
  scalePct: number,
  aspect = 1,
): number {
  return normalizeRotation(thermoContinuousAngle(spec, angleDeg, scalePct, aspect));
}

/**
 * Chequeo de margen lateral del termo. Se expresa con el MISMO contrato
 * `OverflowCheck` que consume la ficha: "por fuera" = por encima del collarín
 * o fuera del arco libre; "hacia la boca" = por debajo del zócalo.
 */
export function evaluateThermoOverflow(
  spec: ThermoSpec,
  input: { scalePct: number; offsetYPct: number; aspect: number },
): OverflowCheck {
  const size = thermoDesignSizeMm(spec, input.aspect, input.scalePct);
  const surface = thermoSurface(spec);
  const slackY = Math.max(0, (surface.heightMm - size.heightMm) / 2);
  const centerY = surface.centerYMm + (normalizeThermoOffset(input.offsetYPct) / 100) * slackY;
  const top = centerY + size.heightMm / 2;
  const bottom = centerY - size.heightMm / 2;

  const aboveMm = Math.max(0, top - surface.maxYMm);
  const belowMm = Math.max(0, surface.minYMm - bottom);

  /* El arco libre se garantiza al componer: `clampThermoRotation` lleva el
   * ángulo vigente al rango permitido antes de dibujar (editor, visor y
   * ficha). Acá solo se mide el margen VERTICAL, que es el que puede
   * desbordar por escala/posición. */
  const overflowOuter = aboveMm > 0.001;
  const overflowInner = belowMm > 0.001;
  return {
    status: overflowOuter || overflowInner ? 'overflow' : 'safe',
    overflowOuter,
    overflowInner,
    overflowOuterMm: Number(aboveMm.toFixed(1)),
    overflowInnerMm: Number(belowMm.toFixed(1)),
  };
}

/** Texto propio del banner del termo/botella (la ficha reusa el genérico). */
export function thermoOverflowText(check: OverflowCheck, spec?: ThermoSpec): string {
  const parts: string[] = [];
  if (check.overflowOuter) parts.push(`Excede ${check.overflowOuterMm.toFixed(1)} mm por arriba`);
  if (check.overflowInner) parts.push(`Excede ${check.overflowInnerMm.toFixed(1)} mm por abajo`);
  const producto = spec?.geometry === 'bowling' ? 'la botella' : 'el termo';
  return `El diseño sale de la zona de grabado de ${producto}. ${parts.join(' / ')}.`;
}

export function resolveThermoSpec(product: ThermoProduct): ThermoSpec {
  return product.thermo;
}
