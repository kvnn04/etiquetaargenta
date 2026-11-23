/* ============================================================================
 * SYNC DE PAGOS — posición 11 (spec_sync_de_pagos_y_reverificacion.md v0.2)
 * ----------------------------------------------------------------------------
 * Camino de RECUPERACIÓN cuando el webhook no alcanza:
 *   · busca pagos por external_reference = user_id (R12.1);
 *   · aplica los faltantes y repara los insertados sin foldear (R12.5/R12.6);
 *   · audita los pagos anteriores al último checkout sin mutar el plan (R12.4);
 *   · lee el preapproval y programa el cierre si MP lo canceló/pausó (R12.8);
 *   · realinea users.plan con resolvePlan al final (R8/R9);
 *   · reintenta emails pendientes de corridas anteriores (R12.7).
 *
 * Decisiones cerradas (22-nov-2026):
 *   · on-read SOLO en /perfil (el editor no consulta MP);
 *   · TTL 60 s no activo / 6 h activo; cooldown manual 20 s;
 *   · ventana anti-resurrección last_checkout_at − 1 día con fallbacks;
 *   · varios pagos ⇒ todos en orden cronológico;
 *   · un email por pago, hasta 3 intentos;
 *   · preapproval faltante ⇒ adoptar el más nuevo; mismatch ⇒ log sin mutar.
 *
 * Sin pg_cron: el sync corre al-vuelo (/perfil) y a pedido (botón). El
 * webhook sigue siendo el camino primario; esto no lo reemplaza.
 * ============================================================================ */

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { Plan } from '@/lib/permissions';
import { DAY_MS, resolvePlan, type SubscriptionStatus } from '@/lib/payments/core';
import {
  getPayment,
  getPreapproval,
  searchPaymentsByExternalReference,
  searchPreapprovalsByExternalReference,
} from '@/lib/payments/mercadopago';
import {
  applyPayment,
  applyPreapproval,
  retryPendingPaymentEmails,
} from '@/lib/payments/apply';
import { isRefundLikeStatus } from '@/lib/payments/refunds';

/* -------------------------------------------------------------------------- */
/* Constantes (spec §3.1-R12.3/R12.4 + §6)                                    */
/* -------------------------------------------------------------------------- */

export const SYNC_TTL_INACTIVE_MS = 60_000; // 60 s on-read sin ciclo activo
export const SYNC_TTL_ACTIVE_MS = 6 * 60 * 60_000; // 6 h on-read con ciclo activo
export const SYNC_MANUAL_COOLDOWN_MS = 20_000; // 20 s entre clics manuales
export const SYNC_WINDOW_SLACK_MS = DAY_MS; // last_checkout_at − 1 día
export const SYNC_ON_READ_BUDGET_MS = 8_000; // presupuesto del render /perfil
export const SYNC_MANUAL_BUDGET_MS = 30_000; // presupuesto del botón
export const SYNC_PREAPPROVAL_ON_READ_TIMEOUT_MS = 3_000; // no bloquear /perfil
export const SYNC_MAX_PAYMENTS = 100; // cap por corrida
export const SYNC_PAGE_SIZE = 50; // páginas de /payments/search

export type SyncTrigger = 'perfil' | 'manual';

export type SyncOutcomeKind =
  | 'ok'
  | 'cooldown'
  | 'no_watermark'
  | 'no_subscription'
  | 'mp_unavailable'
  | 'user_missing'
  | 'deleted'
  | 'error';

export interface SyncOptions {
  trigger: SyncTrigger;
  /** Manual ⇒ cooldown de 20 s; on-read ⇒ TTL 60 s / 6 h. */
  force?: boolean;
  /** Override del presupuesto (tests/QA). */
  budgetMs?: number;
}

