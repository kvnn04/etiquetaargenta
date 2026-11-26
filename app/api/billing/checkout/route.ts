import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkoutBackUrlOrigin } from '@/lib/http/origin';
import {
  cancelPreapproval,
  cancelPreapprovalPlan,
  createPreapprovalPlan,
  getPreapprovalPlan,
  hasMercadoPagoCredentials,
  updatePreapprovalPlanBackUrl,
} from '@/lib/payments/mercadopago';
import { isPositiveAmount } from '@/lib/payments/core';
import { classifyPlanReadFailure } from '@/lib/payments/plan-guard';
import { LEGAL_VERSIONS } from '@/lib/legal/config';
import { checkCheckoutAcceptance } from '@/lib/legal/requests';
import { legalRequestContext, recordCheckoutAcceptances } from '@/lib/legal/service';

/* ============================================================================
 * /api/billing/checkout — ALTA DE SUSCRIPCIÓN (10B + plan MP)
 * ÚNICA FUENTE: spec_pagos.md §2 Happy Path + §3-R2/R3/R4/R7/R10 + §6
 *               spec_pagos_plan_mp.md (checkout con plan).
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
 *      plan; si la evidencia no se puede guardar ⇒ 503 y NO se cobra.
 *   7. `checkout_intents`: UNA fila de auditoría del intento (R10 — cero
 *      emails de recuperación; cf. QA1). fallo= no frena el checkout: es
 *      métrica, no cobro (log).
 *   8. PLAN MP (spec_pagos_plan_mp.md): se REUTILIZA el plan vigente si sigue
 *      activo, es del usuario y conserva precio/moneda; si no, `POST
 *      /preapproval_plan` con external_reference = user_id, ARS/meses y
 *      back_url canónica. Su `init_point` hospedado pide la cuenta del pagador:
 *      el email de Supabase ya no tiene que coincidir con la cuenta que paga.
 *      Si el plan guardado NO es visible con las credenciales de este deploy
 *      (404/401/403) ⇒ 409 PLAN_INCONSISTENTE y NO se crea otro plan: mezclar
 *      entornos test/producción deja la cuenta con dos suscripciones.
 *   9. Mapping `mp_preapproval_plans` (upsert) ANTES de redirigir; si falla ⇒
 *      cancelar SOLO un plan nuevo y 503. Los planes viejos no se cancelan:
 *      pueden tener un checkout abierto en otra pestaña/dominio.
 *  10. Seed de `subscriptions` { status: 'inactiva', preapproval_plan_id }:
 *      el CONGELAMIENTO real lo hace el webhook al aprobarse el cobro con
 *      `freezePrice` de la máquina (R4) usando el monto DEL PAGO.
 * 201 { ok, initPoint, planId } → el modal redirige al checkout del plan.
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
    .select('status, preapproval_id, preapproval_plan_id')
    .eq('user_id', user.id)
    .maybeSingle<{
      status: 'inactiva' | 'activa' | 'gracia' | 'programada_cierre' | 'revocada';
      preapproval_id: string | null;
      preapproval_plan_id: string | null;
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

  /* 8 — PLAN de suscripción (spec_pagos_plan_mp.md). El checkout hospedado
   * del plan es el único que pide la cuenta de Mercado Pago del pagador: el
   * email de Supabase ya no tiene que coincidir con la cuenta que paga.
   *
   * REUTILIZACIÓN (26-nov-2026): antes se creaba un plan por click y se
   * cancelaba el anterior. Eso invalidaba un checkout ya abierto en otra
   * pestaña/dominio y MP lo mandaba a `/subscription/redirect/expired`
   * ("Algo salió mal"). Ahora se reutiliza el plan vigente si sigue activo,
   * es del mismo usuario y mantiene precio/moneda. Recién si cambió el precio
   * o MP lo canceló se crea otro. Los planes viejos NO se cancelan: pueden
   * tener una pestaña de checkout abierta.
   *
   * FALLAR CERRADO (26-nov-2026): si el plan guardado no se puede leer con las
   * credenciales de este deploy, NO se crea uno nuevo a ciegas. Ese 404 delata
   * credenciales de otro entorno (test vs. producción) o un plan borrado;
   * crear otro escondía el problema y vinculaba la cuenta a dos colectores. */
  const webOrigin = checkoutBackUrlOrigin({
    nextUrlOrigin: request.nextUrl.origin,
    nextUrlProtocol: request.nextUrl.protocol,
    host: request.headers.get('host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
  });
  const backUrl = `${webOrigin}/perfil?pago=success`;

  let plan: { id: string; initPoint: string; status: string } | null = null;
  let reusedPlan = false;

  if (sub?.preapproval_plan_id) {
    const existing = await getPreapprovalPlan(sub.preapproval_plan_id);
    if (!existing.ok) {
      console.error(
        '[billing plan read]:',
        sub.preapproval_plan_id,
        existing.status,
        existing.message,
      );
      const failure = classifyPlanReadFailure(existing.status);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
    if (
      existing.data.status === 'active' &&
      existing.data.externalReference === user.id &&
      existing.data.amount === amount &&
      existing.data.currency === 'ARS'
    ) {
      plan = existing.data;
      reusedPlan = true;
      if (existing.data.backUrl !== backUrl) {
        const updated = await updatePreapprovalPlanBackUrl(plan.id, backUrl);
        console.log(
          '[billing plan back_url]:',
          JSON.stringify({
            plan: plan.id,
            from: existing.data.backUrl,
            to: updated.ok ? updated.data.backUrl : backUrl,
            ok: updated.ok,
          }),
        );
      }
    } else {
      console.log(
        '[billing plan reuse skipped]:',
        JSON.stringify({
          plan: existing.data.id,
          status: existing.data.status,
          amount: existing.data.amount,
          currency: existing.data.currency,
          owner: existing.data.externalReference === user.id,
        }),
      );
    }
  }

  if (!plan) {
    const drafted = await createPreapprovalPlan({
      reason: CHECKOUT_REASON,
      externalReference: user.id,
      amount,
      backUrl,
    });
    if (!drafted.ok) {
      console.error('[billing preapproval_plan]:', drafted.status, drafted.message);
      return NextResponse.json({ error: 'MP_UNAVAILABLE' }, { status: 502 });
    }
    plan = drafted.data;
  }

  /* 9 — mapping local ANTES de redirigir. Sin esta fila el webhook no podría
   * atribuir el preapproval (MP no garantiza heredar external_reference).
   * Upsert porque un plan reutilizado ya tiene su fila. Si falla, solo se
   * cancela el plan si es NUEVO: el vigente puede estar en uso. */
  const mapping = await service.from('mp_preapproval_plans').upsert(
    {
      id: plan.id,
      user_id: user.id,
      amount,
      currency: 'ARS',
      status: 'active',
      cancelled_at: null,
    },
    { onConflict: 'id' },
  );
  if (mapping.error) {
    console.error('[billing plan mapping]:', mapping.error.message);
    if (!reusedPlan) {
      const cancelled = await cancelPreapprovalPlan(plan.id);
      if (!cancelled.ok) {
        console.error(
          '[billing plan mapping rollback]:',
          plan.id,
          cancelled.status,
          cancelled.message,
        );
      }
    }
    return NextResponse.json({ error: 'PERSIST_UNAVAILABLE' }, { status: 503 });
  }

  /* 10 — Reactivación tras revocación: el preapproval viejo NO se reutiliza y,
   * si MP todavía lo tiene vivo, se cancela para que no vuelva a cobrar (Q6).
   * Un fallo de cancelación no frena el alta nueva: se logea. */
  if (oldPreapprovalId) {
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

  /* 11 — seed del ciclo: 'inactiva' hasta que el webhook apruebe el cobro.
   * El preapproval real todavía no existe (lo crea MP en su checkout), así
   * que se guarda NULL; el webhook lo vincula por `preapproval_plan_id`.
   * price_frozen TENTATIVO: la verdad la fija el cobro aprobado (R4).
   * `last_checkout_at` es el watermark anti-resurrección (R12.4). */
  const checkoutAt = new Date().toISOString();
  const seed = await service.from('subscriptions').upsert(
    {
      user_id: user.id,
      preapproval_id: null,
      preapproval_plan_id: plan.id,
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
    // El mapping ya permite resolver el webhook; la fila se reconstruye con
    // el primer pago aprobado. Se logea pero no se bloquea el checkout.
  }

  console.log(
    '[billing QA registro]',
    JSON.stringify({ user: user.id, artifact: 'checkout', planId: plan.id, reused: reusedPlan }),
  );

  return NextResponse.json(
    { ok: true as const, initPoint: plan.initPoint, planId: plan.id },
    { status: 201 },
  );
}
