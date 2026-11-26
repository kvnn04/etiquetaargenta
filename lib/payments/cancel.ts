/* ============================================================================
 * CANCELACIÓN DE SUSCRIPCIÓN — R9 + BAJA INMEDIATA CON REEMBOLSO
 * ----------------------------------------------------------------------------
 * Server-only. El `preapproval_id` NO viene del cliente: se resuelve desde la
 * sesión (`subscriptions.preapproval_id`) para que nadie pueda cancelar la
 * suscripción de otro usuario.
 *
 * Dos modos:
 *   · `end_of_cycle` (default): cancela el débito y conserva PRO hasta
 *     `period_end` (R9, comportamiento histórico).
 *   · `immediate`: cancela el débito, reembolsa el saldo del último pago
 *     aprobado y baja el plan YA. El reembolso es total dentro de los 10 días
 *     corridos y prorrateado después (quoteCancellationRefund). Si MP falla,
 *     NO se baja el plan: queda `programada_cierre` hasta `period_end`.
 *
 * Orden del flujo inmediato:
 *   1. cotizar (pago + ciclo) sin mutar nada;
 *   2. cancelar el preapproval (primero: corta cobros futuros);
 *   3. reclamar `refund_requests` (idempotency key única por pago);
 *   4. POST /v1/payments/{id}/refunds;
 *   5. SOLO con 200/201: fold local (`revocada`, `closure_reason='cancel'`) +
 *      `users.plan='free'` + email.
 *
 * Si MP cancela pero la escritura local falla, el sync de `/perfil` converge
 * al leer el pago reembolsado; se devuelve `LOCAL_SYNC_PENDING`.
 * ========================================================================== */

import {
  applyConfirmedCancellationRefund,
  applyPreapproval,
  sendPaymentAlert,
} from '@/lib/payments/apply';
import {
  arDateParts,
  cycleAnchorDayOfStr,
  isCancelableSubscriptionStatus,
  isLiveSubscriptionStatus,
  nextCycleDateMs,
  type SubscriptionStatus,
} from '@/lib/payments/core';
import {
  cancelPreapproval,
  getPreapproval,
  hasMercadoPagoCredentials,
  refundPayment,
  type MpPreapprovalFull,
} from '@/lib/payments/mercadopago';
import {
  claimRefundRequest,
  markRefundRequestApplied,
  markRefundRequestApproved,
  markRefundRequestFailed,
} from '@/lib/payments/refund-requests';
import {
  quoteCancellationRefund,
  type CancellationRefundQuote,
  type CancellationRefundReason,
} from '@/lib/payments/refunds';
import {
  createSupabaseServiceClient,
  hasServiceCredentials,
} from '@/lib/supabase/service';

export type CancelMode = 'end_of_cycle' | 'immediate';

/** Vista serializable de la cotización (la UI no calcula cifras). */
export interface CancellationRefundView {
  paymentId: string | null;
  paymentAmount: number;
  refundedBefore: number;
  availableArs: number;
  amountArs: number;
  kind: 'full' | 'partial' | 'none';
  reason: CancellationRefundReason;
  daysSincePayment: number | null;
  daysRemaining: number | null;
  cycleDays: number | null;
  paidAtMs: number | null;
  cycleEndMs: number | null;
}

export interface CancelSubscriptionOk {
  ok: true;
  status: SubscriptionStatus;
  periodEndMs: number | null;
  /** true ⇒ MP ya la tenía cancelada (o el endpoint se repitió). */
  alreadyCancelled: boolean;
  /** La baja se ejecutó en MP; la DB queda a la espera del sync. */
  warning: 'LOCAL_SYNC_PENDING' | null;
  mode: CancelMode;
  /** Cotización aplicada; `null` en el modo fin de ciclo. */
  refund: CancellationRefundView | null;
  /** Id del reembolso MP cuando `status='revocada'` por baja inmediata. */
  refundId: string | null;
  /** Motivo por el que la baja inmediata cayó a fin de ciclo (sin saldo). */
  fallbackReason: CancellationRefundReason | null;
}

export type CancelSubscriptionFailureReason =
  | 'mp_config'
  | 'no_subscription'
  | 'not_cancelable'
  | 'missing_preapproval'
  | 'ownership'
  | 'mp_unavailable'
  | 'db'
  | 'refund_in_progress'
  | 'refund_failed'
  | 'refund_not_eligible';