export interface SyncOutcome {
  outcome: SyncOutcomeKind;
  found: number;
  missing: number;
  applied: number;
  repaired: number;
  audited: number;
  plan: Plan;
  status: SubscriptionStatus | null;
  checkedAt: string;
  /** Último lease escrito/leído: insumo del cooldown de 20 s en la UI. */
  lastSyncedAtMs: number | null;
  retryAfterSeconds?: number;
  receiptUrl?: string | null;
  preapproval?: 'unchanged' | 'adopted' | 'closed' | 'unavailable';
  /** MP falló pero hay estado local para mostrar (200 con aviso honesto). */
  warning?: 'MP_UNAVAILABLE';
  /** Cuántos pagos locales tiene el usuario (para decidir 502 vs 200). */
  localsCount: number;
  ms: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/* -------------------------------------------------------------------------- */
/* Helpers PUROS (testeables sin DB ni red)                                   */
/* -------------------------------------------------------------------------- */

/** R12.4: solo pagos con date_created >= watermark − 1 día. */
export function isWithinSyncWindow(
  createdMs: number,
  watermarkMs: number,
  slackMs = SYNC_WINDOW_SLACK_MS,
): boolean {
  return Number.isFinite(createdMs) && createdMs >= watermarkMs - slackMs;
}

/** TTL/cooldown del lease (R12.3): manual 20 s; activo 6 h; resto 60 s. */
export function syncWindowMs(input: {
  force: boolean;
  status: SubscriptionStatus | null;
}): number {
  if (input.force) return SYNC_MANUAL_COOLDOWN_MS;
  return input.status === 'activa' ? SYNC_TTL_ACTIVE_MS : SYNC_TTL_INACTIVE_MS;
}

/**
 * On-read sin fila de ciclo: no hay `subscriptions.last_synced_at` durable
 * donde medir el TTL. Si el gating ya está en PRO (cuenta legada o seed
 * perdido), consultar MP en cada `/perfil` solo agrega latencia y vuelve a
 * adoptar el mismo preapproval cancelado. La recuperación sigue disponible
 * con `force` (botón manual o vuelta del checkout), que es el único caso
 * donde vale la pena buscar sin lease.
 */
export function shouldSkipOnReadSync(input: {
  hasSubscription: boolean;
  plan: Plan;
  force: boolean;
  trigger: SyncTrigger;
}): boolean {
  return (
    !input.hasSubscription &&
    !input.force &&
    input.trigger === 'perfil' &&
    input.plan !== 'free'
  );
}

/** Presupuesto de `/preapproval/search`: el on-read no espera más de 3 s. */
export function preapprovalSearchTimeoutMs(input: {
  trigger: SyncTrigger;
  remainingMs: number;
}): number {
  const remaining = Math.max(0, input.remainingMs);
  return input.trigger === 'manual'
    ? remaining
    : Math.min(remaining, SYNC_PREAPPROVAL_ON_READ_TIMEOUT_MS);
}

/** Segundos que faltan para poder reintentar (mínimo 1, nunca 0). */
export function retryAfterSeconds(
  lastSyncedMs: number,
  windowMs: number,
  nowMs: number,
): number {
  return Math.max(1, Math.ceil((lastSyncedMs + windowMs - nowMs) / 1000));
}

/**
 * Watermark R12.4: último checkout; si no existe, creación de la fila; si
 * tampoco, el último checkout_intent. Sin ninguno ⇒ no-op honesto.
 */
export function watermarkMsOf(input: {
  lastCheckoutAtMs: number | null;
  subscriptionCreatedAtMs: number | null;
  lastCheckoutIntentMs: number | null;
}): number | null {
  return input.lastCheckoutAtMs ?? input.subscriptionCreatedAtMs ?? input.lastCheckoutIntentMs;
}

export interface PaymentCandidate {
  id: number;
  dateCreatedMs: number;
  externalReference: string | null;
  status: string;
  /** R11.2: acumulado devuelto que MP informa en el search. */
  refundedAmount?: number | null;
}

export interface LocalPayment {
  mpPaymentId: number;
  status: string;
  appliedAtMs: number | null;
  occurredAtMs: number;
  /** R11.2: acumulado local (para no repullear parciales ya foldidos). */
  refundedAmount?: number;
}

export interface PaymentToApply {
  id: number;
  dateMs: number;
  kind: 'missing' | 'reparable' | 'audit';
}

/**
 * Pagos a APLICAR: faltantes dentro de la ventana + locales con applied_at
 * NULL y status approved/rejected, ordenados de más viejo a más nuevo
 * (R12.5). Posición 13: los refunded/partially_refunded/charged_back se
 * incluyen SIEMPRE (aunque sean viejos) cuando el estado local no coincide,
 * para que el historial refleje el dinero devuelto; el impacto en el plan lo
 * decide apply.ts con la regla de ciclo vigente (R11.3).
 */
export function selectPaymentsToApply(
  candidates: PaymentCandidate[],
  locals: LocalPayment[],
  watermarkMs: number,
  userId: string,
): PaymentToApply[] {
  const localById = new Map<number, LocalPayment>();
  for (const local of locals) localById.set(local.mpPaymentId, local);

  const seen = new Set<number>();
  const out: PaymentToApply[] = [];

  for (const candidate of candidates) {
    if (candidate.externalReference !== userId) continue;
    const refundLike = isRefundLikeStatus(candidate.status);
    if (!refundLike && candidate.status !== 'approved' && candidate.status !== 'rejected') {
      continue;
    }
    if (!refundLike && !isWithinSyncWindow(candidate.dateCreatedMs, watermarkMs)) continue;
    if (seen.has(candidate.id)) continue;

    const local = localById.get(candidate.id);
    if (!refundLike && local?.appliedAtMs != null) continue;
    if (refundLike && local) {
      // Ya está foldido con el mismo estado/monto: nada nuevo que pullear.
      if (
        local.status === candidate.status &&
        (local.refundedAmount ?? 0) >= (candidate.refundedAmount ?? 0)
      ) {
        continue;
      }
    }

    seen.add(candidate.id);
    out.push({
      id: candidate.id,
      dateMs: candidate.dateCreatedMs,
      kind: local ? 'reparable' : 'missing',
    });
  }

  // Reparables que el índice de MP todavía no devolvió (lag del search).
  for (const local of locals) {
    if (local.appliedAtMs != null) continue;
    const refundLike = isRefundLikeStatus(local.status);
    if (!refundLike && local.status !== 'approved' && local.status !== 'rejected') continue;
    if (!refundLike && !isWithinSyncWindow(local.occurredAtMs, watermarkMs)) continue;
    if (seen.has(local.mpPaymentId)) continue;

    seen.add(local.mpPaymentId);
    out.push({
      id: local.mpPaymentId,
      dateMs: local.occurredAtMs,
      kind: 'reparable',
    });
  }

  return out.sort((a, b) => a.dateMs - b.dateMs || a.id - b.id);
}

/**
 * Pagos a AUDITAR: anteriores a la ventana y ausentes del historial local.
 * Se registran con source='sync' pero NO mutan el ciclo (R12.4/§3.3).
 */
export function selectPaymentsToAudit(
  candidates: PaymentCandidate[],
  locals: LocalPayment[],
  watermarkMs: number,
  userId: string,
): PaymentToApply[] {
  const localIds = new Set<number>();
  for (const local of locals) localIds.add(local.mpPaymentId);

  const seen = new Set<number>();
  const out: PaymentToApply[] = [];

  for (const candidate of candidates) {
    if (candidate.externalReference !== userId) continue;
    if (candidate.status !== 'approved' && candidate.status !== 'rejected') continue;
    if (isWithinSyncWindow(candidate.dateCreatedMs, watermarkMs)) continue;
    if (localIds.has(candidate.id) || seen.has(candidate.id)) continue;

    seen.add(candidate.id);
    out.push({ id: candidate.id, dateMs: candidate.dateCreatedMs, kind: 'audit' });
  }

  return out.sort((a, b) => a.dateMs - b.dateMs || a.id - b.id);
}

/* -------------------------------------------------------------------------- */
/* Realineo final de users.plan                                               */
/* -------------------------------------------------------------------------- */

/**
 * Deja users.plan alineado con resolvePlan (R8/R9). Si no hay fila de ciclo,
 * NO baja a legacy (el plan existente se respeta). Idempotente.
 */
export async function realignUsersPlan(
  userId: string,
): Promise<{ plan: Plan; status: SubscriptionStatus | null }> {
  const service = createSupabaseServiceClient();
  const [subRes, userRes] = await Promise.all([
    service
      .from('subscriptions')
      .select('status, grace_expires_at, period_end')
      .eq('user_id', userId)
      .maybeSingle<{
        status: SubscriptionStatus;
        grace_expires_at: string | null;
        period_end: string | null;
      }>(),
    service
      .from('users')
      .select('plan')
      .eq('id', userId)
      .maybeSingle<{ plan: Plan }>(),
  ]);

  if (subRes.error) console.error('[mp sync realign sub]:', subRes.error.message);
  if (userRes.error) console.error('[mp sync realign user]:', userRes.error.message);

  const currentPlan: Plan = userRes.data?.plan ?? 'free';
  const sub = subRes.data;
  if (!sub) return { plan: currentPlan, status: null };

  const plan = resolvePlan(
    {
      status: sub.status,
      graceExpiresAtMs: parseMs(sub.grace_expires_at),
      periodEndMs: parseMs(sub.period_end),
    },
    Date.now(),
  );

  if (plan !== currentPlan) {
    const update = await service
      .from('users')
      .update({
        plan,
        grace_expires_at: sub.status === 'gracia' ? sub.grace_expires_at : null,
      })
      .eq('id', userId);
    if (update.error) console.error('[mp sync realign update]:', update.error.message);
    else {
      console.log(
        '[mp sync plan_realineado]',
        JSON.stringify({ user: userId, from: currentPlan, to: plan }),
      );
    }
  }

  return { plan, status: sub.status };
}

/* -------------------------------------------------------------------------- */
/* Orquestador                                                                */
/* -------------------------------------------------------------------------- */

interface SubSyncRow {
  status: SubscriptionStatus;
  price_frozen: number;
  preapproval_id: string | null;
  cycle_anchor: string | null;
  grace_expires_at: string | null;
  period_end: string | null;
  last_checkout_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export async function syncUserCycle(
  userId: string,
  opts: SyncOptions,
): Promise<SyncOutcome> {
  const started = Date.now();
  const budgetMs =
    opts.budgetMs ??
    (opts.trigger === 'manual' ? SYNC_MANUAL_BUDGET_MS : SYNC_ON_READ_BUDGET_MS);
  const deadline = started + budgetMs;

  const base = (overrides: Partial<SyncOutcome> = {}): SyncOutcome => ({
    outcome: 'ok',
    found: 0,
    missing: 0,
    applied: 0,
    repaired: 0,
    audited: 0,
    plan: 'free',
    status: null,
    checkedAt: new Date().toISOString(),
    lastSyncedAtMs: null,
    preapproval: 'unchanged',
    localsCount: 0,
    ms: Date.now() - started,
    ...overrides,
  });

  try {
    if (!UUID_RE.test(userId)) return base({ outcome: 'user_missing' });

    const service = createSupabaseServiceClient();

    /* 1+2) Usuario y fila del ciclo en paralelo: el render on-read no debe
     * pagar dos round-trips a Supabase antes de decidir si consulta MP. */
    const [userRes, subRes] = await Promise.all([
      service
        .from('users')
        .select('id, deleted_at, plan, mp_preapproval_id')
        .eq('id', userId)
        .maybeSingle<{
          id: string;
          deleted_at: string | null;
          plan: Plan;
          mp_preapproval_id: string | null;
        }>(),
      service
        .from('subscriptions')
        .select(
          'status, price_frozen, preapproval_id, cycle_anchor, grace_expires_at, period_end, last_checkout_at, last_synced_at, created_at',
        )
        .eq('user_id', userId)
        .maybeSingle<SubSyncRow>(),
    ]);
    if (userRes.error) {
      console.error('[mp sync user read]:', userRes.error.message);
      return base({ outcome: 'error' });
    }
    if (!userRes.data) return base({ outcome: 'user_missing' });
    if (userRes.data.deleted_at) {
      return base({ outcome: 'deleted', plan: userRes.data.plan ?? 'free' });
    }

    if (subRes.error) {
      console.error('[mp sync sub read]:', subRes.error.message);
      return base({ outcome: 'error', plan: userRes.data.plan });
    }
    const sub = subRes.data ?? null;

    /* Sin fila de ciclo no hay lease durable: si el plan ya está en PRO, el
     * on-read no consulta MP (fix 23-nov-2026: cuentas legadas sin
     * `subscriptions` golpeaban MP en cada /perfil y adoptaban un preapproval
     * cancelado en loop). El botón manual y la vuelta del checkout (`force`)
     * conservan la recuperación de seed perdido. */
    if (
      shouldSkipOnReadSync({
        hasSubscription: sub != null,
        plan: userRes.data.plan ?? 'free',
        force: opts.force ?? false,
        trigger: opts.trigger,
      })
    ) {
      const plan = userRes.data.plan ?? 'free';
      console.log(
        '[mp sync]',
        JSON.stringify({
          user: userId,
          trigger: opts.trigger,
          since: null,
          scanned: 0,
          missing: 0,
          applied: 0,
          repaired: 0,
          audited: 0,
          preapproval: 'unchanged',
          plan,
          status: null,
          ms: Date.now() - started,
          outcome: 'no_subscription',
        }),
      );
      return base({ outcome: 'no_subscription', plan, status: null });
    }

    const windowMs = syncWindowMs({
      force: opts.force ?? false,
      status: sub?.status ?? null,
    });

    let leaseAtMs: number | null = null;

    if (sub) {
      const lastSyncedMs = parseMs(sub.last_synced_at);
      if (lastSyncedMs != null && started - lastSyncedMs < windowMs) {
        return base({
          outcome: 'cooldown',
          plan: userRes.data.plan,
          status: sub.status,
          lastSyncedAtMs: lastSyncedMs,
          retryAfterSeconds: retryAfterSeconds(lastSyncedMs, windowMs, started),
        });
      }

      // CAS sobre last_synced_at: dos syncs concurrentes ⇒ solo uno gana.
      const leaseQuery = service
        .from('subscriptions')
        .update({ last_synced_at: new Date(started).toISOString() })
        .eq('user_id', userId);
      const lease =
        sub.last_synced_at == null
          ? await leaseQuery.is('last_synced_at', null).select('user_id')
          : await leaseQuery.eq('last_synced_at', sub.last_synced_at).select('user_id');

      if (lease.error) {
        // Error de DB (no carrera): no se disfraza de cooldown.
        console.error('[mp sync lease]:', lease.error.message);
        return base({
          outcome: 'error',
          plan: userRes.data.plan,
          status: sub.status,
        });
      }
      if (!lease.data || lease.data.length === 0) {
        const re = await service
          .from('subscriptions')
          .select('last_synced_at')
          .eq('user_id', userId)
          .maybeSingle<{ last_synced_at: string | null }>();
        const last = parseMs(re.data?.last_synced_at ?? null);
        return base({
          outcome: 'cooldown',
          plan: userRes.data.plan,
          status: sub.status,
          lastSyncedAtMs: last,
          retryAfterSeconds: last
            ? retryAfterSeconds(last, windowMs, Date.now())
            : Math.ceil(windowMs / 1000),
        });
      }
      leaseAtMs = started;
    }

    /* 3) Watermark (R12.4) con fallbacks. */
    let watermarkMs = parseMs(sub?.last_checkout_at ?? null);
    if (watermarkMs == null) watermarkMs = parseMs(sub?.created_at ?? null);
    if (watermarkMs == null) {
      const intent = await service
        .from('checkout_intents')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string }>();
      if (intent.error) console.error('[mp sync intent read]:', intent.error.message);
      watermarkMs = parseMs(intent.data?.created_at ?? null);
    }

    if (watermarkMs == null) {
      const final = await realignUsersPlan(userId);
      console.log(
        '[mp sync]',
        JSON.stringify({
          user: userId,
          trigger: opts.trigger,
          since: null,
          scanned: 0,
          missing: 0,
          applied: 0,
          repaired: 0,
          audited: 0,
          preapproval: 'unchanged',
          plan: final.plan,
          status: final.status,
          ms: Date.now() - started,
          outcome: 'no_watermark',
        }),
      );
      return base({
        outcome: 'no_watermark',
        plan: final.plan,
        status: final.status,
        lastSyncedAtMs: leaseAtMs,
      });
    }

    /* 4) Reintento de emails pendientes de corridas anteriores (R12.7).
     * Limitado por el deadline: el render on-read no espera 10 envíos. */
    const emails = await retryPendingPaymentEmails(
      userId,
      opts.trigger === 'manual' ? 10 : 2,
      deadline,
    );
    if (emails.sent > 0 || emails.failed > 0) {
      console.log(
        '[mp sync emails]',
        JSON.stringify({ user: userId, ...emails }),
      );
    }

    /* 5) Preapproval: adoptar si falta (R12.8); leer al final.
     * Sin fila de ciclo, `users.mp_preapproval_id` es la única memoria del
     * último preapproval adoptado: evita re-buscarlo en cada verificación
     * manual. Con fila, manda `subscriptions.preapproval_id` (una re-alta
     * puede haber creado uno nuevo y el hint de users quedar viejo). */
    let preapprovalId =
      sub?.preapproval_id ?? (sub ? null : userRes.data.mp_preapproval_id) ?? null;
    let preapproval: NonNullable<SyncOutcome['preapproval']> = 'unchanged';

    if (!preapprovalId && sub?.status !== 'revocada') {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        const searchPre = await searchPreapprovalsByExternalReference(userId, {
          limit: 50,
          timeoutMs: preapprovalSearchTimeoutMs({
            trigger: opts.trigger,
            remainingMs: remaining,
          }),
        });
        const ownPreapprovals = searchPre.ok
          ? searchPre.data.filter((p) => p.externalReference === userId)
          : [];
        if (ownPreapprovals.length > 0) {
          const newest = [...ownPreapprovals].sort(
            (a, b) => (parseMs(b.dateCreated) ?? 0) - (parseMs(a.dateCreated) ?? 0),
          )[0];
          preapprovalId = newest.id;
          if (sub) {
            const updSub = await service
              .from('subscriptions')
              .update({ preapproval_id: preapprovalId })
              .eq('user_id', userId);
            if (updSub.error)
              console.error('[mp sync preapproval adopt sub]:', updSub.error.message);
          }
          const updUser = await service
            .from('users')
            .update({ mp_preapproval_id: preapprovalId })
            .eq('id', userId);
          if (updUser.error) console.error('[mp sync preapproval adopt user]:', updUser.error.message);
          preapproval = 'adopted';
        } else if (!searchPre.ok) {
          preapproval = 'unavailable';
        }
      }
    }

