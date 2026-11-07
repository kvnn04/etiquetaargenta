import { redirect } from 'next/navigation';
import type { Plan } from '@/lib/permissions';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedBrandingUrl } from '@/lib/supabase/service';
import ProfilePanel from '@/components/profile/profile-panel';
import type {
  PaymentRowView,
  PagoBanner,
  SubscriptionView,
} from '@/components/profile/subscription-card';

export const dynamic = 'force-dynamic';

/**
 * Panel de Perfil (posición 2, spec registro §4) + CENTRO DE SUSCRIPCIÓN
 * (posición 10B, spec_pagos §4). El flag emailVerified NO se guarda en la
 * base: se DERIVA de auth.users.email_confirmed_at (fuente única de Supabase
 * Auth — R7). El ciclo de cobro se lee con la RLS DEL DUEÑO (§5 pagos:
 * historial estrictamente privado — el server client alcanza, service no hace
 * falta acá).
 */
export default async function ProfilePage({
  searchParams,
}: {
  /** Retorno del Checkout Pro: `?pago=success|failure|pending`. */
  searchParams: Promise<{ pago?: string }>;
}) {
  const ordenPago = (await searchParams).pago;
  const pagoValido: PagoBanner =
    ordenPago === 'success' || ordenPago === 'failure' || ordenPago === 'pending' ? ordenPago : null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  const { data: row } = await supabase
    .from('users')
    .select(
      'id, base_name, brand_name, logo_url, logo_thumb_url, whatsapp_e164, instagram_handle, location, deleted_at, plan, grace_expires_at',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (row?.deleted_at) redirect('/api/auth/exit?motivo=inhabilitada');
  if (!row) {
    // Sin fila ⇒ el trigger es la única vía: el cartel de /editor guía el backfill.
    redirect('/editor');
  }

  const [logoThumbSummary, logoViewUrl] = await Promise.all([
    signedBrandingUrl(row.logo_thumb_url),
    signedBrandingUrl(row.logo_url),
  ]);

  const emailConfirmedAt = (user as unknown as { email_confirmed_at?: string | null }).email_confirmed_at;

  /* ------------------------------------------------------------------
   * CENTRO DE SUSCRIPCIÓN (10B): `subscriptions` + `payments` leídas con
   * la RLS DEL DUEÑO (spec §5: "historial estrictamente privado") — el
   * server client basta y demuestra que los grants de 0005 amarran.
   * ------------------------------------------------------------------ */
  const isoToMs = (iso: string | null): number | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  };

  const [subResult, paymentsResult] = await Promise.all([
    supabase
      .from('subscriptions')
      .select(
        'status, price_frozen, currency, cycle_anchor, grace_expires_at, period_end, preapproval_id',
      )
      .eq('user_id', user.id)
      .maybeSingle<{
        status: 'inactiva' | 'activa' | 'gracia' | 'programada_cierre';
        price_frozen: number | null;
        currency: string | null;
        cycle_anchor: string | null;
        grace_expires_at: string | null;
        period_end: string | null;
        preapproval_id: string | null;
      }>(),
    supabase
      .from('payments')
      .select('id, amount, status, occurred_at, receipt_url')
      .order('occurred_at', { ascending: false })
      .limit(20),
  ]);

  const planView: Plan = (row.plan as Plan | undefined) ?? 'free';
  const sub: SubscriptionView = subResult.data
    ? {
        status: subResult.data.status,
        plan: planView,
        priceFrozen: subResult.data.price_frozen != null ? Number(subResult.data.price_frozen) : null,
        currency: subResult.data.currency ?? 'ARS',
        cycleAnchorDate: subResult.data.cycle_anchor ?? null,
        // Fallback de gracia a la fila users (drift tolerado; el resolver del
        // core manda al decidir candados).
        graceExpiresMs: isoToMs(subResult.data.grace_expires_at) ?? isoToMs(row.grace_expires_at),
        periodEndMs: isoToMs(subResult.data.period_end),
        preapprovalId: subResult.data.preapproval_id ?? null,
      }
    : {
        status: 'sin_suscripcion',
        plan: planView,
        priceFrozen: null,
        currency: 'ARS',
        cycleAnchorDate: null,
        graceExpiresMs: isoToMs(row.grace_expires_at),
        periodEndMs: null,
        preapprovalId: null,
      };

  const payments: PaymentRowView[] = (paymentsResult.data ?? []).map((p) => ({
    id: String(p.id),
    amount: Number(p.amount),
    status: (p.status as 'approved' | 'rejected') ?? 'approved',
    occurredMs: isoToMs(String(p.occurred_at)) ?? Date.now(),
    receiptUrl: (p.receipt_url as string | null) ?? null,
  }));

  return (
    <ProfilePanel
      userId={user.id}
      displayName={row.base_name ?? ''}
      emailVerified={Boolean(emailConfirmedAt)}
      billing={{
        sub,
        payments,
        pago: pagoValido,
        nowMs: Date.now(), // del server: el banner y los días corren con el PlanWatcher/refresh
      }}
      initial={{
        brandName: row.brand_name ?? '',
        whatsappE164: row.whatsapp_e164 ?? '',
        instagramHandle: row.instagram_handle ?? '',
        location: row.location ?? '',
      }}
      logo={{
        stored: Boolean(row.logo_url),
        thumbViewUrl: logoThumbSummary,
        fullViewUrl: logoViewUrl,
      }}
    />
  );
}
