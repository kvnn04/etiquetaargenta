/* ============================================================================
 * REEMBOLSOS Y CONTRACARGOS — posición 13 (spec_reembolsos_y_contracargos.md)
 * ----------------------------------------------------------------------------
 * Lógica PURA (sin DB, sin red, instantes inyectados) que decide:
 *   · cuánto dinero volvió (clamp a `amount`, R11.2/§6);
 *   · el estado autoritativo del pago (approved/rejected/refunded/
 *     partially_refunded/charged_back, R11.2);
 *   · si el pago afectado es el del ciclo vigente (R11.3/§3.3);
 *   · el impacto: revocar, mantener el plan (parcial) o solo auditar.
 *
 * El caller (apply.ts) persiste con CAS y es el único que muta dinero/plan.
 * ============================================================================ */

import {
  DAY_MS,
  arDateParts,
  isLiveSubscriptionStatus,
  type PaymentStatus,
  type SubscriptionStatus,
} from '@/lib/payments/core';

/** Estados de pago que representan dinero devuelto/disputado. */
export type RefundLikeStatus = Extract<
  PaymentStatus,
  'refunded' | 'partially_refunded' | 'charged_back'
>;

export function isRefundLikeStatus(status: string): status is RefundLikeStatus {
  return (
    status === 'refunded' ||
    status === 'partially_refunded' ||
    status === 'charged_back'
  );
}

/**
 * Monto devuelto acumulado, SIEMPRE dentro de [0, amount] (R11.2/§6).
 * `refunded` inválido/negativo ⇒ 0; mayor al cobro ⇒ se clampea y se logea
 * en el caller (el dinero manda, pero el historial no se corrompe).
 */
export function clampRefundedAmount(amount: number, refunded: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(refunded) || refunded <= 0) return 0;
  return Math.min(amount, refunded);
}

/**
 * `transaction_amount_refunded` que MP informa. En `refunded`/`charged_back`
 * el total es el monto del cobro aunque el campo venga vacío: el estado
 * autoritativo ya dice que volvió todo.
 */
export function effectiveRefundedAmount(input: {
  mpStatus: string;
  amount: number | null;
  refundedAmount: number | null;
}): number {
  const amount = input.amount ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (input.mpStatus === 'refunded' || input.mpStatus === 'charged_back') {
    return amount;
  }
  return clampRefundedAmount(amount, input.refundedAmount ?? 0);
}

/**
 * Estado local del pago a partir del estado autoritativo de MP + el monto
 * devuelto. Un `approved` con `transaction_amount_refunded >= amount` se
 * convierte en `refunded` (parcial acumulado que llegó al total, §6).
 */
export function resolveRefundStatus(input: {
  mpStatus: string;
  amount: number | null;
  refundedAmount: number | null;
}): PaymentStatus | null {
  const amount = input.amount ?? 0;
  const refunded = effectiveRefundedAmount(input);

  switch (input.mpStatus) {
    case 'charged_back':
      return 'charged_back';
    case 'refunded':
      return 'refunded';
    case 'partially_refunded':
      return amount > 0 && refunded >= amount ? 'refunded' : 'partially_refunded';
    case 'approved':
      if (amount > 0 && refunded >= amount) return 'refunded';
      return refunded > 0 ? 'partially_refunded' : 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return null;
  }
}

/**
 * Merge MONOTÓNICO de estados de dinero devuelto (R11.7): un evento viejo o
 * duplicado nunca hace retroceder `charged_back → refunded → approved`. El
 * dinero ya devuelto no se "desdevuelve" por un webhook fuera de orden.
 */
export function mergeRefundStatus(
  existing: string,
  incoming: RefundLikeStatus,
): RefundLikeStatus {
  if (existing === 'charged_back' || incoming === 'charged_back') return 'charged_back';
  if (existing === 'refunded' || incoming === 'refunded') return 'refunded';
  return 'partially_refunded';
}

