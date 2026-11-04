import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import AuthOverlay from '@/components/auth/auth-overlay';

/**
 * Auth Overlay página completa (spec_autenticación §4).
 * Con sesión activa ya no tiene sentido: el middleware ya envía a /editor;
 * el guard server-side es defensa en profundidad por si entra directo.
 *
 * `?cuenta=eliminada|inhabilitada` — mensajes neutros del cierre de cuenta
 * (R8 spec registro: borrado de la cuenta nunca revela datos internos).
 */
export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/editor');

  const { cuenta } = await searchParams;
  const banner =
    cuenta === 'eliminada'
      ? 'Cuenta enviada a eliminación. Tus datos se purgan a los 30 días — escribínos desde este email si querés restaurar.'
      : cuenta === 'inhabilitada'
        ? 'Esta cuenta no está disponible. Si creés que es un error, contactá a soporte.'
        : undefined;

  return <AuthOverlay banner={banner} />;
}
