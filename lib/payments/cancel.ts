/* ============================================================================
 * CANCELACIÓN DE SUSCRIPCIÓN DESDE LA APP — R9
 * ----------------------------------------------------------------------------
 * Server-only. El `preapproval_id` NO viene del cliente: se resuelve desde la
 * sesión (`subscriptions.preapproval_id`) para que nadie pueda cancelar la
 * suscripción de otro usuario.
 *
 * Orden del flujo:
 *   1. credenciales + fila local de `subscriptions`;
 *   2. sólo `activa`/`gracia` (una `programada_cierre` ya está cancelada);
 *   3. GET /preapproval/{id} y titularidad (`external_reference` o mapping del plan);
 *   4. PUT /preapproval/{id} { status: 'cancelled' } con el helper oficial;
 *   5. aplicar la máquina R9 con `applyPreapproval` (mismo camino que webhook
 *      y baja legal): `programada_cierre` + `period_end` + email.
 *
 * Si MP cancela pero la escritura local falla, el sync de `/perfil` converge
 * al leer el preapproval `cancelled`; se devuelve `LOCAL_SYNC_PENDING` para
 * que la UI no prometa un estado que todavía no está en la base.
 * ========================================================================== */

import { applyPreapproval } from '@/lib/payments/apply';
import {
  isCancelableSubscriptionStatus,
  type SubscriptionStatus,
} from '@/lib/payments/core';
import {
  cancelPreapproval,
  getPreapproval,
  hasMercadoPagoCredentials,
} from '@/lib/payments/mercadopago';
import {
  createSupabaseServiceClient,
  hasServiceCredentials,
} from '@/lib/supabase/service';

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

function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Cancela la suscripción PRO del usuario autenticado.
 *
 * El llamador NUNCA pasa un `preapproval_id`: se resuelve con `userId`, que a
 * su vez sale de la sesión en el route. La verificación de titularidad contra
 * MP (external_reference o mapping plan → usuario) es la última barrera contra
 * una fila local contaminada o un id ajeno.
 */
export async function cancelUserSubscription(
  userId: string,
): Promise<CancelSubscriptionResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'db' };
  if (!hasMercadoPagoCredentials()) return { ok: false, reason: 'mp_config' };

  const service = createSupabaseServiceClient();
  const { data: sub, error: subError } = await service
    .from('subscriptions')
    .select('status, preapproval_id, preapproval_plan_id, period_end')
    .eq('user_id', userId)
    .maybeSingle<SubscriptionRow>();

  if (subError) {
    console.error('[billing cancel sub]:', subError.message);
    return { ok: false, reason: 'db', detail: subError.message };
  }
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

  const preapprovalId = sub.preapproval_id;
  if (!preapprovalId) return { ok: false, reason: 'missing_preapproval' };

  /* 1) Lectura autoritativa antes de cancelar: jamás un preapproval ajeno. */
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

  /* 2) PUT oficial. Si MP ya la tenía cancelada (p. ej. Portal) se saltea el
   * verbo y se aplica el estado local sin mandar un email con origen falso. */
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

  /* 3) Máquina R9 compartida: programa el cierre y conserva PRO hasta
   * `period_end`. El email sale con el origen "app" (mailScheduledClose). */
  const applied = await applyPreapproval(
    { ...current.data, status: 'cancelled', preapprovalPlanId },
    {
      userId,
      source: 'app',
      suppressEmail: alreadyCancelled,
    },
  );

  /* 4) Releer el estado local: el webhook pudo ganar el CAS y ya haber
   * programado el cierre (mismo resultado, sin email duplicado). */
  const { data: after, error: afterError } = await service
    .from('subscriptions')
    .select('status, period_end')
    .eq('user_id', userId)
    .maybeSingle<SubscriptionAfterRow>();
  if (afterError) console.error('[billing cancel reread]:', afterError.message);

  const localStatus = after?.status ?? sub.status;
  const periodEndMs =
    applied.action === 'closed'
      ? applied.periodEndMs ?? isoToMs(after?.period_end ?? sub.period_end)
      : isoToMs(after?.period_end ?? sub.period_end);
  const warning = localStatus === 'programada_cierre' ? null : 'LOCAL_SYNC_PENDING';

  if (applied.action === 'error') {
    console.error(
      '[billing cancel apply]:',
      JSON.stringify({ user: userId, preapproval: preapprovalId, warning }),
    );
  }

  console.log(
    '[billing cancel QA registro]',
    JSON.stringify({
      user: userId,
      preapproval: preapprovalId,
      ownershipBasis,
      alreadyCancelled,
      apply: applied.action,
      localStatus,
      warning,
    }),
  );

  return {
    ok: true,
    status: localStatus,
    periodEndMs,
    alreadyCancelled,
    warning,
  };
}
