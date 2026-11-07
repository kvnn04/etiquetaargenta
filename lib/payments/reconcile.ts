/* ============================================================================
 * RECONCILIACIÓN AL-VUELO — posición 10B (spec_pagos.md R8 + §8-job nocturno)
 * ----------------------------------------------------------------------------
 * Decisión del titular: SIN pg_cron (no hay deploy aún) — cada LECTURA de
 * plan del server resuelve el estado del ciclo ANTES de renderizar:
 *   1. **Ventanas vencidas** (pure local, 0 red): gracia cuyo plazo pasó /
 *      period_end del cierre programado superado ⇒ `gracia_vencida` de la
 *      máquina (downgrade a FREE preservando proyectos/assets/links — R8).
 *   2. **Drift contra MP API** (pull de preapproval, SOLO si la fila está
 *      viva): un `cancelled`/`paused` en MP que no llegó por webhook ⇒
 *      cierre programado (neutraliza el candado tardío).
 *   3. **Resteo de `users.plan`**: si el gating quedó atascado (p. ej. free
 *      mientras la gracia vive) se re-alinea con `resolvePlan` (R8 + la
 *      fuente del gating sigue siendo users.plan — permissions.ts).
 * Siempre idempotente y con CAS (`WHERE status = current`): puede correr en
 * cada request sin economía rara. El pull a MP se salta si falta el token o
 * si la fila ya no está viva (fail-soft, jamás rompe el render).
 *
 * ANCLAJE: editor page + perfil page la invocan ANTES de leer users.plan.
 * El webhook es quien FALLA el estado normal; esto repara drift y ventanas.
 * ============================================================================ */

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { Plan } from '@/lib/permissions';
import {
  cycleAnchorDayOfStr,
  cancelationPeriodEndMs,
  resolvePlan,
  transitionSubscription,
  type SubscriptionCursor,
  type SubscriptionStatus,
} from '@/lib/payments/core';
import { getPreapproval, hasMercadoPagoCredentials } from '@/lib/payments/mercadopago';

export interface ReconcileOutcome {
  statusBefore: SubscriptionStatus | null;
  statusAfter: SubscriptionStatus | null;
  planBefore: Plan;
  planAfter: Plan;
  touched: boolean;
  reason:
    | 'sin_fila'
    | 'ventana_vencida'
    | 'cancelacion_mp_conocida_async'
    | 'plan_realineado'
    | 'sano';
}

interface SubDbRow {
  status: SubscriptionStatus;
  cycle_anchor: string | null;
  grace_expires_at: string | null;
  period_end: string | null;
}

const isoToMs = (iso: string | null): number | null =>
  iso ? (Number.isNaN(Date.parse(iso)) ? null : Date.parse(iso)) : null;

/**
 * Resuelve el ciclo del usuario ANTES de que cualquier página server decida
 * candados. `deleted_at` NO se mira acá: si la cuenta está eliminada las
 * rutas de auth ya cortan el flujo antes.
 */
