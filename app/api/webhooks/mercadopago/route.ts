import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  arDateStrFromMs,
  cancelationPeriodEndMs,
  cycleAnchorDayOfStr,
  isPositiveAmount,
  normalizeMpPaymentStatus,
  transitionSubscription,
  type SubscriptionStatus,
} from '@/lib/payments/core';
import { parseWebhookEvent, verifyMpSignature } from '@/lib/payments/webhook';
import { getPayment, getPreapproval } from '@/lib/payments/mercadopago';
import { mailGrace, mailReceipt, mailScheduledClose, sendMail } from '@/lib/payments/mail';

/* ============================================================================
 * /api/webhooks/mercadopago — ÚNICO WEBHOOK DE DINERO (posición 10B, R7+QA3)
 * ÚNICA FUENTE: spec_pagos.md §3-R7/R9 + §6 Seguridad + §7 QA3.
 * ----------------------------------------------------------------------------
 * FLUJO (fiel a R7):
 *   1. `x-signature` (`ts,v1`) contra el manifiesto oficial de MP con el
 *      secreto `MP_WEBHOOK_SECRET` — inválida/faltante ⇒ 403 con log del
 *      (NADA se procesa sin firma: fail-close).
 *   2. Ruteo del evento: `payment.updated` (cobro aprobado/rechazado) y
 *      `preapproval.updated` (alta/pausa/cancelación) — el resto se LOGEA
 *      y responde 200 (MP dejan de reintentar: no hay nada que procesar).
 *   3. PULL del recurso real (GET payment / GET preapproval) — el body solo
 *      dice QUÉ id mirar (§6: "nunca confiar en el body").
 *   4. Dedupe: `mp_payment_id` UNIQUE (repetido ⇒ 200 sin mutar estado ni
 *      insertar fila) y compare-and-set (`WHERE status = current`) en la
 *      máquina — un re-envío no re-abre ventanas ni duplica el price_frozen.
 *   5. Transición (core R1/R4/R8/R9): approved ⇒ activa (+price congelado SOLO
 *      alta/re-activación) / rejected ⇒ gracia / cancelled|paused ⇒ cierre
 *      programado. `users.plan` se actualiza ⇒ broadcast Realtime
 *      (plan-watcher refresca TODAS las pestañas sin reload).
 *   6. Emails legítimos SOLO acá: recibo (approved), gracia (rejected) y
 *      cierre programado (cancelled/paused) — R10: nada más existe.
 *
 * Respuestas: 200 ok/ignorado · 403 firma inválida · 502 falla del pull de MP ·
 * 503 fallo de persistencia (MP reintenta; el dedupe hace el retry seguro).
 * QA manual (curl firmado): MP_WEBHOOK_SECRET + openssl dgst -sha256 -hmac
 *   con manifiesto `id:<dataId>;request-id:<rid>;ts:<ts>;` + headers.
 * ============================================================================
 */

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SubStatus = SubscriptionStatus;

interface SubRow {
  status: SubStatus;
  price_frozen: number;
  preapproval_id: string | null;
  cycle_anchor: string | null; // DATE ⇒ 'YYYY-MM-DD'
  grace_expires_at: string | null; // timestamptz ISO
  period_end: string | null;
}

const isoToMs = (iso: string | null): number | null =>
  iso ? (Number.isNaN(Date.parse(iso)) ? null : Date.parse(iso)) : null;

/** email del dueño desde auth (public.users no tiene email — R7/buen alcance). */
async function mailTo(service: ReturnType<typeof createSupabaseServiceClient>, userId: string): Promise<string | null> {
  const { data } = await service.auth.admin.getUserById(userId);
  const email = data?.user?.email ?? null;
  if (!email) console.error('[mp webhook mail]: sin email para', userId);
  return email;
}

