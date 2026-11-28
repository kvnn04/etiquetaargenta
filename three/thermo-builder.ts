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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThermoSpec } from '@/lib/catalog';
import { THERMO_MM_PER_UNIT, sportUnitRadiusAt } from '@/lib/catalog';
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

/** mm por unidad del prototipo deportivo, derivados de su radio máximo. */
function sportUnitMm(spec: ThermoSpec): number {
  return spec.radiusMm / 0.7275;
}

/** Radio del cuerpo deportivo en mm a una altura absoluta (base Y=0). */
function sportBodyRadiusMm(spec: ThermoSpec, yMm: number): number {
  const bodyH = Math.max(1e-6, spec.bodyTopMm - spec.baseBottomMm);
  const t = Math.min(1, Math.max(0, (yMm - spec.baseBottomMm) / bodyH));
  return sportUnitRadiusAt(t) * sportUnitMm(spec);
}

/** Une geometrías y libera las piezas intermedias (nunca deja basura GPU). */
function mergeOrEmpty(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.BufferGeometry();
}

/** Matriz del grupo del mosquetón (posición, rotación y escala del prototipo). */
function sportCarabinerMatrix(spec: ThermoSpec): THREE.Matrix4 {
  const S = sportUnitMm(spec);
  const euler = new THREE.Euler(0, -0.22, 0.38);
  const local = new THREE.Matrix4()
    .makeTranslation(0.47, 0.65, 0.03)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(euler));
  return new THREE.Matrix4()
    .makeTranslation(0, spec.lidBottomMm, 0)
    .multiply(new THREE.Matrix4().makeScale(S, S, S))
    .multiply(local);
}

/**
 * Perfil completo de la Botella Bowling: base cóncava, costura, cuerpo recto,
 * hombro sigmoide y cuello corto. Sale del prototipo `3d_botella_bowling.html`
 * (1 unidad = 36 mm) y usa las alturas absolutas del spec.
 */
function bottleBodyProfile(spec: ThermoSpec): Array<[number, number]> {
  const R = spec.radiusMm;
  const rn = spec.neckRadiusMm;
  const yBottom = spec.baseBottomMm;
  const ySeam = spec.baseTopMm;
  const yCylStart = spec.bodyBottomMm;
  const yCylEnd = spec.bodyTopMm;
  const yNeckStart = spec.shoulderTopMm;
  const yNeckEnd = spec.collarBottomMm;
  const pts: Array<[number, number]> = [
    // 1. Centro inferior cóncavo (base típica de termo inoxidable).
    [0, yBottom + 0.08 * U],
    [0.55 * U, yBottom + 0.06 * U],
    [0.78 * U, yBottom],
  ];

  // 2. Curva redondeada inferior hacia la costura de la base.
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const rad = 0.78 * U + (R - 0.78 * U) * Math.sin(t * Math.PI * 0.5);
    pts.push([rad, yBottom + (ySeam - yBottom) * t]);
  }

  // 3. Costura / hendidura sutil de la base.
  pts.push([R - 0.018 * U, ySeam + 0.025 * U], [R, yCylStart]);

  // 4. Cuerpo principal cilíndrico recto (zona de grabado).
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    pts.push([R, yCylStart + (yCylEnd - yCylStart) * t]);
  }

  // 5. Hombro curvo tipo "bowling" (R=1.08 → rNeck=0.56).
  for (let i = 1; i <= 32; i++) {
    const t = i / 32;
    const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
    pts.push([
      R - (R - rn) * Math.pow(ease, 0.92),
      yCylEnd + (yNeckStart - yCylEnd) * t,
    ]);
  }

  // 6. Cuello cilíndrico corto con ligero labio superior.
  pts.push(
    [rn, yNeckStart + 0.15 * U],
    [rn + 0.015 * U, yNeckStart + 0.30 * U],
    [rn + 0.015 * U, yNeckEnd],
    [rn - 0.04 * U, yNeckEnd],
  );
  return pts;
}

/**
 * Perfil de la Botella Deportiva: base redondeada, cintura cóncava y hombro
 * superior que se estrecha hacia el cuello de acero. Sale del prototipo
 * `botella térmica deportiva ..._3d.html` (1 unidad = 49.08 mm).
 */
function sportBodyProfile(spec: ThermoSpec): Array<[number, number]> {
  const S = sportUnitMm(spec);
  const y0 = spec.baseBottomMm;
  const y1 = spec.bodyTopMm;
  const pts: Array<[number, number]> = [
    [0, y0],
    [0.55 * S, y0],
    [0.65 * S, y0],
  ];
  const segments = 96;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    pts.push([sportUnitRadiusAt(t) * S, y0 + (y1 - y0) * t]);
  }
  return pts;
}

