/* ============================================================================
 * GEOMETRÍA DEL TERMO — derivada de los prototipos
 * `3d_termo_matero_media_manija.html` y `termo_system_1L_3d.html`
 * (1 unidad = 36 mm).
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
  return cached(
    `thermo-body:${spec.geometry}:${spec.radiusMm}:${spec.bodyBottomMm}:${spec.bodyTopMm}`,
    () =>
      spec.geometry === 'system'
        ? lathe([
            // El primer punto queda oculto bajo el zócalo de acero.
            [r - 0.08 * U, spec.bodyBottomMm - 0.1 * U],
            [r - 0.02 * U, spec.bodyBottomMm - 0.08 * U],
            [r, spec.bodyBottomMm],
            [r, spec.bodyTopMm],
            [r - 0.03 * U, spec.bodyTopMm + 0.11 * U],
            [r - 0.15 * U, spec.bodyTopMm + 0.32 * U],
            [r - 0.18 * U, spec.shoulderTopMm],
          ])
        : lathe([
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
  return cached(`thermo-base:${spec.geometry}:${spec.radiusMm}:${spec.baseTopMm}`, () =>
    spec.geometry === 'system'
      ? lathe([
          [0, 0],
          [r - 0.12 * U, 0],
          [r - 0.03 * U, 0.04 * U],
          [r - 0.005 * U, 0.11 * U],
          [r - 0.005 * U, spec.baseTopMm - 0.03 * U],
          [r - 0.03 * U, spec.baseTopMm],
          [r - 0.09 * U, spec.baseTopMm],
          [0, spec.baseTopMm],
        ])
      : lathe([
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

/** Collarín negro (solo Media Manija; el System apoya la tapa en el hombro). */
export function buildThermoCollarGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry === 'system') {
    return cached('thermo-collar:system', () => new THREE.BufferGeometry());
  }
  const r = spec.radiusMm;
  const rCollar = r - 0.035 * U;
  return cached(`thermo-collar:${spec.geometry}:${spec.radiusMm}:${spec.collarTopMm}`, () =>
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

/** Tapa-vaso de acero con domo suave (Media Manija) o copa cónica (System). */
export function buildThermoLidGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  return cached(`thermo-lid:${spec.geometry}:${spec.radiusMm}:${spec.lidTopMm}`, () => {
    if (spec.geometry === 'system') {
      return lathe([
        [0, spec.lidBottomMm],
        [r - 0.19 * U, spec.lidBottomMm],
        [r - 0.135 * U, spec.lidBottomMm],
        [r - 0.135 * U, spec.lidBottomMm + 0.08 * U],
        [r - 0.21 * U, spec.lidBottomMm + 0.35 * U],
        [r - 0.29 * U, spec.lidBottomMm + 0.64 * U],
        [r - 0.37 * U, spec.lidTopMm - 0.08 * U],
        [r - 0.4 * U, spec.lidTopMm - 0.02 * U],
        [r - 0.48 * U, spec.lidTopMm],
        [0, spec.lidTopMm],
      ]);
    }
    const rLid = r - 0.085 * U;
    return lathe([
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
    ]);
  });
}

