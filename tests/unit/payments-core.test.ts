/* ============================================================================
 * TESTS POSICIÓN 10B — NÚCLEO DE PAGOS (ÚNICA FUENTE: spec_pagos.md §3+§5):
 * R1 (estados + ancla del ciclo en America/Argentina/Buenos_Aires),
 * R3/R4 (ARS es-AR + grandfathering: freezePrice solo en alta/re-activación),
 * R7 (whitelist de estados de pago), R8 (gracia 5 días corridos + resolver de
 * plan) y R9 (programada_cierre hasta period_end). Módulo PURO: instantes
 * inyectados, sin DB, sin envs.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  GRACE_DAYS,
  arDateParts,
  cancelationPeriodEndMs,
  cycleAnchorDayOf,
  formatArs,
  formatDateAR,
  formatPricePerMonth,
  graceDaysLeft,
  graceExpiresAtMs,
  isCancelableSubscriptionStatus,
  isPositiveAmount,
  nextCycleDateMs,
  normalizeMpPaymentStatus,
  resolvePlan,
  transitionSubscription,
} from '@/lib/payments/core';

/** t0: 06-nov-2026 12:00 UTC — 09:00 AR del 06/11/2026 (UTC−3 fijo). */
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

/** 00:00 AR de un día (UTC−3 desde 2019, sin DST): 03:00 UTC del mismo día. */
const arMidnight = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 3, 0, 0);

