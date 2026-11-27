/* ============================================================================
 * CANCELACIÓN DE SUSCRIPCIÓN — R9 + ARREPENTIMIENTO (R13.5)
 * ----------------------------------------------------------------------------
 * Server-only. El `preapproval_id` NO viene del cliente: se resuelve desde la
 * sesión (`subscriptions.preapproval_id`) para que nadie pueda cancelar la
 * suscripción de otro usuario.
 *
 * Dos caminos, una sola política de dinero:
 *   · `cancelUserSubscription`: baja estándar desde la app. Cancela el débito
 *     y conserva PRO hasta `period_end`. NO reembolsa.
 *   · `executeWithdrawalCancellation`: Botón de Arrepentimiento. Dentro de los
 *     10 días corridos reembolsa el 100 % por MP y baja el plan YA (solo con
 *     HTTP 200/201). Después del día 10 no hay reembolso: cancela el débito y
 *     conserva PRO hasta `period_end`.
 *
 * Orden del flujo con reembolso:
 *   1. leer pago + evaluar la ventana de 10 días (sin mutar nada);
 *   2. cancelar el preapproval (primero: corta cobros futuros);
 *   3. reclamar `refund_requests` (idempotency key única por pago);
 *   4. POST /v1/payments/{id}/refunds;
 *   5. SOLO con 200/201: fold local (`revocada`, `closure_reason='cancel'`) +
 *      `users.plan='free'` + email.
 *
 * Si MP falla, la renovación queda cancelada, PRO sigue hasta `period_end`,
 * la solicitud queda `failed` para reintentar con la misma key y se alerta.
 * Nunca se baja el plan sin dinero devuelto.
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
  evaluateWithdrawalRefund,
  type WithdrawalRefundReason,
} from '@/lib/payments/refunds';
import {
  createSupabaseServiceClient,
  hasServiceCredentials,
} from '@/lib/supabase/service';

/* -------------------------------------------------------------------------- */
/* Baja estándar (fin de ciclo, sin reembolso)                                 */
/* -------------------------------------------------------------------------- */

export interface CancelSubscriptionOk {
  ok: true;
  status: SubscriptionStatus;
  periodEndMs: number | null;
  /** true ⇒ MP ya la tenía cancelada (o el endpoint se repitió). */
  alreadyCancelled: boolean;
  /** La baja se ejecutó en MP; la DB queda a la espera del sync. */
  warning: 'LOCAL_SYNC_PENDING' | null;
}

export type CancelSubscriptionFailureReason =
  | 'mp_config'
  | 'no_subscription'
  | 'not_cancelable'
  | 'missing_preapproval'
  | 'ownership'
  | 'mp_unavailable'
  | 'db';

export interface CancelSubscriptionFailure {
  ok: false;
  reason: CancelSubscriptionFailureReason;
  detail?: string;
  /** Presente cuando la renovación YA se canceló y PRO sigue hasta esa fecha. */
  periodEndMs?: number | null;
}

export type CancelSubscriptionResult =
  | CancelSubscriptionOk
  | CancelSubscriptionFailure;

