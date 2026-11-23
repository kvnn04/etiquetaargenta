/* ============================================================================
 * APLICACIÓN DE PAGOS — posición 11 (spec_sync_de_pagos_y_reverificacion.md)
 * ----------------------------------------------------------------------------
 * Camino ÚNICO para foldear un pago de Mercado Pago al ciclo, compartido por
 * el webhook (camino primario) y el sync (recuperación). Extraído del route
 * del webhook en 10B para que no existan dos verdades.
 *
 * Reglas que viven acá:
 *   · R12.1  verdad desde MP: el caller ya hizo el pull autoritativo.
 *   · R12.4  ventana anti-resurrección: un pago viejo se AUDITA, no muta.
 *   · R12.6  reparación idempotente: dedupe por mp_payment_id UNIQUE; si la
 *            fila existe con applied_at NULL y status approved/rejected, se
 *            vuelve a aplicar. Si ya tiene applied_at, no se re-aplica.
 *   · R12.7  un email por pago: claim atómico con email_claimed_at (5 min),
 *            hasta 3 intentos, idempotency key `receipt:{mp_payment_id}`.
 *            Si faltan RESEND_API_KEY/EMAIL_FROM no se quema un intento.
 *   · R12.8  preapproval: cancelled/paused ⇒ cierre programado (R9), con el
 *            mismo period_end y el mismo email que el webhook.
 *
 * POSICIÓN 13 (R11.1–R11.10) — reembolsos y contracargos:
 *   · el pago se actualiza SIEMPRE (refunded/partially_refunded/charged_back)
 *     con `refunded_amount` clampeado y CAS por estado;
 *   · el plan solo se revoca si el pago afectado es el del ciclo vigente y la
 *     suscripción está viva; un ciclo pasado se audita (R11.3);
 *   · un refund/chargeback que llega ANTES que el approved gana: el approved
 *     posterior NUNCA activa PRO (carrera §6);
 *   · `payment_adjustments` es la barrera de idempotencia del email: se manda
 *     UN email por ajuste NUEVO, jamás por reintento (R11.7/R11.9);
 *   · el preapproval se cancela al revocar (Q6); si MP falla, la suscripción
 *     queda `revocada` y se alerta al titular — sin loop de reintentos.
 *
 * El pago se inserta ANTES de mutar el ciclo (como el webhook de 10B): si el
 * proceso muere entre medio, applied_at queda NULL y el próximo sync repara.
 * applied_at se marca recién cuando subscriptions y users.plan quedaron
 * consistentes. Nunca se guardan datos de tarjeta.
 * ============================================================================ */

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { Plan } from '@/lib/permissions';
import {
  DAY_MS,
  arDateStrFromMs,
  cancelationPeriodEndMs,
  cycleAnchorDayOfStr,
  isLiveSubscriptionStatus,
  isPositiveAmount,
  nextCycleDateMs,
  resolvePlan,
  transitionSubscription,
  type PaymentStatus,
  type SubscriptionStatus,
} from '@/lib/payments/core';
import {
  decideRefundImpact,
  effectiveRefundedAmount,
  isChargebackReversal,
  isCurrentCyclePayment,
  isRefundLikeStatus,
  mergeRefundStatus,
  refundImpactKindFor,
  resolveRefundStatus,
  type RefundLikeStatus,
} from '@/lib/payments/refunds';
import {
  hasResendCredentials,
  mailChargeback,
  mailGrace,
  mailPaymentInternalAlert,
  mailReceipt,
  mailRefundPartial,
  mailRefundTotal,
  mailScheduledClose,
  sendMail,
} from '@/lib/payments/mail';
import {
  cancelPreapproval,
  type MpChargebackFull,
  type MpPaymentFull,
  type MpPreapprovalFull,
} from '@/lib/payments/mercadopago';

export type ApplySource = 'webhook' | 'sync' | 'legal';

export interface ApplyContext {
  userId: string;
  source: ApplySource;
  /**
   * Watermark R12.4: un pago con date_created anterior a esto − 1 día se
   * audita pero no muta el plan. El webhook pasa null (camino primario).
   */
  watermarkMs: number | null;
  /** Instante inyectable para tests/QA; por defecto now(). */
  nowMs?: number;
  /** Deadline del sync on-read: recorta el envío de email al presupuesto. */
  deadlineMs?: number;
}

export type PaymentSkipReason =
  | 'user_mismatch'
  | 'unsupported_status'
  | 'currency_not_ars'
  | 'amount_invalid'
  | 'invalid_date'
  | 'preapproval_mismatch';

export interface PaymentValidationOk {
  ok: true;
  normalized: PaymentStatus;
  amount: number;
  /** R11.2: devuelto acumulado ya clampeado a `amount`. */
  refundedAmount: number;
  /** R11.2: detalle autoritativo de MP para el historial. */
  statusDetail: string | null;
  /**
   * Aprobado ⇒ date_approved (ancla del ciclo). Rechazo ⇒ date_last_updated
   * (inicio de la gracia). Reembolso/contracargo ⇒ date_last_updated (momento
   * de la novedad; el pago conserva su `occurred_at` de cobro original).
   */
  occurredMs: number;
  /** Fecha de creación: ordena y alimenta la ventana R12.4. */
  createdMs: number;
  /** true ⇒ se audita, no muta (R12.4; solo aplica a approved/rejected). */
  old: boolean;
}

export interface PaymentValidationSkip {
  ok: false;
  reason: PaymentSkipReason;
}

export type PaymentValidation = PaymentValidationOk | PaymentValidationSkip;

export type ApplyAction =
  | 'inserted'
  | 'repaired'
  /** R11: reembolso/contracargo foldido al ciclo (revocación o parcial). */
  | 'adjusted'
  | 'already_applied'
  | 'audited'
  | 'skipped'
  | 'error';

export type ApplyEmailOutcome =
  | 'sent'
  | 'failed'
  | 'skipped'
  | 'claimed'
  | 'exhausted'
  | 'no_env';

export interface ApplyResult {
  action: ApplyAction;
  mpPaymentId: number;
  reason?: string;
  statusAfter?: SubscriptionStatus;
  planAfter?: Plan;
  receiptUrl?: string | null;
  email?: ApplyEmailOutcome;
  /** R11: tipo de novedad aplicada (refund/chargeback/reversal). */
  adjustmentKind?: 'refund' | 'chargeback' | 'reversal';
}