/** Resolución user por external_reference (uuid). Devuelve null SIEMPRE con log (§6). */
async function resolveUserId(
  service: ReturnType<typeof createSupabaseServiceClient>,
  externalRef: string | null,
): Promise<string | null> {
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
    // §6: pagos posteriores de eliminadas se IGNORAN con log (restauración decide).
    console.error('[mp webhook]: evento de cuenta ELIMINADA — ignorado');
    return null;
  }
  return row.id;
}

async function readSubRow(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
): Promise<SubRow | null> {
  const { data } = await service
    .from('subscriptions')
    .select('status, price_frozen, preapproval_id, cycle_anchor, grace_expires_at, period_end')
    .eq('user_id', userId)
    .maybeSingle<SubRow>();
  return data ?? null;
}

/* --------------------------------------------------------------------------
 * payment.updated — cobro aprobado (pro/activa) o rechazado (gracia, R8).
 * -------------------------------------------------------------------------- */
async function handlePayment(resourceId: string): Promise<Response> {
  const service = createSupabaseServiceClient();
  const fetched = await getPayment(resourceId);
  if (!fetched.ok) {
    console.error('[mp webhook]: pull de payment falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }
  const pay = fetched.data;
  const normalized = normalizeMpPaymentStatus(pay.status);
  if (!normalized) {
    console.log(
      '[mp webhook]: payment ignorado (status', pay.status, '/', pay.statusDetail ?? '-', ')',
    );
    return NextResponse.json({ received: true as const }, { status: 200 });
  }
  const userId = await resolveUserId(service, pay.externalReference);
  if (!userId) return NextResponse.json({ received: true as const }, { status: 200 });
  if (!isPositiveAmount(pay.transactionAmount)) {
    console.error('[mp webhook]: pago SIN monto util — ignorado (NaN protege el price_frozen)');
    return NextResponse.json({ received: true as const }, { status: 200 });
  }
  const amountCharged = pay.transactionAmount; // narrowed: positivo y finito

  /* DEDUPE R7: fila única por mp_payment_id. Repetido ⇒ 200 sin nada más. */
  const inserted = await service
    .from('payments')
    .insert({
      user_id: userId,
      mp_payment_id: pay.id,
      amount: amountCharged,
      status: normalized,
      occurred_at:
        pay.dateApproved ?? pay.dateLastUpdated ?? new Date().toISOString(),
      receipt_url: pay.receiptUrl,
    })
    .select('id');
  if (inserted.error) {
    const code = (inserted.error as { code?: string }).code;
    if (code === '23505') {
      console.log('[mp webhook dedupe]: pago', pay.id, 'ya registrado — sin mutaciones (R7)');
      return NextResponse.json({ received: true as const, dedupe: true as const }, { status: 200 });
    }
    console.error('[mp webhook payments insert]:', inserted.error.message);
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  /* Transición de la máquina (R1/R4/R8) — current ANTES de mutar (CAS). */
  const sub = await readSubRow(service, userId);
  const current = sub?.status ?? 'inactiva';
  const mpEvent =
    normalized === 'approved'
      ? { kind: 'cobro_aprobado' as const }
      : {
          kind: 'cobro_rechazado' as const,
          rejectedAtMs: isoToMs(pay.dateLastUpdated) ?? Date.now(),
        };
  const patch = transitionSubscription(current, mpEvent);
  if (!patch) {
    console.log(
      '[mp webhook]: patch vacío para', normalized, 'desde', current, '— sin UPDATE (idempotente)',
    );
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const updatePayload: Record<string, unknown> = { status: patch.status };
  if (patch.graceExpiresAtMs !== undefined) {
    updatePayload.grace_expires_at =
      patch.graceExpiresAtMs == null ? null : new Date(patch.graceExpiresAtMs).toISOString();
  }
  if (patch.periodEndMs !== undefined) {
    updatePayload.period_end =
      patch.periodEndMs == null ? null : new Date(patch.periodEndMs).toISOString();
  }
  let approvalAtMs = Date.now();
  if (patch.freezePrice) {
    // R4: alta o re-activación ⇒ congelar el precio QUE COBRÓ ESTE PAGO y
    // anclar el ciclo al día de ESTA aprobación (re-activación re-ancla).
    updatePayload.price_frozen = amountCharged;
    approvalAtMs = isoToMs(pay.dateApproved) ?? Date.now();
    const anchor = arDateStrFromMs(approvalAtMs);
    if (anchor) updatePayload.cycle_anchor = anchor;
    if (pay.preapprovalId) updatePayload.preapproval_id = pay.preapprovalId;
  }

  if (sub) {
    // Compare-and-set: si el estado movió entre el read y el write, CAS=0 filas
    // ⇒ log (la reconciliación al-vuelo de 10B cierra el drift; jamás doble-segé).
    const cas = await service
      .from('subscriptions')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('status', current)
      .select('status');
    if (cas.error) {
      console.error('[mp webhook sub update]:', cas.error.message);
      return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
    }
    if (!cas.data || cas.data.length === 0) {
      console.error('[mp webhook]: CAS perdido (estado movió a otro target) — se deja a la reconciliación');
    }
  } else if (patch.status === 'activa') {
    // Autoheal: sin fila (seed del checkout falló) ⇒ crear directamente el target.
    const created = await service.from('subscriptions').insert({
      user_id: userId,
      preapproval_id: pay.preapprovalId,
      status: 'activa',
      price_frozen: amountCharged,
      currency: 'ARS',
      cycle_anchor: arDateStrFromMs(approvalAtMs),
    });
    if (created.error) {
      console.error('[mp webhook sub autoheal]:', created.error.message);
      return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
    }
    console.error('[mp webhook]: fila de subscriptions auto-creada (seed del checkout falló)');
  }

  /* users.plan — fuente del gating; su UPDATE dispara Realtime (PlanWatcher). */
  const userUpdate: Record<string, unknown> = { mp_preapproval_id: pay.preapprovalId };
  switch (patch.status) {
    case 'activa':
      userUpdate.plan = 'pro';
      userUpdate.grace_expires_at = null;
      break;
    case 'gracia':
      userUpdate.plan = 'pro_grace';
      userUpdate.grace_expires_at = updatePayload.grace_expires_at;
      break;
    case 'inactiva':
      userUpdate.plan = 'free';
      userUpdate.grace_expires_at = null;
      break;
    case 'programada_cierre':
      // sigue pro hasta period_end; el resolver + Centro muestran el banner.
      break;
  }
  const usersRes = await service.from('users').update(userUpdate).eq('id', userId);
  if (usersRes.error) {
    console.error('[mp webhook users update]:', usersRes.error.message);
    // Fallo secundario: la fila de dinero ya está; el plan lo repara la reconciliación.
  }

  /* Emails legítimos (R10) — el de cierre programado corre por preapproval. */
  const to = await mailTo(service, userId);
  if (to) {
    if (normalized === 'approved') {
      await sendMail(
        mailReceipt({
          to,
          amountArs: amountCharged,
          occurredAtMs: approvalAtMs,
          receiptUrl: pay.receiptUrl,
        }),
      );
    } else if (patch.status === 'gracia') {
      const graceMs = patch.graceExpiresAtMs;
      if (graceMs != null) await sendMail(mailGrace({ to, graceExpiresAtMs: graceMs }));
    }
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'payment',
      status: normalized,
      patch: patch.status,
      mpPaymentId: pay.id,
      user: userId,
    }),
  );
  return NextResponse.json({ received: true as const }, { status: 200 });
}

/* --------------------------------------------------------------------------
 * preapproval.updated — alta (pending/authorized), pausa y cancelación (R9).
 * paused ⇒ cierre programado (sin más cobros, acceso hasta el fin del ciclo).
 * authorized solo ENRUTA: el estado del plan lo manda el COBRO (payment.updated).
 * En producción MP entrega este evento como `subscription_preapproval`; el
 * parser acepta también el alias legado `preapproval` (mismo recurso).
 * -------------------------------------------------------------------------- */
async function handlePreapproval(resourceId: string): Promise<Response> {
  const service = createSupabaseServiceClient();
  const fetched = await getPreapproval(resourceId);
  if (!fetched.ok) {
    console.error('[mp webhook]: pull preapproval falla:', fetched.status, fetched.message);
    return NextResponse.json({ error: 'MP_PULL_UNAVAILABLE' }, { status: 502 });
  }
  const pre = fetched.data;
  const userId = await resolveUserId(service, pre.externalReference);
  if (!userId) return NextResponse.json({ received: true as const }, { status: 200 });

  if (pre.status !== 'cancelled' && pre.status !== 'paused') {
    // pending (alta sin confirmar) / authorized (recurrente listo — el cobro
    // es quien activa): log y 200 (idempotente por sí: nada muta).
    console.log('[mp webhook]: preapproval', pre.status, '— estado del plan manejado por el cobro');
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const sub = await readSubRow(service, userId);
  const current = sub?.status ?? 'inactiva';
  const grMs = isoToMs(sub?.grace_expires_at ?? null);
  const anchorDay = sub ? cycleAnchorDayOfStr(sub.cycle_anchor ?? '') : null;
  const periodEndMs =
    cancelationPeriodEndMs(current, { graceExpiresAtMs: grMs, anchorDay, nowMs: Date.now() }) ??
    Date.now(); // sin ancla ni gracia: cierre inmediato con log del edge
  if (periodEndMs === Date.now() && current === 'activa' && anchorDay == null) {
    console.error('[mp webhook]: cancelación SIN ancla — period_end inmediato (edge logeado)');
  }

  const patch = transitionSubscription(current, {
    kind: 'cancelacion_programada',
    periodEndMs,
  });
  if (!patch) {
    console.log('[mp webhook]: cancelación', pre.status, 'desde', current, '— patch vacío (idempotente)');
    return NextResponse.json({ received: true as const }, { status: 200 });
  }

  const updatePayload: Record<string, unknown> = {
    status: patch.status,
    period_end: new Date(periodEndMs).toISOString(),
    grace_expires_at: null,
  };
  if (sub) {
    const cas = await service
      .from('subscriptions')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('status', current)
      .select('status');
    if (cas.error) {
      console.error('[mp webhook sub update]:', cas.error.message);
      return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
    }
    if (!cas.data || cas.data.length === 0) {
      console.error('[mp webhook]: CAS perdido en cancelación — a la reconciliación');
    }
  } else {
    const created = await service.from('subscriptions').insert({
      user_id: userId,
      preapproval_id: pre.id,
      status: patch.status,
      price_frozen: 0,
      currency: 'ARS',
      period_end: new Date(periodEndMs).toISOString(),
    });
    if (created.error) {
      console.error('[mp webhook sub autoheal cancelacion]:', created.error.message);
      return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
    }
    console.error('[mp webhook]: autoheal de cancelación sin fila (price_frozen 0 — jamás se cobró)');
  }

  const to = await mailTo(service, userId);
  if (to) await sendMail(mailScheduledClose({ to, periodEndMs }));
  if (sub?.preapproval_id && sub.preapproval_id !== pre.id) {
    await service.from('users').update({ mp_preapproval_id: pre.id }).eq('id', userId);
  }

  console.log(
    '[mp webhook QA registro]',
    JSON.stringify({
      artifact: 'preapproval',
      mpStatus: pre.status,
      patch: patch.status,
      period_end: periodEndMs,
      user: userId,
    }),
  );
  return NextResponse.json({ received: true as const }, { status: 200 });
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
    // Sin id de recurso no hay manifiesto que firmar ni pull: rechaza (MP log).
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

  // Otros tipos (factura de MP, sv_point, plan…) — log + 200 sin mutación.
  console.log('[mp webhook]: tipo ignorado:', event.kind, event.resourceId);
  return NextResponse.json({ received: true as const }, { status: 200 });
}
