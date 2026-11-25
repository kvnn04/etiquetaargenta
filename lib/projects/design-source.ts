/* ============================================================================
 * DISEÑO PERSISTIDO POR PROYECTO (bucket privado `designs`) — pos 10A
 * ----------------------------------------------------------------------------
 * El publish guarda el ORIGINAL del grabado en `designs/{userId}/{projectId}.{ext}`
 * para poder reabrir el proyecto sin perder la imagen (antes el asset era
 * SOLO de sesión). Este helper corre server-side:
 *   · recibe un cliente service-role SOLO después de validar ownership;
 *   · lista el prefijo del dueño y elige el archivo de ESE proyecto;
 *   · devuelve una URL firmada de vida corta (nunca el bucket público).
 * Fail-soft: cualquier error devuelve null y el editor abre sin imagen con el
 * aviso correspondiente (jamás bloquea la edición).
 * ============================================================================ */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DesignSourceRef } from '@/lib/design';

const DESIGNS_BUCKET = 'designs';
/** Suficiente para que el cliente descargue al hidratar; no se comparte. */
const SIGNED_URL_TTL_SECONDS = 600;

/** Extensión ⇒ kind de la UI (todo lo no-SVG se trata como bitmap). */
function kindFromName(name: string): DesignSourceRef['kind'] {
  return name.toLowerCase().endsWith('.svg') ? 'svg' : 'png';
}

export async function loadProjectDesignSource(
  service: SupabaseClient,
  input: {
    userId: string;
    projectId: string;
    baseSideMm: number;
    /** Nombre visible; por defecto uno neutro (el original no guarda nombre). */
    name?: string;
  },
): Promise<DesignSourceRef | null> {
  try {
    /* Fail-closed: este helper usa service-role, así que RE-VALIDA el dueño
     * además del chequeo de la página. Un id ajeno jamás llega a Storage. */
    const owned = await service
      .from('projects')
      .select('id')
      .eq('id', input.projectId)
      .eq('user_id', input.userId)
      .maybeSingle<{ id: string }>();
    if (owned.error) {
      console.error('[design source ownership]:', owned.error.message);
      return null;
    }
    if (!owned.data) return null;

    const listed = await service.storage
      .from(DESIGNS_BUCKET)
      .list(input.userId, { limit: 1000 });

    if (listed.error) {
      console.error('[design source list]:', listed.error.message);
      return null;
    }

    const prefix = `${input.projectId}.`;
    const candidates = (listed.data ?? []).filter((entry) => entry.name.startsWith(prefix));
    if (candidates.length === 0) return null;

    // Un solo original por proyecto; si hubiera restos de otro mime, gana el
    // más reciente (el publish hace upsert del último).
    candidates.sort(
      (a, b) =>
        (Date.parse(b.updated_at ?? '') || 0) - (Date.parse(a.updated_at ?? '') || 0) ||
        a.name.localeCompare(b.name),
    );
    const file = candidates[0];
    if (!file) return null;

    const path = `${input.userId}/${file.name}`;
    const signed = await service.storage
      .from(DESIGNS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (signed.error || !signed.data?.signedUrl) {
      console.error('[design source sign]:', signed.error?.message ?? 'sin URL');
      return null;
    }

    return {
      url: signed.data.signedUrl,
      name: input.name?.trim() || 'Diseño guardado',
      kind: kindFromName(file.name),
      baseSideMm: input.baseSideMm,
    };
  } catch (error) {
    console.error('[design source]:', error instanceof Error ? error.message : error);
    return null;
  }
}
