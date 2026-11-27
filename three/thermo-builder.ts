/* ============================================================================
 * GEOMETRÍA DEL TERMO — derivada del prototipo
 * `3d_termo_matero_media_manija.html` (1 unidad = 36 mm).
 * ----------------------------------------------------------------------------
 * Todas las medidas salen de `ThermoSpec` (mm absolutos, base apoyada en Y=0).
 * Los perfiles de torno se construyen una vez por producto y se cachean; el
 * grabado usa un cilindro completo con costura al DORSO (u=0.5 = frente +Z),
 * así el diseño puede girar 360° sin partirse en el frente.
 * ============================================================================ */

import * as THREE from 'three';
import type { ThermoSpec } from '@/lib/catalog';
import { THERMO_MM_PER_UNIT } from '@/lib/catalog';
import { thermoSurface } from '@/lib/thermo';

const U = THERMO_MM_PER_UNIT;

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = geometryCache.get(key);
  if (hit) return hit;
  const geo = make();
  geometryCache.set(key, geo);
  return geo;
}

function lathe(points: Array<[number, number]>, segments = 96): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)),
    segments,
  );
}

/** Cuerpo pintado: cilindro recto + hombro biselado (prototipo 5.1). */
export function buildThermoBodyGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  return cached(`thermo-body:${spec.radiusMm}:${spec.bodyBottomMm}:${spec.bodyTopMm}`, () =>
    lathe([
      [0, spec.bodyBottomMm - 2.88],
      [r - 0.08 * U, spec.bodyBottomMm - 2.88],
      [r - 0.02 * U, spec.bodyBottomMm - 2.16],
      [r, spec.bodyBottomMm],
      [r, spec.bodyTopMm],
      [r - 0.025 * U, spec.bodyTopMm + 4.32],
      [r - 0.055 * U, spec.bodyTopMm + 7.92],
      [r - 0.08 * U, spec.shoulderTopMm],
    ]),
  );
}

/** Zócalo de acero (prototipo 5.2). */
export function buildThermoBaseGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  return cached(`thermo-base:${spec.radiusMm}:${spec.baseTopMm}`, () =>
    lathe([
      [0, 0],
      [r - 0.14 * U, 0],
      [r - 0.04 * U, 0.04 * U],
      [r - 0.005 * U, 0.14 * U],
      [r - 0.005 * U, 0.44 * U],
      [r - 0.03 * U, spec.baseTopMm],
      [r - 0.09 * U, spec.baseTopMm],
      [0, spec.baseTopMm],
    ]),
  );
}

/** Collarín negro (prototipo 5.3). */
export function buildThermoCollarGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  const rCollar = r - 0.035 * U;
  return cached(`thermo-collar:${spec.radiusMm}:${spec.collarTopMm}`, () =>
    lathe([
      [r - 0.09 * U, spec.collarBottomMm],
      [rCollar - 0.01 * U, spec.collarBottomMm],
      [rCollar, spec.collarBottomMm + 1.08],
      [rCollar, spec.collarTopMm - 1.08],
      [rCollar - 0.02 * U, spec.collarTopMm],
      [r - 0.12 * U, spec.collarTopMm],
      [0, spec.collarTopMm],
    ]),
  );
}

/** Tapa-vaso de acero con domo suave (prototipo 5.4). */
export function buildThermoLidGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  const rLid = r - 0.085 * U;
  return cached(`thermo-lid:${spec.radiusMm}:${spec.lidTopMm}`, () =>
    lathe([
      [0, spec.lidBottomMm],
      [rLid - 0.04 * U, spec.lidBottomMm],
      [rLid, spec.lidBottomMm + 0.36],
      [rLid, spec.lidBottomMm + 2.88],
      [rLid + 0.01 * U, spec.lidBottomMm + 4.32],
      [rLid + 0.005 * U, spec.lidTopMm - 13.32],
      [rLid - 0.025 * U, spec.lidTopMm - 7.56],
      [rLid - 0.11 * U, spec.lidTopMm - 2.52],
      [rLid - 0.24 * U, spec.lidTopMm - 0.36],
      [0, spec.lidTopMm],
    ]),
  );
}

/** Media manija en L con codo redondeado (prototipo 5.5). */
export function buildThermoHandleGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  return cached(`thermo-handle:${spec.radiusMm}:${spec.handleAngleRad}`, () => {
    const r = spec.radiusMm;
    const rCollar = r - 0.035 * U;
    const zStart = rCollar - 0.02 * U;
    const zInnerWall = r + 0.34 * U;
    const zOuterWall = r + 0.5 * U;
    // Las alturas del prototipo están referidas a la base -3.38 u: se suman 3.38 u.
    const yTop = 2.25 * U + 3.38 * U;
    const yBotUnderArm = 2.08 * U + 3.38 * U;
    const yBottomTip = -0.32 * U + 3.38 * U;
    const outerCornerR = 0.16 * U;
    const innerCornerR = 0.08 * U;
    const tipRadius = (zOuterWall - zInnerWall) / 2;

    const shape = new THREE.Shape();
    shape.moveTo(zStart, yTop);
    shape.lineTo(zOuterWall - outerCornerR, yTop);
    shape.quadraticCurveTo(zOuterWall, yTop, zOuterWall, yTop - outerCornerR);
    shape.lineTo(zOuterWall, yBottomTip + tipRadius);
    shape.absarc(
      zInnerWall + tipRadius,
      yBottomTip + tipRadius,
      tipRadius,
      0,
      Math.PI,
      true,
    );
    shape.lineTo(zInnerWall, yBotUnderArm - innerCornerR);
    shape.quadraticCurveTo(zInnerWall, yBotUnderArm, zInnerWall - innerCornerR, yBotUnderArm);
    shape.lineTo(zStart, yBotUnderArm);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      steps: 1,
      depth: 0.17 * U,
      bevelEnabled: true,
      bevelThickness: 0.022 * U,
      bevelSize: 0.018 * U,
      bevelSegments: 4,
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(0.085 * U, 0, 0);
    return geo;
  });
}

/** Ranuras decorativas del collarín. */
export function buildThermoGrooveGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const rCollar = spec.radiusMm - 0.035 * U;
  return cached(`thermo-groove:${rCollar}`, () =>
    new THREE.TorusGeometry(rCollar + 0.001 * U, 0.006 * U, 8, 96, Math.PI * 0.45),
  );
}

/**
 * Cilindro del grabado: costura en el DORSO y u=0.5 en el frente (+Z), para
 * que la composición `x = ancho·(0.5 + ángulo/360)` no corte el diseño.
 */
export function buildThermoEngravingGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const surface = thermoSurface(spec);
  return cached(`thermo-engrave:${spec.engraveRadiusMm}:${surface.heightMm}`, () =>
    new THREE.CylinderGeometry(
      spec.engraveRadiusMm,
      spec.engraveRadiusMm,
      surface.heightMm,
      128,
      1,
      true,
      Math.PI,
      Math.PI * 2,
    ),
  );
}
