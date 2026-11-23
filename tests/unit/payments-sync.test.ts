/* ============================================================================
 * TESTS POSICIÓN 11 — SYNC DE PAGOS (spec_sync_de_pagos_y_reverificacion.md):
 * R12.3 (TTL/cooldown), R12.4 (ventana anti-resurrección), R12.5 (orden
 * cronológico), R12.6 (reparación idempotente), R12.12 (ARS/monto) y el
 * preapproval mismatch. Módulos PUROS: sin DB, sin red, instantes inyectados.
 * ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_MANUAL_COOLDOWN_MS,
  SYNC_TTL_ACTIVE_MS,
  SYNC_TTL_INACTIVE_MS,
  isWithinSyncWindow,
  retryAfterSeconds,
  selectPaymentsToApply,
  selectPaymentsToAudit,
  syncWindowMs,
  watermarkMsOf,
  type LocalPayment,
  type PaymentCandidate,
} from '@/lib/payments/sync';
import { decideExistingPayment, validatePaymentForApply } from '@/lib/payments/apply';
import {
  searchPreapprovalsByExternalReference,
  type MpPaymentFull,
} from '@/lib/payments/mercadopago';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0); // 06-nov-2026 09:00 AR
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const iso = (ms: number) => new Date(ms).toISOString();

const payment = (overrides: Partial<MpPaymentFull> = {}): MpPaymentFull => ({
  id: 1,
  status: 'approved',
  statusDetail: null,
  externalReference: USER,
  transactionAmount: 20_000,
  transactionAmountRefunded: 0,
  refunds: [],
  receiptUrl: 'https://mp.example/receipt/1',
  dateApproved: iso(T0),
  dateLastUpdated: iso(T0),
  dateCreated: iso(T0),
  currencyId: 'ARS',
  preapprovalId: 'pre-1',
  payerEmail: 'taller@example.com',
  ...overrides,
});

describe('R12.3 — TTL on-read y cooldown manual', () => {
  it('manual (force) ⇒ 20 s; activa ⇒ 6 h; el resto ⇒ 60 s', () => {
    expect(syncWindowMs({ force: true, status: 'activa' })).toBe(SYNC_MANUAL_COOLDOWN_MS);
    expect(syncWindowMs({ force: true, status: 'inactiva' })).toBe(SYNC_MANUAL_COOLDOWN_MS);
    expect(syncWindowMs({ force: false, status: 'activa' })).toBe(SYNC_TTL_ACTIVE_MS);
    expect(syncWindowMs({ force: false, status: 'gracia' })).toBe(SYNC_TTL_INACTIVE_MS);
    expect(syncWindowMs({ force: false, status: 'programada_cierre' })).toBe(
      SYNC_TTL_INACTIVE_MS,
    );
    expect(syncWindowMs({ force: false, status: 'inactiva' })).toBe(SYNC_TTL_INACTIVE_MS);
    expect(syncWindowMs({ force: false, status: null })).toBe(SYNC_TTL_INACTIVE_MS);
  });

  it('retryAfterSeconds redondea hacia arriba y nunca baja de 1', () => {
    expect(retryAfterSeconds(T0 - 5_000, 20_000, T0)).toBe(15);
    expect(retryAfterSeconds(T0, 20_000, T0)).toBe(20);
    expect(retryAfterSeconds(T0 - 30_000, 20_000, T0)).toBe(1);
  });
});

describe('R12.4 — ventana anti-resurrección', () => {
  it('acepta el borde watermark − 1 día y rechaza 1 ms antes', () => {
    expect(isWithinSyncWindow(T0 - DAY, T0)).toBe(true);
    expect(isWithinSyncWindow(T0 - DAY + 1, T0)).toBe(true);
    expect(isWithinSyncWindow(T0 - DAY - 1, T0)).toBe(false);
    expect(isWithinSyncWindow(Number.NaN, T0)).toBe(false);
  });

  it('watermark: last_checkout_at → created_at → último checkout_intent', () => {
    expect(
      watermarkMsOf({
        lastCheckoutAtMs: T0,
        subscriptionCreatedAtMs: T0 - DAY,
        lastCheckoutIntentMs: T0 - 2 * DAY,
      }),
    ).toBe(T0);
    expect(
      watermarkMsOf({
        lastCheckoutAtMs: null,
        subscriptionCreatedAtMs: T0 - DAY,
        lastCheckoutIntentMs: T0 - 2 * DAY,
      }),
    ).toBe(T0 - DAY);
    expect(
      watermarkMsOf({
        lastCheckoutAtMs: null,
        subscriptionCreatedAtMs: null,
        lastCheckoutIntentMs: T0 - 2 * DAY,
      }),
    ).toBe(T0 - 2 * DAY);
    expect(
      watermarkMsOf({
        lastCheckoutAtMs: null,
        subscriptionCreatedAtMs: null,
        lastCheckoutIntentMs: null,
      }),
    ).toBeNull();
  });
});

describe('R12.5/R12.6 — selección y orden de pagos', () => {
  const candidates: PaymentCandidate[] = [
    { id: 1, dateCreatedMs: T0 - 120 * 60_000, externalReference: USER, status: 'approved' },
    { id: 2, dateCreatedMs: T0 - 60 * 60_000, externalReference: USER, status: 'rejected' },
    { id: 3, dateCreatedMs: T0 - 30 * 60_000, externalReference: OTHER, status: 'approved' },
    { id: 4, dateCreatedMs: T0 - 40 * 60_000, externalReference: USER, status: 'pending' },
    { id: 5, dateCreatedMs: T0 - 2 * DAY, externalReference: USER, status: 'approved' },
    { id: 6, dateCreatedMs: T0 - 50 * 60_000, externalReference: USER, status: 'approved' },
  ];
  const locals: LocalPayment[] = [
    { mpPaymentId: 6, status: 'approved', appliedAtMs: T0, occurredAtMs: T0 - 50 * 60_000 },
    { mpPaymentId: 7, status: 'approved', appliedAtMs: null, occurredAtMs: T0 - 70 * 60_000 },
    { mpPaymentId: 8, status: 'refunded', appliedAtMs: null, occurredAtMs: T0 - 80 * 60_000 },
  ];

  it('aplica faltantes + reparables dentro de la ventana, en orden ASC', () => {
    expect(selectPaymentsToApply(candidates, locals, T0, USER)).toEqual([
      { id: 1, dateMs: T0 - 120 * 60_000, kind: 'missing' },
      { id: 8, dateMs: T0 - 80 * 60_000, kind: 'reparable' },
      { id: 7, dateMs: T0 - 70 * 60_000, kind: 'reparable' },
      { id: 2, dateMs: T0 - 60 * 60_000, kind: 'missing' },
    ]);
  });

  it('excluye otro usuario, pending, viejos y ya aplicados; incluye refunded pendiente', () => {
    const ids = selectPaymentsToApply(candidates, locals, T0, USER).map((p) => p.id);
    expect(ids).not.toContain(3); // otro external_reference
    expect(ids).not.toContain(4); // pending no muta
    expect(ids).not.toContain(5); // fuera de la ventana R12.4
    expect(ids).not.toContain(6); // applied_at no nulo
    expect(ids).toContain(8); // refunded con applied_at NULL ⇒ R11 lo repara
  });

  it('audita solo los viejos ausentes del historial local', () => {
    expect(selectPaymentsToAudit(candidates, locals, T0, USER)).toEqual([
      { id: 5, dateMs: T0 - 2 * DAY, kind: 'audit' },
    ]);
    expect(
      selectPaymentsToAudit(
        candidates,
        [...locals, { mpPaymentId: 5, status: 'approved', appliedAtMs: null, occurredAtMs: T0 - 2 * DAY }],
        T0,
        USER,
      ),
    ).toEqual([]);
  });

  it('R12.6 puro: applied_at manda; refunded/charged_back no se tocan', () => {
    expect(decideExistingPayment({ applied_at: iso(T0), status: 'approved' })).toEqual({
      action: 'already_applied',
    });
    expect(decideExistingPayment({ applied_at: null, status: 'approved' })).toEqual({
      action: 'repair',
    });
    expect(decideExistingPayment({ applied_at: null, status: 'rejected' })).toEqual({
      action: 'repair',
    });
    expect(decideExistingPayment({ applied_at: null, status: 'refunded' })).toEqual({
      action: 'ignore_status',
    });
    expect(decideExistingPayment({ applied_at: null, status: 'charged_back' })).toEqual({
      action: 'ignore_status',
    });
  });
});

describe('R12.1/R12.12 — validación previa al INSERT', () => {
  const input = { userId: USER, watermarkMs: T0, localPreapprovalId: 'pre-1' };

  it('approved ARS con monto y fecha válidos ⇒ ok', () => {
    expect(validatePaymentForApply(payment(), input)).toEqual({
      ok: true,
      normalized: 'approved',
      amount: 20_000,
      refundedAmount: 0,
      statusDetail: null,
      occurredMs: T0,
      createdMs: T0,
      old: false,
    });
  });

  it('external_reference de otro usuario / no UUID ⇒ user_mismatch', () => {
    expect(validatePaymentForApply(payment({ externalReference: OTHER }), input)).toEqual({
      ok: false,
      reason: 'user_mismatch',
    });
    expect(validatePaymentForApply(payment({ externalReference: 'no-uuid' }), input)).toEqual({
      ok: false,
      reason: 'user_mismatch',
    });
  });

  it('pending ⇒ unsupported_status; refunded ⇒ estado R11 válido', () => {
    expect(validatePaymentForApply(payment({ status: 'pending' }), input)).toEqual({
      ok: false,
      reason: 'unsupported_status',
    });
    expect(validatePaymentForApply(payment({ status: 'refunded' }), input)).toEqual({
      ok: true,
      normalized: 'refunded',
      amount: 20_000,
      refundedAmount: 20_000,
      statusDetail: null,
      occurredMs: T0,
      createdMs: T0,
      old: false,
    });
  });

  it('moneda distinta de ARS o monto no positivo ⇒ skip', () => {
    expect(validatePaymentForApply(payment({ currencyId: 'USD' }), input)).toEqual({
      ok: false,
      reason: 'currency_not_ars',
    });
    expect(validatePaymentForApply(payment({ transactionAmount: 0 }), input)).toEqual({
      ok: false,
      reason: 'amount_invalid',
    });
    expect(validatePaymentForApply(payment({ transactionAmount: Number.NaN }), input)).toEqual({
      ok: false,
      reason: 'amount_invalid',
    });
  });

  it('rechazado: la gracia corre desde date_last_updated, no desde date_created', () => {
    const rejected = payment({
      status: 'rejected',
      dateApproved: null,
      dateCreated: iso(T0 - 2 * DAY),
      dateLastUpdated: iso(T0),
    });
    expect(validatePaymentForApply(rejected, input)).toMatchObject({
      ok: true,
      normalized: 'rejected',
      occurredMs: T0,
      createdMs: T0 - 2 * DAY,
      old: true, // date_created quedó fuera de la ventana; se audita, no muta
    });
  });

  it('fechas rotas ⇒ invalid_date; usa date_approved como fallback de created', () => {
    expect(
      validatePaymentForApply(
        payment({ dateCreated: null, dateApproved: null, dateLastUpdated: null }),
        input,
      ),
    ).toEqual({ ok: false, reason: 'invalid_date' });

    expect(
      validatePaymentForApply(
        payment({ dateCreated: null, dateApproved: iso(T0 - 1_000), dateLastUpdated: null }),
        input,
      ),
    ).toMatchObject({ ok: true, createdMs: T0 - 1_000, occurredMs: T0 - 1_000 });
  });

  it('preapproval local distinto ⇒ preapproval_mismatch; local NULL adopta', () => {
    expect(
      validatePaymentForApply(payment({ preapprovalId: 'pre-2' }), input),
    ).toEqual({ ok: false, reason: 'preapproval_mismatch' });
    expect(
      validatePaymentForApply(payment({ preapprovalId: 'pre-2' }), {
        ...input,
        localPreapprovalId: null,
      }),
    ).toMatchObject({ ok: true });
  });

  it('pago anterior al watermark − 1 día ⇒ ok con old=true (audita, no muta)', () => {
    const oldPay = payment({
      dateCreated: iso(T0 - DAY - 1),
      dateApproved: iso(T0 - DAY - 1),
      dateLastUpdated: iso(T0 - DAY - 1),
    });
    expect(validatePaymentForApply(oldPay, input)).toMatchObject({ ok: true, old: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Transporte MP — regresión del 400 de /preapproval/search (23-nov-2026)      */
/* -------------------------------------------------------------------------- */

describe('MP /preapproval/search — formato de sort', () => {
  const originalToken = process.env.MP_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = originalToken;
  });

  it('usa sort=campo:orden (no sort + criteria): MP responde 400 al formato viejo', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchPreapprovalsByExternalReference(USER, { limit: 10 });

    expect(result.ok).toBe(true);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain(`external_reference=${USER}`);
    expect(url).toContain('sort=date_created%3Adesc');
    expect(url).not.toContain('criteria=');
  });

  it('loguea el mensaje del body de MP en un 400 (sin cambiar el contrato)', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ message: 'Invalid sorting value format.', status: 400 }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await searchPreapprovalsByExternalReference(USER);

    expect(result).toEqual({ ok: false, status: 400, message: 'HTTP 400' });
    expect(errorLog).toHaveBeenCalledWith(
      '[mp preapproval search]:',
      'HTTP 400',
      '— Invalid sorting value format.',
    );
  });
});
