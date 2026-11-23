/* ============================================================================
 * HELPERS SERVER DEL ENLACE — posición 14
 * ----------------------------------------------------------------------------
 * Carga pública de la versión (service-role), validación de la variante contra
 * el payload CONGELADO y resolución del email del taller (`auth.users`).
 * Solo se importa desde API Routes/RSC: nunca desde el cliente.
 * ============================================================================ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPublicView, type PublicLinkView } from '@/lib/links/view-shape';
import { isLegacyPayload, type LinkPayload } from '@/lib/links/payload';

export interface PublicLinkRow {
  link_id: string;
  user_id: string;
  expires_at: string;
  payload: unknown;
}

export type LoadPublicLinkResult =
  | { ok: true; link: PublicLinkRow; view: PublicLinkView }
  | {
      ok: false;
      status: 404 | 410 | 503;
      error: 'NOT_FOUND' | 'LINK_EXPIRED' | 'LINK_UNAVAILABLE';
    };

/**
 * Lee una versión por linkId y valida existencia/vigencia. La página y las
 * rutas públicas usan este mismo contrato: 404 si no existe, 410 si venció.
 */
export async function loadPublicLink(
  service: SupabaseClient,
  linkId: string,
): Promise<LoadPublicLinkResult> {
  const link = await service
    .from('links')
    .select('link_id, user_id, expires_at, payload')
    .eq('link_id', linkId)
    .maybeSingle<PublicLinkRow>();

  if (link.error) {
    console.error('[link response read]:', link.error.message);
    return { ok: false, status: 503, error: 'LINK_UNAVAILABLE' };
  }
  if (!link.data) {
    return { ok: false, status: 404, error: 'NOT_FOUND' };
  }

  const expiresMs = Date.parse(link.data.expires_at);
  if (Number.isNaN(expiresMs) || Date.now() >= expiresMs) {
    return { ok: false, status: 410, error: 'LINK_EXPIRED' };
  }

  return { ok: true, link: link.data, view: buildPublicView(link.data.payload) };
}

/**
 * La variante decidida debe existir EN el payload congelado (R14.2). Los
 * payloads legacy sin `variants` no admiten decisión (la observación sí).
 */
export function linkVariantExists(link: PublicLinkRow, variantId: string): boolean {
  if (isLegacyPayload(link.payload)) return false;
  const payload = link.payload as LinkPayload | null;
  return Boolean(payload?.variants?.some((variant) => variant.id === variantId));
}

/** Label congelado de la variante (fallback estable para el mensaje/email). */
export function variantLabelOf(link: PublicLinkRow, variantId: string): string {
  if (!isLegacyPayload(link.payload)) {
    const payload = link.payload as LinkPayload | null;
    const label = payload?.variants?.find((variant) => variant.id === variantId)?.label;
    if (typeof label === 'string' && label.trim().length > 0) return label;
  }
  return `Opción ${variantId}`;
}

/** Email de la cuenta del taller; nunca se expone al cliente. */
export async function workshopEmail(
  service: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) {
    console.error('[link workshop email]:', error.message);
    return null;
  }
  const email = data?.user?.email ?? null;
  if (!email) console.error('[link workshop email]: sin email para', userId);
  return email;
}

/** Mismo contrato que el CTA de aprobación: E.164 con ≥6 dígitos. */
export function isWhatsappAvailable(view: PublicLinkView): boolean {
  return Boolean(view.workshop.whatsapp && view.workshop.whatsapp.length >= 6);
}
