import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hasMercadoPagoCredentials } from '@/lib/payments/mercadopago';
import { SYNC_MANUAL_COOLDOWN_MS, syncUserCycle } from '@/lib/payments/sync';

/* ============================================================================
 * /api/billing/refresh — "VERIFICO DE NUEVO" REAL (posición 11)
 * ÚNICA FUENTE: spec_sync_de_pagos_y_reverificacion.md §3.5 + R12.1/R12.3.
 * ----------------------------------------------------------------------------
 * Contrato:
 *   · Sesión obligatoria ⇒ 401 AUTH_REQUIRED.
 *   · Sin body; cualquier userId del cliente se IGNORA (solo manda la sesión).
 *   · Sin MP_ACCESS_TOKEN ⇒ 503 PAGOS_NO_CONFIGURADOS.
 *   · Cooldown de 20 s por usuario ⇒ 429 SYNC_COOLDOWN + retryAfterSeconds.
 *   · Fuerza syncUserCycle(trigger:'manual', force:true).
 *   · 200 { ok, found, applied, repaired, plan, status, checkedAt, receiptUrl? }.
 *   · 502 MP_UNAVAILABLE si MP falla y no hay estado local que mostrar.
 * El servidor ya mutó antes del 200: el cliente solo refresca el render.
 * ========================================================================== */

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  if (!hasMercadoPagoCredentials()) {
    console.error('[billing refresh]: MP_ACCESS_TOKEN ausente — no se puede verificar');
    return NextResponse.json({ error: 'PAGOS_NO_CONFIGURADOS' }, { status: 503 });
  }

  const result = await syncUserCycle(user.id, { trigger: 'manual', force: true });

  if (result.outcome === 'cooldown') {
    const retryAfterSeconds = result.retryAfterSeconds ?? Math.ceil(SYNC_MANUAL_COOLDOWN_MS / 1000);
    return NextResponse.json(
      { error: 'SYNC_COOLDOWN', retryAfterSeconds },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store' },
      },
    );
  }

  if (result.outcome === 'user_missing' || result.outcome === 'deleted') {
    return NextResponse.json({ error: 'USER_NOT_AVAILABLE' }, { status: 409 });
  }

  if (result.outcome === 'mp_unavailable' || result.outcome === 'error') {
    return NextResponse.json(
      {
        error: 'MP_UNAVAILABLE',
        plan: result.plan,
        status: result.status,
        checkedAt: result.checkedAt,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true as const,
      found: result.found,
      applied: result.applied,
      repaired: result.repaired,
      audited: result.audited,
      plan: result.plan,
      status: result.status,
      checkedAt: result.checkedAt,
      receiptUrl: result.receiptUrl ?? null,
      preapproval: result.preapproval ?? 'unchanged',
      warning: result.warning ?? null,
      retryAfterSeconds: Math.ceil(SYNC_MANUAL_COOLDOWN_MS / 1000),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
