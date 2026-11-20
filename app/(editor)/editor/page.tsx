import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedBrandingUrl } from '@/lib/supabase/service';
import EditorShell, { type ShellProfile } from '@/components/editor/editor-shell';
import type { Plan } from '@/lib/permissions';
import type { UserRecord } from '@/lib/types/db';
import { reconcileUserCycle } from '@/lib/payments/reconcile';
import { isAuthBypassEnabled } from '@/lib/dev-auth';

export const dynamic = 'force-dynamic';

/**
 * Editor (posiciones 3–7 traen la escena 3D acá).
 * El plan se resuelve SIEMPRE server-side (users.plan; el claim del JWT es
 * cache no autoritativa — spec_auth §3 Comportamiento del Sistema).
 * R8: si la fila está con deleted_at ⇒ signOut + mensaje neutro en /auth.
 */
export default async function EditorPage() {
  /* DEV ONLY (DEV_AUTH_BYPASS=1): editor sin login. Perfil de prueba PRO para
   * trabajar las formas del mate sin marca de agua ni gates. */
  if (isAuthBypassEnabled()) {
    return (
      <EditorShell
        userId="dev-local"
        devBypass
        profile={{
          exists: true,
          baseName: 'Taller Dev',
          brandName: 'Taller Dev',
          plan: 'pro',
          graceExpiresAt: null,
          logoThumbUrl: null,
          whatsappE164: null,
          instagramHandle: null,
        }}
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  /* DUNNING AL-VUELO (10B, R8): antes de leer users.plan, el estado del ciclo
   * se reconcilia contra subscriptions/MP (ventanas vencidas → downgrade,
   * drift de cancelaciones, realineo del gating). Así el drift no sobrevive a
   * un solo render — la decisión del titular reemplaza al job nocturno mientras
   * no hay dominio/pg_cron. */
  try {
    await reconcileUserCycle(user.id);
  } catch (e) {
    console.error('[reconcile editor]:', e instanceof Error ? e.message : e); // fail-soft: el render sigue
  }

  const { data } = await supabase
    .from('users')
    .select(
      'id, base_name, plan, grace_expires_at, brand_name, logo_thumb_url, deleted_at, whatsapp_e164, instagram_handle',
    )
    .eq('id', user.id)
    .maybeSingle<UserRecord>();

  if (data?.deleted_at) {
    redirect('/api/auth/exit?motivo=inhabilitada');
  }

  const rawPlan = data?.plan;
  const plan: Plan =
    rawPlan === 'pro' || rawPlan === 'pro_grace' ? rawPlan : 'free';

  // Thumb del logo para el header del taller (workspace: acá se ve SIEMPRE;
  // el white-label de OUTPUTS se decide en resolveBranding según el plan).
  const logoThumbUrl = data?.logo_thumb_url ? await signedBrandingUrl(data.logo_thumb_url) : null;

  const profile: ShellProfile = {
    exists: Boolean(data),
    baseName: data?.base_name || 'MI TALLER',
    brandName: data?.brand_name ?? null,
    plan,
    graceExpiresAt: data?.grace_expires_at ?? null,
    logoThumbUrl,
    // Pos 9 (R4): pie de la Ficha con CTA de WhatsApp + handle de Instagram.
    whatsappE164: data?.whatsapp_e164 ?? null,
    instagramHandle: data?.instagram_handle ?? null,
  };

  return <EditorShell userId={user.id} profile={profile} />;
}
