/* ============================================================================
 * SOLICITUDES DE REEMBOLSO — IDEMPOTENCIA Y AUDITORÍA
 * ----------------------------------------------------------------------------
 * Server-only. Tabla `refund_requests` (migración 0012). Este módulo NO llama a
 * MP ni muta pagos/suscripciones: solo administra la fila que coordina el
 * reembolso y su idempotency key.
 *
 * Reglas:
 *   · una sola solicitud ACTIVA por (user_id, mp_payment_id);
 *   · un reintento reutiliza la MISMA fila y la MISMA key (MP devuelve el mismo
 *     reembolso, nunca dos);
 *   · `approved` + `applied_at` NULL ⇒ el dinero ya volvió pero falta converger
 *     el estado local: el caller reintenta el fold, no el refund.
 * ========================================================================== */

import { randomUUID } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export type RefundRequestKind = 'cancellation' | 'withdrawal';
export type RefundRequestStatus = 'pending' | 'processing' | 'approved' | 'failed';
export type RefundKind = 'full' | 'partial';

export interface RefundRequestRow {
  id: string;
  user_id: string;
  mp_payment_id: number | string;
  kind: RefundRequestKind;
  refund_kind: RefundKind;
  status: RefundRequestStatus;
  idempotency_key: string;
  amount: number | string;
  payment_amount: number | string;
  refunded_before: number | string;
  days_since_payment: number | null;
  days_remaining: number | null;
  cycle_days: number | null;
  mp_refund_id: string | null;
  mp_status: string | null;
  error_detail: string | null;
  legal_request_id: string | null;
  requested_at: string;
  completed_at: string | null;
  applied_at: string | null;
  email_claimed_at: string | null;
  email_sent_at: string | null;
  email_last_error: string | null;
  created_at: string;
  updated_at: string;
}

type Service = ReturnType<typeof createSupabaseServiceClient>;

/** 2 minutos: un `processing` más viejo se considera un proceso muerto. */
export const REFUND_PROCESSING_STALE_MS = 2 * 60_000;

export type ClaimRefundResult =
  | { ok: true; row: RefundRequestRow; alreadyApproved: boolean }
  | { ok: false; reason: 'in_progress' | 'db'; detail?: string };

const SELECT_COLUMNS =
  'id, user_id, mp_payment_id, kind, refund_kind, status, idempotency_key, amount, payment_amount, refunded_before, days_since_payment, days_remaining, cycle_days, mp_refund_id, mp_status, error_detail, legal_request_id, requested_at, completed_at, applied_at, email_claimed_at, email_sent_at, email_last_error, created_at, updated_at';

