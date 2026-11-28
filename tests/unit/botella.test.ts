/* ============================================================================
 * BOTELLA TÉRMICA BOWLING 500 ML — geometría, límites y persistencia
 * ----------------------------------------------------------------------------
 * La botella es una VARIANTE de la familia thermo (`geometry: 'bowling'`):
 *   · cuerpo Ø 77.76 mm × 289.8 mm de alto (36 mm/unidad del prototipo);
 *   · frente fijo de 114° centrado en +Z (el dorso queda bloqueado);
 *   · escala 15–100 % con default 72 % (los termos siguen en 10–100 / 45 %);
 *   · sin manija ni zócalo separado: aro de silicona + tapa de acero.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  BOTTLE_MODEL_ID,
  THERMO_MODEL_ID,
  resolveProduct,
  resolveThermoProduct,
} from '@/lib/catalog';
import {
  buildThermoBaseGeometry,
  buildThermoBodyGeometry,
  buildThermoCollarGeometry,
  buildThermoGrooveGeometry,
  buildThermoHandleGeometry,
  buildThermoLidGeometry,
  buildThermoSeamGeometry,
} from '@/three/thermo-builder';
import {
  clampThermoRotation,
  normalizeThermoScaleFor,
  thermoAngleBounds,
  thermoDesignSizeMm,
  thermoSurface,
} from '@/lib/thermo';
import { normalizeState } from '@/lib/projects/persistence';
import { useEditorStore } from '@/lib/store/editor';

const product = resolveThermoProduct(BOTTLE_MODEL_ID);
const spec = product.thermo;

function positionCount(geometry: { getAttribute(name: string): { count: number } | undefined }): number {
  return geometry.getAttribute('position')?.count ?? 0;
}

describe('botella Bowling — catálogo y medidas del prototipo', () => {
  it('vive en la categoría botellas como variante thermo', () => {
    expect(product.family).toBe('thermo');
    expect(product.category).toBe('botellas');
    expect(spec.geometry).toBe('bowling');
    expect(spec.capacityLabel).toBe('500 ml');
  });

  it('mide Ø 77.76 mm × 289.8 mm de alto (36 mm/unidad)', () => {
    expect(spec.radiusMm).toBeCloseTo(38.88, 2);
    expect(spec.totalHeightMm).toBeCloseTo(289.8, 2);
    expect(spec.neckRadiusMm).toBeCloseTo(20.16, 2);
    expect(spec.lidTopMm).toBeCloseTo(spec.totalHeightMm, 2);
  });

  it('el frente fijo de 114° centra el arco en +Z y limita el diseño a ±57°', () => {
    const surface = thermoSurface(spec);
    const usableArcDeg =
      (surface.usableWidthMm / spec.engraveRadiusMm) * (180 / Math.PI);
    expect(usableArcDeg).toBeCloseTo(114, 2);
    const bounds = thermoAngleBounds(spec, spec.defaultScalePct, 1);
    expect(bounds.centerDeg).toBeCloseTo(0, 5);
    // El centro del diseño se mueve dentro del frente; a 72 % el ancho ya
    // consume parte del arco, así que el rango es menor que ±57°.
    expect(bounds.minDeg).toBeGreaterThan(-57);
    expect(bounds.maxDeg).toBeLessThan(57);
    expect(bounds.minDeg).toBeLessThan(0);
    expect(bounds.maxDeg).toBeGreaterThan(0);
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
});

describe('botella Bowling — geometría procedural', () => {
  it('el cuerpo llega al radio del prototipo y cierra en el cuello', () => {
    const body = buildThermoBodyGeometry(spec);
    body.computeBoundingBox();
    expect(body.boundingBox!.max.x).toBeCloseTo(spec.radiusMm, 2);
    expect(body.boundingBox!.max.y).toBeCloseTo(spec.collarBottomMm, 2);
    expect(body.boundingBox!.min.y).toBeCloseTo(spec.baseBottomMm, 2);
  });

  it('la tapa de acero corona la botella y el aro de silicona une cuello y tapa', () => {
    const lid = buildThermoLidGeometry(spec);
    lid.computeBoundingBox();
    expect(lid.boundingBox!.max.y).toBeCloseTo(spec.totalHeightMm, 2);
    // Las estrías suman una décima de mm al radio nominal de la tapa.
    const rCap = spec.neckRadiusMm + 0.028 * 36;
    expect(lid.boundingBox!.max.x).toBeGreaterThan(rCap);
    expect(lid.boundingBox!.max.x).toBeLessThan(rCap + 0.2);

    const collar = buildThermoCollarGeometry(spec);
    collar.computeBoundingBox();
    expect(positionCount(collar)).toBeGreaterThan(0);
    expect(collar.boundingBox!.max.y).toBeCloseTo(spec.collarTopMm, 2);
    expect(collar.boundingBox!.max.x).toBeCloseTo(spec.neckRadiusMm + 0.018 * 36, 2);
  });

  it('no tiene zócalo, manija, ranuras ni junta de System', () => {
    expect(positionCount(buildThermoBaseGeometry(spec))).toBe(0);
    expect(positionCount(buildThermoHandleGeometry(spec))).toBe(0);
    expect(positionCount(buildThermoGrooveGeometry(spec))).toBe(0);
    expect(positionCount(buildThermoSeamGeometry(spec))).toBe(0);
  });
});

describe('botella Bowling — persistencia y estado del editor', () => {
  it('sin escala persistida arranca en 72 % (no en el 45 % del termo)', () => {
    expect(normalizeState({ mateModel: BOTTLE_MODEL_ID }).design.scale).toBe(72);
    expect(
      normalizeState({ mateModel: BOTTLE_MODEL_ID, design: { rotation: 30 } }).design.scale,
    ).toBe(72);
  });

  it('clampea al rango de la botella y conserva el paso 0.5 %', () => {
    expect(normalizeState({ mateModel: BOTTLE_MODEL_ID, design: { scale: 5 } }).design.scale).toBe(15);
    expect(normalizeState({ mateModel: BOTTLE_MODEL_ID, design: { scale: 150 } }).design.scale).toBe(100);
    expect(normalizeState({ mateModel: BOTTLE_MODEL_ID, design: { scale: 72.3 } }).design.scale).toBe(72.5);
  });

  it('el borrador de variantes usa el rango de la botella', () => {
    const state = normalizeState({
      mateModel: BOTTLE_MODEL_ID,
      linkDraft: [{ id: 'A', label: 'Frente', scalePct: 5, rotationDeg: 0, mirror: false, included: true }],
    });
    expect(state.linkDraft[0]?.scalePct).toBe(15);
  });

  it('setMateModel parte del default de cada geometría y setDesignScale la respeta', () => {
    const before = useEditorStore.getState();
    try {
      useEditorStore.getState().setMateModel(BOTTLE_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(72);

      useEditorStore.getState().setDesignScale(5);
      expect(useEditorStore.getState().design.scale).toBe(15);
      useEditorStore.getState().setDesignScale(150);
      expect(useEditorStore.getState().design.scale).toBe(100);

      // Cambiar de geometría dentro de thermo vuelve al default del producto.
      useEditorStore.getState().setMateModel(THERMO_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(45);
      useEditorStore.getState().setMateModel(BOTTLE_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(72);

      // Volver a un mate conserva el default histórico de la familia.
      useEditorStore.getState().setMateModel('imperial');
      expect(useEditorStore.getState().design.scale).toBe(100);
    } finally {
      useEditorStore.getState().restoreState(before, before.projectId);
    }
  });

  it('resolveProduct conoce el id y el fallback sigue siendo el mate', () => {
    expect(resolveProduct(BOTTLE_MODEL_ID).id).toBe(BOTTLE_MODEL_ID);
    expect(resolveProduct('botella-desconocida').family).toBe('mate');
  });
});