export interface PreapprovalApplyResult {
  action: 'closed' | 'ignored' | 'error';
  periodEndMs?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isoToMs = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/* -------------------------------------------------------------------------- */
/* Validación PURA (testeable sin DB ni red)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Valida el pago ANTES de tocar la base:
 *   · external_reference UUID === user_id de la sesión (R12.1)
 *   · estados R7 + R11 (approved/rejected/refunded/partially_refunded/
 *     charged_back); pending y desconocidos se ignoran con log
 *   · solo ARS y monto positivo (R12.12)
 *   · fecha parseable (date_created → date_approved → date_last_updated)
 *   · preapproval local vs. pago: si el local existe y no coincide, se ignora
 *   · ventana anti-resurrección (R12.4) ⇒ `old: true` (se audita, no muta)
 */
export function validatePaymentForApply(
  pay: MpPaymentFull,
  input: {
    userId: string;
    watermarkMs: number | null;
    localPreapprovalId: string | null;
    /**
     * R11: un reembolso/contracargo de un pago viejo puede llegar después de
     * un checkout nuevo. El pago ya está atado al usuario por
     * external_reference; el mismatch de preapproval no debe bloquear la
     * auditoría del dinero (sí bloquea un approved nuevo, que sí activa).
     */
    ignorePreapprovalMismatch?: boolean;
  },
): PaymentValidation {
  if (
    !pay.externalReference ||
    !UUID_RE.test(pay.externalReference) ||
    pay.externalReference !== input.userId
  ) {
    return { ok: false, reason: 'user_mismatch' };
  }

  // R11.2: el estado local no es solo el status de MP: un `approved` con
  // transaction_amount_refunded > 0 es parcial (o total si llegó al monto).
  const normalized = resolveRefundStatus({
    mpStatus: pay.status,
    amount: pay.transactionAmount,
    refundedAmount: pay.transactionAmountRefunded,
  });
  if (!normalized) return { ok: false, reason: 'unsupported_status' };

  if (pay.currencyId !== 'ARS') return { ok: false, reason: 'currency_not_ars' };

  if (!isPositiveAmount(pay.transactionAmount)) {
    return { ok: false, reason: 'amount_invalid' };
  }

  const refundedAmount = effectiveRefundedAmount({
    mpStatus: pay.status,
    amount: pay.transactionAmount,
    refundedAmount: pay.transactionAmountRefunded,
  });

  const createdMs =
    isoToMs(pay.dateCreated) ?? isoToMs(pay.dateApproved) ?? isoToMs(pay.dateLastUpdated);
  // Aprobado ⇒ fecha de aprobación. Rechazo/reembolso/contracargo ⇒ última
  // mutación (R8: la gracia corre desde el RECHAZO; R11: el refund desde que
  // MP devolvió el dinero, no desde la creación del intento).
  const occurredMs =
    normalized === 'approved'
      ? (isoToMs(pay.dateApproved) ?? createdMs)
      : (isoToMs(pay.dateLastUpdated) ?? isoToMs(pay.dateApproved) ?? createdMs);
  if (createdMs == null || occurredMs == null) {
    return { ok: false, reason: 'invalid_date' };
  }

  if (
    !input.ignorePreapprovalMismatch &&
    input.localPreapprovalId != null &&
    pay.preapprovalId != null &&
    input.localPreapprovalId !== pay.preapprovalId
  ) {
    return { ok: false, reason: 'preapproval_mismatch' };
  }

  const old =
    input.watermarkMs != null && createdMs < input.watermarkMs - DAY_MS;

  return {
    ok: true,
    normalized,
    amount: pay.transactionAmount,
    refundedAmount,
    statusDetail: pay.statusDetail,
    occurredMs,
    createdMs,
    old,
  };
}

export type ExistingPaymentDecision =
  | { action: 'already_applied' }
  | { action: 'repair' }
  | { action: 'ignore_status' };

/**
 * R12.6 puro: qué hacer con una fila de `payments` que ya existía.
 *   · applied_at no nulo ⇒ ya se foldió, no se re-aplica.
 *   · applied_at NULL + approved/rejected ⇒ reparar (falla parcial de 10B).
 *   · refunded/charged_back ⇒ lo resuelve R11; acá no se toca.
 */
export function decideExistingPayment(row: {
  applied_at: string | null;
  status: string;
}): ExistingPaymentDecision {
  if (row.applied_at) return { action: 'already_applied' };
  if (row.status === 'approved' || row.status === 'rejected') return { action: 'repair' };
  return { action: 'ignore_status' };
}

/* -------------------------------------------------------------------------- */
/* Helpers de DB                                                              */
/* -------------------------------------------------------------------------- */

interface SubRow {
  status: SubscriptionStatus;
  price_frozen: number;
  preapproval_id: string | null;
  cycle_anchor: string | null;
  grace_expires_at: string | null;
  period_end: string | null;
}

type Service = ReturnType<typeof createSupabaseServiceClient>;

async function readSubRow(service: Service, userId: string): Promise<SubRow | null> {
  const { data, error } = await service
    .from('subscriptions')
    .select('status, price_frozen, preapproval_id, cycle_anchor, grace_expires_at, period_end')
    .eq('user_id', userId)
    .maybeSingle<SubRow>();
  if (error) console.error('[mp apply sub read]:', error.message);
  return data ?? null;
}

async function mailTo(service: Service, userId: string): Promise<string | null> {
  const { data } = await service.auth.admin.getUserById(userId);
  const email = data?.user?.email ?? null;
  if (!email) console.error('[mp apply mail]: sin email para', userId);
  return email;
}

/* -------------------------------------------------------------------------- */
/* Email por pago — claim atómico (R12.7)                                     */
/* -------------------------------------------------------------------------- */

interface PaymentEmailInput {
  mpPaymentId: number;
  userId: string;
  status: 'approved' | 'rejected';
  amount: number;
  occurredMs: number;
  receiptUrl: string | null;
  graceExpiresAtMs: number | null;
  /** Recorte del envío al presupuesto del sync on-read (R12.9/§6). */
  timeoutMs?: number;
}

/**
 * Un email por pago (recibo si aprobado, aviso de gracia si rechazado).
 * El claim `email_claimed_at` deja pasar UN proceso; si el envío falla se
 * incrementa email_attempts y se libera el lease para el próximo sync. Al
 * tercer intento se deja para soporte. Sin envs NO se incrementa.
 */
async function sendPaymentEmail(
  service: Service,
  input: PaymentEmailInput,
): Promise<ApplyEmailOutcome> {
  if (input.status === 'rejected' && input.graceExpiresAtMs == null) {
    // La ventana ya no existe: un aviso de gracia sería una promesa falsa.
    await service
      .from('payments')
      .update({
        email_sent_at: new Date().toISOString(),
        email_claimed_at: null,
        email_last_error: 'stale_grace',
      })
      .eq('user_id', input.userId)
      .eq('mp_payment_id', input.mpPaymentId)
      .is('email_sent_at', null);
    return 'skipped';
  }

  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const claim = await service
    .from('payments')
    .update({ email_claimed_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('mp_payment_id', input.mpPaymentId)
    .is('email_sent_at', null)
    .lt('email_attempts', 3)
    .or(`email_claimed_at.is.null,email_claimed_at.lt.${fiveMinAgo}`)
    .select('id, email_attempts')
    .maybeSingle<{ id: string; email_attempts: number }>();

  if (claim.error) {
    console.error('[mp email claim]:', claim.error.message);
    return 'skipped';
  }
  if (!claim.data) {
    // Otro proceso lo tiene, ya se envió o se agotaron los intentos.
    return 'claimed';
  }

  if (!hasResendCredentials()) {
    await service.from('payments').update({ email_claimed_at: null }).eq('id', claim.data.id);
    console.log('[mp email] sin RESEND_API_KEY/EMAIL_FROM — se reintenta cuando el entorno esté listo');
    return 'no_env';
  }

  const to = await mailTo(service, input.userId);
  if (!to) {
    await service
      .from('payments')
      .update({
        email_attempts: claim.data.email_attempts + 1,
        email_claimed_at: null,
        email_last_error: 'sin email de cuenta',
      })
      .eq('id', claim.data.id);
    return 'failed';
  }

  const content =
    input.status === 'approved'
      ? mailReceipt({
          to,
          amountArs: input.amount,
          occurredAtMs: input.occurredMs,
          receiptUrl: input.receiptUrl,
        })
      : mailGrace({ to, graceExpiresAtMs: input.graceExpiresAtMs as number });

  const sent = await sendMail(
    {
      ...content,
      idempotencyKey: `receipt:${input.mpPaymentId}`,
    },
    { timeoutMs: input.timeoutMs },
  );

  if (sent.sent) {
    await service
      .from('payments')
      .update({
        email_sent_at: new Date().toISOString(),
        email_claimed_at: null,
        email_last_error: null,
      })
      .eq('id', claim.data.id);
    return 'sent';
  }

  const attempts = claim.data.email_attempts + 1;
  await service
    .from('payments')
    .update({
      email_attempts: attempts,
      email_claimed_at: null,
      email_last_error: sent.note,
    })
    .eq('id', claim.data.id);
  if (attempts >= 3) {
    console.error('[mp email] intentos agotados — queda para soporte:', input.mpPaymentId);
    return 'exhausted';
  }
  return 'failed';
}

/**
 * Reintenta emails pendientes de pagos YA aplicados en corridas anteriores.
 * Se llama al INICIO del sync (los pagos nuevos de esta corrida los maneja
 * applyPayment). Sin credenciales de Resend no reclama ni quema intentos.
 */
export async function retryPendingPaymentEmails(
  userId: string,
  limit = 10,
  deadlineMs?: number,
): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!hasResendCredentials()) return { sent: 0, failed: 0, skipped: 0 };
  if (deadlineMs != null && Date.now() >= deadlineMs) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const service = createSupabaseServiceClient();
  const [sub, pending] = await Promise.all([
    readSubRow(service, userId),
    service
      .from('payments')
      .select('mp_payment_id, amount, status, occurred_at, receipt_url')
      .eq('user_id', userId)
      .in('status', ['approved', 'rejected'])
      .is('email_sent_at', null)
      .not('applied_at', 'is', null)
      .lt('email_attempts', 3)
      .order('occurred_at', { ascending: true })
      .limit(limit),
  ]);

  if (pending.error) {
    console.error('[mp email retry read]:', pending.error.message);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const graceMs = isoToMs(sub?.grace_expires_at ?? null);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of (pending.data ?? []) as Array<{
    mp_payment_id: number | string;
    amount: number | string;
    status: string;
    occurred_at: string;
    receipt_url: string | null;
  }>) {
    if (row.status !== 'approved' && row.status !== 'rejected') {
      skipped++;
      continue;
    }
    const remaining = deadlineMs != null ? deadlineMs - Date.now() : null;
    if (remaining != null && remaining < 1_000) break;
    const result = await sendPaymentEmail(service, {
      mpPaymentId: Number(row.mp_payment_id),
      userId,
      status: row.status,
      amount: Number(row.amount),
      occurredMs: isoToMs(row.occurred_at) ?? Date.now(),
      receiptUrl: row.receipt_url ?? null,
      graceExpiresAtMs: row.status === 'rejected' ? graceMs : null,
      timeoutMs: remaining != null ? Math.min(15_000, remaining) : undefined,
    });
    if (result === 'sent') sent++;
    else if (result === 'failed' || result === 'exhausted') failed++;
    else skipped++;
  }

  return { sent, failed, skipped };
}

/* -------------------------------------------------------------------------- */
/* Posición 13 — reembolsos y contracargos (R11.1–R11.10)                     */
/* -------------------------------------------------------------------------- */

interface LocalPaymentRow {
  id: string;
  mp_payment_id: number | string;
  amount: number | string;
  status: string;
  refunded_amount: number | string | null;
  occurred_at: string;
  applied_at: string | null;
}

async function readLocalPayment(
  service: Service,
  userId: string,
  mpPaymentId: number,
): Promise<LocalPaymentRow | null> {
  const { data, error } = await service
    .from('payments')
    .select('id, mp_payment_id, amount, status, refunded_amount, occurred_at, applied_at')
    .eq('user_id', userId)
    .eq('mp_payment_id', mpPaymentId)
    .maybeSingle<LocalPaymentRow>();
  if (error) console.error('[mp apply refund read]:', error.message);
  return data ?? null;
}

/**
 * Inserta una novedad en `payment_adjustments` (append-only). Devuelve true
 * SOLO si la fila es nueva: esa es la barrera del email (R11.7/R11.9). El
 * unique parcial `(kind, mp_source_id)` o `(mp_payment_id, kind, occurred_at)`
 * convierte el reintento en un no-op.
 */
async function insertAdjustment(
  service: Service,
  input: {
    userId: string;
    mpPaymentId: number;
    kind: 'refund' | 'chargeback' | 'reversal';
    sourceId: string | null;
    amount: number;
    rawStatus: string | null;
    occurredMs: number;
  },
): Promise<boolean> {
  const { error } = await service.from('payment_adjustments').insert({
    user_id: input.userId,
    mp_payment_id: input.mpPaymentId,
    kind: input.kind,
    mp_source_id: input.sourceId,
    amount: input.amount,
    raw_status: input.rawStatus,
    occurred_at: new Date(input.occurredMs).toISOString(),
  });
  if (!error) return true;
  const code = (error as { code?: string }).code;
  if (code === '23505') return false; // reintento/duplicado: no muta ni reenvía
  console.error('[mp adjustment insert]:', error.message);
  return false;
}

/** Alerta operativa al titular (Q7): LEGAL_EMAIL primero, EMAIL_FROM después. */
async function sendPaymentAlert(input: {
  userId: string;
  mpPaymentId: number;
  kind: 'refund_total' | 'refund_partial' | 'chargeback' | 'chargeback_reversal';
  amountArs: number;
  refundedArs: number;
  impact: string;
  sourceId?: string | null;
  note?: string | null;
  timeoutMs?: number;
}): Promise<void> {
  const to =
    process.env.LEGAL_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    '';
  if (!to) {
    console.log('[mp alert] sin LEGAL_EMAIL/EMAIL_FROM — alerta anotada en log');
    return;
  }
  await sendMail(
    mailPaymentInternalAlert({
      to,
      kind: input.kind,
      userId: input.userId,
      mpPaymentId: input.mpPaymentId,
      amountArs: input.amountArs,
      refundedArs: input.refundedArs,
      impact: input.impact,
      mpSourceId: input.sourceId ?? null,
      note: input.note ?? null,
    }),
    { timeoutMs: input.timeoutMs },
  );
}

/**
 * Fold de un reembolso/contracargo. Camino ÚNICO para webhook, sync y topic
 * de contracargos:
 *   1. actualiza el pago (merge monótono + clamp, CAS por estado);
 *   2. registra la novedad append-only (dedupe);
 *   3. revoca SOLO si el pago financió el ciclo vigente y la suscripción vive;
 *   4. cancela el preapproval al revocar (Q6) y alerta si MP falla;
 *   5. manda UN email por novedad NUEVA (nunca por reintento).
 */
async function applyRefundEvent(
  pay: MpPaymentFull,
  ctx: ApplyContext,
  opts: {
    sourceId?: string | null;
    forceKind?: 'chargeback';
    rawStatus?: string | null;
    precomputed?: { subBefore: SubRow | null; validation: PaymentValidationOk };
  } = {},
): Promise<ApplyResult> {
  const service = createSupabaseServiceClient();
  const nowMs = ctx.nowMs ?? Date.now();
  const subBefore =
    opts.precomputed?.subBefore ?? (await readSubRow(service, ctx.userId));
  const validation =
    opts.precomputed?.validation ??
    validatePaymentForApply(pay, {
      userId: ctx.userId,
      watermarkMs: ctx.watermarkMs,
      localPreapprovalId: subBefore?.preapproval_id ?? null,
      ignorePreapprovalMismatch: true, // el dinero viejo también se audita
    });

  if (!validation.ok) {
    console.log(
      '[mp apply refund skipped]',
      JSON.stringify({
        payment: pay.id,
        user: ctx.userId,
        source: ctx.source,
        reason: validation.reason,
      }),
    );
    return { action: 'skipped', mpPaymentId: pay.id, reason: validation.reason };
  }

  const { normalized, amount, refundedAmount, statusDetail, occurredMs } = validation;
  if (!isRefundLikeStatus(normalized)) {
    return { action: 'skipped', mpPaymentId: pay.id, reason: 'unsupported_status' };
  }
  const refundStatus: RefundLikeStatus = normalized;
  const kind: 'refund' | 'chargeback' =
    opts.forceKind === 'chargeback' || refundStatus === 'charged_back'
      ? 'chargeback'
      : 'refund';
  const rawStatus = opts.rawStatus ?? statusDetail ?? pay.status;
  const chargeMs = isoToMs(pay.dateApproved) ?? isoToMs(pay.dateCreated) ?? occurredMs;

  /* 1) ¿El pago financió el ciclo vigente? Se consulta ANTES de actualizar el
   * pago: un parcial sigue siendo el pago del ciclo (approved/partially). */
  const lastFunding = await service
    .from('payments')
    .select('mp_payment_id')
    .eq('user_id', ctx.userId)
    .in('status', ['approved', 'partially_refunded'])
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ mp_payment_id: number | string }>();
  const lastApprovedPaymentId = lastFunding.data
    ? Number(lastFunding.data.mp_payment_id)
    : null;
  const currentCycle = isCurrentCyclePayment({
    affectedPaymentId: pay.id,
    lastApprovedPaymentId,
  });

