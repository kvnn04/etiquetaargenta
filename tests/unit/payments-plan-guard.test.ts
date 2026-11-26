import { describe, expect, it } from 'vitest';
import { classifyPlanReadFailure } from '@/lib/payments/plan-guard';

/* ============================================================================
 * Guard de lectura del plan (26-nov-2026)
 * ----------------------------------------------------------------------------
 * Regresión real: dos proyectos de Vercel con credenciales de MP distintas
 * compartían la misma base. Un deploy creaba un plan que el otro no podía ver
 * (404) y, en vez de avisar, creaba otro plan en su propio colector. El guard
 * falla cerrado para no dejar la cuenta vinculada a dos entornos.
 * ========================================================================== */

describe('classifyPlanReadFailure', () => {
  it.each([401, 403, 404])('%i ⇒ PLAN_INCONSISTENTE (409, no crear otro plan)', (status) => {
    expect(classifyPlanReadFailure(status)).toEqual({
      error: 'PLAN_INCONSISTENTE',
      status: 409,
    });
  });

  it.each([0, 500, 502, 503])('%i ⇒ MP_UNAVAILABLE (502, reintentar)', (status) => {
    expect(classifyPlanReadFailure(status)).toEqual({
      error: 'MP_UNAVAILABLE',
      status: 502,
    });
  });
});
