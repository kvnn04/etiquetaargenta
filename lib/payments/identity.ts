/* ============================================================================
 * IDENTIDAD DE WEBHOOKS CON PLAN — piezas PURAS (spec_pagos_plan_mp.md §5.3)
 * ----------------------------------------------------------------------------
 * El checkout con plan crea un preapproval que puede NO heredar el
 * `external_reference` del plan. La identidad se resuelve por varias fuentes:
 *   · external_reference → users.id
 *   · preapproval_plan_id → mp_preapproval_plans.user_id
 *   · preapproval_id → subscriptions.user_id
 * Regla de oro: si dos fuentes apuntan a usuarios DISTINTOS, no se elige una
 * al azar: el evento se ignora con log (identity_conflict). `payer_email`
 * jamás es identidad.
 * ========================================================================== */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | null | undefined): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

export type IdentitySource = 'external_reference' | 'preapproval_plan' | 'preapproval_id';

export interface IdentityCandidate {
  source: IdentitySource;
  /** null/undefined = la fuente no produjo candidato. */
  userId: string | null | undefined;
}

export type IdentityDecision =
  | { userId: string; source: IdentitySource; conflict: false }
  | { userId: null; source: null; conflict: boolean };

const SOURCE_PRIORITY: Record<IdentitySource, number> = {
  external_reference: 0,
  preapproval_plan: 1,
  preapproval_id: 2,
};

/**
 * Une los candidatos resueltos por DB/API. Devuelve el usuario SOLO si hay una
 * única identidad distinta. Si hay conflicto, `userId: null` y `conflict: true`.
 */
export function chooseIdentity(candidates: IdentityCandidate[]): IdentityDecision {
  const valid = candidates.filter(
    (candidate): candidate is { source: IdentitySource; userId: string } =>
      typeof candidate.userId === 'string' && candidate.userId.length > 0,
  );
  const distinct = new Set(valid.map((candidate) => candidate.userId));
  if (distinct.size === 0) return { userId: null, source: null, conflict: false };
  if (distinct.size > 1) return { userId: null, source: null, conflict: true };

  const userId = valid[0].userId;
  const source = valid
    .filter((candidate) => candidate.userId === userId)
    .sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])[0].source;
  return { userId, source, conflict: false };
}

/**
 * ¿El preapproval pertenece al intento vigente de la fila local?
 *   · si la fila local ya tiene `preapproval_id`, ese ID manda: un preapproval
 *     distinto es un intento viejo/duplicado (aunque comparta el plan);
 *   · sin preapproval local, manda el plan del intento;
 *   · sin intento previo registrado, el primero que llega es vigente.
 */
export function isCurrentPreapprovalAttempt(input: {
  preapprovalId: string;
  preapprovalPlanId: string | null;
  subPreapprovalId: string | null;
  subPreapprovalPlanId: string | null;
}): boolean {
  if (input.subPreapprovalId) {
    return input.subPreapprovalId === input.preapprovalId;
  }
  if (input.subPreapprovalPlanId) {
    return input.preapprovalPlanId === input.subPreapprovalPlanId;
  }
  return true;
}

export type PreapprovalEventDecision =
  | 'apply'
  | 'ignore_stale_live'
  | 'ignore_stale_cancelled';

/**
 * Política de eventos tardíos:
 *   · un preapproval que no pertenece al intento vigente NUNCA muta la fila:
 *     un intento viejo no puede cerrar, pausar ni re-vincular la suscripción
 *     nueva (ni siquiera si llega `authorized` después de un checkout nuevo);
 *   · el resto se aplica (`authorized`/`pending` solo vinculan IDs).
 * El motivo distingue suscripción viva de intento abandonado, para el log.
 */
export function preapprovalEventDecision(input: {
  preapprovalStatus: string;
  isCurrentAttempt: boolean;
  isSubscriptionLive: boolean;
}): PreapprovalEventDecision {
  if (!input.isCurrentAttempt) {
    return input.isSubscriptionLive ? 'ignore_stale_live' : 'ignore_stale_cancelled';
  }
  return 'apply';
}