  /* 2) Fila del pago: insert si no existe; merge monótono si existe. */
  let existing = await readLocalPayment(service, ctx.userId, pay.id);
  let inserted = false;
  if (!existing) {
    const ins = await service
      .from('payments')
      .insert({
        user_id: ctx.userId,
        mp_payment_id: pay.id,
        amount,
        status: refundStatus,
        refunded_amount: refundedAmount,
        status_detail: statusDetail,
        // `occurred_at` conserva la fecha del COBRO (no la del reembolso).
        occurred_at: new Date(chargeMs).toISOString(),
        receipt_url: pay.receiptUrl,
        source: ctx.source,
      })
      .select('id, mp_payment_id, amount, status, refunded_amount, occurred_at, applied_at')
      .maybeSingle<LocalPaymentRow>();
    if (ins.error) {
      const code = (ins.error as { code?: string }).code;
      if (code === '23505') {
        existing = await readLocalPayment(service, ctx.userId, pay.id);
        if (!existing) {
          // El UNIQUE global encontró una fila de OTRO usuario: no se toca.
          console.error('[mp apply refund] dedupe sin fila del usuario — ignorado:', pay.id);
          return {
            action: 'skipped',
            mpPaymentId: pay.id,
            reason: 'payment_owner_mismatch',
          };
        }
      } else if (code === '23503') {
        console.error('[mp apply refund] usuario eliminado — ignorado:', pay.id);
        return { action: 'skipped', mpPaymentId: pay.id, reason: 'user_not_found' };
      } else {
        console.error('[mp apply refund insert]:', ins.error.message);
        return {
          action: 'error',
          mpPaymentId: pay.id,
          reason: 'payments_insert_failed',
        };
      }
    } else {
      inserted = true;
      existing = ins.data as LocalPaymentRow;
    }
  }

