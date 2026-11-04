import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import AuthOverlay from '@/components/auth/auth-overlay';

/**
 * Auth Overlay página completa (spec_autenticación §4).
 * Con sesión activa ya no tiene sentido: el middleware ya envía a /editor;
 * el guard server-side es defensa en profundidad por si entra directo.
 */
export default async function AuthPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/editor');

  return <AuthOverlay />;
}
