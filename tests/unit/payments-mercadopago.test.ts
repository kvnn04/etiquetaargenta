import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREAPPROVAL_START_MARGIN_MS,
  cancelPreapproval,
  cancelPreapprovalPlan,
  createPreapproval,
  createPreapprovalPlan,
  getAuthorizedPayment,
  getPreapproval,
  getPreapprovalPlan,
  preapprovalStartDateIso,
  updatePreapprovalPlanBackUrl,
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

describe('createPreapprovalPlan — checkout hospedado con cuenta del pagador', () => {
  it('POST /preapproval_plan con external_reference, ARS/meses y back_url string', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    const captured: { url?: string; init?: RequestInit } = {};

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        captured.url = String(url);
        captured.init = init;
        return new Response(
          JSON.stringify({
            id: 'plan-qa-1',
            status: 'active',
            init_point:
              'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=plan-qa-1',
            external_reference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const result = await createPreapprovalPlan({
      reason: 'Simulador Mates — Plan PRO (suscripción mensual)',
      externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      amount: 500,
      backUrl: 'https://etiquetaargenta.vercel.app/perfil?pago=success',
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: 'plan-qa-1',
        initPoint:
          'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=plan-qa-1',
        status: 'active',
        externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      },
    });
    expect(captured.url).toBe('https://api.mercadopago.com/preapproval_plan');
    expect(captured.init?.method).toBe('POST');
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer TEST-token');
    expect(headers['X-Idempotency-Key']).toBeTruthy();

    const body = JSON.parse(String(captured.init?.body ?? '{}')) as Record<string, unknown>;
    expect(body.external_reference).toBe('ced3fa8c-41b4-4068-89c6-4007076dba07');
    expect(body.back_url).toBe('https://etiquetaargenta.vercel.app/perfil?pago=success');
    // El checkout del plan NO acepta payer_email: lo pide MP al pagador.
    expect(body).not.toHaveProperty('payer_email');
    const auto = body.auto_recurring as Record<string, unknown>;
    expect(auto.frequency).toBe(1);
    expect(auto.frequency_type).toBe('months');
    expect(auto.transaction_amount).toBe(500);
    expect(auto.currency_id).toBe('ARS');
  });

  it('400 de MP ⇒ resultado con status/mensaje, sin throw', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'invalid back_url' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const result = await createPreapprovalPlan({
      reason: 'QA',
      externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      amount: 500,
      backUrl: 'https://app.example/perfil?pago=success',
    });
    expect(result).toEqual({ ok: false, status: 400, message: 'invalid back_url' });
  });
});

describe('cancelPreapprovalPlan — PUT status cancelled', () => {
  it('manda PUT con { status: cancelled } y parsea la respuesta', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    const captured: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        captured.url = String(url);
        captured.init = init;
        return new Response(JSON.stringify({ id: 'plan-1', status: 'cancelled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const result = await cancelPreapprovalPlan('plan-1');
    expect(result).toEqual({ ok: true, data: { id: 'plan-1', status: 'cancelled' } });
    expect(captured.url).toBe('https://api.mercadopago.com/preapproval_plan/plan-1');
    expect(captured.init?.method).toBe('PUT');
    expect(JSON.parse(String(captured.init?.body))).toEqual({ status: 'cancelled' });
  });
});

describe('cancelPreapproval — PUT status cancelled (R9 in-app)', () => {
  it('manda PUT al endpoint oficial con { status: cancelled }', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    const captured: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        captured.url = String(url);
        captured.init = init;
        return new Response(JSON.stringify({ id: 'pre-1', status: 'cancelled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const result = await cancelPreapproval('pre-1');
    expect(result).toEqual({ ok: true, data: { id: 'pre-1', status: 'cancelled' } });
    expect(captured.url).toBe('https://api.mercadopago.com/preapproval/pre-1');
    expect(captured.init?.method).toBe('PUT');
    expect(JSON.parse(String(captured.init?.body))).toEqual({ status: 'cancelled' });
    expect((captured.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer TEST-token',
    );
  });

  it('400 de MP ⇒ resultado honesto, sin throw', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'preapproval not found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const result = await cancelPreapproval('pre-1');
    expect(result).toEqual({ ok: false, status: 400, message: 'preapproval not found' });
  });
});

describe('lecturas del checkout con plan', () => {
  it('getPreapproval expone preapproval_plan_id y fechas', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'pre-1',
            status: 'authorized',
            external_reference: null,
            preapproval_plan_id: 'plan-1',
            payer_email: 'otra-cuenta@example.com',
            next_payment_date: '2026-12-24T12:00:00.000Z',
            date_created: '2026-11-24T12:00:00.000Z',
            last_modified: '2026-11-24T12:05:00.000Z',
            auto_recurring: { transaction_amount: 500, currency_id: 'ARS' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = await getPreapproval('pre-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.preapprovalPlanId).toBe('plan-1');
    expect(result.data.externalReference).toBeNull();
    expect(result.data.status).toBe('authorized');
    expect(result.data.dateCreated).toBe('2026-11-24T12:00:00.000Z');
    expect(result.data.lastModified).toBe('2026-11-24T12:05:00.000Z');
  });

  it('getPreapprovalPlan lee estado, dueño, precio y back_url para reutilizar', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'plan-1',
            status: 'active',
            init_point:
              'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=plan-1',
            external_reference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
            back_url: 'https://etiquetaargenta-gilt.vercel.app/perfil?pago=success',
            auto_recurring: { transaction_amount: 50.0, currency_id: 'ARS' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = await getPreapprovalPlan('plan-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      id: 'plan-1',
      status: 'active',
      externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      amount: 50,
      currency: 'ARS',
      backUrl: 'https://etiquetaargenta-gilt.vercel.app/perfil?pago=success',
    });
  });

  it('updatePreapprovalPlanBackUrl manda PUT parcial con back_url', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    const captured: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        captured.url = String(url);
        captured.init = init;
        return new Response(
          JSON.stringify({
            id: 'plan-1',
            status: 'active',
            back_url: 'https://etiquetaargenta-gilt.vercel.app/perfil?pago=success',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const result = await updatePreapprovalPlanBackUrl(
      'plan-1',
      'https://etiquetaargenta-gilt.vercel.app/perfil?pago=success',
    );
    expect(result).toEqual({
      ok: true,
      data: {
        id: 'plan-1',
        status: 'active',
        backUrl: 'https://etiquetaargenta-gilt.vercel.app/perfil?pago=success',
      },
    });
    expect(captured.url).toBe('https://api.mercadopago.com/preapproval_plan/plan-1');
    expect(captured.init?.method).toBe('PUT');
    expect(JSON.parse(String(captured.init?.body))).toEqual({
      back_url: 'https://etiquetaargenta-gilt.vercel.app/perfil?pago=success',
    });
  });

  it('getAuthorizedPayment lee preapproval_id, external_reference y payment.id/status', async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 6114264375,
            status: 'scheduled',
            preapproval_id: 'pre-1',
            external_reference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
            transaction_amount: '500',
            currency_id: 'ARS',
            payment: { id: '19951521071', status: 'approved', status_detail: 'accredited' },
            date_created: '2026-11-24T12:00:00.000Z',
            last_modified: '2026-11-24T12:01:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = await getAuthorizedPayment('6114264375');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      id: '6114264375',
      preapprovalId: 'pre-1',
      externalReference: 'ced3fa8c-41b4-4068-89c6-4007076dba07',
      transactionAmount: 500,
      currencyId: 'ARS',
      paymentId: 19951521071,
      paymentStatus: 'approved',
      paymentStatusDetail: 'accredited',
    });
  });
});
