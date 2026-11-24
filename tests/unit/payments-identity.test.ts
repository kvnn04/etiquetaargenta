/* ============================================================================
 * IDENTIDAD DEL CHECKOUT CON PLAN (spec_pagos_plan_mp.md §5.3/§5.4)
 * ----------------------------------------------------------------------------
 * Reglas puras: varias fuentes pueden resolver el usuario; si discrepan, el
 * evento se ignora (identity_conflict). Un preapproval de un intento viejo
 * jamás muta la suscripción nueva. `payer_email` no participa.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import {
  chooseIdentity,
  isCurrentPreapprovalAttempt,
  preapprovalEventDecision,
} from '@/lib/payments/identity';
import { validatePaymentForApply } from '@/lib/payments/apply';
import type { MpPaymentFull } from '@/lib/payments/mercadopago';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe('chooseIdentity — external_reference / plan / preapproval', () => {
  it('sin candidatos ⇒ sin usuario, sin conflicto', () => {
    expect(chooseIdentity([])).toEqual({ userId: null, source: null, conflict: false });
    expect(
      chooseIdentity([
        { source: 'external_reference', userId: null },
        { source: 'preapproval_plan', userId: undefined },
      ]),
    ).toEqual({ userId: null, source: null, conflict: false });
  });

  it('un candidato ⇒ ese usuario', () => {
    expect(
      chooseIdentity([{ source: 'preapproval_plan', userId: USER }]),
    ).toEqual({ userId: USER, source: 'preapproval_plan', conflict: false });
  });

  it('varias fuentes que coinciden ⇒ un usuario (gana external_reference)', () => {
    expect(
      chooseIdentity([
        { source: 'preapproval_id', userId: USER },
        { source: 'external_reference', userId: USER },
        { source: 'preapproval_plan', userId: USER },
      ]),
    ).toEqual({ userId: USER, source: 'external_reference', conflict: false });
  });

  it('dos usuarios distintos ⇒ conflicto (no se elige al azar)', () => {
    expect(
      chooseIdentity([
        { source: 'external_reference', userId: USER },
        { source: 'preapproval_plan', userId: OTHER },
      ]),
    ).toEqual({ userId: null, source: null, conflict: true });
  });
});

describe('isCurrentPreapprovalAttempt — preapproval local manda; plan si falta', () => {
  it('mismo preapproval ⇒ vigente aunque el plan no coincida', () => {
    expect(
      isCurrentPreapprovalAttempt({
        preapprovalId: 'pre-1',
        preapprovalPlanId: 'plan-viejo',
        subPreapprovalId: 'pre-1',
        subPreapprovalPlanId: 'plan-1',
      }),
    ).toBe(true);
  });

  it('preapproval local distinto ⇒ viejo/duplicado aunque comparta el plan', () => {
    expect(
      isCurrentPreapprovalAttempt({
        preapprovalId: 'pre-2',
        preapprovalPlanId: 'plan-1',
        subPreapprovalId: 'pre-1',
        subPreapprovalPlanId: 'plan-1',
      }),
    ).toBe(false);
  });

  it('sin preapproval local, el plan decide', () => {
    expect(
      isCurrentPreapprovalAttempt({
        preapprovalId: 'pre-1',
        preapprovalPlanId: 'plan-nuevo',
        subPreapprovalId: null,
        subPreapprovalPlanId: 'plan-nuevo',
      }),
    ).toBe(true);
    expect(
      isCurrentPreapprovalAttempt({
        preapprovalId: 'pre-1',
        preapprovalPlanId: 'plan-viejo',
        subPreapprovalId: null,
        subPreapprovalPlanId: 'plan-nuevo',
      }),
    ).toBe(false);
  });

  it('fila con plan + preapproval sin plan (legacy) ⇒ viejo', () => {
    expect(
      isCurrentPreapprovalAttempt({
        preapprovalId: 'pre-1',
        preapprovalPlanId: null,
        subPreapprovalId: null,
        subPreapprovalPlanId: 'plan-nuevo',
      }),
    ).toBe(false);
  });

  it('sin intento previo ⇒ el primero que llega es vigente', () => {
    expect(
      isCurrentPreapprovalAttempt({
        preapprovalId: 'pre-1',
        preapprovalPlanId: 'plan-1',
        subPreapprovalId: null,
        subPreapprovalPlanId: null,
      }),
    ).toBe(true);
  });
});

describe('preapprovalEventDecision — eventos tardíos', () => {
  it('intento vigente ⇒ apply (authorized solo vincula)', () => {
    expect(
      preapprovalEventDecision({
        preapprovalStatus: 'authorized',
        isCurrentAttempt: true,
        isSubscriptionLive: false,
      }),
    ).toBe('apply');
  });

  it('intento viejo con suscripción viva ⇒ ignore_stale_live', () => {
    expect(
      preapprovalEventDecision({
        preapprovalStatus: 'cancelled',
        isCurrentAttempt: false,
        isSubscriptionLive: true,
      }),
    ).toBe('ignore_stale_live');
    expect(
      preapprovalEventDecision({
        preapprovalStatus: 'authorized',
        isCurrentAttempt: false,
        isSubscriptionLive: true,
      }),
    ).toBe('ignore_stale_live');
  });

  it('intento viejo sin suscripción viva ⇒ ignore_stale_cancelled', () => {
    expect(
      preapprovalEventDecision({
        preapprovalStatus: 'authorized',
        isCurrentAttempt: false,
        isSubscriptionLive: false,
      }),
    ).toBe('ignore_stale_cancelled');
  });
});

const payment = (overrides: Partial<MpPaymentFull> = {}): MpPaymentFull => ({
  id: 191418025940,
  status: 'approved',
  statusDetail: 'accredited',
  externalReference: null,
  transactionAmount: 500,
  transactionAmountRefunded: 0,
  refunds: [],
  receiptUrl: null,
  dateApproved: iso(T0),
  dateLastUpdated: iso(T0),
  dateCreated: iso(T0),
  currencyId: 'ARS',
  preapprovalId: 'pre-1',
  preapprovalPlanId: 'plan-1',
  payerEmail: 'otra-cuenta@example.com',
  ...overrides,
});

describe('validatePaymentForApply — pago de plan sin external_reference', () => {
  const input = {
    userId: USER,
    watermarkMs: null,
    localPreapprovalId: 'pre-1',
  };

  it('sin external_reference y SIN flag ⇒ user_mismatch', () => {
    expect(validatePaymentForApply(payment(), input)).toEqual({
      ok: false,
      reason: 'user_mismatch',
    });
  });

  it('sin external_reference y con flag ⇒ se aplica', () => {
    const result = validatePaymentForApply(payment(), {
      ...input,
      allowMissingExternalReference: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized).toBe('approved');
      expect(result.amount).toBe(500);
    }
  });

  it('external_reference de OTRO usuario ⇒ user_mismatch aunque haya flag', () => {
    expect(
      validatePaymentForApply(payment({ externalReference: OTHER }), {
        ...input,
        allowMissingExternalReference: true,
      }),
    ).toEqual({ ok: false, reason: 'user_mismatch' });
  });

  it('external_reference correcto ⇒ se aplica sin flag', () => {
    expect(
      validatePaymentForApply(payment({ externalReference: USER }), input).ok,
    ).toBe(true);
  });

  it('preapproval distinto al local ⇒ preapproval_mismatch', () => {
    expect(
      validatePaymentForApply(
        payment({ externalReference: USER, preapprovalId: 'pre-2' }),
        input,
      ),
    ).toEqual({ ok: false, reason: 'preapproval_mismatch' });
  });
});
