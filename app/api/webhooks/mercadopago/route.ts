import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { parseWebhookEvent, verifyMpSignature } from '@/lib/payments/webhook';
import { getChargeback, getPayment, getPreapproval } from '@/lib/payments/mercadopago';
import { isChargebackReversal } from '@/lib/payments/refunds';
import { applyChargeback, applyPayment, applyPreapproval } from '@/lib/payments/apply';

/* ============================================================================
 * /api/webhooks/mercadopago — ÚNICO WEBHOOK DE DINERO (10B + posición 11)
 * ÚNICA FUENTE: spec_pagos.md §3-R7/R9 + spec_sync_de_pagos_y_reverificacion.md.
 * ----------------------------------------------------------------------------
 * FLUJO (fiel a R7):
 *   1. `x-signature` (`ts,v1`) contra el manifiesto oficial de MP con el
 *      secreto `MP_WEBHOOK_SECRET` — inválida/faltante ⇒ 403 (fail-close).
 *   2. Ruteo del evento: `payment.updated` y `preapproval.updated`; el resto
 *      se LOGEA y responde 200 (MP deja de reintentar).
 *   3. PULL del recurso real (GET payment / GET preapproval) — el body solo
 *      dice QUÉ id mirar (§6: "nunca confiar en el body").
 *   4. `applyPayment` / `applyPreapproval` (lib/payments/apply.ts): el MISMO
 *      camino que usa el sync. Dedupe por `mp_payment_id`, CAS por estado,
 *      reparación de `applied_at IS NULL` y claim atómico del email (R12.6/7).
 *   5. Emails legítimos SOLO desde apply.ts: recibo, gracia y cierre (R10).
 *
 * Respuestas: 200 ok/ignorado · 403 firma inválida · 502 pull de MP ·
 * 503 fallo de persistencia (MP reintenta; el dedupe hace el retry seguro).
 * ========================================================================== */

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Service = ReturnType<typeof createSupabaseServiceClient>;

/** Resolución user por external_reference (uuid). Null SIEMPRE con log (§6). */
async function resolveUserId(service: Service, externalRef: string | null): Promise<string | null> {
  if (!externalRef || !UUID_RE.test(externalRef)) {
    console.error('[mp webhook]: evento SIN external_reference util — ignorado con log');
    return null;
  }
  const { data: row } = await service
    .from('users')
    .select('id, deleted_at')
    .eq('id', externalRef)
    .maybeSingle<{ id: string; deleted_at: string | null }>();
  if (!row) {
    console.error('[mp webhook]: external_reference sin fila users — ignorado (pago ajeno)');
    return null;
  }
  if (row.deleted_at) {
    // §6: pagos posteriores de eliminadas se IGNORAN con log.
    console.error('[mp webhook]: evento de cuenta ELIMINADA — ignorado');
    return null;
  }
  return row.id;
}

async function handlePayment(resourceId: string): Promise<Response> {
  const fetched = await getPayment(resourceId);
  if (!fetched.ok) {
    console.error('[mp webhook]: pull de payment falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const userId = await resolveUserId(service, fetched.data.externalReference);
  if (!userId) return NextResponse.json({ received: true as const }, { status: 200 });

  const result = await applyPayment(fetched.data, {
    userId,
    source: 'webhook',
    watermarkMs: null, // el webhook es el camino primario: sin ventana R12.4
  });

  if (result.action === 'error') {
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'payment',
      mpPaymentId: fetched.data.id,
      user: userId,
      action: result.action,
      status: result.statusAfter,
      plan: result.planAfter,
      email: result.email,
      reason: result.reason,
    }),
  );

  return NextResponse.json(
    {
      received: true as const,
      ...(result.action === 'already_applied' ? { dedupe: true as const } : {}),
    },
    { status: 200 },
  );
}

