'use client';

/* ============================================================================
 * ENTORNO DE ESTUDIO — IBL local (sin CDN) para materiales PBR reales.
 * ----------------------------------------------------------------------------
 * El metal de la virola (metalness 0.9) necesita un environment map para
 * reflejar algo; con luces puntuales solamente queda negro. RoomEnvironment
 * genera un set de cajas/luces neutro y PMREM lo convierte en un mapa difuso
 * barato. Es la misma iluminación para editor, visor y ficha.
 * ============================================================================ */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Intensidad base del IBL: luz de estudio suave, sin lavar el color del cuerpo. */
export const STUDIO_ENV_INTENSITY = 0.85;

export function StudioEnvironment({
  intensity = STUDIO_ENV_INTENSITY,
}: {
  intensity?: number;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    const previousEnv = scene.environment;
    const previousIntensity = scene.environmentIntensity;

    scene.environment = target.texture;
    scene.environmentIntensity = intensity;

    room.dispose();
    pmrem.dispose();

    return () => {
      scene.environment = previousEnv;
      scene.environmentIntensity = previousIntensity;
      target.dispose();
    };
  }, [gl, scene, intensity]);

  return null;
}
