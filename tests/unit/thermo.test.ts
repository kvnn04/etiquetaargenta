import { describe, expect, it } from 'vitest';
import { THERMO_MODEL_ID, resolveThermoProduct } from '@/lib/catalog';
import { normalizeState } from '@/lib/projects/persistence';
import {
  clampThermoRotation,
  evaluateThermoOverflow,
  normalizeThermoConfig,
  normalizeThermoOffset,
  normalizeThermoScale,
  thermoAngleBounds,
  thermoContinuousAngle,
  thermoDesignSizeMm,
  thermoSurface,
} from '@/lib/thermo';

/* =====================================================================
 * TERMO MATERO MEDIA MANIJA 1 L — geometría, límites y normalizadores
 * ===================================================================== */

const spec = resolveThermoProduct(THERMO_MODEL_ID).thermo;

describe('termo — geometría derivada del prototipo', () => {
  it('mide 1 L: radio 40.32 mm y alto total 250.92 mm', () => {
    expect(spec.radiusMm).toBeCloseTo(40.32, 2);
    expect(spec.totalHeightMm).toBeCloseTo(250.92, 2);
  });

  it('la superficie útil excluye el arco de la media manija', () => {
    const surface = thermoSurface(spec);
    expect(surface.widthMm).toBeCloseTo(2 * Math.PI * spec.engraveRadiusMm, 3);
    expect(surface.usableWidthMm).toBeCloseTo(
      surface.widthMm - spec.engraveRadiusMm * spec.handleBlockedArcRad,
      3,
    );
    expect(surface.usableWidthMm).toBeLessThan(surface.widthMm);
    expect(surface.heightMm).toBeCloseTo(spec.engraveMaxYMm - spec.engraveMinYMm, 3);
  });

  it('el 100 % se ajusta al arco libre (no al perímetro completo)', () => {
    const surface = thermoSurface(spec);
    const size = thermoDesignSizeMm(spec, 1, 100);
    expect(size.widthMm).toBeLessThanOrEqual(surface.usableWidthMm * 0.96 + 1e-9);
    expect(size.heightMm).toBeLessThanOrEqual(surface.heightMm * 0.96 + 1e-9);
    expect(size.widthMm).toBeCloseTo(size.heightMm, 6); // aspecto 1 ⇒ cuadrado
  });

  it('45 % es el default y deja el frente dentro del arco libre', () => {
    const size = thermoDesignSizeMm(spec, 1, spec.defaultScalePct);
    const bounds = thermoAngleBounds(spec, spec.defaultScalePct, 1);
    expect(size.widthMm).toBeCloseTo(66.56, 1);
    expect(bounds.minDeg).toBeLessThan(0);
    expect(bounds.maxDeg).toBeGreaterThan(0);
    expect(clampThermoRotation(spec, 0, spec.defaultScalePct, 1)).toBe(0);
  });
});

describe('termo — límites angulares conscientes de la manija', () => {
  it('un ángulo canónico cerca de 360 no salta al otro extremo', () => {
    // 350° = -10°: válido a 45 % (rango continuo [-24.6°, 204.6°]).
    expect(thermoContinuousAngle(spec, 350, 45, 1)).toBeCloseTo(-10, 5);
    expect(clampThermoRotation(spec, 350, 45, 1)).toBe(350);
  });

  it('a 100 % el diseño grande se corre al arco libre (el frente ya no entra)', () => {
    const bounds = thermoAngleBounds(spec, 100, 1);
    expect(bounds.minDeg).toBeGreaterThan(0);
    expect(clampThermoRotation(spec, 0, 100, 1)).toBeGreaterThan(0);
  });

  it('nunca devuelve un ángulo dentro del arco bloqueado', () => {
    const blockedCenter = (spec.handleAngleRad * 180) / Math.PI;
    const clamped = clampThermoRotation(spec, blockedCenter, 45, 1);
    const delta = Math.abs(((clamped - blockedCenter + 540) % 360) - 180);
    expect(delta).toBeGreaterThan((spec.handleBlockedArcRad * 180) / Math.PI / 2);
  });
});

describe('termo — normalizadores tolerantes', () => {
  it('escala 10–100 con default 45', () => {
    expect(normalizeThermoScale(undefined)).toBe(45);
    expect(normalizeThermoScale(0)).toBe(10);
    expect(normalizeThermoScale(150)).toBe(100);
    expect(normalizeThermoScale(45.24)).toBe(45);
  });

  it('posición vertical -100…100 y acabado válido', () => {
    expect(normalizeThermoOffset(undefined)).toBe(0);
    expect(normalizeThermoOffset(-300)).toBe(-100);
    expect(normalizeThermoOffset(300)).toBe(100);
    expect(normalizeThermoConfig(null)).toEqual({
      offsetYPct: 0,
      invert: false,
      finish: 'matte',
    });
    expect(normalizeThermoConfig({ offsetYPct: 42, invert: true, finish: 'brushed' })).toEqual({
      offsetYPct: 42,
      invert: true,
      finish: 'brushed',
    });
  });

  it('el margen lateral es seguro en todo el recorrido vertical', () => {
    expect(
      evaluateThermoOverflow(spec, { scalePct: 45, offsetYPct: 0, aspect: 1 }).status,
    ).toBe('safe');
    expect(
      evaluateThermoOverflow(spec, { scalePct: 100, offsetYPct: 100, aspect: 1 }).status,
    ).toBe('safe');
    expect(
      evaluateThermoOverflow(spec, { scalePct: 100, offsetYPct: -100, aspect: 1 }).status,
    ).toBe('safe');
  });
});

describe('termo — persistencia del proyecto', () => {
  it('conserva la escala del termo al recargar (45 %, no el mínimo del mate)', () => {
    const state = normalizeState({
      mateModel: THERMO_MODEL_ID,
      design: { rotation: 90, scale: 45, mirror: true },
      thermo: { offsetYPct: 20, invert: true, finish: 'satin' },
    });
    expect(state.design).toEqual({ rotation: 90, scale: 45, mirror: true });
    expect(state.thermo).toEqual({ offsetYPct: 20, invert: true, finish: 'satin' });
  });

  it('un termo sin escala persistida arranca en su default (45 %)', () => {
    expect(normalizeState({ mateModel: THERMO_MODEL_ID }).design.scale).toBe(45);
    expect(
      normalizeState({ mateModel: THERMO_MODEL_ID, design: { rotation: 0 } }).design.scale,
    ).toBe(45);
  });

  it('un mate conserva su propio rango [70,110]', () => {
    expect(normalizeState({ mateModel: 'imperial', design: { scale: 45 } }).design.scale).toBe(70);
    expect(normalizeState({ mateModel: 'imperial', design: { scale: 100 } }).design.scale).toBe(100);
  });
});
