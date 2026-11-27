/* ============================================================================
 * BAJA — helpers puros de `cancel.ts`
 * ----------------------------------------------------------------------------
 * El fin del ciclo que financió el último pago es la fecha de acceso hasta la
 * que se conserva PRO. La regla: `period_end` manda si el cierre ya está
 * programado; si no, se deriva del ancla del ciclo y la fecha del cobro (R1),
 * porque `period_end` solo se escribe al programar el cierre.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import { resolvePaidCycleEndMs } from '@/lib/payments/cancel';

/** Medianoche AR (UTC−3) del día indicado. */
const arMidnight = (year: number, month1: number, day: number): number =>
  Date.UTC(year, month1 - 1, day, 3);

const PERIOD_END = arMidnight(2026, 12, 7);
const PAID_AT = Date.UTC(2026, 10, 7, 15); // 2026-11-07 12:00 AR

describe('resolvePaidCycleEndMs — ciclo que financió el pago', () => {
  it('usa period_end cuando el cierre ya está programado', () => {
    expect(
      resolvePaidCycleEndMs({
        periodEndMs: PERIOD_END,
        cycleAnchorDate: '2026-11-07',
        paidAtMs: PAID_AT,
      }),
    ).toBe(PERIOD_END);
  });

  it('sin period_end deriva el próximo ancla desde la fecha del pago', () => {
    expect(
      resolvePaidCycleEndMs({
        periodEndMs: null,
        cycleAnchorDate: '2026-11-07',
        paidAtMs: PAID_AT,
      }),
    ).toBe(arMidnight(2026, 12, 7));
  });

  it('sin ancla usa el día del pago como ancla', () => {
    expect(
      resolvePaidCycleEndMs({
        periodEndMs: null,
        cycleAnchorDate: null,
        paidAtMs: PAID_AT,
      }),
    ).toBe(arMidnight(2026, 12, 7));
  });

  it('sin pago y sin period_end no inventa una fecha', () => {
    expect(
      resolvePaidCycleEndMs({
        periodEndMs: null,
        cycleAnchorDate: '2026-11-07',
        paidAtMs: null,
      }),
    ).toBeNull();
  });
});