  const beforeStatus = existing.status;
  const beforeRefunded = Number(existing.refunded_amount ?? 0);
  const mergedStatus = mergeRefundStatus(beforeStatus, refundStatus);
  const mergedRefunded = Math.max(beforeRefunded, refundedAmount);
  const detailChanged =
    statusDetail != null &&
    (statusDetail !== beforeStatus || statusDetail !== pay.status);

  if (mergedStatus !== beforeStatus || mergedRefunded !== beforeRefunded || detailChanged) {
    const cas = await service
      .from('payments')
      .update({
        status: mergedStatus,
        refunded_amount: mergedRefunded,
        status_detail: statusDetail,
        updated_at: new Date(nowMs).toISOString(),
      })
      .eq('user_id', ctx.userId)
      .eq('mp_payment_id', pay.id)
      .eq('status', beforeStatus)
      .select('id');
    if (cas.error) {
      console.error('[mp apply refund update]:', cas.error.message);
      return { action: 'error', mpPaymentId: pay.id, reason: 'payments_update_failed' };
    }
    if (!cas.data || cas.data.length === 0) {
      const after = await readLocalPayment(service, ctx.userId, pay.id);
      if (
        !after ||
        after.status !== mergedStatus ||
        Number(after.refunded_amount ?? 0) !== mergedRefunded
      ) {
        console.error('[mp apply refund] CAS perdido — queda para el próximo sync');
        return {
          action: 'skipped',
          mpPaymentId: pay.id,
          reason: 'cas_lost',
        };
      }
    }
  }