/** Cuerpo pintado: cilindro recto + hombro biselado (prototipo 5.1). */
export function buildThermoBodyGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  if (spec.geometry === 'sport') {
    return cached(
      `thermo-body:sport:${spec.radiusMm}:${spec.bodyTopMm}`,
      () => lathe(sportBodyProfile(spec), 128),
    );
  }
  if (spec.geometry === 'bowling') {
    return cached(
      `thermo-body:bowling:${spec.radiusMm}:${spec.neckRadiusMm}:${spec.totalHeightMm}`,
      () => lathe(bottleBodyProfile(spec), 128),
    );
  }
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

/** Zócalo de acero (prototipo 5.2). La botella no tiene zócalo separado. */
export function buildThermoBaseGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const r = spec.radiusMm;
  if (spec.geometry === 'bowling' || spec.geometry === 'sport') {
    return cached(`thermo-base:${spec.geometry}`, () => new THREE.BufferGeometry());
  }
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

/**
 * Collarín negro de la Media Manija, aro de silicona de la Botella Bowling
 * (cilindro oscuro entre cuello y tapa) o nada en el System.
 */
export function buildThermoCollarGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry === 'system') {
    return cached('thermo-collar:system', () => new THREE.BufferGeometry());
  }
  if (spec.geometry === 'sport') {
    const S = sportUnitMm(spec);
    const rn = spec.neckRadiusMm;
    return cached(
      `thermo-collar:sport:${rn}:${spec.collarBottomMm}:${spec.collarTopMm}`,
      () =>
        lathe(
          [
            [0, spec.collarBottomMm],
            [rn - 0.01 * S, spec.collarBottomMm],
            [rn, spec.collarBottomMm + 0.02 * S],
            [rn, spec.collarTopMm - 0.02 * S],
            [rn - 0.02 * S, spec.collarTopMm],
            [0, spec.collarTopMm],
          ],
          96,
        ),
    );
  }
  if (spec.geometry === 'bowling') {
    const rSeal = spec.neckRadiusMm + 0.018 * U;
    return cached(
      `thermo-collar:bowling:${rSeal}:${spec.collarBottomMm}:${spec.collarTopMm}`,
      () =>
        lathe([
          [0, spec.collarBottomMm],
          [rSeal, spec.collarBottomMm],
          [rSeal, spec.collarTopMm],
          [0, spec.collarTopMm],
        ], 64),
    );
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
  if (spec.geometry === 'sport') {
    return cached(
      `thermo-lid:sport:${spec.neckRadiusMm}:${spec.lidBottomMm}:${spec.lidTopMm}`,
      () => {
        const S = sportUnitMm(spec);
        const y0 = spec.lidBottomMm;
        const y1 = spec.lidTopMm;
        const rBottom = 0.635 * S;
        const rBaseTop = 0.625 * S;
        const rPlateTop = 0.59 * S;
        const yBaseTop = y0 + 0.42 * S;
        return lathe(
          [
            [0, y0],
            [rBottom, y0],
            [rBaseTop, yBaseTop],
            [rPlateTop, y1],
            [0, y1],
          ],
          128,
        );
      },
    );
  }
  if (spec.geometry === 'bowling') {
    return cached(
      `thermo-lid:bowling:${spec.neckRadiusMm}:${spec.lidBottomMm}:${spec.lidTopMm}`,
      () => {
        const rCap = spec.neckRadiusMm + 0.028 * U;
        const y0 = spec.lidBottomMm;
        const y1 = spec.lidTopMm;
        const pts: Array<[number, number]> = [
          [rCap - 0.05 * U, y0],
          [rCap, y0 + 0.03 * U],
          [rCap, y1 - 0.18 * U],
        ];
        // Borde superior redondeado (domo) como la foto de referencia.
        for (let i = 1; i <= 14; i++) {
          const t = i / 14;
          const angle = t * (Math.PI / 2);
          const rad = rCap * Math.cos(angle);
          const y = y1 - 0.18 * U + 0.18 * U * Math.sin(angle);
          pts.push([Math.max(0, rad), y]);
        }
        const geo = lathe(pts, 128);
        // Estrías verticales sutiles en la corona de la tapa (28 alrededor).
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          const radius = Math.hypot(x, z);
          if (radius > 0.15 * U && y > y1 - 0.24 * U && y < y1 - 0.03 * U) {
            const angle = Math.atan2(z, x);
            const flute = Math.sin(angle * 28) * 0.0045 * U;
            const factor = (radius + flute) / radius;
            pos.setX(i, x * factor);
            pos.setZ(i, z * factor);
          }
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        return geo;
      },
    );
  }
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
  if (spec.geometry === 'bowling' || spec.geometry === 'sport') {
    return cached(`thermo-handle:${spec.geometry}`, () => new THREE.BufferGeometry());
  }
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

/* -------------------------------------------------------------------------- */
/* Botella Deportiva — tapa negra, asa superior, pico y mosquetón             */
/* -------------------------------------------------------------------------- */

/** Estrías de la tapa + alojamiento de la bisagra (plástico negro). */
export function buildThermoSportCapDetailsGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry !== 'sport') {
    return cached('thermo-sport-cap:none', () => new THREE.BufferGeometry());
  }
  const S = sportUnitMm(spec);
  return cached(
    `thermo-sport-cap:${spec.radiusMm}:${spec.lidBottomMm}`,
    () => {
      const y0 = spec.lidBottomMm;
      const parts: THREE.BufferGeometry[] = [];
      const ribBase = new THREE.BoxGeometry(0.058 * S, 0.25 * S, 0.036 * S);
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const rib = ribBase.clone();
        rib.rotateY(-angle + Math.PI / 2);
        rib.translate(Math.cos(angle) * 0.631 * S, y0 + 0.2 * S, Math.sin(angle) * 0.631 * S);
        parts.push(rib);
      }
      ribBase.dispose();
      const hinge = new THREE.CylinderGeometry(0.13 * S, 0.14 * S, 0.26 * S, 24);
      hinge.rotateX(Math.PI / 2);
      hinge.translate(-0.08 * S, y0 + 0.52 * S, 0);
      parts.push(hinge);
      return mergeOrEmpty(parts);
    },
  );
}