export interface CancelSubscriptionFailure {
  ok: false;
  reason: CancelSubscriptionFailureReason;
  detail?: string;
  /** Presente cuando la renovación YA se canceló y PRO sigue hasta esa fecha. */
  periodEndMs?: number | null;
  refund?: CancellationRefundView | null;
}

export type CancelSubscriptionResult =
  | CancelSubscriptionOk
  | CancelSubscriptionFailure;

interface SubscriptionRow {
  status: SubscriptionStatus;
  preapproval_id: string | null;
  preapproval_plan_id: string | null;
  period_end: string | null;
  cycle_anchor: string | null;
  grace_expires_at: string | null;
}

interface SubscriptionAfterRow {
  status: SubscriptionStatus;
  period_end: string | null;
}

interface PaymentRow {
  mp_payment_id: number | string;
  amount: number | string;
  refunded_amount: number | string | null;
  occurred_at: string;
  status: string;
}

function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function numberOrZero(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function readSubRow(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await service
    .from('subscriptions')
    .select(
      'status, preapproval_id, preapproval_plan_id, period_end, cycle_anchor, grace_expires_at',
    )
    .eq('user_id', userId)
    .maybeSingle<SubscriptionRow>();
  if (error) console.error('[billing cancel sub]:', error.message);
  return data ?? null;
}

async function readSubAfter(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
): Promise<SubscriptionAfterRow | null> {
  const { data, error } = await service
    .from('subscriptions')
    .select('status, period_end')
    .eq('user_id', userId)
    .maybeSingle<SubscriptionAfterRow>();
  if (error) console.error('[billing cancel reread]:', error.message);
  return data ?? null;
}

/** El plan quedó inactivo si la suscripción está revocada o ya venció. */
function inactiveStatus(
  after: SubscriptionAfterRow | null,
): 'revocada' | 'programada_cierre' {
  return after?.status === 'revocada' || after?.status === 'inactiva'
    ? 'revocada'
    : 'programada_cierre';
}

/* -------------------------------------------------------------------------- */
/* Cotización (pura + lectura)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fin del ciclo que financió el último pago:
 *   · `period_end` manda si el cierre ya está programado;
 *   · si no, el próximo ancla desde la fecha del cobro (R1).
 */
export function resolvePaidCycleEndMs(input: {
  periodEndMs: number | null;
  cycleAnchorDate: string | null;
  paidAtMs: number | null;
}): number | null {
  if (input.periodEndMs != null) return input.periodEndMs;
  if (input.paidAtMs == null) return null;
  const anchorDay =
    (input.cycleAnchorDate ? cycleAnchorDayOfStr(input.cycleAnchorDate) : null) ??
    arDateParts(input.paidAtMs).day;
  return nextCycleDateMs(anchorDay, input.paidAtMs);
}

function toRefundView(
  quote: CancellationRefundQuote,
  input: {
    paymentId: string | null;
    paidAtMs: number | null;
    cycleEndMs: number | null;
  },
): CancellationRefundView {
  return {
    paymentId: input.paymentId,
    paymentAmount: quote.paymentAmount,
    refundedBefore: quote.refundedBefore,
    availableArs: quote.availableArs,
    amountArs: quote.amountArs,
    kind: quote.kind,
    reason: quote.reason,
    daysSincePayment: quote.daysSincePayment,
    daysRemaining: quote.daysRemaining,
    cycleDays: quote.cycleDays,
    paidAtMs: input.paidAtMs,
    cycleEndMs: input.cycleEndMs,
  };
}

export type CancellationQuoteResult =
  | {
      ok: true;
      quote: CancellationRefundView;
      subscription: SubscriptionRow;
      payment: PaymentRow | null;
    }
  | {
      ok: false;
      reason: 'db' | 'no_subscription' | 'not_cancelable';
      detail?: string;
    };

/**
 * Lee el último pago aprobado (o parcialmente reembolsado) y cotiza la baja
 * inmediata. No muta nada. La usa la API de baja y el Centro de Suscripción
 * (server) para mostrar el monto antes de confirmar.
 */
export async function readCancellationQuote(
  userId: string,
  nowMs = Date.now(),
): Promise<CancellationQuoteResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'db' };
  const service = createSupabaseServiceClient();

  const [sub, paymentResult] = await Promise.all([
    readSubRow(service, userId),
    service
      .from('payments')
      .select('mp_payment_id, amount, refunded_amount, occurred_at, status')
      .eq('user_id', userId)
      .in('status', ['approved', 'partially_refunded'])
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle<PaymentRow>(),
  ]);

  if (!sub) return { ok: false, reason: 'no_subscription' };
  if (!isLiveSubscriptionStatus(sub.status)) {
    return { ok: false, reason: 'not_cancelable' };
  }
  if (paymentResult.error) {
    console.error('[billing cancel quote payment]:', paymentResult.error.message);
    return { ok: false, reason: 'db', detail: paymentResult.error.message };
  }

  const payment = paymentResult.data ?? null;
  const paidAtMs = payment ? isoToMs(payment.occurred_at) : null;
  const periodEndMs = isoToMs(sub.period_end);
  const cycleEndMs = resolvePaidCycleEndMs({
    periodEndMs,
    cycleAnchorDate: sub.cycle_anchor,
    paidAtMs,
  });
  const quote = quoteCancellationRefund({
    paymentAmount: payment ? numberOrZero(payment.amount) : null,
    refundedAmount: payment ? numberOrZero(payment.refunded_amount) : 0,
    paidAtMs,
    cycleEndMs,
    nowMs,
  });

  return {
    ok: true,
    quote: toRefundView(quote, {
      paymentId: payment ? String(payment.mp_payment_id) : null,
      paidAtMs,
      cycleEndMs,
    }),
    subscription: sub,
    payment,
  };
}

