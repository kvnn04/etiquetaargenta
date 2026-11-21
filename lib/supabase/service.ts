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
  await removeStoragePrefix(BRANDING_BUCKET, userId);
}

/**
 * Borra TODOS los objetos bajo un prefijo de un bucket (R8: borrado en cascada
 * de assets al eliminar cuenta). Los buckets de la app usan un nivel plano,
 * pero el helper también desciende en carpetas por si un asset futuro anida.
 *
 * Fail-soft: la cuenta ya quedó inhabilitada por `deleted_at`; si Storage falla
 * se logea el prefijo exacto para que soporte limpie el huérfano, sin romper
 * la respuesta de la API.
 */
export async function removeStoragePrefix(bucket: string, prefix: string): Promise<void> {
  const clean = prefix.replace(/^\/+|\/+$/g, '');
  if (!clean) return;
  try {
    const client = createSupabaseServiceClient();
    const storage = client.storage.from(bucket);

    /* Listado paginado (Supabase devuelve 100 por página por defecto). */
    const entries: Array<{ name: string; id: string | null }> = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await storage.list(clean, { limit: 100, offset });
      if (error) throw error;
      const batch = data ?? [];
      entries.push(...batch);
      if (batch.length < 100) break;
      offset += batch.length;
    }

    const files = entries.filter((e) => e.id !== null).map((e) => `${clean}/${e.name}`);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await storage.remove(files.slice(i, i + 100));
      if (error) throw error;
    }

    const folders = entries.filter((e) => e.id === null).map((e) => `${clean}/${e.name}`);
    for (const folder of folders) {
      await removeStoragePrefix(bucket, folder);
    }
  } catch (err) {
    // No bloquear el flujo por un huérfano de Storage: se logea y sigue.
    console.error(
      `[service] limpieza ${bucket}/${clean}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