/** Manija: media manija en L (prototipo 5.5) o manija táctica (System 5.4). */
export function buildThermoHandleGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  return cached(
    `thermo-handle:${spec.geometry}:${spec.radiusMm}:${spec.handleAngleRad}`,
    () => {
      const r = spec.radiusMm;
      if (spec.geometry === 'system') {
        const zInner = r + 0.21 * U;
        const zOuter = r + 0.44 * U;
        const yTop = spec.bodyTopMm - 0.12 * U;
        const yBot = spec.bodyBottomMm + 0.28 * U;

        const shape = new THREE.Shape();
        shape.moveTo(zInner, yTop);
        shape.lineTo(zOuter - 0.04 * U, yTop);
        shape.quadraticCurveTo(zOuter + 0.02 * U, yTop, zOuter + 0.02 * U, yTop - 0.08 * U);
        shape.lineTo(zOuter + 0.02 * U, spec.bodyTopMm - 0.98 * U);
        shape.lineTo(zOuter + 0.06 * U, spec.bodyTopMm - 1.1 * U);
        shape.lineTo(zOuter + 0.06 * U, spec.bodyBottomMm + 1.18 * U);
        shape.lineTo(zOuter + 0.02 * U, spec.bodyBottomMm + 1.06 * U);
        shape.lineTo(zOuter + 0.02 * U, yBot + 0.08 * U);
        shape.quadraticCurveTo(zOuter + 0.02 * U, yBot, zOuter - 0.05 * U, yBot);
        shape.lineTo(zInner, yBot);
        shape.lineTo(zInner, yBot + 0.24 * U);
        shape.lineTo(zInner + 0.08 * U, yBot + 0.34 * U);
        shape.lineTo(zInner + 0.08 * U, yTop - 0.34 * U);
        shape.lineTo(zInner, yTop - 0.24 * U);
        shape.closePath();

        // Recorte superior
        const topHole = new THREE.Path();
        topHole.moveTo(zInner + 0.09 * U, yTop - 0.2 * U);
        topHole.lineTo(zOuter - 0.04 * U, yTop - 0.2 * U);
        topHole.lineTo(zOuter - 0.04 * U, yTop - 0.8 * U);
        topHole.lineTo(zInner + 0.09 * U, yTop - 0.68 * U);
        topHole.closePath();
        shape.holes.push(topHole);

        // Recorte inferior
        const botHole = new THREE.Path();
        botHole.moveTo(zInner + 0.09 * U, spec.bodyBottomMm + 1.04 * U);
        botHole.lineTo(zOuter - 0.04 * U, spec.bodyBottomMm + 1.16 * U);
        botHole.lineTo(zOuter - 0.04 * U, spec.bodyBottomMm + 0.48 * U);
        botHole.lineTo(zInner + 0.09 * U, spec.bodyBottomMm + 0.48 * U);
        botHole.closePath();
        shape.holes.push(botHole);

        const geo = new THREE.ExtrudeGeometry(shape, {
          steps: 1,
          depth: 0.21 * U,
          bevelEnabled: true,
          bevelThickness: 0.024 * U,
          bevelSize: 0.019 * U,
          bevelSegments: 3,
        });
        geo.rotateY(-Math.PI / 2);
        geo.translate(0.105 * U, 0, 0);
        return geo;
      }

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
    },
  );
}

export interface ThermoHandleMount {
  yMm: number;
  zMm: number;
  sizeMm: [number, number, number];
}

/** Soportes de anclaje de la manija táctica (solo System). */
export function thermoHandleMounts(spec: ThermoSpec): ThermoHandleMount[] {
  if (spec.geometry !== 'system') return [];
  const r = spec.radiusMm;
  return [
    {
      yMm: spec.bodyTopMm - 0.38 * U,
      zMm: r + 0.04 * U,
      sizeMm: [0.23 * U, 0.36 * U, 0.16 * U],
    },
    {
      yMm: spec.bodyBottomMm + 0.48 * U,
      zMm: r + 0.04 * U,
      sizeMm: [0.23 * U, 0.36 * U, 0.16 * U],
    },
  ];
}

export interface ThermoHandleLink {
  xMm: number;
  y1Mm: number;
  z1Mm: number;
  y2Mm: number;
  z2Mm: number;
  radiusMm: number;
}

/** Barras metálicas articuladas de la manija táctica (solo System). */
export function thermoHandleLinks(spec: ThermoSpec): ThermoHandleLink[] {
  if (spec.geometry !== 'system') return [];
  const r = spec.radiusMm;
  const links = [
    {
      y1Mm: spec.bodyTopMm - 0.42 * U,
      z1Mm: r + 0.06 * U,
      y2Mm: spec.bodyTopMm - 0.88 * U,
      z2Mm: r + 0.27 * U,
    },
    {
      y1Mm: spec.bodyBottomMm + 0.52 * U,
      z1Mm: r + 0.06 * U,
      y2Mm: spec.bodyBottomMm + 0.98 * U,
      z2Mm: r + 0.27 * U,
    },
  ];
  return links.flatMap((l) =>
    [-0.062 * U, 0.062 * U].map((xMm) => ({ ...l, xMm, radiusMm: 0.021 * U })),
  );
}

/** Ranuras decorativas del collarín (solo Media Manija). */
export function buildThermoGrooveGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry === 'system') {
    return cached('thermo-groove:system', () => new THREE.BufferGeometry());
  }
  const rCollar = spec.radiusMm - 0.035 * U;
  return cached(`thermo-groove:${spec.geometry}:${rCollar}`, () =>
    new THREE.TorusGeometry(rCollar + 0.001 * U, 0.006 * U, 8, 96, Math.PI * 0.45),
  );
}

/** Aro de junta entre tapa-vaso y cuerpo (solo System). */
export function buildThermoSeamGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  return cached(`thermo-seam:${spec.geometry}:${r}`, () =>
    new THREE.TorusGeometry(r - 0.16 * U, 0.011 * U, 12, 96),
  );
}

/**
 * Cilindro del grabado: costura en el DORSO y u=0.5 en el frente (+Z), para
 * que la composición `x = ancho·(0.5 + ángulo/360)` no corte el diseño.
 */
export function buildThermoEngravingGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const surface = thermoSurface(spec);
  return cached(
    `thermo-engrave:${spec.geometry}:${spec.engraveRadiusMm}:${surface.heightMm}`,
    () =>
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
