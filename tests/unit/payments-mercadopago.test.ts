import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREAPPROVAL_START_MARGIN_MS,
  createPreapproval,
  preapprovalStartDateIso,
} from '@/lib/payments/mercadopago';

/* ============================================================================
 * Cliente MP — payload de preapproval (posición 10B, QA 23-nov-2026)
 * ----------------------------------------------------------------------------
 * Regresiones REALES encontradas contra MP TEST:
 *   · `back_url` debe ser un STRING; un objeto devuelve 400
 *     "back_url is required".
 *   · `auto_recurring.start_date` no puede ser el instante actual; MP
 *     devuelve 400 "cannot be a past date".
 * Estos tests fijan el contrato sin red ni DB.
 * ========================================================================== */

const NOW = Date.parse('2026-11-23T18:00:00.000Z');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MP_ACCESS_TOKEN;
});

describe('preapprovalStartDateIso — MP exige start_date futura', () => {
  it('fecha pasada ⇒ now + margen', () => {
    expect(preapprovalStartDateIso('2026-11-23T17:59:00.000Z', NOW)).toBe(
      new Date(NOW + PREAPPROVAL_START_MARGIN_MS).toISOString(),
    );
  });

  it('fecha dentro del margen ⇒ now + margen', () => {
    expect(preapprovalStartDateIso('2026-11-23T18:02:00.000Z', NOW)).toBe(
      new Date(NOW + PREAPPROVAL_START_MARGIN_MS).toISOString(),
    );
  });

  it('fecha ya futura más allá del margen ⇒ se respeta', () => {
    expect(preapprovalStartDateIso('2026-11-23T19:00:00.000Z', NOW)).toBe(
      '2026-11-23T19:00:00.000Z',
    );
  });

  it('fecha inválida ⇒ now + margen (nunca un payload roto)', () => {
    expect(preapprovalStartDateIso('no-es-fecha', NOW)).toBe(
      new Date(NOW + PREAPPROVAL_START_MARGIN_MS).toISOString(),
    );
  });
});

describe('createPreapproval — contrato del payload', () => {
  it('manda back_url string + start_date futura + ARS/meses', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    const captured: { body?: Record<string, unknown> } = {};

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: 'pre-qa-1',
          init_point: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-qa-1',
          status: 'pending',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createPreapproval({
      reason: 'Simulador Mates — Plan PRO (suscripción mensual)',
      payerEmail: 'taller@example.com',
      externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      amount: 20000,
      backUrls: {
        success: 'https://app.example/perfil?pago=success',
        failure: 'https://app.example/perfil?pago=failure',
        pending: 'https://app.example/perfil?pago=pending',
      },
      notificationUrl: 'https://app.example/api/webhooks/mercadopago',
      startDateIso: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.body).toBeDefined();
    const body = captured.body as Record<string, unknown>;

    expect(body.back_url).toBe('https://app.example/perfil?pago=success');
    expect(typeof body.back_url).toBe('string');
    expect(body.back_url).not.toHaveProperty('success');

    const auto = body.auto_recurring as Record<string, unknown>;
    expect(auto.currency_id).toBe('ARS');
    expect(auto.frequency).toBe(1);
    expect(auto.frequency_type).toBe('months');
    expect(auto.transaction_amount).toBe(20000);
    expect(Date.parse(String(auto.start_date))).toBeGreaterThan(Date.now() + 4 * 60_000);

    expect(body.external_reference).toBe('ced3fa8c-41b4-4068-89c6-4007076dba07');
    expect(body.notification_url).toBe('https://app.example/api/webhooks/mercadopago');
  });

  it('400 de MP ⇒ MpResult con status y mensaje (sin throw)', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            message: 'Parameters passed are invalid',
            cause: [{ code: 7, description: 'back_url is required' }],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = await createPreapproval({
      reason: 'QA',
      payerEmail: 'taller@example.com',
      externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      amount: 20000,
      backUrls: {
        success: 'https://app.example/perfil?pago=success',
        failure: 'https://app.example/perfil?pago=failure',
        pending: 'https://app.example/perfil?pago=pending',
      },
      notificationUrl: 'https://app.example/api/webhooks/mercadopago',
      startDateIso: new Date().toISOString(),
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      message: 'Parameters passed are invalid',
    });
  });
});
