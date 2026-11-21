/* ============================================================================
 * OBJETIVOS DE STORAGE AL ELIMINAR CUENTA — R8 del spec de registro
 * ----------------------------------------------------------------------------
 * El borrado en cascada de la DB (projects → links → approvals) lo resuelve
 * Postgres; Storage es un sistema aparte y necesita que le digamos QUÉ borrar:
 *   · link-assets/{linkId}/…  → textura y logo congelados de cada versión;
 *   · designs/{userId}/…      → archivo original del grabado;
 *   · branding/{userId}/…     → logo y thumb del taller.
 *
 * Función PURA para poder testear los paths contra los que escriben
 * `/api/links` y `/api/profile/logo` sin tocar Supabase.
 * ============================================================================ */

export type AccountStorageBucket = 'link-assets' | 'designs' | 'branding';

export interface AccountStorageTarget {
  bucket: AccountStorageBucket;
  /** Prefijo relativo al bucket (sin slashes en los extremos). */
  prefix: string;
}

/**
 * Targets de limpieza para una cuenta:
 * - un prefijo por link publicado (los ids ya son canónicos de 6 chars);
 * - un prefijo por usuario en `designs` y `branding`.
 * Deduplica ids y descarta valores vacíos por sanidad.
 */
export function accountStorageTargets(
  userId: string,
  linkIds: readonly string[],
): AccountStorageTarget[] {
  const uniqueLinks = [...new Set(linkIds.filter((id) => id.length > 0))];
  return [
    ...uniqueLinks.map((prefix) => ({ bucket: 'link-assets' as const, prefix })),
    { bucket: 'designs' as const, prefix: userId },
    { bucket: 'branding' as const, prefix: userId },
  ];
}
