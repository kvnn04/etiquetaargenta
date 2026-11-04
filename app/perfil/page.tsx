import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { signedBrandingUrl } from '@/lib/supabase/service';
import ProfilePanel from '@/components/profile/profile-panel';

export const dynamic = 'force-dynamic';

/**
 * Panel de Perfil (posición 2, spec registro §4).
 * El flag emailVerified NO se guarda en la base: se DERIVA de
 * auth.users.email_confirmed_at (fuente única de Supabase Auth — R7).
 */
export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  const { data: row } = await supabase
    .from('users')
    .select(
      'id, base_name, brand_name, logo_url, logo_thumb_url, whatsapp_e164, instagram_handle, location, deleted_at',
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

  return (
    <ProfilePanel
      userId={user.id}
      displayName={row.base_name ?? ''}
      emailVerified={Boolean(emailConfirmedAt)}
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