/* -------------------------------------------------------------------------- */
/* Preapproval: lectura + titularidad + cancelación                           */
/* -------------------------------------------------------------------------- */

type PreapprovalCancelOutcome =
  | {
      ok: true;
      preapprovalId: string | null;
      alreadyCancelled: boolean;
      data: MpPreapprovalFull | null;
    }
  | {
      ok: false;
      reason: 'missing_preapproval' | 'ownership' | 'mp_unavailable' | 'db';
      detail?: string;
    };

async function cancelPreapprovalForUser(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  sub: SubscriptionRow,
  opts: { allowMissing: boolean },
): Promise<PreapprovalCancelOutcome> {
  /* `programada_cierre` ya tiene el débito cancelado: no se vuelve a llamar a
   * MP. La baja inmediata puede seguir directo al reembolso. */
  if (sub.status === 'programada_cierre') {
    return {
      ok: true,
      preapprovalId: sub.preapproval_id,
      alreadyCancelled: true,
      data: null,
    };
  }

  const preapprovalId = sub.preapproval_id;
  if (!preapprovalId) {
    return opts.allowMissing
      ? { ok: true, preapprovalId: null, alreadyCancelled: true, data: null }
      : { ok: false, reason: 'missing_preapproval' };
  }

  /* Lectura autoritativa antes de cancelar: jamás un preapproval ajeno. */
  const current = await getPreapproval(preapprovalId);
  if (!current.ok) {
    console.error(
      '[billing cancel get]:',
      preapprovalId,
      current.status,
      current.message,
    );
    return { ok: false, reason: 'mp_unavailable', detail: current.message };
  }

  /* Titularidad: `external_reference` manda cuando MP lo heredó. En los
   * preapprovals creados desde un PLAN, MP puede no heredarlo; en ese caso se
   * valida el mapping local `preapproval_plan_id → user_id` (creado en el
   * checkout). Sin ninguna de las dos pruebas, no se cancela. */
  const externalReference = current.data.externalReference;
  const preapprovalPlanId =
    current.data.preapprovalPlanId ?? sub.preapproval_plan_id ?? null;
  let ownershipBasis: 'external_reference' | 'preapproval_plan' | null = null;
  if (externalReference) {
    ownershipBasis = externalReference === userId ? 'external_reference' : null;
  } else if (preapprovalPlanId) {
    const { data: planMapping, error: planError } = await service
      .from('mp_preapproval_plans')
      .select('user_id')
      .eq('id', preapprovalPlanId)
      .maybeSingle<{ user_id: string }>();
    if (planError) {
      console.error('[billing cancel plan mapping]:', planError.message);
      return { ok: false, reason: 'db', detail: planError.message };
    }
    ownershipBasis = planMapping?.user_id === userId ? 'preapproval_plan' : null;
  }

  if (!ownershipBasis) {
    console.error(
      '[billing cancel ownership]:',
      JSON.stringify({
        user: userId,
        preapproval: preapprovalId,
        external_reference: externalReference ?? null,
        preapproval_plan_id: preapprovalPlanId,
      }),
    );
    return { ok: false, reason: 'ownership' };
  }

  const alreadyCancelled = current.data.status === 'cancelled';
  if (!alreadyCancelled) {
    const cancelled = await cancelPreapproval(preapprovalId);
    if (!cancelled.ok) {
      console.error(
        '[billing cancel mp]:',
        preapprovalId,
        cancelled.status,
        cancelled.message,
      );
      return { ok: false, reason: 'mp_unavailable', detail: cancelled.message };
    }
  }

  return {
    ok: true,
    preapprovalId,
    alreadyCancelled,
    data: current.data,
  };
}