  /* 3) Auditoría append-only: una fila por refund id de MP o una fila por
   * evento sin id (dedupe por occurred_at, §6). */
  const occurredIso = new Date(occurredMs).toISOString();
  let newAdjustments = 0;

  if (kind === 'chargeback') {
    if (
      await insertAdjustment(service, {
        userId: ctx.userId,
        mpPaymentId: pay.id,
        kind: 'chargeback',
        sourceId: opts.sourceId ?? null,
        amount: mergedRefunded,
        rawStatus,
        occurredMs,
      })
    ) {
      newAdjustments++;
    }
  } else {
    const refunds = pay.refunds ?? [];
    if (refunds.length > 0) {
      let listed = 0;
      for (const refund of refunds) {
        listed += refund.amount ?? 0;
        const refundMs = isoToMs(refund.dateCreated) ?? occurredMs;
        if (
          await insertAdjustment(service, {
            userId: ctx.userId,
            mpPaymentId: pay.id,
            kind: 'refund',
            sourceId: refund.id,
            amount: refund.amount ?? 0,
            rawStatus,
            occurredMs: refundMs,
          })
        ) {
          newAdjustments++;
        }
      }
      // Total acumulado mayor a la suma listada (p. ej. parciales previos):
      // se registra el delta sin id para no perder dinero en el historial.
      const delta = mergedRefunded - listed;
      if (delta > 0.009) {
        if (
          await insertAdjustment(service, {
            userId: ctx.userId,
            mpPaymentId: pay.id,
            kind: 'refund',
            sourceId: null,
            amount: delta,
            rawStatus,
            occurredMs,
          })
        ) {
          newAdjustments++;
        }
      }
    } else {
      const delta = Math.max(0, mergedRefunded - beforeRefunded);
      if (
        await insertAdjustment(service, {
          userId: ctx.userId,
          mpPaymentId: pay.id,
          kind: 'refund',
          sourceId: null,
          amount: delta,
          rawStatus,
          occurredMs,
        })
      ) {
        newAdjustments++;
      }
    }
  }

  /* 4) Impacto en el ciclo. */
  const impactKind =
    kind === 'chargeback'
      ? 'chargeback'
      : refundImpactKindFor({
          status: mergedStatus,
          amount,
          refundedAmount: mergedRefunded,
        });
  const impact = decideRefundImpact({
    kind: impactKind,
    currentCycle,
    subscriptionStatus: subBefore?.status ?? 'inactiva',
  });

  let statusAfter: SubscriptionStatus = subBefore?.status ?? 'inactiva';
  let planAfter: Plan = subBefore
    ? resolvePlan(
        {
          status: subBefore.status,
          graceExpiresAtMs: isoToMs(subBefore.grace_expires_at),
          periodEndMs: isoToMs(subBefore.period_end),
        },
        nowMs,
      )
    : 'free';
  let planTouched = false;

  if (impact === 'revoke') {
    const event =
      impactKind === 'chargeback'
        ? ({ kind: 'contracargo', occurredAtMs: occurredMs } as const)
        : ({ kind: 'reembolso_total', occurredAtMs: occurredMs } as const);

    if (subBefore) {
      const patch = transitionSubscription(subBefore.status, event);
      if (patch) {
        const cas = await service
          .from('subscriptions')
          .update({
            status: patch.status,
            grace_expires_at: null,
            closure_reason: patch.closureReason ?? null,
            closed_at: patch.closedAtMs
              ? new Date(patch.closedAtMs).toISOString()
              : null,
          })
          .eq('user_id', ctx.userId)
          .eq('status', subBefore.status)
          .select('status');
        if (cas.error) {
          console.error('[mp apply refund sub update]:', cas.error.message);
          return {
            action: 'error',
            mpPaymentId: pay.id,
            reason: 'subscription_update_failed',
          };
        }
        if (!cas.data || cas.data.length === 0) {
          const after = await readSubRow(service, ctx.userId);
          if (after?.status !== 'revocada') {
            console.error('[mp apply refund] CAS de revocación perdido');
            return {
              action: 'skipped',
              mpPaymentId: pay.id,
              reason: 'cas_lost',
              statusAfter: after?.status,
            };
          }
        }
        statusAfter = 'revocada';
        planAfter = 'free';
        planTouched = true;

        const usersRes = await service
          .from('users')
          .update({ plan: 'free', grace_expires_at: null })
          .eq('id', ctx.userId);
        if (usersRes.error) {
          console.error('[mp apply refund users update]:', usersRes.error.message);
          return {
            action: 'error',
            mpPaymentId: pay.id,
            reason: 'users_update_failed',
          };
        }

        /* Q6: el preapproval viejo no debe volver a cobrar. Si MP falla, la
         * suscripción ya quedó revocada: se alerta y NO hay loop de reintentos. */
        const preapprovalId = subBefore.preapproval_id ?? pay.preapprovalId;
        if (preapprovalId) {
          const cancelled = await cancelPreapproval(preapprovalId);
          if (!cancelled.ok) {
            console.error(
              '[mp apply refund] preapproval no cancelado:',
              preapprovalId,
              cancelled.status,
              cancelled.message,
            );
            await sendPaymentAlert({
              userId: ctx.userId,
              mpPaymentId: pay.id,
              kind: impactKind === 'chargeback' ? 'chargeback' : 'refund_total',
              amountArs: amount,
              refundedArs: mergedRefunded,
              impact: 'revoke',
              sourceId: opts.sourceId ?? null,
              note: `preapproval ${preapprovalId} no se pudo cancelar en MP (${cancelled.message}); revisar a mano`,
              timeoutMs:
                ctx.deadlineMs != null
                  ? Math.max(1_000, Math.min(15_000, ctx.deadlineMs - Date.now()))
                  : undefined,
            });
          }
        }
      }
    }
  }

  /* 5) applied_at: deja el pago "foldido" para que un approved posterior del
   * preapproval viejo no lo repare ni active PRO (carrera §6). */
  const applied = await service
    .from('payments')
    .update({ applied_at: new Date(nowMs).toISOString() })
    .eq('user_id', ctx.userId)
    .eq('mp_payment_id', pay.id)
    .is('applied_at', null);
  if (applied.error) console.error('[mp apply refund applied_at]:', applied.error.message);

