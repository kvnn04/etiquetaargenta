/* ============================================================================
 * TESTS POSICIÓN 13 — REEMBOLSOS Y CONTRACARGOS
 * Fuente: spec_reembolsos_y_contracargos.md v0.2 (R11.1–R11.10 + Q1–Q7).
 * Módulos PUROS: sin DB, sin red, instantes inyectados.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import {
  normalizeMpPaymentStatus,
  resolvePlan,
  transitionSubscription,
} from '@/lib/payments/core';
import {
  clampRefundedAmount,
  decideRefundImpact,
  effectiveRefundedAmount,
  isChargebackReversal,
  isCurrentCyclePayment,
  isRefundLikeStatus,
  mergeRefundStatus,
  refundImpactKindFor,
  resolveRefundStatus,
} from '@/lib/payments/refunds';

const T0 = Date.UTC(2026, 10, 20, 15, 0, 0); // 2026-11-20 12:00 AR
const AMOUNT = 20_000;

describe('R11.2 — monto devuelto: clamp y acumulación', () => {
  it('clampea a [0, amount] y tolera valores inválidos', () => {
    expect(clampRefundedAmount(AMOUNT, 5_000)).toBe(5_000);
    expect(clampRefundedAmount(AMOUNT, AMOUNT + 1)).toBe(AMOUNT);
    expect(clampRefundedAmount(AMOUNT, -10)).toBe(0);
    expect(clampRefundedAmount(0, 5_000)).toBe(0);
    expect(clampRefundedAmount(Number.NaN, 5_000)).toBe(0);
    expect(clampRefundedAmount(AMOUNT, Number.NaN)).toBe(0);
  });

  it('refunded/charged_back valen el total aunque MP omita el campo', () => {
    expect(
      effectiveRefundedAmount({
        mpStatus: 'refunded',
        amount: AMOUNT,
        refundedAmount: null,
      }),
    ).toBe(AMOUNT);
    expect(
      effectiveRefundedAmount({
        mpStatus: 'charged_back',
        amount: AMOUNT,
        refundedAmount: 0,
      }),
    ).toBe(AMOUNT);
    expect(
      effectiveRefundedAmount({
        mpStatus: 'approved',
        amount: AMOUNT,
        refundedAmount: 7_500,
      }),
    ).toBe(7_500);
  });

  it('un approved con devolución acumulada se vuelve parcial o total', () => {
    expect(
      resolveRefundStatus({
        mpStatus: 'approved',
        amount: AMOUNT,
        refundedAmount: 0,
      }),
    ).toBe('approved');
    expect(
      resolveRefundStatus({
        mpStatus: 'approved',
        amount: AMOUNT,
        refundedAmount: 5_000,
      }),
    ).toBe('partially_refunded');
    expect(
      resolveRefundStatus({
        mpStatus: 'approved',
        amount: AMOUNT,
        refundedAmount: AMOUNT,
      }),
    ).toBe('refunded');
    expect(
      resolveRefundStatus({
        mpStatus: 'partially_refunded',
        amount: AMOUNT,
        refundedAmount: AMOUNT,
      }),
    ).toBe('refunded');
    expect(
      resolveRefundStatus({
        mpStatus: 'refunded',
        amount: AMOUNT,
        refundedAmount: 1,
      }),
    ).toBe('refunded');
    expect(
      resolveRefundStatus({
        mpStatus: 'charged_back',
        amount: AMOUNT,
        refundedAmount: null,
      }),
    ).toBe('charged_back');
    expect(
      resolveRefundStatus({
        mpStatus: 'pending',
        amount: AMOUNT,
        refundedAmount: 0,
      }),
    ).toBeNull();
  });

  it('merge monótono: un evento viejo nunca deshace el dinero devuelto', () => {
    expect(mergeRefundStatus('approved', 'refunded')).toBe('refunded');
    expect(mergeRefundStatus('partially_refunded', 'refunded')).toBe('refunded');
    expect(mergeRefundStatus('refunded', 'partially_refunded')).toBe('refunded');
    expect(mergeRefundStatus('charged_back', 'refunded')).toBe('charged_back');
    expect(mergeRefundStatus('refunded', 'charged_back')).toBe('charged_back');
    expect(mergeRefundStatus('approved', 'partially_refunded')).toBe('partially_refunded');
  });

  it('isRefundLikeStatus distingue solo los estados de dinero devuelto', () => {
    expect(isRefundLikeStatus('refunded')).toBe(true);
    expect(isRefundLikeStatus('partially_refunded')).toBe(true);
    expect(isRefundLikeStatus('charged_back')).toBe(true);
    expect(isRefundLikeStatus('approved')).toBe(false);
    expect(isRefundLikeStatus('rejected')).toBe(false);
    expect(isRefundLikeStatus('pending')).toBe(false);
  });
});

describe('R11.3/§3.3 — ciclo vigente', () => {
  it('solo el último pago aprobado/financiador es el ciclo vigente', () => {
    expect(
      isCurrentCyclePayment({ affectedPaymentId: 7, lastApprovedPaymentId: 7 }),
    ).toBe(true);
    expect(
      isCurrentCyclePayment({ affectedPaymentId: 7, lastApprovedPaymentId: 8 }),
    ).toBe(false);
    expect(
      isCurrentCyclePayment({ affectedPaymentId: 7, lastApprovedPaymentId: null }),
    ).toBe(false);
  });

  it('clasifica la novedad por estado autoritativo', () => {
    expect(
      refundImpactKindFor({
        status: 'refunded',
        amount: AMOUNT,
        refundedAmount: AMOUNT,
      }),
    ).toBe('refund_total');
    expect(
      refundImpactKindFor({
        status: 'partially_refunded',
        amount: AMOUNT,
        refundedAmount: 5_000,
      }),
    ).toBe('refund_partial');
    expect(
      refundImpactKindFor({
        status: 'partially_refunded',
        amount: AMOUNT,
        refundedAmount: AMOUNT,
      }),
    ).toBe('refund_total');
    expect(
      refundImpactKindFor({
        status: 'charged_back',
        amount: AMOUNT,
        refundedAmount: AMOUNT,
      }),
    ).toBe('chargeback');
  });

  it('Q1–Q4: total/contracargo revocan; parcial mantiene; ciclo pasado audita', () => {
    expect(
      decideRefundImpact({
        kind: 'refund_total',
        currentCycle: true,
        subscriptionStatus: 'activa',
      }),
    ).toBe('revoke');
    expect(
      decideRefundImpact({
        kind: 'chargeback',
        currentCycle: true,
        subscriptionStatus: 'gracia',
      }),
    ).toBe('revoke');
    expect(
      decideRefundImpact({
        kind: 'refund_total',
        currentCycle: true,
        subscriptionStatus: 'programada_cierre',
      }),
    ).toBe('revoke');
    expect(
      decideRefundImpact({
        kind: 'refund_partial',
        currentCycle: true,
        subscriptionStatus: 'activa',
      }),
    ).toBe('partial_keep');
    expect(
      decideRefundImpact({
        kind: 'refund_total',
        currentCycle: false,
        subscriptionStatus: 'activa',
      }),
    ).toBe('audit');
    expect(
      decideRefundImpact({
        kind: 'refund_total',
        currentCycle: true,
        subscriptionStatus: 'inactiva',
      }),
    ).toBe('audit');
    expect(
      decideRefundImpact({
        kind: 'refund_total',
        currentCycle: true,
        subscriptionStatus: 'revocada',
      }),
    ).toBe('audit');
  });

  it('Q5: reverso/ganado se reconoce sin reactivar', () => {
    expect(isChargebackReversal('won')).toBe(true);
    expect(isChargebackReversal('reversed')).toBe(true);
    expect(isChargebackReversal('CANCELLED')).toBe(true);
    expect(isChargebackReversal('opened')).toBe(false);
    expect(isChargebackReversal('lost')).toBe(false);
  });
});

describe('R11.4/R11.6 — máquina de estados', () => {
  it('resolvePlan({status:revocada}) ⇒ free', () => {
    expect(resolvePlan({ status: 'revocada', graceExpiresAtMs: null, periodEndMs: null }, T0)).toBe(
      'free',
    );
  });

  it('reembolso total desde estados vivos ⇒ revocada con closure_reason=refund', () => {
    for (const status of ['activa', 'gracia', 'programada_cierre'] as const) {
      expect(
        transitionSubscription(status, { kind: 'reembolso_total', occurredAtMs: T0 }),
      ).toEqual({
        status: 'revocada',
        freezePrice: false,
        graceExpiresAtMs: null,
        periodEndMs: null,
        closureReason: 'refund',
        closedAtMs: T0,
      });
    }
  });

  it('contracargo ⇒ revocada con closure_reason=chargeback', () => {
    expect(transitionSubscription('activa', { kind: 'contracargo', occurredAtMs: T0 })).toEqual({
      status: 'revocada',
      freezePrice: false,
      graceExpiresAtMs: null,
      periodEndMs: null,
      closureReason: 'chargeback',
      closedAtMs: T0,
    });
  });

  it('inactiva/revocada no se re-revocan (solo se audita el pago)', () => {
    expect(
      transitionSubscription('inactiva', { kind: 'reembolso_total', occurredAtMs: T0 }),
    ).toBeNull();
    expect(
      transitionSubscription('revocada', { kind: 'contracargo', occurredAtMs: T0 }),
    ).toBeNull();
  });

  it('un approved posterior al reembolso NUNCA resucita PRO (carrera §6)', () => {
    expect(transitionSubscription('revocada', { kind: 'cobro_aprobado' })).toBeNull();
  });

  it('la whitelist del webhook acepta los estados de R11', () => {
    expect(normalizeMpPaymentStatus('refunded')).toBe('refunded');
    expect(normalizeMpPaymentStatus('partially_refunded')).toBe('partially_refunded');
    expect(normalizeMpPaymentStatus('charged_back')).toBe('charged_back');
    expect(normalizeMpPaymentStatus('pending')).toBeNull();
  });
});
