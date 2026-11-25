import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { parseWebhookEvent, verifyMpSignature } from '@/lib/payments/webhook';
import {
  getAuthorizedPayment,
  getChargeback,
  getPayment,
  getPreapproval,
  type MpPaymentFull,
} from '@/lib/payments/mercadopago';
import { isChargebackReversal } from '@/lib/payments/refunds';
import { applyChargeback, applyPayment, applyPreapproval } from '@/lib/payments/apply';
import {
  chooseIdentity,
  isUuid,
  type IdentityCandidate,
  type IdentitySource,
} from '@/lib/payments/identity';

/* ============================================================================
 * /api/webhooks/mercadopago — ÚNICO WEBHOOK DE DINERO (10B + pos 11/13 + plan)
 * ÚNICA FUENTE: spec_pagos.md §3-R7/R9, spec_sync_de_pagos_y_reverificacion.md
 * y spec_pagos_plan_mp.md §5.3–5.6.
 * ----------------------------------------------------------------------------
 * FLUJO (fiel a R7):
 *   1. `x-signature` (`ts,v1`) contra el manifiesto oficial de MP con el
 *      secreto `MP_WEBHOOK_SECRET` — inválida/faltante ⇒ 403 (fail-close).
 *   2. Ruteo: payment, preapproval/subscription_preapproval,
 *      authorized_payment/subscription_authorized_payment y chargeback; el
 *      resto se LOGEA y responde 200 (MP deja de reintentar).
 *   3. PULL del recurso real (GET payment / preapproval / authorized_payment /
 *      chargeback) — el body solo dice QUÉ id mirar (§6: nunca confiar en el
 *      body).
 *   4. Identidad SIN usar payer_email: external_reference → plan mapping →
 *      preapproval local. Dos identidades distintas ⇒ `identity_conflict`
 *      (200 sin mutar; jamás se elige una al azar).
 *   5. `applyPayment` / `applyPreapproval` / `applyChargeback`: el MISMO camino
 *      que usa el sync. Dedupe por `mp_payment_id`, CAS por estado, reparación
 *      de `applied_at IS NULL` y claim atómico del email (R12.6/7).
 *
 * Respuestas: 200 ok/ignorado · 403 firma inválida · 502 pull de MP ·
 * 503 fallo de persistencia (MP reintenta; el dedupe hace el retry seguro).
 * ========================================================================== */

export const dynamic = 'force-dynamic';

type Service = ReturnType<typeof createSupabaseServiceClient>;

interface ResolvedIdentity {
  userId: string | null;
  source: IdentitySource | null;
  conflict: boolean;
  /** Un pull necesario falló de forma transitoria ⇒ conviene que MP reintente. */
  retryable?: boolean;
}

/**
 * Un 404 de MP significa que el recurso no existe en el entorno consultado:
 * típico del botón "Probar" del panel, que manda `payment.id = 123456` y
 * `live_mode: false`. Reintentar no lo va a crear, así que se responde 200
 * (MP deja de reintentar) en vez del 502 reservado a fallas transitorias.
 */
function missingResource(kind: string, id: string, status: number): Response | null {
  if (status !== 404) return null;
  console.log('[mp webhook resource_not_found]', JSON.stringify({ kind, id }));
  return NextResponse.json({ received: true as const }, { status: 200 });
}

/** users.id existe y no está eliminado. */
async function lookupUser(service: Service, userId: string | null): Promise<string | null> {
  if (!userId || !isUuid(userId)) return null;
  const { data, error } = await service
    .from('users')
    .select('id, deleted_at')
    .eq('id', userId)
    .maybeSingle<{ id: string; deleted_at: string | null }>();
  if (error) {
    console.error('[mp webhook users read]:', error.message);
    return null;
  }
  if (!data) return null;
  if (data.deleted_at) {
    // §6: pagos posteriores de cuentas eliminadas se IGNORAN con log.
    console.error('[mp webhook]: evento de cuenta ELIMINADA — ignorado');
    return null;
  }
  return data.id;
}

async function resolveExternalReference(
  service: Service,
  externalReference: string | null | undefined,
): Promise<string | null> {
  if (!isUuid(externalReference)) return null;
  return lookupUser(service, externalReference);
}

async function resolvePlanMapping(
  service: Service,
  preapprovalPlanId: string | null | undefined,
): Promise<string | null> {
  if (!preapprovalPlanId) return null;
  const { data, error } = await service
    .from('mp_preapproval_plans')
    .select('user_id')
    .eq('id', preapprovalPlanId)
    .maybeSingle<{ user_id: string }>();
  if (error) {
    console.error('[mp webhook plan mapping read]:', error.message);
    return null;
  }
  return data?.user_id ?? null;
}

async function resolveLocalPreapproval(
  service: Service,
  preapprovalId: string | null | undefined,
): Promise<string | null> {
  if (!preapprovalId) return null;
  const { data, error } = await service
    .from('subscriptions')
    .select('user_id')
    .eq('preapproval_id', preapprovalId)
    .maybeSingle<{ user_id: string }>();
  if (error) {
    console.error('[mp webhook preapproval read]:', error.message);
    return null;
  }
  return data?.user_id ?? null;
}

