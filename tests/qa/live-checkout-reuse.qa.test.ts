import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelPreapprovalPlan, getPreapprovalPlan } from '@/lib/payments/mercadopago';
import {
  loginCookie,
  serviceClient,
  startNextServer,
  type NextServer,
} from './helpers';

/* ============================================================================
 * QA DE INTEGRACIÓN — reutilización del plan de checkout
 * ----------------------------------------------------------------------------
 * Regresión real (26-nov-2026): cada click creaba un plan nuevo y cancelaba el
 * anterior. Un checkout ya abierto en otra pestaña/dominio quedaba inválido y
 * MP lo mandaba a `/subscription/redirect/expired` ("Algo salió mal").
 *
 * Este test crea un usuario efímero, pide el checkout DOS veces y verifica que
 * el plan sea el mismo y siga activo en MP. No toca cuentas reales.
 * ========================================================================== */

const BASE_URL = 'http://127.0.0.1:3102';
const PASSWORD = 'Admin1234';

let server: NextServer;
let cookie = '';
let userId = '';
let planId = '';
const email = `qa-checkout-reuse-${Date.now()}@simuladormates.test`;

async function postCheckout(): Promise<{
  status: number;
  body: { ok?: boolean; initPoint?: string; planId?: string; error?: string } | null;
}> {
  const res = await fetch(`${BASE_URL}/api/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      legalAccepted: true,
      termsVersion: '1.0',
      privacyVersion: '1.0',
    }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as {
      ok?: boolean;
      initPoint?: string;
      planId?: string;
      error?: string;
    } | null,
  };
}

beforeAll(async () => {
  const service = serviceClient();
  const created = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser: ${created.error?.message ?? 'sin user'}`);
  }
  userId = created.data.user.id;

  // El trigger `handle_new_user` ya insertó public.users; solo se alinea el plan.
  const profile = await service.from('users').update({ plan: 'free' }).eq('id', userId);
  if (profile.error) throw new Error(`users update: ${profile.error.message}`);

  const sub = await service.from('subscriptions').upsert(
    {
      user_id: userId,
      preapproval_id: null,
      preapproval_plan_id: null,
      status: 'inactiva',
      price_frozen: 50,
      currency: 'ARS',
      cycle_anchor: new Date().toISOString().slice(0, 10),
      period_end: null,
      grace_expires_at: null,
      last_checkout_at: null,
      last_synced_at: null,
      closure_reason: null,
      closed_at: null,
    },
    { onConflict: 'user_id' },
  );
  if (sub.error) throw new Error(`subscriptions upsert: ${sub.error.message}`);

  server = await startNextServer(3102, { RESEND_API_KEY: '', EMAIL_FROM: '' });
  cookie = await loginCookie(email, PASSWORD);
}, 240_000);

afterAll(async () => {
  if (planId) {
    const cancelled = await cancelPreapprovalPlan(planId);
    if (!cancelled.ok) console.error('[QA reuse cleanup]', cancelled.status, cancelled.message);
  }
  if (userId) {
    const service = serviceClient();
    const deleted = await service.auth.admin.deleteUser(userId);
    if (deleted.error) console.error('[QA reuse cleanup]', deleted.error.message);
  }
  await server?.stop();
});

describe('checkout con plan reutilizable', () => {
  it('dos POST devuelven el mismo plan y no invalidan el checkout abierto', async () => {
    const first = await postCheckout();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body?.ok).toBe(true);
    expect(first.body?.planId).toBeTruthy();
    expect(first.body?.initPoint).toContain('preapproval_plan_id=');
    planId = String(first.body?.planId);

    const second = await postCheckout();
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body?.planId).toBe(planId);
    expect(second.body?.initPoint).toBe(first.body?.initPoint);

    const plan = await getPreapprovalPlan(planId);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.status).toBe('active');
    expect(plan.data.externalReference).toBe(userId);
    expect(plan.data.amount).toBe(50);
    expect(plan.data.currency).toBe('ARS');
    expect(plan.data.backUrl).toContain('/perfil?pago=success');

    const service = serviceClient();
    const sub = await service
      .from('subscriptions')
      .select('status, preapproval_plan_id')
      .eq('user_id', userId)
      .maybeSingle<{ status: string; preapproval_plan_id: string | null }>();
    expect(sub.error).toBeNull();
    expect(sub.data?.status).toBe('inactiva');
    expect(sub.data?.preapproval_plan_id).toBe(planId);

    const mapping = await service
      .from('mp_preapproval_plans')
      .select('user_id, status')
      .eq('id', planId)
      .maybeSingle<{ user_id: string; status: string }>();
    expect(mapping.error).toBeNull();
    expect(mapping.data).toMatchObject({ user_id: userId, status: 'active' });
  }, 120_000);
});