/**
 * ¿El pago afectado es el del ciclo vigente? (R11.3/§3.3)
 *
 * El ciclo vigente lo financia el ÚLTIMO pago aprobado. Un pago parcialmente
 * reembolsado sigue siendo el pago que financió el ciclo (por eso el caller
 * busca `approved` + `partially_refunded`). Cualquier pago anterior —o un
 * reembolso que llegó antes que su `approved`— se audita sin tocar el plan.
 */
export function isCurrentCyclePayment(input: {
  affectedPaymentId: number;
  lastApprovedPaymentId: number | null;
}): boolean {
  return (
    input.lastApprovedPaymentId != null &&
    input.lastApprovedPaymentId === input.affectedPaymentId
  );
}

/** Tipo de novedad según el estado autoritativo del pago. */
export type RefundImpactKind = 'refund_total' | 'refund_partial' | 'chargeback';

export function refundImpactKindFor(input: {
  status: PaymentStatus;
  amount: number;
  refundedAmount: number;
}): RefundImpactKind {
  if (input.status === 'charged_back') return 'chargeback';
  if (input.status === 'refunded') return 'refund_total';
  if (input.status === 'partially_refunded') {
    return input.amount > 0 && input.refundedAmount >= input.amount
      ? 'refund_total'
      : 'refund_partial';
  }
  // approved/rejected no son novedades de dinero devuelto; el caller no
  // debería llegar acá, pero el fallback honesto es auditoría parcial.
  return 'refund_partial';
}

/** Impacto sobre el ciclo (Q1–Q4 cerradas por defecto en la v0.2). */
export type RefundImpact = 'revoke' | 'audit' | 'partial_keep';

export function decideRefundImpact(input: {
  kind: RefundImpactKind;
  currentCycle: boolean;
  subscriptionStatus: SubscriptionStatus;
}): RefundImpact {
  // R11.3/§3.3.2: un reembolso de un ciclo anterior solo se audita.
  if (!input.currentCycle) return 'audit';
  // §3.3.4: si la suscripción ya está inactiva/revocada, no hay plan que tocar.
  if (!isLiveSubscriptionStatus(input.subscriptionStatus)) return 'audit';
  // Q2: el parcial mantiene el plan hasta el fin del ciclo.
  if (input.kind === 'refund_partial') return 'partial_keep';
  // Q1/Q4: total y contracargo cortan el acceso de inmediato.
  return 'revoke';
}

/**
 * Contracargo revertido/ganado (Q5): se registra `reversal` y el plan queda
 * FREE hasta que el titular decida. No se reactiva automáticamente.
 */