/**
 * Suma candidatos de un preapproval: primero la fila local; si no está (p.ej.
 * el webhook de pago llegó antes que el de preapproval), se lee de MP y se
 * resuelve por plan/external_reference.
 */
async function addPreapprovalCandidates(
  service: Service,
  preapprovalId: string | null | undefined,
  candidates: IdentityCandidate[],
): Promise<boolean> {
  if (!preapprovalId) return false;
  const local = await resolveLocalPreapproval(service, preapprovalId);
  candidates.push({ source: 'preapproval_id', userId: local });
  if (local) return false;

  const fetched = await getPreapproval(preapprovalId);
  if (!fetched.ok) return fetched.status !== 404;
  candidates.push({
    source: 'preapproval_plan',
    userId: await resolvePlanMapping(service, fetched.data.preapprovalPlanId ?? null),
  });
  candidates.push({
    source: 'external_reference',
    userId: await resolveExternalReference(service, fetched.data.externalReference),
  });
  return false;
}

/**
 * Decide el dueño de un evento. `conflict` ⇒ no se muta nada. `userId` null
 * sin conflicto ⇒ evento ajeno/sin datos ⇒ 200 con log.
 */
async function decideIdentity(
  service: Service,
  candidates: IdentityCandidate[],
  context: Record<string, unknown>,
): Promise<ResolvedIdentity> {
  const decision = chooseIdentity(candidates);
  if (decision.conflict) {
    console.error(
      '[mp webhook identity_conflict]',
      JSON.stringify({
        ...context,
        candidates: candidates.map((c) => ({ source: c.source, user: c.userId ?? null })),
      }),
    );
    return { userId: null, source: null, conflict: true };
  }
  if (!decision.userId) {
    console.error(
      '[mp webhook sin identidad]',
      JSON.stringify({
        ...context,
        candidates: candidates.map((c) => ({ source: c.source, user: c.userId ?? null })),
      }),
    );
    return { userId: null, source: null, conflict: false };
  }
  const userId = await lookupUser(service, decision.userId);
  return { userId, source: userId ? decision.source : null, conflict: false };
}

/**
 * Identidad de un pago: external_reference propio, plan en metadata y
 * preapproval (local o leído de MP). `fallbackPreapprovalId` cubre el invoice
 * de `subscription_authorized_payment`; `fallbackExternalReference` cubre un
 * pago sin external_reference cuyo invoice sí lo trae.
 */
async function resolvePaymentIdentity(
  service: Service,
  pay: MpPaymentFull,
  fallbacks: {
    preapprovalId?: string | null;
    externalReference?: string | null;
  } = {},
): Promise<ResolvedIdentity> {
  const candidates: IdentityCandidate[] = [];
  let retryable = false;
  candidates.push({
    source: 'external_reference',
    userId: await resolveExternalReference(service, pay.externalReference),
  });
  candidates.push({
    source: 'preapproval_plan',
    userId: await resolvePlanMapping(service, pay.preapprovalPlanId ?? null),
  });
  if (await addPreapprovalCandidates(service, pay.preapprovalId, candidates)) retryable = true;
  if (fallbacks.preapprovalId && fallbacks.preapprovalId !== pay.preapprovalId) {
    if (await addPreapprovalCandidates(service, fallbacks.preapprovalId, candidates)) {
      retryable = true;
    }
  }
  if (fallbacks.externalReference) {
    candidates.push({
      source: 'external_reference',
      userId: await resolveExternalReference(service, fallbacks.externalReference),
    });
  }
  const identity = await decideIdentity(service, candidates, { payment: pay.id });
  return { ...identity, retryable };
}

