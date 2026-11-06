import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de SERVICIO (saltea RLS) — solo server-side en API Routes y RSC:
 * /api/config/pricing, logo del perfil y backfill de posición 2; tickets de
 * export 402 y webhook de Mercado Pago en posiciones 8–10.
 * Nunca importar desde código cliente.
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

/**
 * Cliente ANÓNIMO server-side (API pública sin sesión): lo usa ÚNICAMENTE la
 * ruta de aprobaciones (pos 10A, spec shareable-link §5) para que el INSERT
 * pase por la policy `approvals_public_insert` de RLS — la DB es la última
 * palabra: un link inexistente o vencido es RECHAZADO por el propio motor de
 * policies, no solo por la lógica del route.
 * Nunca usarlo para saltarse permisos: es el espejo de un visitante real.
 */
export function createSupabasePublicClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Faltan variables para el cliente público (URL / ANON_KEY).');
  }
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/* -------------------------------------------------------------------------- */
/* Storage del branding (posición 2, spec registro §3-R4)                      */
/* bucket PRIVADO: en la base solo guardamos PATHS; la URL firmada se emite   */
/* al render (cache 1 h). El original crudo jamás se persiste.                */
/* -------------------------------------------------------------------------- */

export const BRANDING_BUCKET = 'branding';

/** Crea el bucket privado si no existe (idempotente, tolera carrera). */
export async function ensureBrandingBucket(): Promise<boolean> {
  const client = createSupabaseServiceClient();
  try {
    const { data: existing } = await client.storage.listBuckets();
    if (existing?.some((b) => b.id === BRANDING_BUCKET)) return true;
    const { error } = await client.storage.createBucket(BRANDING_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
    return true;
  } catch (err) {
    console.error('[service] branding bucket:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * URL firmada de un objeto del bucket `branding`. Acepta el path guardado en
 * la base ("branding/{uid}/logo.webp") o el relativo al bucket. Null si el
 * asset no está (lazy-check del visor, R3: fallback de iniciales sin romper).
 */
export async function signedBrandingUrl(
  objectPath: string | null | undefined,
  seconds = 3600,
): Promise<string | null> {
  if (!objectPath) return null;
  const relative = objectPath.replace(/^branding\//i, '');
  try {
    const client = createSupabaseServiceClient();
    const { data, error } = await client.storage
      .from(BRANDING_BUCKET)
      .createSignedUrl(relative, seconds);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Borrado de todos los assets de logo de un usuario (reemplazo/limpieza R4). */
export async function removeBrandingFiles(userId: string): Promise<void> {
  try {
    const client = createSupabaseServiceClient();
    const { data } = await client.storage.from(BRANDING_BUCKET).list(userId);
    if (data && data.length > 0) {
      await client.storage.from(BRANDING_BUCKET).remove(data.map((f) => `${userId}/${f.name}`));
    }
  } catch (err) {
    // No bloquear el flujo por un orfanado de Storage: se logea y sigue.
    console.error('[service] limpieza branding:', err instanceof Error ? err.message : err);
  }
}
