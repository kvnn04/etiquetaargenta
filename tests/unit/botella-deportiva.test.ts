/* ============================================================================
 * BOTELLA DEPORTIVA CON PICO Y MOSQUETÓN 500 ML — geometría, límites y estado
 * ----------------------------------------------------------------------------
 * Es una VARIANTE de la familia thermo (`geometry: 'sport'`) con el mismo
 * contrato que la Bowling:
 *   · cuerpo acinturado Ø ≈ 71.4 mm × ≈ 261 mm de alto (49.08 mm/unidad);
 *   · frente fijo de 114° centrado en +Z (el dorso queda bloqueado);
 *   · escala 15–100 % con default 72 %;
 *   · sin manija lateral: cuello de acero, tapa negra, asa, pico y mosquetón.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  SPORT_BOTTLE_MODEL_ID,
  SPORT_MM_PER_UNIT,
  THERMO_MODEL_ID,
  isBottleGeometry,
  resolveProduct,
  resolveThermoProduct,
  sportUnitRadiusAt,
} from '@/lib/catalog';
import {
  buildThermoBaseGeometry,
  buildThermoBodyGeometry,
  buildThermoCollarGeometry,
  buildThermoEngravingGeometry,
  buildThermoGrooveGeometry,
  buildThermoHandleGeometry,
  buildThermoLidGeometry,
  buildThermoSeamGeometry,
  buildThermoSportCapDetailsGeometry,
  buildThermoSportCarabinerGeometry,
  buildThermoSportHandleGeometry,
  buildThermoSportRingGeometry,
  buildThermoSportSpoutGeometry,
} from '@/three/thermo-builder';
import {
  clampThermoRotation,
  normalizeThermoScaleFor,
  thermoAngleBounds,
  thermoDesignSizeMm,
  thermoOverflowText,
  thermoSurface,
} from '@/lib/thermo';
import { normalizeState } from '@/lib/projects/persistence';
import { useEditorStore } from '@/lib/store/editor';

const product = resolveThermoProduct(SPORT_BOTTLE_MODEL_ID);
const spec = product.thermo;

function positionCount(geometry: { getAttribute(name: string): { count: number } | undefined }): number {
  return geometry.getAttribute('position')?.count ?? 0;
}

describe('botella Deportiva — catálogo y medidas del prototipo', () => {
  it('vive en la categoría botellas como variante thermo', () => {
    expect(product.family).toBe('thermo');
    expect(product.category).toBe('botellas');
    expect(product.label).toBe('Botella Deportiva con Pico y Mosquetón 500 ml');
    expect(spec.geometry).toBe('sport');
    expect(spec.capacityLabel).toBe('500 ml');
    expect(isBottleGeometry(spec.geometry)).toBe(true);
  });

  it('mide Ø ≈ 71.4 mm × ≈ 261.1 mm de alto (49.08 mm/unidad)', () => {
    expect(SPORT_MM_PER_UNIT).toBeCloseTo(49.08, 2);
    expect(spec.radiusMm).toBeCloseTo(35.706, 2);
    expect(spec.totalHeightMm).toBeCloseTo(261.106, 2);
    expect(spec.neckRadiusMm).toBeCloseTo(31.166, 2);
    expect(spec.lidTopMm).toBeLessThan(spec.totalHeightMm); // el asa corona
    expect(spec.lidBottomMm).toBeCloseTo(210.062, 2);
  });

  it('la zona de grabado declarada es de 165 mm y arranca sobre la base', () => {
    const surface = thermoSurface(spec);
    expect(surface.heightMm).toBeCloseTo(165, 1);
    expect(surface.minYMm).toBeCloseTo(18.11, 1);
    expect(surface.maxYMm).toBeCloseTo(183.12, 1);
    // El radio de wrapping es el de la cintura, no el máximo del cuerpo.
    expect(spec.engraveRadiusMm).toBeLessThan(spec.radiusMm);
    expect(spec.engraveRadiusMm).toBeCloseTo(
      sportUnitRadiusAt(0.5) * SPORT_MM_PER_UNIT,
      2,
    );
  });

  it('el frente fijo de 114° centra el arco en +Z y limita el diseño a ±57°', () => {
    const surface = thermoSurface(spec);
    const usableArcDeg =
      (surface.usableWidthMm / spec.engraveRadiusMm) * (180 / Math.PI);
    expect(usableArcDeg).toBeCloseTo(114, 2);
    const bounds = thermoAngleBounds(spec, spec.defaultScalePct, 1);
    expect(bounds.centerDeg).toBeCloseTo(0, 5);
    expect(bounds.minDeg).toBeGreaterThan(-57);
    expect(bounds.maxDeg).toBeLessThan(57);
    expect(bounds.minDeg).toBeCloseTo(-17.6, 1);
    expect(bounds.maxDeg).toBeCloseTo(17.6, 1);
  });

  it('escala 15–100 con default 72 y el grabado nunca sale del frente', () => {
    expect(spec.defaultScalePct).toBe(72);
    expect(spec.minScalePct).toBe(15);
    expect(spec.maxScalePct).toBe(100);
    expect(normalizeThermoScaleFor(spec, undefined)).toBe(72);
    expect(normalizeThermoScaleFor(spec, 5)).toBe(15);
    expect(normalizeThermoScaleFor(spec, 150)).toBe(100);

    const bounds = thermoAngleBounds(spec, spec.defaultScalePct, 1);
    const clamped = clampThermoRotation(spec, 180, spec.defaultScalePct, 1);
    expect(clamped).toBeGreaterThanOrEqual(bounds.minDeg);
    expect(clamped).toBeLessThanOrEqual(bounds.maxDeg);
    expect(Math.abs(clamped)).toBeLessThanOrEqual(57);
  });

  it('el diseño al 100 % sigue entrando en el arco frontal', () => {
    const surface = thermoSurface(spec);
    const size = thermoDesignSizeMm(spec, 1, 100);
    expect(size.widthMm).toBeLessThanOrEqual(surface.usableWidthMm * 0.96 + 1e-9);
    const bounds = thermoAngleBounds(spec, 100, 1);
    expect(bounds.minDeg).toBeLessThan(0);
    expect(bounds.maxDeg).toBeGreaterThan(0);
  });

  it('el aviso de desborde habla de "la botella"', () => {
    const text = thermoOverflowText(
      { status: 'overflow', overflowOuter: true, overflowInner: false, overflowOuterMm: 2, overflowInnerMm: 0 },
      spec,
    );
    expect(text).toContain('la botella');
  });
});

describe('botella Deportiva — geometría procedural', () => {
  it('el cuerpo acinturado llega al radio máximo y cierra en el cuello', () => {
    const body = buildThermoBodyGeometry(spec);
    body.computeBoundingBox();
    // La malla muestrea el perfil: el pico cae a < 0.03 mm del radio teórico.
    expect(body.boundingBox!.max.x).toBeCloseTo(spec.radiusMm, 1);
    expect(body.boundingBox!.max.y).toBeCloseTo(spec.bodyTopMm, 2);
    expect(body.boundingBox!.min.y).toBeCloseTo(spec.baseBottomMm, 2);
  });

  it('la tapa negra es más angosta que el cuello y el aro de acero lo corona', () => {
    const lid = buildThermoLidGeometry(spec);
    lid.computeBoundingBox();
    expect(lid.boundingBox!.max.y).toBeCloseTo(spec.lidTopMm, 2);
    expect(lid.boundingBox!.max.x).toBeLessThanOrEqual(spec.neckRadiusMm + 1e-6);

    const collar = buildThermoCollarGeometry(spec);
    collar.computeBoundingBox();
    expect(positionCount(collar)).toBeGreaterThan(0);
    expect(collar.boundingBox!.max.y).toBeCloseTo(spec.collarTopMm, 2);
    expect(collar.boundingBox!.max.x).toBeCloseTo(spec.neckRadiusMm, 2);
  });

  it('el grabado sigue la cintura cóncava en vez de flotar sobre un cilindro', () => {
    const engrave = buildThermoEngravingGeometry(spec);
    engrave.computeBoundingBox();
    // La superficie sigue el perfil: su radio máximo queda por debajo del
    // radio máximo del cuerpo y por encima del radio de la cintura.
    expect(engrave.boundingBox!.max.x).toBeLessThan(spec.radiusMm);
    expect(engrave.boundingBox!.max.x).toBeGreaterThan(spec.engraveRadiusMm);
    const height = engrave.boundingBox!.max.y - engrave.boundingBox!.min.y;
    expect(height).toBeCloseTo(thermoSurface(spec).heightMm, 2);
  });

  it('no tiene zócalo, manija lateral, ranuras ni junta de System', () => {
    expect(positionCount(buildThermoBaseGeometry(spec))).toBe(0);
    expect(positionCount(buildThermoHandleGeometry(spec))).toBe(0);
    expect(positionCount(buildThermoGrooveGeometry(spec))).toBe(0);
    expect(positionCount(buildThermoSeamGeometry(spec))).toBe(0);
  });

  it('tapa estriada, asa, pico y mosquetón existen y quedan sobre la tapa', () => {
    const cap = buildThermoSportCapDetailsGeometry(spec);
    const handle = buildThermoSportHandleGeometry(spec);
    const spout = buildThermoSportSpoutGeometry(spec);
    const carabiner = buildThermoSportCarabinerGeometry(spec);
    const ring = buildThermoSportRingGeometry(spec);
    for (const geo of [cap, handle, spout, carabiner, ring]) {
      expect(positionCount(geo)).toBeGreaterThan(0);
      geo.computeBoundingBox();
    }
    expect(handle.boundingBox!.max.y).toBeCloseTo(spec.totalHeightMm, 0);
    expect(spout.boundingBox!.min.y).toBeGreaterThan(spec.lidBottomMm);
  });

  it('las piezas deportivas no contaminan los termos existentes', () => {
    const thermos = resolveThermoProduct(THERMO_MODEL_ID).thermo;
    for (const build of [
      buildThermoSportCapDetailsGeometry,
      buildThermoSportHandleGeometry,
      buildThermoSportSpoutGeometry,
      buildThermoSportCarabinerGeometry,
      buildThermoSportRingGeometry,
    ]) {
      expect(positionCount(build(thermos))).toBe(0);
    }
  });
});

describe('botella Deportiva — persistencia y estado del editor', () => {
  it('sin escala persistida arranca en 72 % (no en el 45 % del termo)', () => {
    expect(normalizeState({ mateModel: SPORT_BOTTLE_MODEL_ID }).design.scale).toBe(72);
    expect(
      normalizeState({ mateModel: SPORT_BOTTLE_MODEL_ID, design: { rotation: 30 } }).design.scale,
    ).toBe(72);
  });

  it('clampea al rango de la botella y conserva el paso 0.5 %', () => {
    expect(normalizeState({ mateModel: SPORT_BOTTLE_MODEL_ID, design: { scale: 5 } }).design.scale).toBe(15);
    expect(normalizeState({ mateModel: SPORT_BOTTLE_MODEL_ID, design: { scale: 150 } }).design.scale).toBe(100);
    expect(normalizeState({ mateModel: SPORT_BOTTLE_MODEL_ID, design: { scale: 72.3 } }).design.scale).toBe(72.5);
  });

  it('el borrador de variantes usa el rango de la botella', () => {
    const state = normalizeState({
      mateModel: SPORT_BOTTLE_MODEL_ID,
      linkDraft: [{ id: 'A', label: 'Frente', scalePct: 5, rotationDeg: 0, mirror: false, included: true }],
    });
    expect(state.linkDraft[0]?.scalePct).toBe(15);
  });

  it('cambiar Bowling ⇄ Deportiva conserva el 72 % y volver al termo resetea a 45 %', () => {
    const before = useEditorStore.getState();
    try {
      useEditorStore.getState().setMateModel(SPORT_BOTTLE_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(72);

      useEditorStore.getState().setDesignScale(5);
      expect(useEditorStore.getState().design.scale).toBe(15);

      useEditorStore.getState().setMateModel(THERMO_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(45);
      useEditorStore.getState().setMateModel(SPORT_BOTTLE_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(72);
    } finally {
      useEditorStore.getState().restoreState(before, before.projectId);
    }
  });

  it('resolveProduct conoce el id y el fallback sigue siendo el mate', () => {
    expect(resolveProduct(SPORT_BOTTLE_MODEL_ID).id).toBe(SPORT_BOTTLE_MODEL_ID);
    expect(resolveProduct('botella-deportiva-2l').family).toBe('mate');
  });
});
