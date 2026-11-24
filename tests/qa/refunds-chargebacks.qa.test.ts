import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyChargeback, applyPayment } from '@/lib/payments/apply';
import { DAY_MS } from '@/lib/payments/core';
import { getPayment, type MpChargebackFull, type MpPaymentFull } from '@/lib/payments/mercadopago';
import { syncUserCycle } from '@/lib/payments/sync';
import { sendMail } from '@/lib/payments/mail';
import {
  KHER_EMAIL,
  KHER_PASSWORD,
  KHER_USER_ID,
  OTHER_USER_ID,
  QA_ORIGIN,
  SEED_PAYMENTS,
  TEST_PAYER_EMAIL,
  TEST_PAYER_PASSWORD,
  cancelTestPreapproval,
  cancelTestPreapprovalPlan,
  captureResend,
  createTestPreapproval,
  loginCookie,
  mpPayment,
  preapprovalStatus,
  readAdjustments,
  readPayments,
  readSubscription,
  readUser,
  serviceClient,
  signedWebhookHeaders,
  startNextServer,
  type CapturedEmail,
  type NextServer,
  type ResendCapture,
} from './helpers';

/* ============================================================================
 * QA DE INTEGRACIÓN — POSICIÓN 13 (reembolsos y contracargos)
 * ----------------------------------------------------------------------------
 * Qué prueba DE VERDAD (no mocks de DB):
 *   · fold real de reembolsos totales/parciales en Supabase (payments,
 *     subscriptions, users, adjustments) con eventos que replican el payload
 *     de MP. Los pagos semilla son `live_mode: true` (cobros REALES): este QA
 *     JAMÁS les pega al endpoint de refunds;
 *   · sync real por /v1/payments/search + pull (verifica que un `approved`
 *     real de MP no revierte el reembolso local);
 *   · cancelación REAL del preapproval en MP;
 *   · contracargo/reverso simulados (MP no permite crearlos) con fold real;
 *   · constraints/RLS/grants de 0009;
 *   · webhook HTTP firmado contra el Next real;
 *   · UI /perfil y checkout de reactivación por HTTP con sesión real.
 *
 * NO se pueden crear contracargos reales: MP solo los recibe del emisor. Se
 * usa el mismo `applyChargeback` con un recurso sintético y un pago REAL.
 * ========================================================================== */

const BASE_URL = 'http://127.0.0.1:3100';
const NOW = Date.now();

interface Snapshot {
  user: Record<string, unknown> | null;
  sub: Record<string, unknown> | null;
  payments: Array<Record<string, unknown>>;
}

let service: SupabaseClient;
let server: NextServer;
let cookie = '';
let capture: ResendCapture;
let snapshot: Snapshot;
let qaUserId: string | null = null;
/** Id del refund parcial del escenario 1, reutilizado por el total del 3. */
let partialRefundSourceId = '';
/** Evento total del escenario 3, reutilizado por el reintento del 5. */
let totalRefundEvent: MpPaymentFull | null = null;
const createdPreapprovals: string[] = [];
const createdPlans: string[] = [];
const extraPaymentIds = new Set<number>();

function ok<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