  /* 6) Emails: SOLO con novedad nueva. Un reintento no reenvía (R11.9). */
  let email: ApplyEmailOutcome = 'skipped';
  if (newAdjustments > 0) {
    const to = await mailTo(service, ctx.userId);
    if (to && impact !== 'audit') {
      const cycleEndMs =
        isoToMs(subBefore?.period_end ?? null) ??
        (subBefore?.cycle_anchor
          ? nextCycleDateMs(
              cycleAnchorDayOfStr(subBefore.cycle_anchor) ?? 1,
              occurredMs,
            )
          : null);
      const content =
        impact === 'partial_keep'
          ? mailRefundPartial({
              to,
              amountArs: amount,
              refundedArs: mergedRefunded,
              cycleEndMs,
            })
          : impactKind === 'chargeback'
            ? mailChargeback({
                to,
                amountArs: amount,
                occurredAtMs: occurredMs,
                supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null,
              })
            : mailRefundTotal({
                to,
                amountArs: amount,
                refundedArs: mergedRefunded,
                occurredAtMs: occurredMs,
              });
      const sent = await sendMail(content, {
        timeoutMs:
          ctx.deadlineMs != null
            ? Math.max(1_000, Math.min(15_000, ctx.deadlineMs - Date.now()))
            : undefined,
      });
      email = sent.sent ? 'sent' : sent.note === 'env-no-configurado' ? 'no_env' : 'failed';
    }

    await sendPaymentAlert({
      userId: ctx.userId,
      mpPaymentId: pay.id,
      kind:
        impactKind === 'chargeback'
          ? 'chargeback'
          : impactKind === 'refund_total'
            ? 'refund_total'
            : 'refund_partial',
      amountArs: amount,
      refundedArs: mergedRefunded,
      impact,
      sourceId: opts.sourceId ?? null,
      note: impact === 'audit' ? 'ciclo pasado o suscripción no viva: solo auditoría' : null,
      timeoutMs:
        ctx.deadlineMs != null
          ? Math.max(1_000, Math.min(15_000, ctx.deadlineMs - Date.now()))
          : undefined,
    });
  }

  return {
    action:
      newAdjustments > 0 || inserted || planTouched ? 'adjusted' : 'already_applied',
    mpPaymentId: pay.id,
    reason: impact === 'audit' ? 'refund_audit_only' : undefined,
    statusAfter,
    planAfter,
    receiptUrl: pay.receiptUrl,
    email,
    adjustmentKind: kind,
  };
}

/* -------------------------------------------------------------------------- */
/* applyChargeback — topic de contracargos (R11.1/R11.6)                      */
/* -------------------------------------------------------------------------- */

/**
 * Fold de un contracargo traído por `GET /v1/chargebacks/{id}`. El pago
 * asociado se pullea aparte (autoritativo) y se usa para montos/fechas. Un
 * reverso/ganado NO reactiva el plan (Q5): registra `reversal` y alerta al
 * titular para que decida a mano.
 */
export async function applyChargeback(
  cb: MpChargebackFull,
  payment: MpPaymentFull | null,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const service = createSupabaseServiceClient();
  const nowMs = ctx.nowMs ?? Date.now();
  const paymentId = cb.paymentId ?? payment?.id ?? null;
  if (paymentId == null) {
    console.error('[mp chargeback] sin pago asociado — ignorado con log:', cb.id);
    return { action: 'skipped', mpPaymentId: 0, reason: 'no_payment' };
  }

  const occurredMs =
    isoToMs(cb.dateLastUpdated) ??
    isoToMs(cb.dateCreated) ??
    isoToMs(payment?.dateLastUpdated ?? null) ??
    nowMs;

  if (isChargebackReversal(cb.status)) {
    const inserted = await insertAdjustment(service, {
      userId: ctx.userId,
      mpPaymentId: paymentId,
      kind: 'reversal',
      sourceId: cb.id,
      amount: cb.amount ?? payment?.transactionAmount ?? 0,
      rawStatus: cb.status,
      occurredMs,
    });
    if (inserted) {
      await sendPaymentAlert({
        userId: ctx.userId,
        mpPaymentId: paymentId,
        kind: 'chargeback_reversal',
        amountArs: payment?.transactionAmount ?? cb.amount ?? 0,
        refundedArs: 0,
        impact: 'manual_reactivation',
        sourceId: cb.id,
        note: 'contracargo revertido/ganado: el plan queda FREE hasta reactivación manual (Q5)',
      });
    }
    return {
      action: inserted ? 'adjusted' : 'already_applied',
      mpPaymentId: paymentId,
      reason: 'chargeback_reversal',
      adjustmentKind: 'reversal',
      receiptUrl: payment?.receiptUrl ?? null,
    };
  }

  const amount = payment?.transactionAmount ?? cb.amount;
  const synthetic: MpPaymentFull = {
    id: paymentId,
    status: 'charged_back',
    statusDetail: cb.status,
    externalReference: payment?.externalReference ?? cb.externalReference,
    transactionAmount: amount,
    transactionAmountRefunded: amount,
    refunds: [],
    receiptUrl: payment?.receiptUrl ?? null,
    dateApproved: payment?.dateApproved ?? null,
    dateLastUpdated: cb.dateLastUpdated ?? payment?.dateLastUpdated ?? null,
    dateCreated: payment?.dateCreated ?? cb.dateCreated ?? null,
    currencyId: payment?.currencyId ?? cb.currencyId,
    preapprovalId: payment?.preapprovalId ?? null,
    payerEmail: payment?.payerEmail ?? null,
  };

  return applyRefundEvent(synthetic, ctx, {
    sourceId: cb.id,
    forceKind: 'chargeback',
    rawStatus: cb.status,
  });
}

/* -------------------------------------------------------------------------- */
/* applyPayment — el corazón compartido                                       */
/* -------------------------------------------------------------------------- */

