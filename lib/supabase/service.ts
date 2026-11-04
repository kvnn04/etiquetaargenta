import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de SERVICIO (saltea RLS) — solo server-side en API Routes:
 * /api/config/pricing hoy; tickets de export 402 y webhook de Mercado Pago
 * en posiciones 8–10. Nunca importar desde código cliente.
 */
let cached: SupabaseClient | null = null;

export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Faltan variables para el cliente de servicio (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    );
  }

  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}

export function hasServiceCredentials(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