export async function findLatestRefundRequest(
  service: Service,
  userId: string,
  mpPaymentId: number,
): Promise<RefundRequestRow | null> {
  const { data, error } = await service
    .from('refund_requests')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .eq('mp_payment_id', mpPaymentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<RefundRequestRow>();
  if (error) {
    console.error('[refund request read]:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Webhook/sync: ¿este pago tiene una baja inmediata con reembolso en curso o
 * aprobada? Si sí, el fold debe revocar con `closure_reason='cancel'` aunque
 * el reembolso sea parcial (excepción a R11.5).
 */
export async function findCancellationRefundForPayment(
  service: Service,
  userId: string,
  mpPaymentId: number,
): Promise<RefundRequestRow | null> {
  const { data, error } = await service
    .from('refund_requests')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .eq('mp_payment_id', mpPaymentId)
    .in('kind', ['cancellation', 'withdrawal'])
    .in('status', ['processing', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<RefundRequestRow>();
  if (error) {
    // Si la migración 0012 todavía no se aplicó, el webhook sigue funcionando
    // con la regla general de R11 (no se cae por una tabla ausente).
    console.error('[refund request lookup]:', error.message);
    return null;
  }
  return data ?? null;
}

function isStaleProcessing(row: RefundRequestRow, nowMs: number): boolean {
  const updatedMs = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedMs)) return true;
  return nowMs - updatedMs >= REFUND_PROCESSING_STALE_MS;
}

/**
 * Reclama (o crea) la solicitud activa del pago. Devuelve `alreadyApproved`
 * cuando MP ya devolvió el dinero: el caller NO debe volver a llamar al refund,
 * solo converger el estado local.
 */
export async function claimRefundRequest(
  service: Service,
  input: {
    userId: string;
    mpPaymentId: number;
    kind: RefundRequestKind;
    refundKind: RefundKind;
    amount: number;
    paymentAmount: number;
    refundedBefore: number;
    daysSincePayment: number | null;
    daysRemaining: number | null;
    cycleDays: number | null;
    legalRequestId?: string | null;
    nowMs: number;
  },
): Promise<ClaimRefundResult> {
  const existing = await findLatestRefundRequest(service, input.userId, input.mpPaymentId);
  if (existing) {
    if (existing.status === 'approved') {
      return { ok: true, row: existing, alreadyApproved: true };
    }
    if (existing.status === 'processing' && !isStaleProcessing(existing, input.nowMs)) {
      return { ok: false, reason: 'in_progress' };
    }

    const claimed = await service
      .from('refund_requests')
      .update({
        status: 'processing',
        error_detail: null,
        updated_at: new Date(input.nowMs).toISOString(),
        /* Reintento: la cotización puede haber cambiado (pasaron días). La
         * fila guarda la cotización del intento vigente; la key NO cambia. */
        kind: input.kind,
        refund_kind: input.refundKind,
        amount: input.amount,
        payment_amount: input.paymentAmount,
        refunded_before: input.refundedBefore,
        days_since_payment: input.daysSincePayment,
        days_remaining: input.daysRemaining,
        cycle_days: input.cycleDays,
        legal_request_id: input.legalRequestId ?? existing.legal_request_id,
      })
      .eq('id', existing.id)
      .in('status', ['pending', 'failed', 'processing'])
      .select(SELECT_COLUMNS)
      .maybeSingle<RefundRequestRow>();
    if (claimed.error) {
      console.error('[refund request claim]:', claimed.error.message);
      return { ok: false, reason: 'db', detail: claimed.error.message };
    }
    if (claimed.data) return { ok: true, row: claimed.data, alreadyApproved: false };

    // Otro proceso ganó el claim: releer para distinguir approved de in_progress.
    const after = await findLatestRefundRequest(service, input.userId, input.mpPaymentId);
    if (after?.status === 'approved') {
      return { ok: true, row: after, alreadyApproved: true };
    }
    return { ok: false, reason: 'in_progress' };
  }

  const nowIso = new Date(input.nowMs).toISOString();
  const inserted = await service
    .from('refund_requests')
    .insert({
      user_id: input.userId,
      mp_payment_id: input.mpPaymentId,
      kind: input.kind,
      refund_kind: input.refundKind,
      status: 'processing',
      idempotency_key: `cancel-refund:${randomUUID()}`,
      amount: input.amount,
      payment_amount: input.paymentAmount,
      refunded_before: input.refundedBefore,
      days_since_payment: input.daysSincePayment,
      days_remaining: input.daysRemaining,
      cycle_days: input.cycleDays,
      legal_request_id: input.legalRequestId ?? null,
      requested_at: nowIso,
      updated_at: nowIso,
    })
    .select(SELECT_COLUMNS)
    .maybeSingle<RefundRequestRow>();

  if (!inserted.error && inserted.data) {
    return { ok: true, row: inserted.data, alreadyApproved: false };
  }

  const code = (inserted.error as { code?: string } | null)?.code;
  if (code === '23505') {
    // Carrera: otra request creó la fila activa. Releer y decidir.
    const after = await findLatestRefundRequest(service, input.userId, input.mpPaymentId);
    if (after?.status === 'approved') {
      return { ok: true, row: after, alreadyApproved: true };
    }
    if (after?.status === 'processing' && !isStaleProcessing(after, input.nowMs)) {
      return { ok: false, reason: 'in_progress' };
    }
    if (after) {
      const retried = await service
        .from('refund_requests')
        .update({
          status: 'processing',
          error_detail: null,
          updated_at: nowIso,
          kind: input.kind,
          refund_kind: input.refundKind,
          amount: input.amount,
          payment_amount: input.paymentAmount,
          refunded_before: input.refundedBefore,
          days_since_payment: input.daysSincePayment,
          days_remaining: input.daysRemaining,
          cycle_days: input.cycleDays,
          legal_request_id: input.legalRequestId ?? after.legal_request_id,
        })
        .eq('id', after.id)
        .in('status', ['pending', 'failed', 'processing'])
        .select(SELECT_COLUMNS)
        .maybeSingle<RefundRequestRow>();
      if (!retried.error && retried.data) {
        return { ok: true, row: retried.data, alreadyApproved: false };
      }
    }
    return { ok: false, reason: 'in_progress' };
  }

  console.error('[refund request insert]:', inserted.error?.message ?? 'sin fila');
  return {
    ok: false,
    reason: 'db',
    detail: inserted.error?.message ?? 'No se pudo crear la solicitud de reembolso.',
  };
}

export async function markRefundRequestApproved(
  service: Service,
  input: {
    id: string;
    mpRefundId: string;
    mpStatus: string;
    amount: number;
    nowMs: number;
  },
): Promise<boolean> {
  const nowIso = new Date(input.nowMs).toISOString();
  const { error } = await service
    .from('refund_requests')
    .update({
      status: 'approved',
      mp_refund_id: input.mpRefundId,
      mp_status: input.mpStatus,
      amount: input.amount,
      completed_at: nowIso,
      updated_at: nowIso,
      error_detail: null,
    })
    .eq('id', input.id);
  if (error) {
    console.error('[refund request approved]:', error.message);
    return false;
  }
  return true;
}

export async function markRefundRequestFailed(
  service: Service,
  input: { id: string; detail: string; nowMs: number },
): Promise<void> {
  const { error } = await service
    .from('refund_requests')
    .update({
      status: 'failed',
      error_detail: input.detail.slice(0, 1_000),
      updated_at: new Date(input.nowMs).toISOString(),
      email_claimed_at: null,
    })
    .eq('id', input.id);
  if (error) console.error('[refund request failed]:', error.message);
}

export async function markRefundRequestApplied(
  service: Service,
  input: { id: string; nowMs: number },
): Promise<void> {
  const { error } = await service
    .from('refund_requests')
    .update({
      applied_at: new Date(input.nowMs).toISOString(),
      updated_at: new Date(input.nowMs).toISOString(),
    })
    .eq('id', input.id);
  if (error) console.error('[refund request applied]:', error.message);
}

/**
 * Claim atómico del email de baja+reembolso. El webhook y la API pueden
 * foldear el mismo reembolso: solo el primero manda el email.
 */
export async function claimRefundRequestEmail(
  service: Service,
  id: string,
  nowMs: number,
): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await service
    .from('refund_requests')
    .update({ email_claimed_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .is('email_claimed_at', null)
    .select('id');
  if (error) {
    console.error('[refund request email claim]:', error.message);
    return false;
  }
  return Boolean(data && data.length > 0);
}

export async function markRefundRequestEmailResult(
  service: Service,
  input: { id: string; sent: boolean; error?: string | null; nowMs: number },
): Promise<void> {
  const nowIso = new Date(input.nowMs).toISOString();
  const { error } = await service
    .from('refund_requests')
    .update(
      input.sent
        ? { email_sent_at: nowIso, email_last_error: null, updated_at: nowIso }
        : {
            email_claimed_at: null,
            email_last_error: (input.error ?? 'envío fallido').slice(0, 1_000),
            updated_at: nowIso,
          },
    )
    .eq('id', input.id);
  if (error) console.error('[refund request email result]:', error.message);
}