async function seedSubscription(input: {
  preapprovalId: string;
  status: 'activa' | 'revocada';
  plan: 'pro' | 'free';
  closureReason?: 'refund' | 'chargeback' | null;
}): Promise<void> {
  const now = Date.now();
  const { error } = await service.from('subscriptions').upsert(
    {
      user_id: KHER_USER_ID,
      preapproval_id: input.preapprovalId,
      status: input.status,
      price_frozen: 20000,
      currency: 'ARS',
      cycle_anchor: new Date(now).toISOString().slice(0, 10),
      period_end: new Date(now + 30 * DAY_MS).toISOString(),
      grace_expires_at: null,
      last_checkout_at: new Date(now).toISOString(),
      last_synced_at: new Date(now).toISOString(),
      closure_reason: input.closureReason ?? null,
      closed_at: input.status === 'revocada' ? new Date(now).toISOString() : null,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`seedSubscription: ${error.message}`);

  const user = await service
    .from('users')
    .update({
      plan: input.plan,
      grace_expires_at: null,
      mp_preapproval_id: input.preapprovalId,
    })
    .eq('id', KHER_USER_ID);
  if (user.error) throw new Error(`seedSubscription users: ${user.error.message}`);
}

async function setLeaseAgo(userId: string, ms = 60_000): Promise<void> {
  const { error } = await service
    .from('subscriptions')
    .update({ last_synced_at: new Date(Date.now() - ms).toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error(`setLeaseAgo: ${error.message}`);
}

async function syncNow(): Promise<Awaited<ReturnType<typeof syncUserCycle>>> {
  await setLeaseAgo(KHER_USER_ID);
  return syncUserCycle(KHER_USER_ID, {
    trigger: 'manual',
    force: true,
    budgetMs: 45_000,
  });
}

async function ui(path: string): Promise<{ status: number; html: string; location: string | null }> {
  // El perfil sincroniza on-read; con lease fresco no vuelve a pegarle a MP.
  const sub = await readSubscription(service, KHER_USER_ID);
  if (sub) {
    await service
      .from('subscriptions')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', KHER_USER_ID);
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  return {
    status: res.status,
    html: await res.text(),
    location: res.headers.get('location'),
  };
}

function customerEmails(to = KHER_EMAIL): CapturedEmail[] {
  return capture.emails.filter((email) => email.to.includes(to));
}

function alertEmails(): CapturedEmail[] {
  return capture.emails.filter((email) => email.subject.startsWith('[PAGOS]'));
}

function subjectList(): string[] {
  return capture.emails.map((email) => email.subject);
}

async function cleanupExtraPayment(mpPaymentId: number): Promise<void> {
  await service
    .from('payment_adjustments')
    .delete()
    .eq('user_id', KHER_USER_ID)
    .eq('mp_payment_id', mpPaymentId);
  await service
    .from('payments')
    .delete()
    .eq('user_id', KHER_USER_ID)
    .eq('mp_payment_id', mpPaymentId);
  extraPaymentIds.delete(mpPaymentId);
}

/**
 * Evento de reembolso con la MISMA forma que MP entrega en `GET /v1/payments`
 * (status refunded/partially_refunded + transaction_amount_refunded + refunds).
 * Se construye sobre un pago REAL para conservar montos, fechas y
 * external_reference. NO se llama al endpoint de refunds: los pagos semilla
 * son live_mode=true y reembolsarlos movería dinero real.
 */
async function syntheticRefund(
  paymentId: number,
  input: {
    status: 'partially_refunded' | 'refunded';
    refundedAmount: number;
    refunds: Array<{ id: string; amount: number }>;
  },
): Promise<MpPaymentFull> {
  const real = await getPayment(String(paymentId));
  if (!real.ok) throw new Error(`getPayment ${paymentId}: ${real.status} ${real.message}`);
  const nowIso = new Date().toISOString();
  return {
    ...real.data,
    status: input.status,
    statusDetail: input.status,
    transactionAmountRefunded: input.refundedAmount,
    refunds: input.refunds.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      dateCreated: nowIso,
    })),
    dateLastUpdated: nowIso,
  };
}

beforeAll(async () => {
  service = serviceClient();

  snapshot = {
    user: await readUser(service, KHER_USER_ID),
    sub: await readSubscription(service, KHER_USER_ID),
    payments: await readPayments(service, KHER_USER_ID),
  };

  const seedIds = new Set<number>(Object.values(SEED_PAYMENTS));
  const present = new Set(snapshot.payments.map((row) => Number(row.mp_payment_id)));
  for (const id of seedIds) {
    if (!present.has(id)) {
      throw new Error(
        `Falta el pago semilla ${id} en payments. Este QA necesita los 4 pagos TEST de kherrera.`,
      );
    }
  }

  // Los 3 aprobados deben seguir aprobados en MP. OJO: son `live_mode: true`
  // (cobros reales) — se usan SOLO como fuente de datos y para pulls GET; el
  // QA no llama al endpoint de refunds.
  for (const id of [SEED_PAYMENTS.current, SEED_PAYMENTS.partial, SEED_PAYMENTS.past]) {
    const pay = await mpPayment(id);
    if (pay.status !== 'approved' || Number(pay.transaction_amount_refunded ?? 0) !== 0) {
      throw new Error(
        `El pago semilla ${id} ya no está aprobado/limpio en MP (status=${pay.status}, refunded=${pay.transaction_amount_refunded}). ` +
          'El QA lo usa SOLO como fuente de datos (no lo reembolsa): restaurá el pago en MP o actualizá SEED_PAYMENTS.',
      );
    }
  }

  // Fixtures deterministas: el orden del ciclo lo fija occurred_at, no MP.
  const now = Date.now();
  const seeds = [
    { id: SEED_PAYMENTS.current, status: 'approved', at: now - 60 * 60_000, detail: 'accredited' },
    { id: SEED_PAYMENTS.partial, status: 'approved', at: now - 25 * 60 * 60_000, detail: 'accredited' },
    { id: SEED_PAYMENTS.past, status: 'approved', at: now - 49 * 60 * 60_000, detail: 'accredited' },
    {
      id: SEED_PAYMENTS.rejected,
      status: 'rejected',
      at: now - 73 * 60 * 60_000,
      detail: 'cc_rejected_other_reason',
    },
  ];
  for (const seed of seeds) {
    const { error } = await service
      .from('payments')
      .update({
        status: seed.status,
        refunded_amount: 0,
        status_detail: seed.detail,
        occurred_at: new Date(seed.at).toISOString(),
        applied_at: new Date(now).toISOString(),
        email_sent_at: new Date(now).toISOString(),
        email_attempts: 0,
        email_claimed_at: null,
        email_last_error: null,
      })
      .eq('user_id', KHER_USER_ID)
      .eq('mp_payment_id', seed.id);
    if (error) throw new Error(`seed payment ${seed.id}: ${error.message}`);
  }

  await service.from('payment_adjustments').delete().eq('user_id', KHER_USER_ID);

  const preapprovalA = await createTestPreapproval('preapproval activo inicial');
  createdPreapprovals.push(preapprovalA);
  await seedSubscription({ preapprovalId: preapprovalA, status: 'activa', plan: 'pro' });

  server = await startNextServer(3100);
  cookie = await loginCookie(KHER_EMAIL, KHER_PASSWORD);
  capture = captureResend();
}, 240_000);

afterAll(async () => {
  capture?.restore();

  // Preapprovals creados por el QA: cancelar si siguen vivos (best-effort).
  for (const id of createdPreapprovals) {
    try {
      if ((await preapprovalStatus(id)) !== 'cancelled') await cancelTestPreapproval(id);
    } catch (error) {
      console.warn('[QA cleanup preapproval]', id, error instanceof Error ? error.message : error);
    }
  }

  // Planes del checkout con plan: cancelar (idempotente) best-effort.
  for (const id of createdPlans) {
    try {
      await cancelTestPreapprovalPlan(id);
    } catch (error) {
      console.warn('[QA cleanup plan]', id, error instanceof Error ? error.message : error);
    }
  }

  // Usuario QA del checkout: borrar primero la evidencia legal (su FK es
  // `on delete set null` para conservar evidencia real; acá el usuario es
  // efímero y no queremos huérfanos de prueba) y después el usuario.
  if (qaUserId) {
    const legal = await service
      .from('legal_acceptances')
      .delete()
      .eq('user_id', qaUserId);
    if (legal.error) console.warn('[QA cleanup legal]', legal.error.message);
    const requests = await service.from('legal_requests').delete().eq('user_id', qaUserId);
    if (requests.error) console.warn('[QA cleanup legal requests]', requests.error.message);
    const { error } = await service.auth.admin.deleteUser(qaUserId);
    if (error) console.warn('[QA cleanup qa user]', error.message);
  }

  // Pagos sintéticos del QA (cancel-failure / owner-mismatch).
  for (const id of [...extraPaymentIds]) {
    try {
      await cleanupExtraPayment(id);
    } catch (error) {
      console.warn('[QA cleanup payment]', id, error instanceof Error ? error.message : error);
    }
  }
  await service
    .from('payments')
    .delete()
    .eq('user_id', OTHER_USER_ID)
    .eq('mp_payment_id', 999999999991);

  // Los reembolsos/contracargos del QA son SINTÉTICOS: los pagos semilla son
  // `live_mode: true` y en MP siguen `approved` con 0 devuelto. Restauramos
  // `payments` desde MP (fuente autoritativa) y borramos los adjustments
  // sintéticos, para que la cuenta no quede contradiciendo a MP incluso si una
  // corrida anterior quedó a medias. La evidencia vive en
  // `docs/qa-posicion-13.md`.
  await service.from('payment_adjustments').delete().eq('user_id', KHER_USER_ID);
  for (const id of Object.values(SEED_PAYMENTS)) {
    try {
      const pay = await mpPayment(id);
      const occurredAt = new Date(String(pay.date_created));
      const { error } = await service
        .from('payments')
        .update({
          status: String(pay.status),
          refunded_amount: Number(pay.transaction_amount_refunded ?? 0),
          status_detail: pay.status_detail == null ? null : String(pay.status_detail),
          occurred_at: Number.isNaN(occurredAt.getTime())
            ? new Date().toISOString()
            : occurredAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', KHER_USER_ID)
        .eq('mp_payment_id', id);
      if (error) console.warn('[QA cleanup payment restore]', id, error.message);
    } catch (error) {
      console.warn(
        '[QA cleanup payment restore]',
        id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // kherrera vuelve a su fila original (plan pro, sin subscriptions) para no
  // dejar la cuenta trabada.
  if (snapshot?.sub) {
    await service.from('subscriptions').upsert(snapshot.sub, { onConflict: 'user_id' });
  } else {
    await service.from('subscriptions').delete().eq('user_id', KHER_USER_ID);
  }
  if (snapshot?.user) {
    const { id: _id, created_at: _created, updated_at: _updated, ...rest } = snapshot.user;
    await service.from('users').update(rest).eq('id', KHER_USER_ID);
  }

  await server?.stop();
}, 240_000);

describe.sequential('QA posición 13 — DB, MP TEST, webhook, UI y checkout', () => {
  it('0009: constraints de estados, montos y dedupe', async () => {
    const payBogus = await service
      .from('payments')
      .update({ status: 'bogus' })
      .eq('user_id', KHER_USER_ID)
      .eq('mp_payment_id', SEED_PAYMENTS.current);
    expect(payBogus.error?.code).toBe('23514');

    const subBogus = await service
      .from('subscriptions')
      .update({ status: 'bogus' })
      .eq('user_id', KHER_USER_ID);
    expect(subBogus.error?.code).toBe('23514');

    const closureBogus = await service
      .from('subscriptions')
      .update({ closure_reason: 'bogus' })
      .eq('user_id', KHER_USER_ID);
    expect(closureBogus.error?.code).toBe('23514');

    // Los 5 estados de pago y los 5 de suscripción son aceptados.
    const fakeId = 999999999990;
    const insertFake = await service.from('payments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: fakeId,
      amount: 20000,
      status: 'approved',
      occurred_at: new Date().toISOString(),
      applied_at: new Date().toISOString(),
    });
    expect(insertFake.error).toBeNull();
    for (const status of ['approved', 'rejected', 'refunded', 'partially_refunded', 'charged_back']) {
      const { error } = await service
        .from('payments')
        .update({ status })
        .eq('user_id', KHER_USER_ID)
        .eq('mp_payment_id', fakeId);
      expect(error, `payments.status=${status}`).toBeNull();
    }
    const nullRefund = await service.from('payments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: 999999999989,
      amount: 20000,
      status: 'approved',
      refunded_amount: null,
      occurred_at: new Date().toISOString(),
    });
    expect(nullRefund.error?.code).toBe('23502');
    await service
      .from('payments')
      .delete()
      .eq('user_id', KHER_USER_ID)
      .eq('mp_payment_id', fakeId);

    for (const status of ['inactiva', 'activa', 'gracia', 'programada_cierre', 'revocada']) {
      const { error } = await service
        .from('subscriptions')
        .update({ status })
        .eq('user_id', KHER_USER_ID);
      expect(error, `subscriptions.status=${status}`).toBeNull();
    }
    for (const reason of ['refund', 'chargeback', 'dunning', 'cancel']) {
      const { error } = await service
        .from('subscriptions')
        .update({ closure_reason: reason })
        .eq('user_id', KHER_USER_ID);
      expect(error, `closure_reason=${reason}`).toBeNull();
    }
    // Restaurar el fixture vivo para el resto del QA.
    await seedSubscription({
      preapprovalId: createdPreapprovals[0],
      status: 'activa',
      plan: 'pro',
    });

    const badKind = await service.from('payment_adjustments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: SEED_PAYMENTS.current,
      kind: 'bogus',
      amount: 1,
      occurred_at: new Date().toISOString(),
    });
    expect(badKind.error?.code).toBe('23514');

    const sourceId = `qa-dup-${crypto.randomUUID()}`;
    const first = await service.from('payment_adjustments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: SEED_PAYMENTS.current,
      kind: 'refund',
      mp_source_id: sourceId,
      amount: 1,
      occurred_at: new Date().toISOString(),
    });
    expect(first.error).toBeNull();
    const dup = await service.from('payment_adjustments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: SEED_PAYMENTS.current,
      kind: 'refund',
      mp_source_id: sourceId,
      amount: 1,
      occurred_at: new Date().toISOString(),
    });
    expect(dup.error?.code).toBe('23505');
    await service.from('payment_adjustments').delete().eq('mp_source_id', sourceId);

    const occurredAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const noSource = {
      user_id: KHER_USER_ID,
      mp_payment_id: SEED_PAYMENTS.partial,
      kind: 'refund' as const,
      mp_source_id: null,
      amount: 1,
      occurred_at: occurredAt,
    };
    const firstNoSource = await service.from('payment_adjustments').insert(noSource);
    expect(firstNoSource.error).toBeNull();
    const dupNoSource = await service.from('payment_adjustments').insert(noSource);
    expect(dupNoSource.error?.code).toBe('23505');
    await service
      .from('payment_adjustments')
      .delete()
      .eq('mp_payment_id', SEED_PAYMENTS.partial)
      .is('mp_source_id', null)
      .eq('occurred_at', occurredAt);
  });

  it('1. reembolso PARCIAL del ciclo vigente: pago parcial, plan PRO y email', async () => {
    capture.reset();
    partialRefundSourceId = `qa-refund-partial-${crypto.randomUUID()}`;
    const event = await syntheticRefund(SEED_PAYMENTS.current, {
      status: 'partially_refunded',
      refundedAmount: 5000,
      refunds: [{ id: partialRefundSourceId, amount: 5000 }],
    });

    const result = await applyPayment(event, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(result.action).toBe('adjusted');
    expect(result.adjustmentKind).toBe('refund');
    expect(result.statusAfter).toBe('activa');
    expect(result.planAfter).toBe('pro');

    // El pago REAL en MP sigue `approved` con 0 devuelto: el sync no revierte
    // el parcial local (merge monótono + applied_at).
    const mp = await mpPayment(SEED_PAYMENTS.current);
    expect(mp.status).toBe('approved');
    expect(Number(mp.transaction_amount_refunded)).toBe(0);
    const sync = await syncNow();
    expect(sync.outcome).toBe('ok');

    const payments = await readPayments(service, KHER_USER_ID);
    const current = ok(
      payments.find((p) => Number(p.mp_payment_id) === SEED_PAYMENTS.current),
      'pago current',
    );
    expect(current.status).toBe('partially_refunded');
    expect(Number(current.refunded_amount)).toBe(5000);

    const sub = await readSubscription(service, KHER_USER_ID);
    expect(sub?.status).toBe('activa');
    expect(sub?.closure_reason).toBeNull();
    const user = await readUser(service, KHER_USER_ID);
    expect(user?.plan).toBe('pro');

    const adjustments = (await readAdjustments(service, KHER_USER_ID)).filter(
      (a) => Number(a.mp_payment_id) === SEED_PAYMENTS.current,
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].kind).toBe('refund');
    expect(String(adjustments[0].mp_source_id)).toBe(partialRefundSourceId);
    expect(Number(adjustments[0].amount)).toBe(5000);

    expect(subjectList()).toContain('Registramos un reembolso parcial — Simulador Mates');
    expect(subjectList()).toContain(`[PAGOS] Reembolso parcial · pago ${SEED_PAYMENTS.current}`);
    expect(customerEmails()).toHaveLength(1);
    expect(customerEmails()[0].html).toContain('Tu plan PRO sigue activo');
    expect(alertEmails()[0].html).toContain('partial_keep');

    const perfil = await ui('/perfil');
    expect(perfil.status).toBe(200);
    expect(perfil.html).toContain('REEMBOLSO PARCIAL');
    expect(perfil.html).toContain('Tu plan sigue activo hasta el fin del ciclo');
  });

  it('2. reembolso TOTAL de un ciclo PASADO: solo auditoría, plan intacto', async () => {
    capture.reset();
    const pastRefundSourceId = `qa-refund-past-${crypto.randomUUID()}`;
    const event = await syntheticRefund(SEED_PAYMENTS.past, {
      status: 'refunded',
      refundedAmount: 20000,
      refunds: [{ id: pastRefundSourceId, amount: 20000 }],
    });

    const result = await applyPayment(event, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(result.action).toBe('adjusted');
    expect(result.adjustmentKind).toBe('refund');
    expect(result.reason).toBe('refund_audit_only');
    expect(result.statusAfter).toBe('activa');
    expect(result.planAfter).toBe('pro');

    const sync = await syncNow();
    expect(sync.outcome).toBe('ok');

    const payments = await readPayments(service, KHER_USER_ID);
    const past = ok(
      payments.find((p) => Number(p.mp_payment_id) === SEED_PAYMENTS.past),
      'pago past',
    );
    expect(past.status).toBe('refunded');
    expect(Number(past.refunded_amount)).toBe(20000);

    const sub = await readSubscription(service, KHER_USER_ID);
    expect(sub?.status).toBe('activa');
    const user = await readUser(service, KHER_USER_ID);
    expect(user?.plan).toBe('pro');

    const adjustments = (await readAdjustments(service, KHER_USER_ID)).filter(
      (a) => Number(a.mp_payment_id) === SEED_PAYMENTS.past,
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].kind).toBe('refund');
    expect(String(adjustments[0].mp_source_id)).toBe(pastRefundSourceId);
    expect(Number(adjustments[0].amount)).toBe(20000);

    // Ciclo pasado ⇒ NO email al cliente; sí alerta interna con impacto audit.
    expect(customerEmails()).toHaveLength(0);
    expect(alertEmails()).toHaveLength(1);
    expect(alertEmails()[0].subject).toContain('Reembolso total');
    expect(alertEmails()[0].html).toContain('audit');
    expect(alertEmails()[0].html).toContain('ciclo pasado');
  });

  it('3. reembolso TOTAL del ciclo vigente: revoca, cancela preapproval y avisa', async () => {
    capture.reset();
    const preapprovalA = createdPreapprovals[0];
    const totalRefundSourceId = `qa-refund-total-${crypto.randomUUID()}`;
    const event = await syntheticRefund(SEED_PAYMENTS.current, {
      status: 'refunded',
      refundedAmount: 20000,
      // El parcial del escenario 1 sigue en el payload; el total es nuevo.
      refunds: [
        { id: partialRefundSourceId, amount: 5000 },
        { id: totalRefundSourceId, amount: 15000 },
      ],
    });
    totalRefundEvent = event;

    const result = await applyPayment(event, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(result.action).toBe('adjusted');
    expect(result.adjustmentKind).toBe('refund');
    expect(result.statusAfter).toBe('revocada');
    expect(result.planAfter).toBe('free');

    const sync = await syncNow();
    expect(sync.outcome).toBe('ok');

    const payments = await readPayments(service, KHER_USER_ID);
    const current = ok(
      payments.find((p) => Number(p.mp_payment_id) === SEED_PAYMENTS.current),
      'pago current total',
    );
    expect(current.status).toBe('refunded');
    expect(Number(current.refunded_amount)).toBe(20000);

    const sub = await readSubscription(service, KHER_USER_ID);
    expect(sub?.status).toBe('revocada');
    expect(sub?.closure_reason).toBe('refund');
    expect(sub?.closed_at).not.toBeNull();
    const user = await readUser(service, KHER_USER_ID);
    expect(user?.plan).toBe('free');

    expect(await preapprovalStatus(preapprovalA)).toBe('cancelled');

    const refundRows = (await readAdjustments(service, KHER_USER_ID)).filter(
      (a) => Number(a.mp_payment_id) === SEED_PAYMENTS.current && a.kind === 'refund',
    );
    const totalRefunded = refundRows.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(totalRefunded).toBe(20000);

    expect(subjectList()).toContain('Reembolso procesado — Plan PRO inactivo');
    expect(subjectList()).toContain(`[PAGOS] Reembolso total · pago ${SEED_PAYMENTS.current}`);
    expect(customerEmails()[0].html).toContain('El plan PRO quedó <strong>inactivo</strong>');
    expect(alertEmails()[0].html).toContain('revoke');

    const perfil = await ui('/perfil');
    expect(perfil.status).toBe(200);
    expect(perfil.html).toContain('REEMBOLSADO');
    expect(perfil.html).toContain('Reactivar PRO');
    expect(perfil.html).toContain('href="/editor?paywall=1"');
    expect(perfil.html).toContain('Reembolsamos tu último pago');
  });

  it('4. contracargo: suspende sin gracia, cancela preapproval; reverso NO reactiva', async () => {
    const preapprovalB = await createTestPreapproval('preapproval contracargo');
    createdPreapprovals.push(preapprovalB);
    await seedSubscription({ preapprovalId: preapprovalB, status: 'activa', plan: 'pro' });

    const p2 = await getPayment(String(SEED_PAYMENTS.partial));
    expect(p2.ok).toBe(true);
    if (!p2.ok) throw new Error(p2.message);

    const cbId = `qa-cb-${crypto.randomUUID()}`;
    const cb: MpChargebackFull = {
      id: cbId,
      status: 'in_dispute',
      paymentId: SEED_PAYMENTS.partial,
      externalReference: KHER_USER_ID,
      amount: 20000,
      currencyId: 'ARS',
      dateCreated: new Date().toISOString(),
      dateLastUpdated: new Date().toISOString(),
    };

    capture.reset();
    const result = await applyChargeback(cb, p2.data, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(result.action).toBe('adjusted');
    expect(result.adjustmentKind).toBe('chargeback');
    expect(result.statusAfter).toBe('revocada');
    expect(result.planAfter).toBe('free');

    const payments = await readPayments(service, KHER_USER_ID);
    const charged = ok(
      payments.find((p) => Number(p.mp_payment_id) === SEED_PAYMENTS.partial),
      'pago chargeback',
    );
    expect(charged.status).toBe('charged_back');
    expect(Number(charged.refunded_amount)).toBe(20000);

    const sub = await readSubscription(service, KHER_USER_ID);
    expect(sub?.status).toBe('revocada');
    expect(sub?.closure_reason).toBe('chargeback');
    const user = await readUser(service, KHER_USER_ID);
    expect(user?.plan).toBe('free');
    expect(await preapprovalStatus(preapprovalB)).toBe('cancelled');

    const adjustments = (await readAdjustments(service, KHER_USER_ID)).filter(
      (a) => String(a.mp_source_id) === cbId,
    );
    expect(adjustments.map((a) => a.kind)).toEqual(['chargeback']);
    expect(Number(adjustments[0].amount)).toBe(20000);

    expect(subjectList()).toContain('Contracargo recibido — acceso suspendido');
    expect(subjectList()).toContain(`[PAGOS] Contracargo · pago ${SEED_PAYMENTS.partial}`);

    const perfil = await ui('/perfil');
    expect(perfil.status).toBe(200);
    expect(perfil.html).toContain('CONTRACARGO');
    expect(perfil.html).toContain('Se inició un contracargo');
    expect(perfil.html).toContain('Contactar soporte');
    expect(perfil.html).not.toContain('Reactivar PRO');

    // Reverso/ganado: registra `reversal` + alerta, NO reactiva (Q5).
    capture.reset();
    const won: MpChargebackFull = {
      ...cb,
      status: 'won',
      dateLastUpdated: new Date(Date.now() + 1_000).toISOString(),
    };
    const reversal = await applyChargeback(won, p2.data, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(reversal.action).toBe('adjusted');
    expect(reversal.adjustmentKind).toBe('reversal');
    expect(reversal.reason).toBe('chargeback_reversal');

    const subAfter = await readSubscription(service, KHER_USER_ID);
    expect(subAfter?.status).toBe('revocada');
    expect(subAfter?.closure_reason).toBe('chargeback');
    const userAfter = await readUser(service, KHER_USER_ID);
    expect(userAfter?.plan).toBe('free');

    const reversalRows = (await readAdjustments(service, KHER_USER_ID)).filter(
      (a) => String(a.mp_source_id) === cbId && a.kind === 'reversal',
    );
    expect(reversalRows).toHaveLength(1);
    expect(customerEmails()).toHaveLength(0);
    expect(alertEmails()).toHaveLength(1);
    expect(alertEmails()[0].subject).toContain('Contracargo revertido/ganado');
    expect(alertEmails()[0].html).toContain('manual_reactivation');

    // Reintento del reverso: no duplica adjustment ni email.
    const countBefore = (await readAdjustments(service, KHER_USER_ID)).length;
    capture.reset();
    const again = await applyChargeback(won, p2.data, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(again.action).toBe('already_applied');
    expect(await readAdjustments(service, KHER_USER_ID)).toHaveLength(countBefore);
    expect(capture.emails).toHaveLength(0);
  });

  it('5. carrera refund/approved: el approved posterior NO reactiva; reintento idempotente', async () => {
    const before = await readSubscription(service, KHER_USER_ID);
    const beforeUser = await readUser(service, KHER_USER_ID);
    const beforeAdjustments = await readAdjustments(service, KHER_USER_ID);

    const approved: MpPaymentFull = {
      id: SEED_PAYMENTS.past,
      status: 'approved',
      statusDetail: 'accredited',
      externalReference: KHER_USER_ID,
      transactionAmount: 20000,
      transactionAmountRefunded: 0,
      refunds: [],
      receiptUrl: null,
      dateApproved: new Date().toISOString(),
      dateLastUpdated: new Date().toISOString(),
      dateCreated: new Date(Date.now() - 49 * 60 * 60_000).toISOString(),
      currencyId: 'ARS',
      preapprovalId: null,
      payerEmail: TEST_PAYER_EMAIL,
    };
    capture.reset();
    const result = await applyPayment(approved, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(result.action).not.toBe('inserted');
    expect(result.action).not.toBe('repaired');

    // El contrato de `already_applied` no incluye planAfter: la prueba real es
    // el estado persistido (el approved tardío no resucita la revocación).
    expect((await readSubscription(service, KHER_USER_ID))?.status).toBe('revocada');
    expect((await readUser(service, KHER_USER_ID))?.plan).toBe('free');
    const past = (await readPayments(service, KHER_USER_ID)).find(
      (p) => Number(p.mp_payment_id) === SEED_PAYMENTS.past,
    );
    expect(past?.status).toBe('refunded');

    // Reintento del MISMO refund total: dedupe por mp_source_id, cero emails.
    capture.reset();
    const retry = await applyPayment(ok(totalRefundEvent, 'evento total del escenario 3'), {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(retry.action).toBe('already_applied');
    expect(await readAdjustments(service, KHER_USER_ID)).toHaveLength(beforeAdjustments.length);
    expect(capture.emails).toHaveLength(0);

    // No se tocó nada más que el intento aprobado rechazado.
    expect((await readSubscription(service, KHER_USER_ID))?.status).toBe(before?.status);
    expect((await readUser(service, KHER_USER_ID))?.plan).toBe(beforeUser?.plan);
  });

  it('6. pago de OTRO usuario: user_mismatch y dedupe sin fila del usuario', async () => {
    const p2 = await getPayment(String(SEED_PAYMENTS.partial));
    expect(p2.ok).toBe(true);
    if (!p2.ok) throw new Error(p2.message);

    const foreign = await applyPayment(p2.data, {
      userId: OTHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(foreign.action).toBe('skipped');
    expect(foreign.reason).toBe('user_mismatch');

    // Fila del pago atada a OTRO usuario + evento con external_reference de
    // kherrera ⇒ el UNIQUE global no deja mutar la fila ajena.
    const fakeId = 999999999991;
    extraPaymentIds.add(fakeId);
    const inserted = await service.from('payments').insert({
      user_id: OTHER_USER_ID,
      mp_payment_id: fakeId,
      amount: 20000,
      status: 'approved',
      occurred_at: new Date().toISOString(),
      applied_at: new Date().toISOString(),
      email_sent_at: new Date().toISOString(),
    });
    expect(inserted.error).toBeNull();

    const synthetic: MpPaymentFull = {
      id: fakeId,
      status: 'approved',
      statusDetail: 'accredited',
      externalReference: KHER_USER_ID,
      transactionAmount: 20000,
      transactionAmountRefunded: 0,
      refunds: [],
      receiptUrl: null,
      dateApproved: new Date().toISOString(),
      dateLastUpdated: new Date().toISOString(),
      dateCreated: new Date().toISOString(),
      currencyId: 'ARS',
      preapprovalId: null,
      payerEmail: TEST_PAYER_EMAIL,
    };
    const ownerMismatch = await applyPayment(synthetic, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(ownerMismatch.action).toBe('skipped');
    expect(ownerMismatch.reason).toBe('payment_owner_mismatch');

    const otherRow = await service
      .from('payments')
      .select('status')
      .eq('user_id', OTHER_USER_ID)
      .eq('mp_payment_id', fakeId)
      .maybeSingle<{ status: string }>();
    expect(otherRow.data?.status).toBe('approved');
    await cleanupExtraPayment(fakeId);
  });

  it('7. Q6: si MP no cancela el preapproval, igual revoca y alerta (sin loop)', async () => {
    const fakeId = 999999999992;
    extraPaymentIds.add(fakeId);
    const nowIso = new Date().toISOString();
    const inserted = await service.from('payments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: fakeId,
      amount: 20000,
      status: 'approved',
      occurred_at: nowIso,
      applied_at: nowIso,
      email_sent_at: nowIso,
    });
    expect(inserted.error).toBeNull();

    const bogusPreapproval = `qa-missing-${crypto.randomUUID()}`;
    await seedSubscription({
      preapprovalId: bogusPreapproval,
      status: 'activa',
      plan: 'pro',
    });

    const refunded: MpPaymentFull = {
      id: fakeId,
      status: 'refunded',
      statusDetail: 'refunded',
      externalReference: KHER_USER_ID,
      transactionAmount: 20000,
      transactionAmountRefunded: 20000,
      refunds: [{ id: `qa-refund-${fakeId}`, amount: 20000, dateCreated: nowIso }],
      receiptUrl: null,
      dateApproved: nowIso,
      dateLastUpdated: nowIso,
      dateCreated: nowIso,
      currencyId: 'ARS',
      preapprovalId: null,
      payerEmail: TEST_PAYER_EMAIL,
    };

    capture.reset();
    const result = await applyPayment(refunded, {
      userId: KHER_USER_ID,
      source: 'webhook',
      watermarkMs: null,
    });
    expect(result.action).toBe('adjusted');
    expect(result.statusAfter).toBe('revocada');
    expect(result.planAfter).toBe('free');

    const sub = await readSubscription(service, KHER_USER_ID);
    expect(sub?.status).toBe('revocada');
    expect(sub?.closure_reason).toBe('refund');
    expect((await readUser(service, KHER_USER_ID))?.plan).toBe('free');

    const alert = alertEmails().find((email) => email.html.includes('no se pudo cancelar'));
    expect(alert).toBeDefined();
    expect(alert?.html).toContain(bogusPreapproval);
    expect(alert?.html).toContain('revisar a mano');
    expect(customerEmails()).toHaveLength(1);

    await cleanupExtraPayment(fakeId);
  });

  it('8. Reactivar PRO: checkout nuevo, preapproval viejo cancelado y evidencia legal', async () => {
    const created = await service.auth.admin.createUser({
      email: TEST_PAYER_EMAIL,
      password: TEST_PAYER_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    qaUserId = created.data.user?.id ?? null;
    if (!qaUserId) throw new Error('No se creó el usuario QA');

    const qaUserRow = await service
      .from('users')
      .select('id, plan')
      .eq('id', qaUserId)
      .maybeSingle<{ id: string; plan: string }>();
    expect(qaUserRow.error).toBeNull();
    if (!qaUserRow.data) {
      const backfill = await service.from('users').insert({ id: qaUserId, base_name: 'QA POS 13' });
      expect(backfill.error).toBeNull();
    }

    const oldPreapproval = await createTestPreapprovalForUser(
      'preapproval viejo revocado',
      qaUserId,
    );
    createdPreapprovals.push(oldPreapproval);

    const now = Date.now();
    const subSeed = await service.from('subscriptions').upsert(
      {
        user_id: qaUserId,
        preapproval_id: oldPreapproval,
        status: 'revocada',
        price_frozen: 20000,
        currency: 'ARS',
        cycle_anchor: new Date(now).toISOString().slice(0, 10),
        period_end: null,
        grace_expires_at: null,
        last_checkout_at: new Date(now).toISOString(),
        last_synced_at: new Date(now).toISOString(),
        closure_reason: 'refund',
        closed_at: new Date(now).toISOString(),
      },
      { onConflict: 'user_id' },
    );
    expect(subSeed.error).toBeNull();
    await service.from('users').update({ plan: 'free' }).eq('id', qaUserId);

    const qaCookie = await loginCookie(TEST_PAYER_EMAIL, TEST_PAYER_PASSWORD);
    const res = await fetch(`${BASE_URL}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: qaCookie },
      body: JSON.stringify({
        legalAccepted: true,
        termsVersion: '1.0',
        privacyVersion: '1.0',
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      initPoint?: string;
      planId?: string;
      error?: string;
    } | null;
    if (res.status !== 201) {
      console.log('[QA checkout server logs]', server.logs().slice(-6000));
    }
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body?.ok).toBe(true);
    expect(body?.planId).toBeTruthy();
    expect(body?.initPoint).toContain('preapproval_plan_id=');
    const newPlan = body?.planId as string;
    createdPlans.push(newPlan);
    expect(await preapprovalStatus(oldPreapproval)).toBe('cancelled');

    const qaSub = await service
      .from('subscriptions')
      .select('status, preapproval_id, preapproval_plan_id, closure_reason, closed_at, period_end')
      .eq('user_id', qaUserId)
      .maybeSingle<{
        status: string;
        preapproval_id: string | null;
        preapproval_plan_id: string | null;
        closure_reason: string | null;
        closed_at: string | null;
        period_end: string | null;
      }>();
    expect(qaSub.data?.status).toBe('inactiva');
    // El preapproval real lo crea MP en su checkout: todavía no existe.
    expect(qaSub.data?.preapproval_id).toBeNull();
    expect(qaSub.data?.preapproval_plan_id).toBe(newPlan);
    expect(qaSub.data?.closure_reason).toBeNull();
    expect(qaSub.data?.closed_at).toBeNull();

    const planMapping = await service
      .from('mp_preapproval_plans')
      .select('user_id, amount, currency, status')
      .eq('id', newPlan)
      .maybeSingle<{
        user_id: string;
        amount: number;
        currency: string;
        status: string;
      }>();
    expect(planMapping.error).toBeNull();
    expect(planMapping.data?.user_id).toBe(qaUserId);
    expect(Number(planMapping.data?.amount)).toBeGreaterThan(0);
    expect(planMapping.data?.currency).toBe('ARS');
    expect(planMapping.data?.status).toBe('active');

    const legal = await service
      .from('legal_acceptances')
      .select('document, version')
      .eq('user_id', qaUserId)
      .order('document');
    expect(legal.error).toBeNull();
    expect(legal.data?.map((row) => row.document)).toEqual(['privacy', 'terms']);
    expect(legal.data?.every((row) => row.version === '1.0')).toBe(true);

    const intent = await service
      .from('checkout_intents')
      .select('id')
      .eq('user_id', qaUserId);
    expect(intent.error).toBeNull();
    expect(intent.data?.length).toBe(1);

    await cancelTestPreapprovalPlan(newPlan);
  });

  it('9. webhook HTTP: firma, dedupe, topic de contracargo sin recurso y topic ignorado', async () => {
    const dedupeRes = await fetch(`${BASE_URL}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers: signedWebhookHeaders(String(SEED_PAYMENTS.past)),
      body: JSON.stringify({ type: 'payment', data: { id: String(SEED_PAYMENTS.past) } }),
    });
    const dedupeBody = (await dedupeRes.json().catch(() => null)) as {
      received?: boolean;
      dedupe?: boolean;
    } | null;
    expect(dedupeRes.status).toBe(200);
    expect(dedupeBody?.received).toBe(true);
    expect(dedupeBody?.dedupe).toBe(true);

    const badRes = await fetch(`${BASE_URL}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'qa-bad',
        'x-signature': `ts=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      },
      body: JSON.stringify({ type: 'payment', data: { id: String(SEED_PAYMENTS.past) } }),
    });
    expect(badRes.status).toBe(403);

    const fakeChargeback = `qa-no-existe-${crypto.randomUUID()}`;
    const cbRes = await fetch(`${BASE_URL}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers: signedWebhookHeaders(fakeChargeback),
      body: JSON.stringify({ type: 'chargeback', data: { id: fakeChargeback } }),
    });
    expect(cbRes.status).toBe(502);

    const ignoredRes = await fetch(`${BASE_URL}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers: signedWebhookHeaders('qa-ignored'),
      body: JSON.stringify({
        type: 'subscription_preapproval_plan',
        data: { id: 'qa-ignored' },
      }),
    });
    expect(ignoredRes.status).toBe(200);

    const noIdRes = await fetch(`${BASE_URL}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment', data: {} }),
    });
    expect(noIdRes.status).toBe(403);
  });

  it('10. RLS/grants de payment_adjustments: dueño sí, anon no, escritura solo service', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('Faltan URL/ANON_KEY');

    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anonRead = await anon.from('payment_adjustments').select('id').limit(1);
    expect(anonRead.error).not.toBeNull();

    const authed = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const login = await authed.auth.signInWithPassword({
      email: KHER_EMAIL,
      password: KHER_PASSWORD,
    });
    expect(login.error).toBeNull();

    const own = await authed.from('payment_adjustments').select('id, user_id');
    expect(own.error).toBeNull();
    expect((own.data ?? []).length).toBeGreaterThan(0);
    expect((own.data ?? []).every((row) => row.user_id === KHER_USER_ID)).toBe(true);

    const foreign = await authed
      .from('payment_adjustments')
      .select('id')
      .eq('user_id', OTHER_USER_ID);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);

    const write = await authed.from('payment_adjustments').insert({
      user_id: KHER_USER_ID,
      mp_payment_id: SEED_PAYMENTS.current,
      kind: 'refund',
      amount: 1,
      occurred_at: new Date().toISOString(),
    });
    expect(write.error).not.toBeNull();

    const update = await authed
      .from('payment_adjustments')
      .update({ amount: 999999 })
      .eq('user_id', KHER_USER_ID);
    expect(update.error).not.toBeNull();

    const del = await authed
      .from('payment_adjustments')
      .delete()
      .eq('user_id', KHER_USER_ID);
    expect(del.error).not.toBeNull();

    const serviceRead = await service
      .from('payment_adjustments')
      .select('id')
      .eq('user_id', KHER_USER_ID);
    expect(serviceRead.error).toBeNull();
    expect((serviceRead.data ?? []).length).toBeGreaterThan(0);

    // El Centro de Suscripción usa las policies de 0005: el dueño lee sus
    // payments/subscriptions; anon no.
    const ownPayments = await authed.from('payments').select('id').limit(5);
    expect(ownPayments.error).toBeNull();
    const ownSubs = await authed.from('subscriptions').select('user_id').limit(1);
    expect(ownSubs.error).toBeNull();
    const anonPayments = await anon.from('payments').select('id').limit(1);
    expect(anonPayments.error).not.toBeNull();
  });

  it('11. Resend real (informativo): credenciales y entrega con el from actual', async () => {
    capture.restore();
    const outcome = await sendMail({
      kind: 'reembolso_total',
      to: KHER_EMAIL,
      subject: 'QA posición 13 — prueba de entrega',
      html: '<p>Prueba de entrega del QA de reembolsos. Si recibís esto, Resend está operativo.</p>',
    });
    console.log('[QA Resend real]', JSON.stringify({ to: KHER_EMAIL, from: process.env.EMAIL_FROM, ...outcome }));
    expect(outcome.note).toBeTruthy();
  });
});

/** Variante del helper para el usuario QA (email = payer de prueba). */
async function createTestPreapprovalForUser(label: string, userId: string): Promise<string> {
  const { createPreapproval } = await import('@/lib/payments/mercadopago');
  const result = await createPreapproval({
    reason: `QA posición 13 — ${label}`,
    payerEmail: TEST_PAYER_EMAIL,
    externalReference: userId,
    amount: 20000,
    backUrls: {
      success: `${QA_ORIGIN}/perfil?pago=success`,
      failure: `${QA_ORIGIN}/perfil?pago=failure`,
      pending: `${QA_ORIGIN}/perfil?pago=pending`,
    },
    notificationUrl: `${QA_ORIGIN}/api/webhooks/mercadopago`,
    startDateIso: new Date().toISOString(),
  });
  if (!result.ok) {
    throw new Error(`createPreapproval QA ${label} falló (${result.status}): ${result.message}`);
  }
  return result.data.id;
}
