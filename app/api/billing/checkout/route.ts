import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createPreapproval,
  hasMercadoPagoCredentials,
} from '@/lib/payments/mercadopago';
import { isPositiveAmount } from '@/lib/payments/core';

/* ============================================================================
 * /api/billing/checkout — ALTA DE SUSCRIPCIÓN (posición 10B)
 * ÚNICA FUENTE: spec_pagos.md §2 Happy Path + §3-R2/R3/R4/R7/R10 + §6.
 * ----------------------------------------------------------------------------
 * TODO server-side (el cliente jamás recalcula plan/precio/fechas). Orden de
 * gates — cada corte responde con código honesto que el modal traduce:
 *   1. Sesión ⇒ user (401 AUTH_REQUIRED).
 *   2. GATE DE EMAIL (§6 + usuario R7): `email_confirmed_at` vacío ⇒ 409
 *      EMAIL_NOT_VERIFIED → paso intermedio del modal. Confirm email queda
 *      OFF en Supabase (decisión del titular: alta sin fricción; el seed de
 *      QA fuerza email_confirmed_at = NULL para ejercitar este paso).
 *   3. Credenciales MP presentes (503 PAGOS_NO_CONFIGURADOS con log — la
 *      setup page ya muestra qué falta).
 *   4. Precio vigente: única fila `pro_monthly_ars` de pricing_config (R3),
 *      validación > 0 y currency ARS (§6) ⇒ 503 PRECIO_NO_DISPONIBLE.
 *   5. Suscripción VIVA (activa / gracia / programada_cierre) ⇒ 409
 *      SUSCRIPCION_VIVA — el paywall no debería verse en esos estados; una
 *      corrida hasta acá delata race (QA2). `inactiva` (downgrade) sigue.
 *   6. `checkout_intents`: UNA fila de auditoría del intento (R10 — cero
 *      emails de recuperación; cf. QA1). fallo= no frena el checkout: es
 *      métrica, no cobro (log).
 *   7. preapproval MP (Checkout Pro, R2): frequency_type months + ARS +
 *      external_reference = user_id + notification_url (túnel/dominio) +
 *      back_urls al origin de navegación del taller.
 *   8. Seed de `subscriptions` { status: 'inactiva', price_frozen vigente }:
 *      el CONGELAMIENTO real lo hace el webhook al aprobarse el cobro con
 *      `freezePrice` de la máquina (R4) usando el monto DEL PAGO.
 * 201 { ok, initPoint, preapprovalId } → el modal redirige (Checkout Pro).
 * ============================================================================
 */

export const dynamic = 'force-dynamic';

const PRO_PRICE_KEY = 'pro_monthly_ars';
const CHECKOUT_REASON = 'Simulador Mates — Plan PRO (suscripción mensual)';

export async function POST(request: NextRequest) {
  /* 1 — sesión */
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  /* 2 — gate de email (QA1: el Checkout JAMÁS se inicia sin verificar) */
  if (!user.email_confirmed_at) {
    console.log('[billing email gate]:', JSON.stringify({ user: user.id }));
    return NextResponse.json({ error: 'EMAIL_NOT_VERIFIED' }, { status: 409 });
  }

  /* 3 — credenciales MP */
  if (!hasMercadoPagoCredentials()) {
    console.error('[billing checkout]: faltan credenciales MP (.env.local)');
    return NextResponse.json({ error: 'PAGOS_NO_CONFIGURADOS' }, { status: 503 });
  }

  const service = createSupabaseServiceClient();

  /* 4 — precio vigente (R3) */
  const { data: priceRow, error: priceErr } = await service
    .from('pricing_config')
    .select('amount, currency')
    .eq('key', PRO_PRICE_KEY)
    .maybeSingle<{ amount: number; currency: string }>();
  if (priceErr) console.error('[billing pricing]:', priceErr.message);
  const amount = priceRow ? Number(priceRow.amount) : Number.NaN;
  if (!priceRow || !isPositiveAmount(amount) || priceRow.currency !== 'ARS') {
    return NextResponse.json({ error: 'PRECIO_NO_DISPONIBLE' }, { status: 503 });
  }

  /* 5 — suscripción viva (race del paywall) */
  const { data: sub, error: subErr } = await service
    .from('subscriptions')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle<{ status: 'inactiva' | 'activa' | 'gracia' | 'programada_cierre' }>();
  if (subErr) console.error('[billing sub read]:', subErr.message);
  if (sub && sub.status !== 'inactiva') {
    console.log('[billing sub viva]:', JSON.stringify({ user: user.id, status: sub.status }));
    return NextResponse.json({ error: 'SUSCRIPCION_VIVA' }, { status: 409 });
  }

  /* 6 — auditoría del intento (R10; el abandono se mide, no se persigue) */
  const intent = await service.from('checkout_intents').insert({ user_id: user.id });
  if (intent.error) {
    console.error('[billing checkout intent]:', intent.error.message); // log: la métrica no frena el cobro
  }

  /* 7 — preapproval (Checkout Pro, R2). Orígenes SEPARADOS: el taller abre
   * el Checkout desde SU origin (cookie de sesión en localhost), mientras MP
   * necesita un endpoint ALCANZABLE para el webhook (túnel QA → MP_PUBLIC_ORIGIN). */
  const webOrigin = request.nextUrl.origin.replace(/\/+$/, '');
  const override = process.env.MP_PUBLIC_ORIGIN?.trim();
  const callbackOrigin = override ? override.replace(/\/+$/, '') : webOrigin;

  const drafted = await createPreapproval({
    reason: CHECKOUT_REASON,
    payerEmail: user.email,
    externalReference: user.id,
    amount,
    backUrls: {
      success: `${webOrigin}/perfil?pago=success`,
      failure: `${webOrigin}/perfil?pago=failure`,
      pending: `${webOrigin}/perfil?pago=pending`,
    },
    notificationUrl: `${callbackOrigin}/api/webhooks/mercadopago`,
    startDateIso: new Date().toISOString(),
  });
  if (!drafted.ok) {
    console.error('[billing preapproval]:', drafted.status, drafted.message);
    return NextResponse.json({ error: 'MP_UNAVAILABLE' }, { status: 502 });
  }

  /* 8 — seed del ciclo: 'inactiva' hasta que el webhook apruebe el cobro.
   * price_frozen TENTATIVO (obliga a la columna NOT NULL); la verdad la fija
   * el cobro aprobado con el patch freezePrice (monto del pago, R4). */
  const seed = await service.from('subscriptions').upsert(
    {
      user_id: user.id,
      preapproval_id: drafted.data.id,
      status: 'inactiva',
      price_frozen: amount,
      currency: 'ARS',
    },
    { onConflict: 'user_id' },
  );
  if (seed.error) {
    console.error('[billing sub seed]:', seed.error.message);
    // log simple: la fila se reconstruye con la primera aprobación, pero logea.
  }

  console.log(
    '[billing QA registro]',
    JSON.stringify({ user: user.id, artifact: 'checkout', preapprovalId: drafted.data.id }),
  );

  return NextResponse.json(
    { ok: true as const, initPoint: drafted.data.initPoint, preapprovalId: drafted.data.id },
    { status: 201 },
  );
}