    /* 6) Búsqueda de pagos (R12.1/R12.5), cap 100 en páginas de 50. */
    const candidates: PaymentCandidate[] = [];
    let searchFailed = false;

    for (let offset = 0; offset < SYNC_MAX_PAYMENTS; offset += SYNC_PAGE_SIZE) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.warn('[mp sync] presupuesto agotado en la búsqueda');
        break;
      }
      const page = await searchPaymentsByExternalReference(userId, {
        limit: SYNC_PAGE_SIZE,
        offset,
        timeoutMs: remaining,
      });
      if (!page.ok) {
        searchFailed = true;
        console.error('[mp sync search]:', page.status, page.message);
        break;
      }

      for (const item of page.data.items) {
        if (item.externalReference !== userId) continue;
        const dateMs = parseMs(item.dateCreated) ?? parseMs(item.dateLastUpdated);
        if (dateMs == null) {
          console.warn('[mp sync] pago sin fecha parseable:', item.id);
          continue;
        }
        const refunded = item.transactionAmountRefunded ?? 0;
        let status = item.status;
        if (item.status === 'approved' && refunded > 0) {
          status =
            item.transactionAmount != null && refunded >= item.transactionAmount
              ? 'refunded'
              : 'partially_refunded';
        }
        candidates.push({
          id: item.id,
          dateCreatedMs: dateMs,
          externalReference: item.externalReference,
          status,
          refundedAmount: refunded,
        });
      }