async function handlePreapproval(resourceId: string): Promise<Response> {
  const fetched = await getPreapproval(resourceId);
  if (!fetched.ok) {
    console.error('[mp webhook]: pull preapproval falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const userId = await resolveUserId(service, fetched.data.externalReference);
  if (!userId) return NextResponse.json({ received: true as const }, { status: 200 });

  const result = await applyPreapproval(fetched.data, { userId, source: 'webhook' });
  if (result.action === 'error') {
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'preapproval',
      mpStatus: fetched.data.status,
      user: userId,
      action: result.action,
      period_end: result.periodEndMs ?? null,
    }),
  );

  return NextResponse.json({ received: true as const }, { status: 200 });
}

/**
 * R11.1/R11.6: el topic de contracargos solo dispara; la verdad sale de
 * `GET /v1/chargebacks/{id}` + `GET /v1/payments/{payment_id}`. Sin usuario
 * asociado se responde 200 y se logea (§3.4): jamás se inventa un dueño.
 */
async function handleChargeback(resourceId: string): Promise<Response> {
  const fetched = await getChargeback(resourceId);
  if (!fetched.ok) {
    console.error('[mp webhook]: pull chargeback falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  if (fetched.data.paymentId == null) {
    console.error('[mp webhook]: chargeback sin payment_id — ignorado con log:', resourceId);
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const payment = await getPayment(String(fetched.data.paymentId));
  if (!payment.ok && !isChargebackReversal(fetched.data.status)) {
    console.error(
      '[mp webhook]: pull payment del chargeback falla:',
      payment.status,
      payment.message,
    );
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const externalRef =
    (payment.ok ? payment.data.externalReference : null) ??
    fetched.data.externalReference;
  const userId = await resolveUserId(service, externalRef);
  if (!userId) return NextResponse.json({ received: true as const }, { status: 200 });

  const result = await applyChargeback(
    fetched.data,
    payment.ok ? payment.data : null,
    { userId, source: 'webhook', watermarkMs: null },
  );
  if (result.action === 'error') {
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'chargeback',
      chargebackId: fetched.data.id,
      mpPaymentId: fetched.data.paymentId,
      mpStatus: fetched.data.status,
      user: userId,
      action: result.action,
      adjustment: result.adjustmentKind,
      status: result.statusAfter,
      plan: result.planAfter,
      reason: result.reason,
    }),
  );

  return NextResponse.json(
    {
      received: true as const,
      ...(result.action === 'already_applied' ? { dedupe: true as const } : {}),
    },
    { status: 200 },
  );
}

/* -------------------------------------------------------------------------- */
/* Entrada — firma PRIMERO (fail-close), luego ruteo del recurso              */
/* -------------------------------------------------------------------------- */

export async function POST(request: NextRequest) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[mp webhook]: MP_WEBHOOK_SECRET ausente — webhook no operable');
    return NextResponse.json({ error: 'WEBHOOK_NO_CONFIGURADO' }, { status: 500 });
  }

  const payload = (await request.json().catch(() => null)) as unknown;
  const event = parseWebhookEvent(payload, request.nextUrl.searchParams);
  if (!event.resourceId) {
    console.error('[mp webhook]: evento SIN data.id — 403 (sin manifiesto ni pull posible)');
    return NextResponse.json({ error: 'FIRMA_INVALIDA' }, { status: 403 });
  }

  const valid = verifyMpSignature({
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId: event.resourceId,
    secret,
  });
  if (!valid) {
    console.error('[mp webhook]: FIRMA INVALIDA — 403 (motivo: no matchea el manifiesto)');
    return NextResponse.json({ error: 'FIRMA_INVALIDA' }, { status: 403 });
  }

  if (event.kind === 'payment') return handlePayment(event.resourceId);
  if (event.kind === 'preapproval') return handlePreapproval(event.resourceId);
  if (event.kind === 'chargeback') return handleChargeback(event.resourceId);

  console.log('[mp webhook]: tipo ignorado:', event.kind, event.resourceId);
  return NextResponse.json({ received: true as const }, { status: 200 });
}
