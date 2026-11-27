import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  cancelUserSubscription,
  type CancelSubscriptionFailureReason,
} from '@/lib/payments/cancel';

/* ============================================================================
 * /api/billing/cancel — BAJA DE LA SUSCRIPCIÓN PRO DESDE LA APP (R9)
 * ----------------------------------------------------------------------------
 * Contrato:
 *   · Sesión obligatoria ⇒ 401 AUTH_REQUIRED.
 *   · Sin body. Cualquier `preapproval_id` del cliente se IGNORA: el id sale
 *     de `subscriptions.preapproval_id` del usuario de la sesión.
 *   · Solo `activa`/`gracia` ⇒ el resto 409; cancela el débito y conserva PRO
 *     hasta `period_end`. La baja estándar NO reembolsa.
 *   · El reembolso total vive únicamente en el Botón de Arrepentimiento
 *     (`/api/legal/arrepentimiento`), dentro de los 10 días corridos.
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
};

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const result = await cancelUserSubscription(user.id);

  if (!result.ok) {
    const failure = FAILURES[result.reason];
    console.error(
      '[billing cancel]:',
      JSON.stringify({
        user: user.id,
        reason: result.reason,
        detail: result.detail ?? null,
        periodEndMs: result.periodEndMs ?? null,
      }),
    );
    return NextResponse.json(
      {
        error: failure.error,
        periodEndMs: result.periodEndMs ?? null,
      },
      { status: failure.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true as const,
      status: result.status,
      periodEndMs: result.periodEndMs,
      alreadyCancelled: result.alreadyCancelled,
      warning: result.warning,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