describe('R3 — montos ARS formato argentino', () => {
  /**
   * CLDR es-AR separa símbolo y monto con U+00A0 (no-break space), no con
   * espacio ASCII — idéntico en browser (misma data ICU): se normaliza en
   * los asserts para que la SUITE diga qué dice el cielo visual.
   */
  const normalizar = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

  it('formatArs $ 20.000 (sin decimales, separador es-AR)', () => {
    expect(normalizar(formatArs(20000) as string)).toBe('$ 20.000');
  });

  it('formatArs montos medios y fallback honesto de divisa rara', () => {
    expect(normalizar(formatArs(9876) as string)).toBe('$ 9.876');
    expect(normalizar(formatArs(0) as string)).toBe('$ 0'); // no bloquea el render; el gate es isPositiveAmount
    // currency invalida ⇒ RangeError de Intl ⇒ eco `${currency} ${amount}`.
    expect(formatArs(20000, 'INVALID')).toBe('INVALID 20000');
  });

  it('formatArs devuelve null solo con montos no numéricos', () => {
    expect(formatArs(Number.NaN)).toBeNull();
    expect(formatArs(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('formatPricePerMonth — la leyenda exacta del paywall/centro', () => {
    const precio = formatPricePerMonth(20000) as string;
    expect(precio.replace(/[\u00a0\u202f]/g, ' ')).toBe('$ 20.000 / mes');
    expect(formatPricePerMonth(Number.NaN)).toBeNull();
  });

  it('isPositiveAmount (§6: monto > 0 antes de enviar el Checkout)', () => {
    expect(isPositiveAmount(20000)).toBe(true);
    expect(isPositiveAmount(0.01)).toBe(true);
    expect(isPositiveAmount(0)).toBe(false);
    expect(isPositiveAmount(-5)).toBe(false);
    expect(isPositiveAmount(Number.NaN)).toBe(false);
    expect(isPositiveAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isPositiveAmount('20000')).toBe(false); // string del form: PAYWALL NO
  });
});

describe('R1 — fechas en America/Argentina/Buenos_Aires', () => {
  it('arDateParts respeta el rollover de midnight AR (UTC−3, sin DST)', () => {
    expect(arDateParts(T0)).toEqual({ year: 2026, month: 11, day: 6 });
    // 02:00 UTC = 23:00 AR del día ANTERIOR (midnight AR = 03:00 UTC).
    expect(arDateParts(Date.UTC(2026, 10, 6, 2, 0, 0))).toEqual({
      year: 2026,
      month: 11,
      day: 5,
    });
    expect(arDateParts(Date.UTC(2026, 10, 6, 3, 0, 0))).toEqual({
      year: 2026,
      month: 11,
      day: 6,
    });
  });

  it('formatDateAR DD/MM/YYYY + null para instantes inválidos', () => {
    expect(formatDateAR(T0)).toBe('06/11/2026');
    expect(formatDateAR(arMidnight(2027, 1, 5))).toBe('05/01/2027');
    expect(formatDateAR(Number.NaN)).toBeNull();
  });
});

describe('R8 — gracia de 5 días corridos', () => {
  it('la ventana arranca en el rechazo y vale EXACTAMENTE 5 días', () => {
    expect(GRACE_DAYS).toBe(5);
    expect(graceExpiresAtMs(T0)).toBe(T0 + 5 * DAY_MS);
  });

  it('graceDaysLeft decrementa por corridos con techo a 0 (banner §4)', () => {
    const exp = T0 + 5 * DAY_MS;
    expect(graceDaysLeft(exp, T0 + 3 * 3_600_000)).toBe(5); // 3 h después: ceil(4,87 d)
    expect(graceDaysLeft(exp, T0 + 4 * DAY_MS + 23 * 3_600_000)).toBe(1); // últ. hora del día 5
    expect(graceDaysLeft(exp, exp)).toBe(0); // venció EN el borde
    expect(graceDaysLeft(exp, T0 + 9 * DAY_MS)).toBe(0); // nunca días negativos
  });
});

describe('R1 — ancla del ciclo y próxima fecha de cobro', () => {
  it('cycleAnchorDayOf = día del primer pago en tz AR', () => {
    expect(cycleAnchorDayOf(T0)).toBe(6);
  });

  it('mismo día del ancla ⇒ próximo mes (día del débito ya corrió)', () => {
    expect(nextCycleDateMs(6, T0)).toBe(arMidnight(2026, 12, 6));
  });

  it('día del ancla a futuro dentro del mes ⇒ ese día', () => {
    expect(nextCycleDateMs(20, T0)).toBe(arMidnight(2026, 11, 20));
  });

  it('ancla 31 en meses cortos ⇒ clampa al último día (febrero no-bisiesto)', () => {
    expect(nextCycleDateMs(31, Date.UTC(2026, 1, 6, 12))).toBe(arMidnight(2026, 2, 28));
    expect(nextCycleDateMs(31, T0)).toBe(arMidnight(2026, 11, 30));
  });

  it('rollover de mes y de año (20/12 con ancla 5 ⇒ 05/01/2027)', () => {
    expect(nextCycleDateMs(5, Date.UTC(2026, 11, 20, 12))).toBe(arMidnight(2027, 1, 5));
    expect(nextCycleDateMs(15, Date.UTC(2026, 10, 20, 12))).toBe(arMidnight(2026, 12, 15));
  });
});

describe('R8/R9 — resolver de plan autoritativo', () => {
  const cursors = {
    inactiva: { status: 'inactiva' as const, graceExpiresAtMs: null, periodEndMs: null },
    activa: { status: 'activa' as const, graceExpiresAtMs: null, periodEndMs: null },
    graciaViva: { status: 'gracia' as const, graceExpiresAtMs: T0 + 5 * DAY_MS, periodEndMs: null },
    graciaVencida: { status: 'gracia' as const, graceExpiresAtMs: T0, periodEndMs: null },
    programadaViva: {
      status: 'programada_cierre' as const,
      graceExpiresAtMs: null,
      periodEndMs: T0 + 10 * DAY_MS,
    },
    programadaExpirada: {
      status: 'programada_cierre' as const,
      graceExpiresAtMs: null,
      periodEndMs: T0,
    },
  };

  it('activa ⇒ pro (el paywall jamás se dibuja a PRO, §4)', () => {
    expect(resolvePlan(cursors.activa, T0)).toBe('pro');
  });

  it('gracia viva ⇒ pro_grace; vencida en el borde ⇒ free', () => {
    expect(resolvePlan(cursors.graciaViva, T0 + 4 * DAY_MS)).toBe('pro_grace');
    expect(resolvePlan(cursors.graciaVencida, T0)).toBe('free'); // >=: expiró
    expect(resolvePlan(cursors.graciaViva, T0 + 5 * DAY_MS)).toBe('free');
  });

  it('programada_cierre opera hasta period_end (R9); expirada ⇒ free', () => {
    expect(resolvePlan(cursors.programadaViva, T0 + 9 * DAY_MS)).toBe('pro');
    expect(resolvePlan(cursors.programadaViva, T0 + 10 * DAY_MS)).toBe('free');
    expect(resolvePlan(cursors.programadaExpirada, T0)).toBe('free');
  });

  it('inactiva ⇒ free; gracia sin fecha (residuo) ⇒ free, jamás crash', () => {
    expect(resolvePlan(cursors.inactiva, T0)).toBe('free');
    expect(resolvePlan({ status: 'gracia', graceExpiresAtMs: null, periodEndMs: null }, T0)).toBe('free');
    expect(resolvePlan({ status: 'programada_cierre', graceExpiresAtMs: null, periodEndMs: null }, T0)).toBe('free');
  });
});

describe('máquina de estados (R7 compare-and-set en el caller)', () => {
  it('cobro_aprobado desde inactiva ⇒ activa CON congelamiento (alta o re-activación, R4)', () => {
    expect(transitionSubscription('inactiva', { kind: 'cobro_aprobado' })).toEqual({
      status: 'activa',
      freezePrice: true,
      graceExpiresAtMs: null,
      periodEndMs: null,
    });
  });

  it('cobro_aprobado desde activa ⇒ ciclo normal: patch SIN tocar precio NI filas (R4)', () => {
    expect(transitionSubscription('activa', { kind: 'cobro_aprobado' })).toEqual({
      status: 'activa',
      freezePrice: false,
    });
    const patch = transitionSubscription('activa', { kind: 'cobro_aprobado' })!;
    expect('graceExpiresAtMs' in patch).toBe(false); // undefined ⇒ caller NO hace UPDATE
    expect('periodEndMs' in patch).toBe(false);
  });

  it('cobro_aprobado desde gracia ⇒ restauración instantánea sin re-congelar (R8)', () => {
    expect(transitionSubscription('gracia', { kind: 'cobro_aprobado' })).toEqual({
      status: 'activa',
      freezePrice: false, // nunca bajó a FREE: el precio congelado sigue en la fila
      graceExpiresAtMs: null,
      periodEndMs: null,
    });
  });

  it('cobro_aprobado desde programada_cierre ⇒ vuelve a activa (QA3)', () => {
    expect(transitionSubscription('programada_cierre', { kind: 'cobro_aprobado' })).toEqual({
      status: 'activa',
      freezePrice: false,
      graceExpiresAtMs: null,
      periodEndMs: null,
    });
  });

  it('cobro_rechazado desde activa ⇒ gracia con ventana = rechazo + 5 días (R8)', () => {
    expect(transitionSubscription('activa', { kind: 'cobro_rechazado', rejectedAtMs: T0 })).toEqual({
      status: 'gracia',
      freezePrice: false,
      graceExpiresAtMs: T0 + 5 * DAY_MS,
      periodEndMs: null,
    });
  });

  it('cobro_rechazado desde gracia ⇒ null: NO re-abre los 5 corridos (R1 primer rechazo)', () => {
    expect(
      transitionSubscription('gracia', { kind: 'cobro_rechazado', rejectedAtMs: T0 + 2 * DAY_MS }),
    ).toBeNull();
  });

  it('cobro_rechazado desde inactiva/programada ⇒ null (sin ciclo vivo que mutar)', () => {
    expect(transitionSubscription('inactiva', { kind: 'cobro_rechazado', rejectedAtMs: T0 })).toBeNull();
    expect(
      transitionSubscription('programada_cierre', { kind: 'cobro_rechazado', rejectedAtMs: T0 }),
    ).toBeNull();
  });

  it('cancelación desde activa ⇒ programada_cierre al period_end dado (R9)', () => {
    const pe = arMidnight(2026, 12, 6);
    expect(
      transitionSubscription('activa', { kind: 'cancelacion_programada', periodEndMs: pe }),
    ).toEqual({
      status: 'programada_cierre',
      freezePrice: false,
      graceExpiresAtMs: null,
      periodEndMs: pe,
    });
  });

  it('cancelación desde gracia ⇒ period_end = ventana de gracia (§6 edge: downgrade al vencer)', () => {
    // Pero si el cobro igualmente llega, QA3 lo restore cobro_aprobado desde programada (✓ arriba).
    const pe = cancelationPeriodEndMs('gracia', {
      graceExpiresAtMs: T0 + 5 * DAY_MS,
      anchorDay: 6,
      nowMs: T0,
    });
    expect(pe).toBe(T0 + 5 * DAY_MS);
    expect(
      transitionSubscription('gracia', {
        kind: 'cancelacion_programada',
        periodEndMs: pe as number,
      }),
    ).toEqual({
      status: 'programada_cierre',
      freezePrice: false,
      graceExpiresAtMs: null,
      periodEndMs: T0 + 5 * DAY_MS,
    });
  });

  it('cancelación desde inactiva ⇒ null; helper de period_end sin ancla ⇒ null', () => {
    expect(
      transitionSubscription('inactiva', {
        kind: 'cancelacion_programada',
        periodEndMs: arMidnight(2026, 12, 6),
      }),
    ).toBeNull();
    expect(
      cancelationPeriodEndMs('activa', { graceExpiresAtMs: null, anchorDay: null, nowMs: T0 }),
    ).toBeNull();
  });

  it('helper de period_end de cancelación activa = próximo ciclo (fin del ya pago)', () => {
    expect(
      cancelationPeriodEndMs('activa', { graceExpiresAtMs: null, anchorDay: 6, nowMs: T0 }),
    ).toBe(arMidnight(2026, 12, 6));
  });

  it('gracia_vencida ⇒ inactiva (downgrade R8) limpia ventanas', () => {
    expect(transitionSubscription('gracia', { kind: 'gracia_vencida' })).toEqual({
      status: 'inactiva',
      freezePrice: false,
      graceExpiresAtMs: null,
      periodEndMs: null,
    });
    // Cancelada durante gracia y nunca cobró: al vencer la ventana baja IGUAL (§6 edge).
    expect(transitionSubscription('programada_cierre', { kind: 'gracia_vencida' })).toEqual({
      status: 'inactiva',
      freezePrice: false,
      graceExpiresAtMs: null,
      periodEndMs: null,
    });
  });

  it('gracia_vencida desde estados sin gracia ⇒ null (evento no aplica)', () => {
    expect(transitionSubscription('activa', { kind: 'gracia_vencida' })).toBeNull();
    expect(transitionSubscription('inactiva', { kind: 'gracia_vencida' })).toBeNull();
  });
});

describe('R9 — baja in-app habilitada por estado', () => {
  it('sólo activa/gracia se pueden cancelar desde la app', () => {
    expect(isCancelableSubscriptionStatus('activa')).toBe(true);
    expect(isCancelableSubscriptionStatus('gracia')).toBe(true);
    expect(isCancelableSubscriptionStatus('programada_cierre')).toBe(false);
    expect(isCancelableSubscriptionStatus('revocada')).toBe(false);
    expect(isCancelableSubscriptionStatus('inactiva')).toBe(false);
  });
});

describe('R7/R11 — whitelist del webhook', () => {
  it('approved/rejected/refunded/charged_back mutan; pending se ignora (nunca crash)', () => {
    expect(normalizeMpPaymentStatus('approved')).toBe('approved');
    expect(normalizeMpPaymentStatus('rejected')).toBe('rejected');
    expect(normalizeMpPaymentStatus('refunded')).toBe('refunded');
    expect(normalizeMpPaymentStatus('partially_refunded')).toBe('partially_refunded');
    expect(normalizeMpPaymentStatus('charged_back')).toBe('charged_back');
    expect(normalizeMpPaymentStatus('pending')).toBeNull();
    expect(normalizeMpPaymentStatus('in_process')).toBeNull();
    expect(normalizeMpPaymentStatus('')).toBeNull();
  });
});
