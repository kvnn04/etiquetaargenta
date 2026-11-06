import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedBrandingUrl } from '@/lib/supabase/service';
import EditorShell, { type ShellProfile } from '@/components/editor/editor-shell';
import type { Plan } from '@/lib/permissions';
import type { UserRecord } from '@/lib/types/db';

export const dynamic = 'force-dynamic';

/**
 * Editor (posiciones 3–7 traen la escena 3D acá).
 * El plan se resuelve SIEMPRE server-side (users.plan; el claim del JWT es
 * cache no autoritativa — spec_auth §3 Comportamiento del Sistema).
 * R8: si la fila está con deleted_at ⇒ signOut + mensaje neutro en /auth.
 */
export default async function EditorPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

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
