/* ============================================================================
 * CASCADA ÚNICA virola.dimensionsChanged — spec_tecnica_geometrica §3-R3
 * ----------------------------------------------------------------------------
 * UN evento por cambio de medidas (inputs tipeados con debounce 200 ms,
 * steppers/sliders inmediatos — el debounce de la UI vive en DimensionsCard),
 * que encadena en este orden:
 *   (a) validación/clamp R1        → reconcileDiameters()
 *   (b) re-cálculo de métricas R2  → derivadas del store (virolaMetrics)
 *   (c) redraw de guías R5         → GuidesLayer (reactivo al store)
 *   (d) re-anclaje anti-fuga R4    → MateBodyMesh (reactivo, lathe-builder)
 *   (e) re-chequeo de desborde con escala/rotación/espejo vigentes
 *       (R3 de spec_escala_y_alerta_de_desborde) — RESUELTO en la posición 7:
 *       los consumidores (DesignCard, escena 3D) re-evalúan el chequeo de
 *       manera REACTIVA a los mismos disparadores (escala, D_ext/D_int y
 *       carga/cambio de diseño) — jamás al ángulo/espejo (invariancia polar
 *       R3). El bus de esta posición queda para consumidores NO-React
 *       (ficha/export, pos 8–10).
 *   (f) marca de guardado pendiente → setDiameters deja dirty (autosave 2 s)
 * QA2: latencia total ≤ 100 ms — la emisión es sincrónica y no depende de React.
 * ============================================================================ */

import { useEditorStore } from '@/lib/store/editor';
import { reconcileDiameters, type Diameters, type ReconciledDiameters } from '@/lib/virola';

/** Payload del evento único (§5: `{ extDiameter, intDiameter }`). */
export interface VirolaDimensionsEvent {
  extDiameter: number;
  intDiameter: number;
}

export type DimensionsListener = (event: VirolaDimensionsEvent) => void;

const listeners = new Set<DimensionsListener>();

/**
 * Suscriptor de la cascada (R3-e): el módulo de desborde (pos 7) se registra
 * acá para re-chequear el chorreo con la escala/rotación/espejo vigentes.
 * Devuelve la función para des-suscribirse.
 */
export function onVirolaDimensionsChanged(listener: DimensionsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: VirolaDimensionsEvent): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch (err) {
      // Un suscriptor roto jaleón rompe la cascada (§6: estado consistente).
      console.error('[virola.dimensionsChanged] listener error:', err);
    }
  }
}

/**
 * R3 — corre la cascada completa para un cambio de diámetros. `touched` indica
 * el campo que el tallerista editó ('ext' | 'int'); undefined ⇒ restauración de
 * estado (orden canónico D_ext ⇒ D_int). Marca dirty para el autosave (f).
 */
export function runDimensionsCascade(
  input: Diameters,
  touched?: 'ext' | 'int',
): ReconciledDiameters {
  const result = reconcileDiameters(input, touched); // (a)
  // (b)(c)(d) reaccionan al store; (f) dirty nace con el set (único evento).
  useEditorStore.getState().setDiameters(result);
  emit({ extDiameter: result.extDiameter, intDiameter: result.intDiameter }); // (e)
  return result;
}
