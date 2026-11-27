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
/* Arrepentimiento: reembolso total dentro de los 10 días (R13.5)             */
/* -------------------------------------------------------------------------- */

/** Ventana legal del arrepentimiento (debe coincidir con LEGAL_WITHDRAWAL_DAYS). */
export const WITHDRAWAL_REFUND_WINDOW_DAYS = 10;

/**
 * Resultado de evaluar el derecho de arrepentimiento. `eligible` sólo es true
 * dentro de los 10 días corridos: fuera de esa ventana NO hay reembolso, ni
 * total ni proporcional.
 */
export type WithdrawalRefundReason =
  | 'full_window'
  | 'outside_window'
  | 'no_payment'
  | 'no_balance'
  | 'invalid_dates';

export interface WithdrawalRefundEligibility {
  eligible: boolean;
  /** 100 % del saldo no devuelto; 0 cuando no corresponde reembolso. */
  amountArs: number;
  paymentAmount: number;
  refundedBefore: number;
  availableArs: number;
  daysSincePayment: number | null;
  reason: WithdrawalRefundReason;
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
 * Evalúa el reembolso del Botón de Arrepentimiento (R13.5):
 *
 *   · día 0 a día 10 corridos inclusive ⇒ reembolso del 100 % del saldo;
 *   · después del día 10 ⇒ NO hay reembolso (ni total ni proporcional);
 *   · sin pago, saldo ya devuelto o fechas inválidas ⇒ no hay monto.
 *
 * El monto SIEMPRE se topea al saldo no devuelto (`amount - refunded_amount`):
 * un reembolso previo no se devuelve dos veces. Función pura: sin DB ni red.
 */
export function evaluateWithdrawalRefund(input: {
  paymentAmount: number | null;
  refundedAmount?: number | null;
  paidAtMs: number | null;
  nowMs: number;
}): WithdrawalRefundEligibility {
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
  };

  if (
    paymentAmount <= 0 ||
    input.paidAtMs == null ||
    !Number.isFinite(input.paidAtMs)
  ) {
    return { ...base, eligible: false, amountArs: 0, reason: 'no_payment' };
  }
  if (availableArs <= 0.009) {
    return { ...base, eligible: false, amountArs: 0, reason: 'no_balance' };
  }

  const daysSincePayment = arCalendarDaysBetween(input.paidAtMs, input.nowMs);
  if (daysSincePayment < 0) {
    return {
      ...base,
      daysSincePayment,
      eligible: false,
      amountArs: 0,
      reason: 'invalid_dates',
    };
  }
  if (daysSincePayment > WITHDRAWAL_REFUND_WINDOW_DAYS) {
    return {
      ...base,
      daysSincePayment,
      eligible: false,
      amountArs: 0,
      reason: 'outside_window',
    };
  }

  return {
    ...base,
    daysSincePayment,
    eligible: true,
    amountArs: availableArs,
    reason: 'full_window',
  };
}