      if (page.data.items.length < SYNC_PAGE_SIZE) break;
      if (
        page.data.total != null &&
        page.data.total > SYNC_MAX_PAYMENTS &&
        offset + SYNC_PAGE_SIZE >= SYNC_MAX_PAYMENTS
      ) {
        console.warn('[mp sync] truncated:', page.data.total);
      }
    }

    /* 7) Locales + selección pura. */
    const localsRes = await service
      .from('payments')
      .select('mp_payment_id, status, applied_at, occurred_at, refunded_amount')
      .eq('user_id', userId);
    if (localsRes.error) {
      console.error('[mp sync locals read]:', localsRes.error.message);
      return base({
        outcome: 'error',
        plan: userRes.data.plan,
        status: sub?.status ?? null,
        lastSyncedAtMs: leaseAtMs,
      });
    }

    const locals: LocalPayment[] = (localsRes.data ?? []).map(
      (row: {
        mp_payment_id: number | string;
        status: string;
        applied_at: string | null;
        occurred_at: string;
        refunded_amount: number | string | null;
      }) => ({
        mpPaymentId: Number(row.mp_payment_id),
        status: row.status,
        appliedAtMs: parseMs(row.applied_at),
        occurredAtMs: parseMs(row.occurred_at) ?? 0,
        refundedAmount: Number(row.refunded_amount ?? 0),
      }),
    );

    const toApply = selectPaymentsToApply(candidates, locals, watermarkMs, userId);
    const toAudit = selectPaymentsToAudit(candidates, locals, watermarkMs, userId);
    const missing = toApply.length + toAudit.length;

    let applied = 0;
    let repaired = 0;
    let audited = 0;
    let errors = 0;
    let pulled = 0;
    let lastReceiptUrl: string | null = null;

    /* 8) Aplicar en orden cronológico (R12.5). */
    for (const item of toApply) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.warn('[mp sync] presupuesto agotado aplicando pagos');
        break;
      }
      const fetched = await getPayment(String(item.id), { timeoutMs: remaining });
      if (!fetched.ok) {
        errors++;
        console.error('[mp sync payment pull]:', item.id, fetched.status, fetched.message);
        continue;
      }
      pulled++;
      const result = await applyPayment(fetched.data, {
        userId,
        source: 'sync',
        watermarkMs,
        deadlineMs: deadline,
      });
      if (result.action === 'inserted') applied++;
      else if (result.action === 'repaired') repaired++;
      else if (result.action === 'adjusted') repaired++;
      else if (result.action === 'audited') audited++;
      else if (result.action === 'error') errors++;
      if (result.receiptUrl) lastReceiptUrl = result.receiptUrl;
    }

    /* 9) Auditar pagos viejos faltantes, si queda presupuesto. */
    for (const item of toAudit) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.warn('[mp sync] presupuesto agotado auditando pagos viejos');
        break;
      }
      const fetched = await getPayment(String(item.id), { timeoutMs: remaining });
      if (!fetched.ok) {
        errors++;
        console.error('[mp sync audit pull]:', item.id, fetched.status, fetched.message);
        continue;
      }
      const result = await applyPayment(fetched.data, {
        userId,
        source: 'sync',
        watermarkMs,
        deadlineMs: deadline,
      });
      if (result.action === 'audited') audited++;
      else if (result.action === 'error') errors++;
    }

    /* 10) Preapproval: cancelled/paused ⇒ cierre programado (R12.8/R9). */
    if (preapprovalId) {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        const pre = await getPreapproval(preapprovalId, { timeoutMs: remaining });
        if (!pre.ok) {
          preapproval = 'unavailable';
          console.error('[mp sync preapproval]:', pre.status, pre.message);
        } else if (pre.data.status === 'cancelled' || pre.data.status === 'paused') {
          const closed = await applyPreapproval(pre.data, {
            userId,
            source: 'sync',
            deadlineMs: deadline,
          });
          if (closed.action === 'closed') preapproval = 'closed';
          else if (closed.action === 'error') errors++;
        }
      }
    }

    /* 11) Realineo final de users.plan. */
    const final = await realignUsersPlan(userId);

    if (!lastReceiptUrl) {
      const receipt = await service
        .from('payments')
        .select('receipt_url')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .not('receipt_url', 'is', null)
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ receipt_url: string | null }>();
      lastReceiptUrl = receipt.data?.receipt_url ?? null;
    }

    const outcome: SyncOutcomeKind =
      searchFailed && candidates.length === 0 && locals.length === 0
        ? 'mp_unavailable'
        : toApply.length > 0 && pulled === 0 && errors > 0
          ? 'mp_unavailable'
          : errors > 0 && applied + repaired + audited === 0
            ? 'error'
            : 'ok';

    console.log(
      '[mp sync]',
      JSON.stringify({
        user: userId,
        trigger: opts.trigger,
        since: new Date(watermarkMs).toISOString(),
        scanned: candidates.length,
        missing,
        applied,
        repaired,
        audited,
        preapproval,
        plan: final.plan,
        status: final.status,
        ms: Date.now() - started,
        outcome,
      }),
    );

    return base({
      outcome,
      found: candidates.length,
      missing,
      applied,
      repaired,
      audited,
      plan: final.plan,
      status: final.status,
      receiptUrl: lastReceiptUrl,
      preapproval,
      warning: searchFailed ? 'MP_UNAVAILABLE' : undefined,
      localsCount: locals.length,
      lastSyncedAtMs: leaseAtMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error inesperado';
    console.error('[mp sync error]:', message);
    return base({ outcome: 'error' });
  }
}