/** Asa superior curva con hueco central (plástico negro). */
export function buildThermoSportHandleGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry !== 'sport') {
    return cached('thermo-sport-handle:none', () => new THREE.BufferGeometry());
  }
  const S = sportUnitMm(spec);
  return cached(
    `thermo-sport-handle:${spec.radiusMm}:${spec.lidBottomMm}`,
    () => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.56, 0.44);
      shape.lineTo(-0.56, 0.56);
      shape.bezierCurveTo(-0.54, 0.72, -0.14, 0.99, 0.34, 1.01);
      shape.bezierCurveTo(0.58, 1.02, 0.67, 0.85, 0.56, 0.65);
      shape.lineTo(0.43, 0.44);
      shape.closePath();

      const hole = new THREE.Path();
      hole.moveTo(-0.18, 0.53);
      hole.bezierCurveTo(-0.14, 0.73, 0.14, 0.88, 0.36, 0.88);
      hole.bezierCurveTo(0.49, 0.88, 0.51, 0.76, 0.42, 0.63);
      hole.lineTo(0.31, 0.5);
      hole.bezierCurveTo(0.14, 0.5, -0.04, 0.5, -0.18, 0.53);
      hole.closePath();
      shape.holes.push(hole);

      const geo = new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: 0.25,
        bevelEnabled: true,
        bevelThickness: 0.032,
        bevelSize: 0.028,
        bevelSegments: 6,
        curveSegments: 32,
      });
      geo.translate(0, 0, -0.125);
      geo.scale(S, S, S);
      geo.translate(0, spec.lidBottomMm, 0);
      return geo;
    },
  );
}

/** Pico rebatible translúcido + lengüeta de agarre (cerrado, decorativo). */
export function buildThermoSportSpoutGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry !== 'sport') {
    return cached('thermo-sport-spout:none', () => new THREE.BufferGeometry());
  }
  const S = sportUnitMm(spec);
  return cached(
    `thermo-sport-spout:${spec.radiusMm}:${spec.lidBottomMm}`,
    () => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.06, -0.05);
      shape.lineTo(0.34, 0.16);
      shape.bezierCurveTo(0.39, 0.19, 0.38, 0.26, 0.32, 0.27);
      shape.lineTo(-0.05, 0.08);
      shape.bezierCurveTo(-0.09, 0.05, -0.09, -0.02, -0.06, -0.05);
      shape.closePath();

      const spout = new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: 0.13,
        bevelEnabled: true,
        bevelThickness: 0.018,
        bevelSize: 0.016,
        bevelSegments: 4,
        curveSegments: 20,
      });
      spout.translate(0, 0, -0.065);
      const lip = new THREE.BoxGeometry(0.06, 0.035, 0.12);
      lip.rotateZ(0.45);
      lip.translate(0.33, 0.24, 0);
      // ExtrudeGeometry no está indexada y BoxGeometry sí: unificar antes de
      // fusionar (mergeGeometries exige el mismo esquema de atributos).
      const lipNI = lip.toNonIndexed();
      lip.dispose();
      const merged = mergeOrEmpty([spout, lipNI]);
      merged.scale(S, S, S);
      merged.translate(-0.08 * S, spec.lidBottomMm + 0.52 * S, 0);
      return merged;
    },
  );
}