export async function applyPayment(
  pay: MpPaymentFull,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const service = createSupabaseServiceClient();
  const nowMs = ctx.nowMs ?? Date.now();

  const subBefore = await readSubRow(service, ctx.userId);
  const validation = validatePaymentForApply(pay, {
    userId: ctx.userId,
    watermarkMs: ctx.watermarkMs,
    localPreapprovalId: subBefore?.preapproval_id ?? null,
  });

  if (!validation.ok) {
    console.log(
      '[mp apply skipped]',
      JSON.stringify({
        payment: pay.id,
        user: ctx.userId,
        source: ctx.source,
        reason: validation.reason,
      }),
    );
    return { action: 'skipped', mpPaymentId: pay.id, reason: validation.reason };
  }

  /* Posición 13: refunded/partially_refunded/charged_back tienen su propio
   * fold (pago + auditoría + revocación). Nunca pasan por el alta del ciclo. */
  if (isRefundLikeStatus(validation.normalized)) {
    return applyRefundEvent(pay, ctx, {
      precomputed: { subBefore, validation },
    });
  }

  const { normalized, amount, occurredMs, old } = validation;

  /* 1) INSERT idempotente — dedupe mp_payment_id UNIQUE (R7/R12.6). */
  const inserted = await service
    .from('payments')
    .insert({
      user_id: ctx.userId,
      mp_payment_id: pay.id,
      amount,
      status: normalized,
      occurred_at: new Date(occurredMs).toISOString(),
      receipt_url: pay.receiptUrl,
      source: ctx.source,
    })
    .select('id');

  let isNew = false;
  if (inserted.error) {
    const code = (inserted.error as { code?: string }).code;
    if (code !== '23505') {
      console.error('[mp apply payments insert]:', inserted.error.message);
      return { action: 'error', mpPaymentId: pay.id, reason: 'payments_insert_failed' };
    }
  } else {
    isNew = true;
  }

  /* 2) Pago anterior al último checkout: se audita, NO muta (R12.4). */
  if (old) {
    if (isNew) {
      console.log(
        '[mp apply old_payment_ignored]',
        JSON.stringify({ payment: pay.id, user: ctx.userId, source: ctx.source }),
      );
    }
    return {
      action: 'audited',
      mpPaymentId: pay.id,
      reason: 'old_payment_ignored',
      receiptUrl: pay.receiptUrl,
    };
  }

  /* 3) Ya aplicado ⇒ no se re-aplica. applied_at NULL ⇒ reparar (R12.6). */
  if (!isNew) {
    const existing = await service
      .from('payments')
      .select('status, applied_at')
      .eq('user_id', ctx.userId)
      .eq('mp_payment_id', pay.id)
      .maybeSingle<{ status: string; applied_at: string | null }>();
    if (existing.error) {
      console.error('[mp apply payments read]:', existing.error.message);
      return { action: 'error', mpPaymentId: pay.id, reason: 'payments_read_failed' };
    }
    const decision = existing.data ? decideExistingPayment(existing.data) : null;
    if (!decision) {
      // El UNIQUE global encontró una fila que no es de este usuario. No se
      // muta nada: el pago ajeno jamás activa el ciclo de otro (R12.1).
      console.error('[mp apply] dedupe sin fila del usuario — ignorado:', pay.id);
      return {
        action: 'skipped',
        mpPaymentId: pay.id,
        reason: 'payment_owner_mismatch',
      };
    }
    if (decision.action === 'already_applied') {
      return {
        action: 'already_applied',
        mpPaymentId: pay.id,
        receiptUrl: pay.receiptUrl,
      };
    }
    if (decision?.action === 'ignore_status') {
      // refunded/charged_back pertenecen a R11: no se tocan acá.
      return {
        action: 'skipped',
        mpPaymentId: pay.id,
        reason: 'local_status_unsupported',
      };
    }
  }

  /* Carrera refund/approved (§6/QA5): si el reembolso ya escribió el pago
   * como refunded/charged_back, el approved NUNCA activa PRO. */
  if (normalized === 'approved') {
    const guard = await readLocalPayment(service, ctx.userId, pay.id);
    if (guard && isRefundLikeStatus(guard.status)) {
      console.log(
        '[mp apply refund_wins]',
        JSON.stringify({ payment: pay.id, user: ctx.userId, status: guard.status }),
      );
      return {
        action: 'skipped',
        mpPaymentId: pay.id,
        reason: 'refund_wins',
        statusAfter: subBefore?.status,
      };
    }
  }

  /* 4) Transición del ciclo con la MISMA máquina del webhook (R1/R4/R8/R9). */
  const sub = subBefore ?? (await readSubRow(service, ctx.userId));
  const current: SubscriptionStatus = sub?.status ?? 'inactiva';
  const event =
    normalized === 'approved'
      ? ({ kind: 'cobro_aprobado' } as const)
      : ({ kind: 'cobro_rechazado', rejectedAtMs: occurredMs } as const);
  const patch = transitionSubscription(current, event);

  let statusAfter: SubscriptionStatus = current;
  let planAfter: Plan = sub
    ? resolvePlan(
        {
          status: sub.status,
          graceExpiresAtMs: isoToMs(sub.grace_expires_at),
          periodEndMs: isoToMs(sub.period_end),
        },
        nowMs,
      )
    : 'free';

  if (patch) {
    const approvalMs = isoToMs(pay.dateApproved) ?? occurredMs;
    const updatePayload: Record<string, unknown> = { status: patch.status };
    if (patch.graceExpiresAtMs !== undefined) {
      updatePayload.grace_expires_at =
        patch.graceExpiresAtMs == null ? null : new Date(patch.graceExpiresAtMs).toISOString();
    }
    if (patch.periodEndMs !== undefined) {
      updatePayload.period_end =
        patch.periodEndMs == null ? null : new Date(patch.periodEndMs).toISOString();
    }
    if (patch.freezePrice) {
      updatePayload.price_frozen = amount;
      const anchor = arDateStrFromMs(approvalMs);
      if (anchor) updatePayload.cycle_anchor = anchor;
    }
    if (pay.preapprovalId && (!sub?.preapproval_id || patch.freezePrice)) {
      updatePayload.preapproval_id = pay.preapprovalId;
    }

    if (sub) {
      const cas = await service
        .from('subscriptions')
        .update(updatePayload)
        .eq('user_id', ctx.userId)
        .eq('status', current)
        .select('status');
      if (cas.error) {
        console.error('[mp apply sub update]:', cas.error.message);
        return { action: 'error', mpPaymentId: pay.id, reason: 'subscription_update_failed' };
      }
      if (!cas.data || cas.data.length === 0) {
        // Compare-and-set perdido: si otro proceso ya dejó el target, seguimos.
        const after = await readSubRow(service, ctx.userId);
        if (after?.status !== patch.status) {
          console.error('[mp apply] CAS perdido — queda para el próximo sync');
          return {
            action: 'skipped',
            mpPaymentId: pay.id,
            reason: 'cas_lost',
            statusAfter: after?.status,
          };
        }
      }
      statusAfter = patch.status;
    } else if (patch.status === 'activa') {
      // Seed perdido (raro): crear la fila con el target, igual que el webhook 10B.
      const created = await service.from('subscriptions').insert({
        user_id: ctx.userId,
        preapproval_id: pay.preapprovalId,
        status: 'activa',
        price_frozen: amount,
        currency: 'ARS',
        cycle_anchor: arDateStrFromMs(approvalMs),
      });
      if (created.error) {
        const code = (created.error as { code?: string }).code;
        if (code === '23505') {
          const after = await readSubRow(service, ctx.userId);
          if (after?.status !== 'activa') {
            return {
              action: 'skipped',
              mpPaymentId: pay.id,
              reason: 'cas_lost',
              statusAfter: after?.status,
            };
          }
        } else {
          console.error('[mp apply sub autoheal]:', created.error.message);
          return {
            action: 'error',
            mpPaymentId: pay.id,
            reason: 'subscription_insert_failed',
          };
        }
      }
      statusAfter = 'activa';
    } else {
      // Rechazo sin fila: no se inventa un ciclo; el pago queda registrado.
      statusAfter = current;
    }

    /* 5) users.plan — fuente del gating; el UPDATE dispara Realtime. */
    planAfter = resolvePlan(
      {
        status: patch.status,
        graceExpiresAtMs: patch.graceExpiresAtMs ?? null,
        periodEndMs: patch.periodEndMs ?? null,
      },
      nowMs,
    );
    const userUpdate: Record<string, unknown> = { plan: planAfter };
    userUpdate.grace_expires_at =
      patch.status === 'gracia' && patch.graceExpiresAtMs != null
        ? new Date(patch.graceExpiresAtMs).toISOString()
        : null;
    if (pay.preapprovalId) userUpdate.mp_preapproval_id = pay.preapprovalId;

    const usersRes = await service.from('users').update(userUpdate).eq('id', ctx.userId);
    if (usersRes.error) {
      console.error('[mp apply users update]:', usersRes.error.message);
      // La fila de dinero ya está; applied_at queda NULL y el sync repara.
      return { action: 'error', mpPaymentId: pay.id, reason: 'users_update_failed' };
    }
  }

  /* 6) applied_at SOLO con ciclo + plan consistentes (R12.6). */
  const applied = await service
    .from('payments')
    .update({ applied_at: new Date(nowMs).toISOString() })
    .eq('user_id', ctx.userId)
    .eq('mp_payment_id', pay.id)
    .is('applied_at', null)
    .select('id');
  if (applied.error) {
    console.error('[mp apply applied_at]:', applied.error.message);
    return { action: 'error', mpPaymentId: pay.id, reason: 'applied_at_failed' };
  }

  /* 7) Email por pago (recibo/gracia) con claim atómico (R12.7). */
  const email = await sendPaymentEmail(service, {
    mpPaymentId: pay.id,
    userId: ctx.userId,
    status: normalized,
    amount,
    occurredMs,
    receiptUrl: pay.receiptUrl,
    graceExpiresAtMs: patch?.graceExpiresAtMs ?? null,
    timeoutMs:
      ctx.deadlineMs != null
        ? Math.max(1_000, Math.min(15_000, ctx.deadlineMs - Date.now()))
        : undefined,
  });

  return {
    action: isNew ? 'inserted' : 'repaired',
    mpPaymentId: pay.id,
    statusAfter,
    planAfter,
    receiptUrl: pay.receiptUrl,
    email,
  };
}

