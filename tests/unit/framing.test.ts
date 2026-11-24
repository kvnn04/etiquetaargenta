import { describe, expect, it } from 'vitest';
import { resolveMateModel } from '@/lib/catalog';
import {
  CAMERA_FOV_DEG,
  ENGRAVING_VIEW_FIT_MARGIN,
  TOP_VIEW_OFFSET_MM,
  engravingViewPoseMm,
  fitCameraDistanceMm,
} from '@/three/framing';

describe('engravingViewPoseMm — vista de grabado del editor', () => {
  const product = resolveMateModel('camionero');
  const aspect = 0.84; // panel 3D del editor (alto > ancho)
  const pose = engravingViewPoseMm(product, 123, aspect);
  const crownY = product.shape.totalHeightMm + product.shape.sealOverlapMm;

  it('apunta a la corona (borde superior de la virola)', () => {
    expect(pose.target).toEqual([0, crownY, 0]);
    expect(pose.position[1]).toBeGreaterThan(crownY);
  });

  it('usa la dirección cenital de la ficha y encuadra el anillo externo', () => {
    const [ox, oy, oz] = TOP_VIEW_OFFSET_MM;
    const len = Math.hypot(ox, oy, oz);
    expect(pose.position[0]).toBeCloseTo(0, 10);
    expect(pose.position[1] - crownY).toBeCloseTo((oy / len) * pose.distance, 6);
    expect(pose.position[2]).toBeCloseTo((oz / len) * pose.distance, 6);
    expect(pose.distance).toBeCloseTo(
      fitCameraDistanceMm(123 / 2, aspect, CAMERA_FOV_DEG, ENGRAVING_VIEW_FIT_MARGIN),
      6,
    );
  });

  it('el anillo entra completo en el campo horizontal (con aire)', () => {
    const vFov = (CAMERA_FOV_DEG * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const halfWidthMm = pose.distance * Math.sin(hFov / 2);
    expect(halfWidthMm).toBeGreaterThanOrEqual(123 / 2);
  });
});
