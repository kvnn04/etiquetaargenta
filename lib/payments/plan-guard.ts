/* ============================================================================
 * Guard de lectura del plan de checkout
 * ----------------------------------------------------------------------------
 * El plan guardado en `subscriptions.preapproval_plan_id` pertenece al entorno
 * de Mercado Pago con el que se creó. Si el deploy actual usa otras
 * credenciales (test vs. producción, u otra cuenta), MP responde 404/401/403.
 *
 * Decisión (26-nov-2026): FALLAR CERRADO. Crear un plan nuevo en ese caso
 * escondía el problema y podía dejar a la cuenta vinculada a dos entornos.
 * El operador debe corregir credenciales/estado; el usuario ve un error claro
 * y no se inicia un cobro nuevo.
 * ========================================================================== */

export type PlanReadFailureCode = 'PLAN_INCONSISTENTE' | 'MP_UNAVAILABLE';

export interface PlanReadFailure {
  error: PlanReadFailureCode;
  status: 409 | 502;
}

/**
 * Clasifica el fallo de `GET /preapproval_plan/{id}`:
 * - 401/403/404 ⇒ el plan no existe o no es visible con estas credenciales:
 *   entorno inconsistente (conflicto de estado, 409).
 * - 0 (red) o 5xx ⇒ no se pudo verificar: reintentar más tarde (502).
 */
export function classifyPlanReadFailure(mpStatus: number): PlanReadFailure {
  if (mpStatus === 401 || mpStatus === 403 || mpStatus === 404) {
    return { error: 'PLAN_INCONSISTENTE', status: 409 };
  }
  return { error: 'MP_UNAVAILABLE', status: 502 };
}