/* -------------------------------------------------------------------------- */
/* applyPreapproval — cancelación/pausa (R9/R12.8)                            */
/* -------------------------------------------------------------------------- */

/**
 * cancelled/paused ⇒ cierre programado con el period_end de la máquina R9.
 * El email de cierre se envía SOLO si el CAS gana (webhook y sync no duplican).
 */
export async function applyPreapproval(
  pre: MpPreapprovalFull,
  ctx: { userId: string; source: ApplySource; deadlineMs?: number; suppressEmail?: boolean },
): Promise<PreapprovalApplyResult> {
  if (pre.status !== 'cancelled' && pre.status !== 'paused') {
    return { action: 'ignored' };
  }

  const service = createSupabaseServiceClient();
  const sub = await readSubRow(service, ctx.userId);
  const current: SubscriptionStatus = sub?.status ?? 'inactiva';
  const grMs = isoToMs(sub?.grace_expires_at ?? null);
  const anchorDay = sub?.cycle_anchor ? cycleAnchorDayOfStr(sub.cycle_anchor) : null;
  const periodEndMs =
    cancelationPeriodEndMs(current, {
      graceExpiresAtMs: grMs,
      anchorDay,
      nowMs: Date.now(),
    }) ?? Date.now();

  const patch = transitionSubscription(current, {
    kind: 'cancelacion_programada',
    periodEndMs,
  });
  if (!patch) return { action: 'ignored' };

  if (sub) {
    const cas = await service
      .from('subscriptions')
      .update({
        status: patch.status,
        period_end: new Date(periodEndMs).toISOString(),
        grace_expires_at: null,
      })
      .eq('user_id', ctx.userId)
      .eq('status', current)
      .select('status');
    if (cas.error) {
      console.error('[mp apply preapproval update]:', cas.error.message);
      return { action: 'error' };
    }
    if (!cas.data || cas.data.length === 0) {
      // Otro proceso ya programó el cierre: no se duplica el email.
      return { action: 'ignored' };
    }
  } else {
    const created = await service.from('subscriptions').insert({
      user_id: ctx.userId,
      preapproval_id: pre.id,
      status: patch.status,
      price_frozen: 0,
      currency: 'ARS',
      period_end: new Date(periodEndMs).toISOString(),
    });
    if (created.error) {
      const code = (created.error as { code?: string }).code;
      if (code === '23505') return { action: 'ignored' };
      console.error('[mp apply preapproval insert]:', created.error.message);
      return { action: 'error' };
    }
  }

  const plan = resolvePlan(
    { status: patch.status, graceExpiresAtMs: null, periodEndMs },
    Date.now(),
  );
  const userUpdate: Record<string, unknown> = { plan, grace_expires_at: null };
  if (sub?.preapproval_id !== pre.id) userUpdate.mp_preapproval_id = pre.id;
  const usersRes = await service.from('users').update(userUpdate).eq('id', ctx.userId);
  if (usersRes.error) console.error('[mp apply preapproval users]:', usersRes.error.message);

  const to = await mailTo(service, ctx.userId);
  if (to && !ctx.suppressEmail) {
    await sendMail(mailScheduledClose({ to, periodEndMs }), {
      timeoutMs:
        ctx.deadlineMs != null
          ? Math.max(1_000, Math.min(15_000, ctx.deadlineMs - Date.now()))
          : undefined,
    });
  }

  console.log(
    '[mp preapproval QA registro]',
    JSON.stringify({
      user: ctx.userId,
      source: ctx.source,
      mpStatus: pre.status,
      patch: patch.status,
      period_end: periodEndMs,
    }),
  );
  return { action: 'closed', periodEndMs };
}
