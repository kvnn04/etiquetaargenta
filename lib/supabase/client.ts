import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente de navegador (Auth + queries con RLS del usuario).
 * Las env vars públicas las valida el middleware antes de llegar acá
 * (si faltan ⇒ redirect a /setup).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
