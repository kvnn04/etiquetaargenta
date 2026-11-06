/* ============================================================================
 * HELPERS DE SERVIDOR PARA EXPORTS — posiciones 8–9
 * ÚNICA FUENTE: spec_autenticacion_y_modelo_freemium.md §3-R4 (402 FREE,
 * plan leído con service-role) + spec_detalle_del_modelo_en_ficha.md §3-R7
 * (ticket HMAC 5 min ligado al snapshot hash).
 * ----------------------------------------------------------------------------
 * planOf() y ticketSecret() viven acá para que las TRES rutas del módulo
 * exports (ticket / ticket/verificar / registro QA) compartan EL MISMO
 * criterio: fail-closed (fallo de lectura ⇒ free) y secreto SOLO en envs.
 * ============================================================================ */

import { createSupabaseServiceClient } from '@/lib/supabase/service';

export type ExportsPlan = 'free' | 'pro' | 'pro_grace';

/** Secreto HMAC del ticket: `EXPORT_TICKET_SECRET` (override para poder rotar
 *  claves sin tocar el service key) con fallback documentado
 *  `SUPABASE_SERVICE_ROLE_KEY`. Ambos viven SOLO en envs del server. */
export function ticketSecret(): string {
  return process.env.EXPORT_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

/**
 * Plan autoritativo desde `users` (service-role; el claim del JWT es cache no
 * autoritativa — spec_auth §6: limpiar localStorage no concede nada). Retornos:
 *  - 'free'/'pro'/'pro_grace' según la fila,
 *  - null si la fila no existe (el caller decide su fallback — misma pauta de
 *    la shell del editor: fail-closed, fila ausente JAMÁS desbloquea),
 *  - 'free' ante error de lectura (nunca desbloquea por falta de base).
 */
export async function planOf(userId: string): Promise<ExportsPlan | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('users')
    .select('plan')
    .eq('id', userId)
    .maybeSingle<{ plan: string }>();
  if (error) {
    console.error('[exports plan read]:', error.message);
    return 'free';
  }
  if (!data?.plan) return null;
  if (data.plan === 'pro' || data.plan === 'pro_grace') return data.plan;
  return 'free';
}
