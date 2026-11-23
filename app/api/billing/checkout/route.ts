import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { publicRequestOrigin } from '@/lib/http/origin';
import {
  cancelPreapproval,
  createPreapproval,
  hasMercadoPagoCredentials,
} from '@/lib/payments/mercadopago';
import { isPositiveAmount } from '@/lib/payments/core';
import { LEGAL_VERSIONS } from '@/lib/legal/config';
import { checkCheckoutAcceptance } from '@/lib/legal/requests';
import { legalRequestContext, recordCheckoutAcceptances } from '@/lib/legal/service';

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
 *   6. ACEPTACIÓN LEGAL VERSIONADA (R13.7/R13.8): sin checkbox o con versiones
 *      viejas ⇒ 409 LEGAL_NOT_ACCEPTED / LEGAL_VERSION_CHANGED. Si pasa, se
 *      registran DOS filas de evidencia (terms + privacy) ANTES de crear el
 *      preapproval; si la evidencia no se puede guardar ⇒ 503 y NO se cobra.
 *   7. `checkout_intents`: UNA fila de auditoría del intento (R10 — cero
 *      emails de recuperación; cf. QA1). fallo= no frena el checkout: es
 *      métrica, no cobro (log).
 *   8. preapproval MP (Checkout Pro, R2): frequency_type months + ARS +
 *      external_reference = user_id + notification_url (túnel/dominio) +
 *      back_url string al origin de navegación del taller.
 *   9. Seed de `subscriptions` { status: 'inactiva', price_frozen vigente }:
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

  /* 5 — suscripción viva (race del paywall). `revocada` (posición 13) SÍ
   * puede reactivar: crea un checkout NUEVO y jamás reutiliza el preapproval
   * viejo (R11.8/QA7). */
  const { data: sub, error: subErr } = await service
    .from('subscriptions')
    .select('status, preapproval_id')
    .eq('user_id', user.id)
    .maybeSingle<{
      status: 'inactiva' | 'activa' | 'gracia' | 'programada_cierre' | 'revocada';
      preapproval_id: string | null;
    }>();
  if (subErr) console.error('[billing sub read]:', subErr.message);
  if (sub && sub.status !== 'inactiva' && sub.status !== 'revocada') {
    console.log('[billing sub viva]:', JSON.stringify({ user: user.id, status: sub.status }));
    return NextResponse.json({ error: 'SUSCRIPCION_VIVA' }, { status: 409 });
  }
  const oldPreapprovalId = sub?.status === 'revocada' ? sub.preapproval_id : null;

  /* 6 — aceptación legal versionada (R13.7/R13.8). El body es opcional:
   * un cliente viejo sin checkbox recibe 409 LEGAL_NOT_ACCEPTED y el modal
   * muestra el paso legal. La evidencia se guarda ANTES del preapproval. */
  const legalBody = await request.json().catch(() => null);
  const legalGate = checkCheckoutAcceptance(legalBody, LEGAL_VERSIONS);
  if (!legalGate.ok) {
    console.log('[billing legal gate]:', JSON.stringify({ user: user.id, error: legalGate.error }));
    return NextResponse.json({ error: legalGate.error }, { status: 409 });
  }

  const legalContext = legalRequestContext(request);
  const evidence = await recordCheckoutAcceptances({
    userId: user.id,
    email: user.email,
    ip: legalContext.ip === 'unknown' ? null : legalContext.ip,
    userAgent: legalContext.userAgent,
    versions: LEGAL_VERSIONS,
  });
  if (!evidence.ok) {
    console.error('[billing legal evidence]:', evidence.detail);
    return NextResponse.json({ error: 'EVIDENCIA_NO_DISPONIBLE' }, { status: 503 });
  }

  /* 7 — auditoría del intento (R10; el abandono se mide, no se persigue) */
  const intent = await service.from('checkout_intents').insert({ user_id: user.id });
  if (intent.error) {
    console.error('[billing checkout intent]:', intent.error.message); // log: la métrica no frena el cobro
  }

  /* 8 — preapproval (Checkout Pro, R2). Orígenes SEPARADOS: el taller abre
   * el Checkout desde SU origin (cookie de sesión en localhost), mientras MP
   * necesita un endpoint ALCANZABLE para el webhook (túnel QA → MP_PUBLIC_ORIGIN). */
  // Next dev reporta `nextUrl.origin = http://localhost:...` aunque el server
  // escuche en 127.0.0.1; MP rechaza localhost como back_url. El helper usa el
  // Host real y normaliza loopback (QA 23-nov-2026).
  const webOrigin = publicRequestOrigin({
    nextUrlOrigin: request.nextUrl.origin,
    nextUrlProtocol: request.nextUrl.protocol,
    host: request.headers.get('host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
  });
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
    // createPreapproval normaliza el arranque a +5 min: MP rechaza el pasado.
    startDateIso: new Date().toISOString(),
  });
  if (!drafted.ok) {
    console.error('[billing preapproval]:', drafted.status, drafted.message);
    return NextResponse.json({ error: 'MP_UNAVAILABLE' }, { status: 502 });
  }

  /* Reactivación tras revocación: el preapproval viejo NO se reutiliza y, si
   * MP todavía lo tiene vivo, se cancela para que no vuelva a cobrar (Q6).
   * Un fallo de cancelación no frena el alta nueva: se logea. */
  if (oldPreapprovalId && oldPreapprovalId !== drafted.data.id) {
    const cancelled = await cancelPreapproval(oldPreapprovalId);
    if (!cancelled.ok) {
      console.error(
        '[billing preapproval viejo]:',
        oldPreapprovalId,
        cancelled.status,
        cancelled.message,
      );
    }
  }

  /* 9 — seed del ciclo: 'inactiva' hasta que el webhook apruebe el cobro.
   * price_frozen TENTATIVO (obliga a la columna NOT NULL); la verdad la fija
   * el cobro aprobado con el patch freezePrice (monto del pago, R4).
   * `last_checkout_at` es el watermark anti-resurrección (R12.4): cada alta o
   * re-alta corre la ventana. `last_synced_at = null` invalida el TTL para que
   * el primer retorno del checkout verifique contra MP sin esperar 60 s/6 h.
   * Posición 13: se limpian closure_reason/closed_at/gracia/period_end de la
   * revocación anterior — el alta nueva arranca sin deuda visual. */
  const checkoutAt = new Date().toISOString();
  const seed = await service.from('subscriptions').upsert(
    {
      user_id: user.id,
      preapproval_id: drafted.data.id,
      status: 'inactiva',
      price_frozen: amount,
      currency: 'ARS',
      last_checkout_at: checkoutAt,
      last_synced_at: null,
      grace_expires_at: null,
      period_end: null,
      closure_reason: null,
      closed_at: null,
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