export async function reconcileUserCycle(userId: string): Promise<ReconcileOutcome> {
  const service = createSupabaseServiceClient();

  const [subResult, userResult] = await Promise.all([
    service
      .from('subscriptions')
      .select('status, cycle_anchor, grace_expires_at, period_end')
      .eq('user_id', userId)
      .maybeSingle<SubDbRow>(),
    service.from('users').select('plan, grace_expires_at').eq('id', userId).maybeSingle<{
      plan: Plan;
      grace_expires_at: string | null;
    }>(),
  ]);

  if (userResult.error) {
    console.error('[reconcile users read]:', userResult.error.message);
  }
  if (subResult.error) {
    console.error('[reconcile subs read]:', subResult.error.message);
  }

  const planBefore: Plan = userResult.data?.plan ?? 'free';
  const sub = subResult.data ?? null;
  if (!sub) {
    return {
      statusBefore: null,
      statusAfter: null,
      planBefore,
      planAfter: planBefore,
      touched: false,
      reason: 'sin_fila',
    };
  }

  const now = Date.now();
  const graceMs = isoToMs(sub.grace_expires_at);
  const periodMs = isoToMs(sub.period_end);
  const anchorDay = cycleAnchorDayOfStr(sub.cycle_anchor ?? '');

  /* ---------- 1) Ventanas vencidas (LOOK MA: cero llamadas a MP) ---------- */
  const vencidas =
    (sub.status === 'gracia' && graceMs == null) ||
    (sub.status === 'gracia' && graceMs != null && now >= graceMs) ||
    (sub.status === 'programada_cierre' && (periodMs == null || now >= periodMs));
  if (vencidas) {
    const patch = transitionSubscription(sub.status === 'gracia' ? 'gracia' : 'programada_cierre', {
      kind: 'gracia_vencida',
    });
    if (patch) {
      const cas = await service
        .from('subscriptions')
        .update({
          status: patch.status,
          grace_expires_at: null,
          period_end: null,
        })
        .eq('user_id', userId)
        .eq('status', sub.status)
        .select('status');
      if (cas.error) console.error('[reconcile sub update]:', cas.error.message);

      await service
        .from('users')
        .update({ plan: 'free', grace_expires_at: null })
        .eq('id', userId);
      console.log(
        '[reconcile QA registro]',
        JSON.stringify({ user: userId, reason: 'ventana_vencida', from: sub.status, at: now }),
      );
      return {
        statusBefore: sub.status,
        statusAfter: patch.status,
        planBefore,
        planAfter: 'free',
        touched: true,
        reason: 'ventana_vencida',
      };
    }
  }

  /* ---------- 2) Drift contra MP (pull SOLO si el estado sigue vivo) ------ */
  if (
    sub.status === 'activa' ||
    (sub.status === 'gracia' && graceMs != null && now < graceMs) ||
    (sub.status === 'programada_cierre' && periodMs != null && now < periodMs)
  ) {
    // Sin preapproval_id (cuenta vieja de antes de 10B): nada que pullear.
    const preapprovalRes = hasMercadoPagoCredentials()
      ? await service
          .from('subscriptions')
          .select('preapproval_id')
          .eq('user_id', userId)
          .maybeSingle<{ preapproval_id: string | null }>()
      : null;
    const preapprovalId = preapprovalRes?.data?.preapproval_id ?? null;
    if (preapprovalId) {
      const pre = await getPreapproval(preapprovalId);
      if (pre.ok && (pre.data.status === 'cancelled' || pre.data.status === 'paused')) {
        const periodEnd =
          cancelationPeriodEndMs(sub.status, {
            graceExpiresAtMs: graceMs,
            anchorDay,
            nowMs: now,
          }) ?? now;
        const patch = transitionSubscription(sub.status, {
          kind: 'cancelacion_programada',
          periodEndMs: periodEnd,
        });
        if (patch) {
          const cas = await service
            .from('subscriptions')
            .update({
              status: patch.status,
              period_end: new Date(periodEnd).toISOString(),
              grace_expires_at: null,
            })
            .eq('user_id', userId)
            .eq('status', sub.status)
            .select('status');
          if (cas.error) console.error('[reconcile sub update]:', cas.error.message);
          console.log(
            '[reconcile QA registro]',
            JSON.stringify({
              user: userId,
              reason: 'cancelacion_mp_conocida_async',
              mpStatus: pre.data.status,
              at: now,
            }),
          );
          return {
            statusBefore: sub.status,
            statusAfter: patch.status,
            planBefore,
            planAfter: resolvePlan(
              { status: patch.status, graceExpiresAtMs: null, periodEndMs: periodEnd },
              now,
            ),
            touched: true,
            reason: 'cancelacion_mp_conocida_async',
          };
        }
      }
    }
  }

  /* ---------- 3) users.plan desalineado con el estado real --------------- */
  const cursor: SubscriptionCursor = {
    status: sub.status,
    graceExpiresAtMs: graceMs,
    periodEndMs: periodMs,
  };
  const planExpected = resolvePlan(cursor, now);
  if (planBefore !== planExpected) {
    const usersUpdate: Record<string, unknown> = { plan: planExpected };
    if (sub.status !== 'gracia') usersUpdate.grace_expires_at = null;
    const res = await service.from('users').update(usersUpdate).eq('id', userId);
    if (res.error) console.error('[reconcile users update]:', res.error.message);
    console.log(
      '[reconcile QA registro]',
      JSON.stringify({ user: userId, reason: 'plan_realineado', from: planBefore, to: planExpected }),
    );
    return {
      statusBefore: sub.status,
      statusAfter: sub.status,
      planBefore,
      planAfter: planExpected,
      touched: true,
      reason: 'plan_realineado',
    };
  }

  return {
    statusBefore: sub.status,
    statusAfter: sub.status,
    planBefore,
    planAfter: planExpected,
    touched: false,
    reason: 'sano',
  };
}