/* -------------------------------------------------------------------------- */
/* Cierre programado (R9)                                                      */
/* -------------------------------------------------------------------------- */

async function applyScheduledClose(input: {
  userId: string;
  pre: Extract<PreapprovalCancelOutcome, { ok: true }>;
  source: 'app' | 'legal';
  suppressEmail: boolean;
}): Promise<{
  status: SubscriptionStatus;
  periodEndMs: number | null;
  action: string;
}> {
  const service = createSupabaseServiceClient();
  if (input.pre.data) {
    const applied = await applyPreapproval(
      {
        ...input.pre.data,
        status: 'cancelled',
        preapprovalPlanId: input.pre.data.preapprovalPlanId ?? null,
      },
      {
        userId: input.userId,
        source: input.source,
        suppressEmail: input.suppressEmail,
      },
    );
    if (applied.action === 'error') {
      console.error(
        '[billing cancel apply]:',
        JSON.stringify({ user: input.userId, preapproval: input.pre.preapprovalId }),
      );
    }
  }

  const after = await readSubAfter(service, input.userId);

  return {
    status: after?.status ?? 'programada_cierre',
    periodEndMs: isoToMs(after?.period_end ?? null),
    action: input.pre.data ? 'closed' : 'already_scheduled',
  };
}

/* -------------------------------------------------------------------------- */
/* Baja inmediata con reembolso                                                */
/* -------------------------------------------------------------------------- */

/**
 * ¿El reembolso YA está en `payment_adjustments`? El webhook pudo ganar la
 * carrera y actualizar el pago antes de que la API retome un intento cuyo
 * `applied_at` quedó NULL. En ese caso el saldo local ya incluye el refund y
 * NO se debe sumar dos veces.
 */
async function hasRefundAdjustment(
  service: ReturnType<typeof createSupabaseServiceClient>,
  refundId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from('payment_adjustments')
    .select('id')
    .eq('kind', 'refund')
    .eq('mp_source_id', refundId)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error('[billing cancel adjustment read]:', error.message);
    return false;
  }
  return data != null;
}

export type ImmediateCancellationResult =
  | {
      ok: true;
      status: 'revocada' | 'programada_cierre';
      periodEndMs: number | null;
      alreadyCancelled: boolean;
      warning: 'LOCAL_SYNC_PENDING' | null;
      refund: CancellationRefundView;
      refundId: string | null;
      fallbackReason: CancellationRefundReason | null;
    }
  | {
      ok: false;
      reason: CancelSubscriptionFailureReason;
      detail?: string;
      periodEndMs?: number | null;
      refund?: CancellationRefundView | null;
    };

/**
 * Ejecuta la baja inmediata con reembolso. La comparten la app y las páginas
 * legales (arrepentimiento / baja). `requireFullRefund` limita el camino
 * automático al derecho de arrepentimiento (≤ 10 días); fuera de esa ventana
 * el caller decide el camino manual.
 *
 * Nunca baja el plan antes de que MP devuelva 200/201. Si el reembolso falla,
 * cancela la renovación y deja PRO hasta `period_end` (no hay downgrade).
 */