/** Mosquetón negro del asa (tubo cerrado). */
export function buildThermoSportCarabinerGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry !== 'sport') {
    return cached('thermo-sport-carabiner:none', () => new THREE.BufferGeometry());
  }
  return cached(
    `thermo-sport-carabiner:${spec.radiusMm}:${spec.lidBottomMm}`,
    () => {
      const points = [
        new THREE.Vector3(0, 0.08, 0),
        new THREE.Vector3(0.085, 0.04, 0),
        new THREE.Vector3(0.075, -0.36, 0),
        new THREE.Vector3(0, -0.44, 0),
        new THREE.Vector3(-0.075, -0.36, 0),
        new THREE.Vector3(-0.085, 0.04, 0),
      ];
      const curve = new THREE.CatmullRomCurve3(points, true);
      const geo = new THREE.TubeGeometry(curve, 48, 0.024, 16, true);
      geo.applyMatrix4(sportCarabinerMatrix(spec));
      return geo;
    },
  );
}

/** Argolla metálica + pasador del mosquetón (acero). */
export function buildThermoSportRingGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry !== 'sport') {
    return cached('thermo-sport-ring:none', () => new THREE.BufferGeometry());
  }
  return cached(
    `thermo-sport-ring:${spec.radiusMm}:${spec.lidBottomMm}`,
    () => {
      const gate = new THREE.CylinderGeometry(0.015, 0.015, 0.24, 12);
      gate.rotateZ(-0.06);
      gate.translate(-0.072, -0.16, 0);
      const ring = new THREE.TorusGeometry(0.165, 0.014, 16, 48);
      ring.rotateY(0.35);
      ring.translate(0.02, -0.58, 0);
      const merged = mergeOrEmpty([gate, ring]);
      merged.applyMatrix4(sportCarabinerMatrix(spec));
      return merged;
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
  if (spec.geometry !== 'media-manija') {
    return cached(`thermo-groove:${spec.geometry}`, () => new THREE.BufferGeometry());
  }
  const rCollar = spec.radiusMm - 0.035 * U;
  return cached(`thermo-groove:${spec.geometry}:${rCollar}`, () =>
    new THREE.TorusGeometry(rCollar + 0.001 * U, 0.006 * U, 8, 96, Math.PI * 0.45),
  );
}

/** Aro de junta entre tapa-vaso y cuerpo (solo System). */
export function buildThermoSeamGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  if (spec.geometry !== 'system') {
    return cached(`thermo-seam:${spec.geometry}`, () => new THREE.BufferGeometry());
  }
  const r = spec.radiusMm;
  return cached(`thermo-seam:${spec.geometry}:${r}`, () =>
    new THREE.TorusGeometry(r - 0.16 * U, 0.011 * U, 12, 96),
  );
}

/**
 * Superficie del grabado: costura en el DORSO y u=0.5 en el frente (+Z), para
 * que la composición `x = ancho·(0.5 + ángulo/360)` no corte el diseño.
 * La botella deportiva tiene cintura cóncava: la malla sigue el perfil real
 * (levantada 0.12 mm) en vez de flotar sobre un cilindro recto.
 */
export function buildThermoEngravingGeometry(spec: ThermoSpec): THREE.BufferGeometry {
  const surface = thermoSurface(spec);
  if (spec.geometry === 'sport') {
    return cached(
      `thermo-engrave:sport:${spec.radiusMm}:${spec.bodyTopMm}:${surface.heightMm}`,
      () => {
        const segments = 96;
        const half = surface.heightMm / 2;
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= segments; i++) {
          const localY = -half + (surface.heightMm * i) / segments;
          const r = sportBodyRadiusMm(spec, surface.centerYMm + localY) + 0.12;
          pts.push([r, localY]);
        }
        const geo = lathe(pts, 128);
        // LatheGeometry arranca u=0 en +Z; girado π deja u=0.5 en +Z y la
        // costura en el dorso, igual que el cilindro de los termos.
        geo.rotateY(Math.PI);
        return geo;
      },
    );
  }
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