async function handlePayment(resourceId: string): Promise<Response> {
  const fetched = await getPayment(resourceId);
  if (!fetched.ok) {
    const missing = missingResource('payment', resourceId, fetched.status);
    if (missing) return missing;
    console.error('[mp webhook]: pull de payment falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const identity = await resolvePaymentIdentity(service, fetched.data);
  if (!identity.userId) {
    if (identity.retryable) {
      return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
    }
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const result = await applyPayment(fetched.data, {
    userId: identity.userId,
    source: 'webhook',
    watermarkMs: null, // el webhook es el camino primario: sin ventana R12.4
    // El pago de una suscripción con plan puede no traer external_reference;
    // la identidad ya se resolvió contra la DB local.
    allowMissingExternalReference: !fetched.data.externalReference,
  });

  if (result.action === 'error') {
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'payment',
      mpPaymentId: fetched.data.id,
      user: identity.userId,
      identity: identity.source,
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
    const missing = missingResource('preapproval', resourceId, fetched.status);
    if (missing) return missing;
    console.error('[mp webhook]: pull preapproval falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const candidates: IdentityCandidate[] = [];
  candidates.push({
    source: 'external_reference',
    userId: await resolveExternalReference(service, fetched.data.externalReference),
  });
  candidates.push({
    source: 'preapproval_plan',
    userId: await resolvePlanMapping(service, fetched.data.preapprovalPlanId ?? null),
  });
  candidates.push({
    source: 'preapproval_id',
    userId: await resolveLocalPreapproval(service, fetched.data.id),
  });
  const identity = await decideIdentity(service, candidates, {
    preapproval: fetched.data.id,
    plan: fetched.data.preapprovalPlanId ?? null,
  });
  if (!identity.userId) return NextResponse.json({ received: true as const }, { status: 200 });

  const result = await applyPreapproval(fetched.data, { userId: identity.userId, source: 'webhook' });
  if (result.action === 'error') {
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'preapproval',
      mpStatus: fetched.data.status,
      preapproval: fetched.data.id,
      plan: fetched.data.preapprovalPlanId ?? null,
      user: identity.userId,
      identity: identity.source,
      action: result.action,
      reason: result.reason,
      period_end: result.periodEndMs ?? null,
    }),
  );

  return NextResponse.json({ received: true as const }, { status: 200 });
}

/**
 * Invoice de cobro recurrente (`subscription_authorized_payment`). El estado
 * del invoice NO decide PRO: se pullea el pago real y se aplica por el mismo
 * `applyPayment`. Si el webhook `payment` ya lo aplicó, el dedupe responde
 * `already_applied` y no duplica nada.
 */
async function handleAuthorizedPayment(resourceId: string): Promise<Response> {
  const invoice = await getAuthorizedPayment(resourceId);
  if (!invoice.ok) {
    const missing = missingResource('authorized_payment', resourceId, invoice.status);
    if (missing) return missing;
    console.error('[mp webhook]: pull authorized_payment falla:', invoice.status, invoice.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  if (invoice.data.paymentId == null) {
    console.log(
      '[mp webhook authorized_payment sin pago]',
      JSON.stringify({
        invoice: invoice.data.id,
        preapproval: invoice.data.preapprovalId,
        status: invoice.data.status,
      }),
    );
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const fetched = await getPayment(String(invoice.data.paymentId));
  if (!fetched.ok) {
    const missing = missingResource('payment', String(invoice.data.paymentId), fetched.status);
    if (missing) return missing;
    console.error('[mp webhook]: pull payment del invoice falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const identity = await resolvePaymentIdentity(service, fetched.data, {
    preapprovalId: invoice.data.preapprovalId,
    externalReference: invoice.data.externalReference,
  });
  if (!identity.userId) {
    if (identity.retryable) {
      return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
    }
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const result = await applyPayment(fetched.data, {
    userId: identity.userId,
    source: 'webhook',
    watermarkMs: null,
    allowMissingExternalReference: !fetched.data.externalReference,
  });
  if (result.action === 'error') {
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'authorized_payment',
      invoice: invoice.data.id,
      mpPaymentId: fetched.data.id,
      user: identity.userId,
      identity: identity.source,
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

/**
 * R11.1/R11.6: el topic de contracargos solo dispara; la verdad sale de
 * `GET /v1/chargebacks/{id}` + `GET /v1/payments/{payment_id}`. Sin usuario
 * asociado se responde 200 y se logea (§3.4): jamás se inventa un dueño.
 */
async function handleChargeback(resourceId: string): Promise<Response> {
  const fetched = await getChargeback(resourceId);
  if (!fetched.ok) {
    const missing = missingResource('chargeback', resourceId, fetched.status);
    if (missing) return missing;
    console.error('[mp webhook]: pull chargeback falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  if (fetched.data.paymentId == null) {
    console.error('[mp webhook]: chargeback sin payment_id — ignorado con log:', resourceId);
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const payment = await getPayment(String(fetched.data.paymentId));
  if (!payment.ok && !isChargebackReversal(fetched.data.status)) {
    const missing = missingResource('payment', String(fetched.data.paymentId), payment.status);
    if (missing) return missing;
    console.error(
      '[mp webhook]: pull payment del chargeback falla:',
      payment.status,
      payment.message,
    );
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }

  const service = createSupabaseServiceClient();
  const identity = payment.ok
    ? await resolvePaymentIdentity(service, payment.data, {
        externalReference: fetched.data.externalReference,
      })
    : await decideIdentity(
        service,
        [
          {
            source: 'external_reference',
            userId: await resolveExternalReference(service, fetched.data.externalReference),
          },
        ],
        { chargeback: fetched.data.id },
      );
  if (!identity.userId) {
    if (identity.retryable) {
      return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
    }
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const result = await applyChargeback(
    fetched.data,
    payment.ok ? payment.data : null,
    {
      userId: identity.userId,
      source: 'webhook',
      watermarkMs: null,
      allowMissingExternalReference: payment.ok ? !payment.data.externalReference : false,
    },
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
      user: identity.userId,
      identity: identity.source,
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
  if (event.kind === 'authorized_payment') return handleAuthorizedPayment(event.resourceId);
  if (event.kind === 'chargeback') return handleChargeback(event.resourceId);

  console.log('[mp webhook]: tipo ignorado:', event.kind, event.resourceId);
  return NextResponse.json({ received: true as const }, { status: 200 });
}
