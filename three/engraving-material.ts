/* ============================================================================
 * MATERIAL DEL GRABADO — ÚNICA FUENTE para editor, visor y Ficha HD
 * ----------------------------------------------------------------------------
 * La marca láser no es una calcomanía: sobre el metal se lee como un trazo
 * mate, ligeramente rebajado, que responde a la luz. El compositor entrega
 * dos mapas del MISMO canvas:
 *   · `map`      ⇒ color del quemado adaptativo (R4 pos 5) + máscara anular;
 *   · `bumpMap`  ⇒ relieve derivado del alfa (composeEngravingHeightCanvas).
 * Este módulo mantiene los tres consumidores con idéntico acabado y evita
 * que el editor, el visor del cliente y la ficha deriven por separado.
 * ============================================================================ */

import * as THREE from 'three';

/**
 * Fuerza del relieve. El bumpMap de three se evalúa en espacio de pantalla:
 * 0.35 da un bisel visible al acercarse sin convertir el grabado en un
 * bajorrelieve plástico. Constante compartida por las tres vistas.
 */
export const ENGRAVING_BUMP_SCALE = 0.35;

/** ε sobre la corona para no pelear Z con el metal (guías: +0.2 mm). */
export const ENGRAVING_LIFT_MM = 0.02;

/**
 * Material único del grabado. `opacity` sale del quemado adaptativo
 * (LASER_BURN_DARK / LASER_BURN_SILVER) y puede actualizarse en vivo.
 */
export function createEngravingMaterial(
  map: THREE.Texture,
  bumpMap: THREE.Texture | null,
  opacity: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    bumpMap: bumpMap ?? undefined,
    bumpScale: ENGRAVING_BUMP_SCALE,
    transparent: true,
    opacity,
    // Marca láser: óxido/frosting mate, no espejo.
    metalness: 0.05,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