export function isChargebackReversal(status: string): boolean {
  switch (status.toLowerCase()) {
    case 'won':
    case 'reversed':
    case 'reverted':
    case 'cancelled':
    case 'canceled':
      return true;
    default:
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Baja inmediata con reembolso (R9 + R11.5, decisión del titular)             */
/* -------------------------------------------------------------------------- */

/**
 * Motivo de la cotización. `none` siempre viene acompañado de un motivo
 * legible para que la UI no invente un monto ni prometa un reembolso.
 */
export type CancellationRefundReason =
  | 'full_window'
  | 'prorated'
  | 'no_payment'
  | 'no_balance'
  | 'less_than_one_day'
  | 'cycle_expired'
  | 'invalid_dates';

export interface CancellationRefundQuote {
  /** `full` = 100 % del saldo; `partial` = prorrateo; `none` = no hay dinero. */
  kind: 'full' | 'partial' | 'none';
  amountArs: number;
  paymentAmount: number;
  refundedBefore: number;
  availableArs: number;
  daysSincePayment: number | null;
  daysRemaining: number | null;
  cycleDays: number | null;
  reason: CancellationRefundReason;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Medianoche AR de un instante (03:00 UTC), para contar días corridos. */
function arDayStartMs(ms: number): number {
  const { year, month, day } = arDateParts(ms);
  return Date.UTC(year, month - 1, day, 3);
}

/** Días de calendario argentino entre dos instantes (positivo si `to` > `from`). */
export function arCalendarDaysBetween(fromMs: number, toMs: number): number {
  return Math.round((arDayStartMs(toMs) - arDayStartMs(fromMs)) / DAY_MS);
}

/**
 * Cotiza la baja inmediata de la suscripción (R9 + decisión del titular):
 *
 *   · dentro de los 10 días corridos desde el pago ⇒ 100 % del saldo;
 *   · después ⇒ `monto_pagado / días_totales_ciclo * días_restantes`, en días
 *     de calendario argentino y redondeado a 2 decimales;
 *   · menos de 24 h para el vencimiento, ciclo vencido o sin pago aprobado ⇒
 *     NO hay reembolso: se cancela la renovación y el PRO sigue hasta vencer.
 *
 * El monto SIEMPRE se topea al saldo no devuelto (`amount - refunded_amount`):
 * un reembolso previo no se devuelve dos veces. Función pura: sin DB ni red.
 */
export function quoteCancellationRefund(input: {
  paymentAmount: number | null;
  refundedAmount?: number | null;
  paidAtMs: number | null;
  cycleEndMs: number | null;
  nowMs: number;
}): CancellationRefundQuote {
  const paymentAmount =
    input.paymentAmount != null && Number.isFinite(input.paymentAmount)
      ? input.paymentAmount
      : 0;
  const refundedBefore = clampRefundedAmount(paymentAmount, input.refundedAmount ?? 0);
  const availableArs = Math.max(0, round2(paymentAmount - refundedBefore));
  const base = {
    paymentAmount,
    refundedBefore,
    availableArs,
    daysSincePayment: null,
    daysRemaining: null,
    cycleDays: null,
  };

  if (
    paymentAmount <= 0 ||
    input.paidAtMs == null ||
    !Number.isFinite(input.paidAtMs) ||
    input.cycleEndMs == null ||
    !Number.isFinite(input.cycleEndMs)
  ) {
    return { ...base, kind: 'none', amountArs: 0, reason: 'no_payment' };
  }
  if (input.cycleEndMs <= input.paidAtMs) {
    return { ...base, kind: 'none', amountArs: 0, reason: 'invalid_dates' };
  }
  if (availableArs <= 0.009) {
    return { ...base, kind: 'none', amountArs: 0, reason: 'no_balance' };
  }

  const remainingMs = input.cycleEndMs - input.nowMs;
  if (remainingMs <= 0) {
    return { ...base, kind: 'none', amountArs: 0, reason: 'cycle_expired' };
  }

  const daysSincePayment = arCalendarDaysBetween(input.paidAtMs, input.nowMs);
  const cycleDays = Math.max(1, arCalendarDaysBetween(input.paidAtMs, input.cycleEndMs));
  const daysRemaining = arCalendarDaysBetween(input.nowMs, input.cycleEndMs);

  if (daysSincePayment < 0) {
    return {
      ...base,
      daysSincePayment,
      daysRemaining,
      cycleDays,
      kind: 'none',
      amountArs: 0,
      reason: 'invalid_dates',
    };
  }

  // Menos de 24 h exactas para el vencimiento: no hay reembolso (decisión).
  if (remainingMs < DAY_MS || daysRemaining < 1) {
    return {
      ...base,
      daysSincePayment,
      daysRemaining,
      cycleDays,
      kind: 'none',
      amountArs: 0,
      reason: 'less_than_one_day',
    };
  }

  if (daysSincePayment <= 10) {
    return {
      ...base,
      daysSincePayment,
      daysRemaining,
      cycleDays,
      kind: 'full',
      amountArs: availableArs,
      reason: 'full_window',
    };
  }

  const prorated = round2((paymentAmount / cycleDays) * daysRemaining);
  const amountArs = Math.min(availableArs, Math.max(0, prorated));
  if (amountArs < 0.01) {
    return {
      ...base,
      daysSincePayment,
      daysRemaining,
      cycleDays,
      kind: 'none',
      amountArs: 0,
      reason: 'no_balance',
    };
  }

  return {
    ...base,
    daysSincePayment,
    daysRemaining,
    cycleDays,
    kind: 'partial',
    amountArs,
    reason: 'prorated',
  };
}