export async function executeImmediateCancellation(input: {
  userId: string;
  nowMs?: number;
  kind?: 'cancellation' | 'withdrawal';
  source?: 'app' | 'legal';
  legalRequestId?: string | null;
  requireFullRefund?: boolean;
  allowMissingPreapproval?: boolean;
  suppressScheduledCloseEmail?: boolean;
}): Promise<ImmediateCancellationResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'db' };
  if (!hasMercadoPagoCredentials()) return { ok: false, reason: 'mp_config' };

  const nowMs = input.nowMs ?? Date.now();
  const service = createSupabaseServiceClient();
  const quoteRead = await readCancellationQuote(input.userId, nowMs);
  if (!quoteRead.ok) {
    return {
      ok: false,
      reason:
        quoteRead.reason === 'no_subscription'
          ? 'no_subscription'
          : quoteRead.reason === 'not_cancelable'
            ? 'not_cancelable'
            : 'db',
      detail: quoteRead.detail,
    };
  }

  const { quote, subscription: sub, payment } = quoteRead;

  if (input.requireFullRefund && quote.kind !== 'full') {
    return {
      ok: false,
      reason: 'refund_not_eligible',
      detail: quote.reason,
      refund: quote,
    };
  }

  /* 1) Cortar la renovación ANTES de tocar el dinero. */
  const pre = await cancelPreapprovalForUser(service, input.userId, sub, {
    allowMissing: input.allowMissingPreapproval ?? false,
  });
  if (!pre.ok) {
    return { ok: false, reason: pre.reason, detail: pre.detail, refund: quote };
  }

  /* 2) Sin saldo reembolsable: se mantiene PRO hasta el fin del ciclo y solo
   * se cancela la renovación (menos de 24 h, ciclo vencido, sin pago). */
  if (quote.kind === 'none' || !payment) {
    if (sub.status === 'programada_cierre') {
      return {
        ok: true,
        status: 'programada_cierre',
        periodEndMs: isoToMs(sub.period_end),
        alreadyCancelled: true,
        warning: null,
        refund: quote,
        refundId: null,
        fallbackReason: quote.reason,
      };
    }
    const closed = await applyScheduledClose({
      userId: input.userId,
      pre,
      source: input.source ?? 'app',
      suppressEmail: input.suppressScheduledCloseEmail ?? false,
    });
    return {
      ok: true,
      status: 'programada_cierre',
      periodEndMs: closed.periodEndMs,
      alreadyCancelled: pre.alreadyCancelled,
      warning: closed.status === 'programada_cierre' ? null : 'LOCAL_SYNC_PENDING',
      refund: quote,
      refundId: null,
      fallbackReason: quote.reason,
    };
  }

  const paymentId = Number(payment.mp_payment_id);
  if (!Number.isFinite(paymentId)) {
    return { ok: false, reason: 'no_subscription', detail: 'pago sin id', refund: quote };
  }

  /* 3) Claim idempotente: una sola solicitud activa por pago. */
  const claimed = await claimRefundRequest(service, {
    userId: input.userId,
    mpPaymentId: paymentId,
    kind: input.kind ?? 'cancellation',
    refundKind: quote.kind === 'full' ? 'full' : 'partial',
    amount: quote.amountArs,
    paymentAmount: quote.paymentAmount,
    refundedBefore: quote.refundedBefore,
    daysSincePayment: quote.daysSincePayment,
    daysRemaining: quote.daysRemaining,
    cycleDays: quote.cycleDays,
    legalRequestId: input.legalRequestId ?? null,
    nowMs,
  });

  if (!claimed.ok) {
    /* Ya hay un proceso en curso o la DB no responde. La renovación ya está
     * cortada: se conserva PRO hasta period_end y se informa para reintentar. */
    const closed =
      sub.status === 'programada_cierre'
        ? { status: 'programada_cierre' as const, periodEndMs: isoToMs(sub.period_end) }
        : await applyScheduledClose({
            userId: input.userId,
            pre,
            source: input.source ?? 'app',
            suppressEmail: input.suppressScheduledCloseEmail ?? false,
          });
    return {
      ok: false,
      reason: claimed.reason === 'in_progress' ? 'refund_in_progress' : 'db',
      detail: claimed.detail,
      periodEndMs: closed.periodEndMs,
      refund: quote,
    };
  }

  const request = claimed.row;

  /* 4) El dinero YA volvió en un intento anterior: solo converger local. */
  if (claimed.alreadyApproved) {
    const refundId = request.mp_refund_id ?? null;
    const refundedNow = numberOrZero(request.amount) || quote.amountArs;
    if (request.applied_at == null && refundId) {
      const alreadyInLocal = await hasRefundAdjustment(service, refundId);
      const folded = await applyConfirmedCancellationRefund({
        userId: input.userId,
        source: input.source ?? 'app',
        mpPaymentId: paymentId,
        paymentAmount: quote.paymentAmount,
        refundedTotal: Math.min(
          quote.paymentAmount,
          alreadyInLocal
            ? quote.refundedBefore
            : quote.refundedBefore + refundedNow,
        ),
        refundAmount: refundedNow,
        refundId,
        occurredAtMs: nowMs,
        nowMs,
      });
      if (folded.action === 'adjusted' || folded.action === 'already_applied') {
        await markRefundRequestApplied(service, { id: request.id, nowMs });
      } else {
        console.error(
          '[billing cancel fold retry]:',
          JSON.stringify({
            user: input.userId,
            payment: paymentId,
            refund: refundId,
            action: folded.action,
            reason: folded.reason ?? null,
          }),
        );
      }
    }

    let after = await readSubAfter(service, input.userId);
    if (after?.status !== 'revocada' && after?.status !== 'inactiva') {
      /* El reembolso ya volvió pero el fold no revocó (o perdió la carrera).
       * Se asegura el cierre local: PRO hasta period_end, sin cobros futuros. */
      const closed = await applyScheduledClose({
        userId: input.userId,
        pre,
        source: input.source ?? 'app',
        suppressEmail: true,
      });
      after = {
        status: closed.status,
        period_end:
          closed.periodEndMs != null
            ? new Date(closed.periodEndMs).toISOString()
            : null,
      };
    }
    const status = inactiveStatus(after);
    return {
      ok: true,
      status,
      periodEndMs:
        status === 'revocada' ? null : isoToMs(after?.period_end ?? sub.period_end),
      alreadyCancelled: pre.alreadyCancelled,
      warning: status === 'revocada' ? null : 'LOCAL_SYNC_PENDING',
      refund: quote,
      refundId,
      fallbackReason: null,
    };
  }

  /* 5) Reembolso real en MP. Total sin body; parcial (o saldo remanente) con
   * `{ amount }`. La idempotency key vive en la fila y se reutiliza al
   * reintentar: MP nunca devuelve dos veces el mismo dinero. */
  const sendAmount =
    quote.kind === 'full' && quote.refundedBefore <= 0.009
      ? null
      : quote.amountArs;
  const refund = await refundPayment(paymentId, {
    amount: sendAmount,
    idempotencyKey: request.idempotency_key,
  });

  if (!refund.ok) {
    await markRefundRequestFailed(service, {
      id: request.id,
      detail: refund.message,
      nowMs,
    });
    const closed =
      sub.status === 'programada_cierre'
        ? { status: 'programada_cierre' as const, periodEndMs: isoToMs(sub.period_end) }
        : await applyScheduledClose({
            userId: input.userId,
            pre,
            source: input.source ?? 'app',
            suppressEmail: input.suppressScheduledCloseEmail ?? false,
          });
    await sendPaymentAlert({
      userId: input.userId,
      mpPaymentId: paymentId,
      kind: quote.kind === 'full' ? 'refund_total' : 'refund_partial',
      amountArs: quote.paymentAmount,
      refundedArs: quote.refundedBefore,
      impact: 'refund_failed_keep_pro',
      note: `baja inmediata: MP rechazó el reembolso (${refund.message}); renovación cancelada y PRO hasta ${closed.periodEndMs ? new Date(closed.periodEndMs).toISOString() : 'period_end'}; reintentar`,
    });
    return {
      ok: false,
      reason: 'refund_failed',
      detail: refund.message,
      periodEndMs: closed.periodEndMs,
      refund: quote,
    };
  }

  const mpAmount =
    refund.data.amount != null && refund.data.amount > 0
      ? refund.data.amount
      : quote.amountArs;
  const refundedTotal = Math.min(
    quote.paymentAmount,
    quote.refundedBefore + mpAmount,
  );

  await markRefundRequestApproved(service, {
    id: request.id,
    mpRefundId: refund.data.id,
    mpStatus: refund.data.status,
    amount: mpAmount,
    nowMs,
  });

  /* 6) SOLO ahora se revoca el PRO local. */
  const folded = await applyConfirmedCancellationRefund({
    userId: input.userId,
    source: input.source ?? 'app',
    mpPaymentId: paymentId,
    paymentAmount: quote.paymentAmount,
    refundedTotal,
    refundAmount: mpAmount,
    refundId: refund.data.id,
    occurredAtMs: nowMs,
    nowMs,
  });

  if (folded.action !== 'adjusted' && folded.action !== 'already_applied') {
    console.error(
      '[billing cancel fold]:',
      JSON.stringify({
        user: input.userId,
        payment: paymentId,
        refund: refund.data.id,
        action: folded.action,
        reason: folded.reason ?? null,
      }),
    );
  } else {
    await markRefundRequestApplied(service, { id: request.id, nowMs });
  }

  let after = await readSubAfter(service, input.userId);
  if (after?.status !== 'revocada' && after?.status !== 'inactiva') {
    /* MP confirmó el reembolso pero el fold local no revocó. Se programa el
     * cierre para no dejar la renovación viva; el sync reconcilia el revoke. */
    const closed = await applyScheduledClose({
      userId: input.userId,
      pre,
      source: input.source ?? 'app',
      suppressEmail: true,
    });
    after = {
      status: closed.status,
      period_end:
        closed.periodEndMs != null
          ? new Date(closed.periodEndMs).toISOString()
          : null,
    };
  }
  const status = inactiveStatus(after);

  return {
    ok: true,
    status,
    periodEndMs:
      status === 'revocada' ? null : isoToMs(after?.period_end ?? sub.period_end),
    alreadyCancelled: pre.alreadyCancelled,
    warning: status === 'revocada' ? null : 'LOCAL_SYNC_PENDING',
    refund: quote,
    refundId: refund.data.id,
    fallbackReason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Baja desde la app (R9): fin de ciclo o inmediata                            */
/* -------------------------------------------------------------------------- */

export async function cancelUserSubscription(
  userId: string,
  opts: { mode?: CancelMode; nowMs?: number } = {},
): Promise<CancelSubscriptionResult> {
  const mode = opts.mode ?? 'end_of_cycle';

  if (mode === 'immediate') {
    const result = await executeImmediateCancellation({
      userId,
      nowMs: opts.nowMs,
      kind: 'cancellation',
      source: 'app',
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        detail: result.detail,
        periodEndMs: result.periodEndMs,
        refund: result.refund,
      };
    }
    return {
      ok: true,
      status: result.status,
      periodEndMs: result.periodEndMs,
      alreadyCancelled: result.alreadyCancelled,
      warning: result.warning,
      mode: 'immediate',
      refund: result.refund,
      refundId: result.refundId,
      fallbackReason: result.fallbackReason,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Fin de ciclo (comportamiento histórico R9)                         */
  /* ------------------------------------------------------------------ */
  if (!hasServiceCredentials()) return { ok: false, reason: 'db' };
  if (!hasMercadoPagoCredentials()) return { ok: false, reason: 'mp_config' };

  const service = createSupabaseServiceClient();
  const sub = await readSubRow(service, userId);
  if (!sub) return { ok: false, reason: 'no_subscription' };

  /* Idempotencia: si el cierre ya está programado, no se vuelve a llamar a MP
   * ni se duplica el email. El botón tampoco se muestra en este estado. */
  if (sub.status === 'programada_cierre') {
    return {
      ok: true,
      status: 'programada_cierre',
      periodEndMs: isoToMs(sub.period_end),
      alreadyCancelled: true,
      warning: null,
      mode: 'end_of_cycle',
      refund: null,
      refundId: null,
      fallbackReason: null,
    };
  }

  if (!isCancelableSubscriptionStatus(sub.status)) {
    return { ok: false, reason: 'not_cancelable' };
  }

  const pre = await cancelPreapprovalForUser(service, userId, sub, {
    allowMissing: false,
  });
  if (!pre.ok) {
    return { ok: false, reason: pre.reason, detail: pre.detail };
  }

  const closed = await applyScheduledClose({
    userId,
    pre,
    source: 'app',
    suppressEmail: pre.alreadyCancelled,
  });

  const warning = closed.status === 'programada_cierre' ? null : 'LOCAL_SYNC_PENDING';

  console.log(
    '[billing cancel QA registro]',
    JSON.stringify({
      user: userId,
      preapproval: pre.preapprovalId,
      alreadyCancelled: pre.alreadyCancelled,
      apply: closed.action,
      localStatus: closed.status,
      warning,
    }),
  );

  return {
    ok: true,
    status: closed.status,
    periodEndMs: closed.periodEndMs,
    alreadyCancelled: pre.alreadyCancelled,
    warning,
    mode: 'end_of_cycle',
    refund: null,
    refundId: null,
    fallbackReason: null,
  };
}
