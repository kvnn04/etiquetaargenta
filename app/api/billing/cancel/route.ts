import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  cancelUserSubscription,
  type CancelMode,
  type CancelSubscriptionFailureReason,
} from '@/lib/payments/cancel';

/* ============================================================================
 * /api/billing/cancel — BAJA DE LA SUSCRIPCIÓN PRO DESDE LA APP (R9)
 * ----------------------------------------------------------------------------
 * Contrato:
 *   · Sesión obligatoria ⇒ 401 AUTH_REQUIRED.
 *   · Body opcional `{ mode: 'end_of_cycle' | 'immediate' }`. Default:
 *     `end_of_cycle`. Cualquier `preapproval_id` del cliente se IGNORA: el id
 *     sale de `subscriptions.preapproval_id` del usuario de la sesión.
 *   · `end_of_cycle`: sólo `activa`/`gracia` ⇒ el resto 409; cancela el débito
 *     y conserva PRO hasta `period_end`.
 *   · `immediate`: cotiza el reembolso, cancela el débito, reembolsa en MP y
 *     SOLO con 200/201 baja el plan (`revocada`, `closure_reason='cancel'`).
 *     Sin saldo (menos de 24 h, ciclo vencido, sin pago) ⇒ cae a fin de ciclo.
 *     Si MP rechaza el reembolso ⇒ 502 REFUND_FAILED, PRO sigue hasta
 *     `period_end` y se alerta para reintentar.
 * ========================================================================== */

export const dynamic = 'force-dynamic';

const FAILURES: Record<
  CancelSubscriptionFailureReason,
  { status: number; error: string }
> = {
  mp_config: { status: 503, error: 'PAGOS_NO_CONFIGURADOS' },
  no_subscription: { status: 409, error: 'SIN_SUSCRIPCION' },
  not_cancelable: { status: 409, error: 'SUSCRIPCION_NO_CANCELABLE' },
  missing_preapproval: { status: 409, error: 'SIN_PREAPPROVAL' },
  ownership: { status: 409, error: 'TITULARIDAD_NO_VALIDADA' },
  mp_unavailable: { status: 502, error: 'MP_UNAVAILABLE' },
  db: { status: 503, error: 'PERSIST_UNAVAILABLE' },
  refund_in_progress: { status: 409, error: 'REEMBOLSO_EN_CURSO' },
  refund_failed: { status: 502, error: 'REFUND_FAILED' },
  refund_not_eligible: { status: 409, error: 'REEMBOLSO_NO_ELEGIBLE' },
};

function parseMode(raw: unknown): CancelMode | null {
  if (raw == null) return 'end_of_cycle';
  return raw === 'end_of_cycle' || raw === 'immediate' ? raw : null;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { mode?: unknown }
    | null;
  const mode = parseMode(body?.mode);
  if (!mode) {
    return NextResponse.json(
      { error: 'MODO_INVALIDO' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await cancelUserSubscription(user.id, { mode });

  if (!result.ok) {
    const failure = FAILURES[result.reason];
    console.error(
      '[billing cancel]:',
      JSON.stringify({
        user: user.id,
        mode,
        reason: result.reason,
        detail: result.detail ?? null,
        periodEndMs: result.periodEndMs ?? null,
      }),
    );
    return NextResponse.json(
      {
        error: failure.error,
        mode,
        periodEndMs: result.periodEndMs ?? null,
        refund: result.refund ?? null,
      },
      { status: failure.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true as const,
      mode: result.mode,
      status: result.status,
      periodEndMs: result.periodEndMs,
      alreadyCancelled: result.alreadyCancelled,
      warning: result.warning,
      refund: result.refund,
      refundId: result.refundId,
      fallbackReason: result.fallbackReason,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