interface SubscriptionRow {
  status: SubscriptionStatus;
  preapproval_id: string | null;
  preapproval_plan_id: string | null;
  period_end: string | null;
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

/**
 * Fin del ciclo que financió el último pago: `period_end` manda si el cierre ya
 * está programado; si no, se deriva del ancla del ciclo y la fecha del cobro
 * (R1), porque `period_end` solo se escribe al programar el cierre. Sin pago no
 * se inventa una fecha.
 */
export function resolvePaidCycleEndMs(input: {
  periodEndMs: number | null;
  cycleAnchorDate: string | null;
  paidAtMs: number | null;
}): number | null {
  if (input.periodEndMs != null && Number.isFinite(input.periodEndMs)) {
    return input.periodEndMs;
  }
  if (input.paidAtMs == null || !Number.isFinite(input.paidAtMs)) return null;
  const anchorDay = input.cycleAnchorDate
    ? cycleAnchorDayOfStr(input.cycleAnchorDate)
    : null;
  return nextCycleDateMs(
    anchorDay ?? arDateParts(input.paidAtMs).day,
    input.paidAtMs,
  );
}

async function readSubRow(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await service
    .from('subscriptions')
    .select('status, preapproval_id, preapproval_plan_id, period_end')
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
   * MP. El arrepentimiento puede seguir directo al reembolso. */
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
/* Baja desde la app (R9): fin de ciclo, sin reembolso                         */
/* -------------------------------------------------------------------------- */

export async function cancelUserSubscription(
  userId: string,
  opts: { nowMs?: number } = {},
): Promise<CancelSubscriptionResult> {
  void opts.nowMs;
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
  };
}

/* -------------------------------------------------------------------------- */
/* Arrepentimiento (R13.5): reembolso total ≤ 10 días; después, sin reembolso  */
/* -------------------------------------------------------------------------- */

export type WithdrawalCancellationResult =
  | {
      ok: true;
      kind: 'refund';
      status: 'revocada' | 'programada_cierre';
      periodEndMs: number | null;
      alreadyCancelled: boolean;
      warning: 'LOCAL_SYNC_PENDING' | null;
      amountArs: number;
      refundId: string | null;
    }
  | {
      ok: true;
      kind: 'scheduled';
      status: 'programada_cierre';
      periodEndMs: number | null;
      alreadyCancelled: boolean;
      warning: 'LOCAL_SYNC_PENDING' | null;
      reason: WithdrawalRefundReason;
    }
  | {
      ok: false;
      reason:
        | CancelSubscriptionFailureReason
        | 'refund_in_progress'
        | 'refund_failed';
      detail?: string;
      periodEndMs?: number | null;
      amountArs?: number | null;
    };

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

/**
 * Cierra el ciclo local sin reembolso. Si el cierre ya estaba programado, es
 * idempotente y conserva `period_end`.
 */
async function closeWithoutRefund(input: {
  userId: string;
  sub: SubscriptionRow;
  pre: Extract<PreapprovalCancelOutcome, { ok: true }>;
  suppressEmail: boolean;
}): Promise<{ status: SubscriptionStatus; periodEndMs: number | null }> {
  if (input.sub.status === 'programada_cierre') {
    return {
      status: 'programada_cierre',
      periodEndMs: isoToMs(input.sub.period_end),
    };
  }
  return applyScheduledClose({
    userId: input.userId,
    pre: input.pre,
    source: 'legal',
    suppressEmail: input.suppressEmail,
  });
}

/**
 * Ejecuta el Botón de Arrepentimiento. La ventana se mide contra el pago REAL
 * (no contra la fecha tipeada):
 *
 *   · ≤ 10 días corridos ⇒ reembolso del 100 % del saldo + baja inmediata;
 *   · > 10 días ⇒ sin reembolso: cancela la renovación y PRO hasta `period_end`;
 *   · sin pago / saldo ya devuelto ⇒ sin reembolso, mismo cierre programado.
 *
 * Nunca baja el plan antes de que MP devuelva 200/201. Si el reembolso falla,
 * cancela la renovación y deja PRO hasta `period_end` (no hay downgrade).
 */
export async function executeWithdrawalCancellation(input: {
  userId: string;
  nowMs?: number;
  legalRequestId?: string | null;
}): Promise<WithdrawalCancellationResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'db' };
  if (!hasMercadoPagoCredentials()) return { ok: false, reason: 'mp_config' };

  const nowMs = input.nowMs ?? Date.now();
  const service = createSupabaseServiceClient();

  const [sub, paymentResult] = await Promise.all([
    readSubRow(service, input.userId),
    service
      .from('payments')
      .select('mp_payment_id, amount, refunded_amount, occurred_at, status')
      .eq('user_id', input.userId)
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
    console.error('[billing withdrawal payment]:', paymentResult.error.message);
    return { ok: false, reason: 'db', detail: paymentResult.error.message };
  }

  const payment = paymentResult.data ?? null;
  const paidAtMs = payment ? isoToMs(payment.occurred_at) : null;
  const eligibility = evaluateWithdrawalRefund({
    paymentAmount: payment ? numberOrZero(payment.amount) : null,
    refundedAmount: payment ? numberOrZero(payment.refunded_amount) : 0,
    paidAtMs,
    nowMs,
  });

  /* 1) Cortar la renovación ANTES de tocar el dinero. Si no hay reembolso que
   * hacer, el preapproval es obligatorio (no se puede "programar" un cierre
   * que no existe). */
  const pre = await cancelPreapprovalForUser(service, input.userId, sub, {
    allowMissing: eligibility.eligible,
  });
  if (!pre.ok) {
    return { ok: false, reason: pre.reason, detail: pre.detail };
  }

  /* 2) Fuera de la ventana (o sin saldo): solo se cancela la renovación. */
  if (!eligibility.eligible || !payment) {
    const closed = await closeWithoutRefund({
      userId: input.userId,
      sub,
      pre,
      suppressEmail: false,
    });
    return {
      ok: true,
      kind: 'scheduled',
      status: 'programada_cierre',
      periodEndMs: closed.periodEndMs,
      alreadyCancelled: pre.alreadyCancelled,
      warning: closed.status === 'programada_cierre' ? null : 'LOCAL_SYNC_PENDING',
      reason: eligibility.reason,
    };
  }

  const paymentId = Number(payment.mp_payment_id);
  if (!Number.isFinite(paymentId)) {
    const closed = await closeWithoutRefund({
      userId: input.userId,
      sub,
      pre,
      suppressEmail: false,
    });
    return {
      ok: false,
      reason: 'no_subscription',
      detail: 'pago sin id',
      periodEndMs: closed.periodEndMs,
      amountArs: eligibility.amountArs,
    };
  }

  /* 3) Claim idempotente: una sola solicitud activa por pago. */
  const claimed = await claimRefundRequest(service, {
    userId: input.userId,
    mpPaymentId: paymentId,
    kind: 'withdrawal',
    refundKind: 'full',
    amount: eligibility.amountArs,
    paymentAmount: eligibility.paymentAmount,
    refundedBefore: eligibility.refundedBefore,
    daysSincePayment: eligibility.daysSincePayment,
    daysRemaining: null,
    cycleDays: null,
    legalRequestId: input.legalRequestId ?? null,
    nowMs,
  });

  if (!claimed.ok) {
    /* Ya hay un proceso en curso o la DB no responde. La renovación ya está
     * cortada: se conserva PRO hasta period_end y se informa para reintentar. */
    const closed = await closeWithoutRefund({
      userId: input.userId,
      sub,
      pre,
      suppressEmail: false,
    });
    return {
      ok: false,
      reason: claimed.reason === 'in_progress' ? 'refund_in_progress' : 'db',
      detail: claimed.detail,
      periodEndMs: closed.periodEndMs,
      amountArs: eligibility.amountArs,
    };
  }

  const request = claimed.row;

  /* 4) El dinero YA volvió en un intento anterior: solo converger local. */
  if (claimed.alreadyApproved) {
    const refundId = request.mp_refund_id ?? null;
    const refundedNow = numberOrZero(request.amount) || eligibility.amountArs;
    if (request.applied_at == null && refundId) {
      const alreadyInLocal = await hasRefundAdjustment(service, refundId);
      const folded = await applyConfirmedCancellationRefund({
        userId: input.userId,
        source: 'legal',
        mpPaymentId: paymentId,
        paymentAmount: eligibility.paymentAmount,
        refundedTotal: Math.min(
          eligibility.paymentAmount,
          alreadyInLocal
            ? eligibility.refundedBefore
            : eligibility.refundedBefore + refundedNow,
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
          '[billing withdrawal fold retry]:',
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
        source: 'legal',
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
      kind: 'refund',
      status,
      periodEndMs:
        status === 'revocada' ? null : isoToMs(after?.period_end ?? sub.period_end),
      alreadyCancelled: pre.alreadyCancelled,
      warning: status === 'revocada' ? null : 'LOCAL_SYNC_PENDING',
      amountArs: refundedNow,
      refundId,
    };
  }

  /* 5) Reembolso real en MP: total sin body; si hubo un parcial previo, se
   * envía el saldo remanente para completar el 100 %. La idempotency key vive
   * en la fila y se reutiliza al reintentar: MP nunca devuelve dos veces el
   * mismo dinero. */
  const sendAmount =
    eligibility.refundedBefore <= 0.009 ? null : eligibility.amountArs;
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
    const closed = await closeWithoutRefund({
      userId: input.userId,
      sub,
      pre,
      suppressEmail: false,
    });
    await sendPaymentAlert({
      userId: input.userId,
      mpPaymentId: paymentId,
      kind: 'refund_total',
      amountArs: eligibility.paymentAmount,
      refundedArs: eligibility.refundedBefore,
      impact: 'refund_failed_keep_pro',
      note: `arrepentimiento: MP rechazó el reembolso (${refund.message}); renovación cancelada y PRO hasta ${
        closed.periodEndMs
          ? new Date(closed.periodEndMs).toISOString()
          : 'period_end'
      }; reintentar`,
    });
    return {
      ok: false,
      reason: 'refund_failed',
      detail: refund.message,
      periodEndMs: closed.periodEndMs,
      amountArs: eligibility.amountArs,
    };
  }

  const mpAmount =
    refund.data.amount != null && refund.data.amount > 0
      ? refund.data.amount
      : eligibility.amountArs;
  const refundedTotal = Math.min(
    eligibility.paymentAmount,
    eligibility.refundedBefore + mpAmount,
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
    source: 'legal',
    mpPaymentId: paymentId,
    paymentAmount: eligibility.paymentAmount,
    refundedTotal,
    refundAmount: mpAmount,
    refundId: refund.data.id,
    occurredAtMs: nowMs,
    nowMs,
  });

  if (folded.action !== 'adjusted' && folded.action !== 'already_applied') {
    console.error(
      '[billing withdrawal fold]:',
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
      source: 'legal',
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
    kind: 'refund',
    status,
    periodEndMs:
      status === 'revocada' ? null : isoToMs(after?.period_end ?? sub.period_end),
    alreadyCancelled: pre.alreadyCancelled,
    warning: status === 'revocada' ? null : 'LOCAL_SYNC_PENDING',
    amountArs: mpAmount,
    refundId: refund.data.id,
  };
}
