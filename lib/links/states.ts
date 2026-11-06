/* ============================================================================
 * ESTADOS DEL LINK + CIERRE COMERCIAL — posición 10A
 * (spec_ficha_comercial_interactiva_shareable_link.md §3-R5/R6/R8 + §4)
 * ----------------------------------------------------------------------------
 * R5: vigencia 30 días desde `createdAt` (expiresAt calculada). Estados del
 * EDITOR: `vigente` / `por vencer` (≤5 días: badge ámbar + sugerir regenerar)
 * / `vencido` / `aprobado` (badge con la última opción). Al abrir un link
 * vencido: página amable — jamás redirect a otra versión.
 * R6: la aprobación registra `POST /links/{linkId}/approvals` ANTES de abrir
 * WhatsApp; badge "APROBADO Opción B" en el editor.
 * R8: mensaje pre-armado EXACTO de la spec §4 con URL-encoding sobre
 * `wa.me/{phone}?text=`; NÚMERO en E.164 (spec usuario §3); sin número ⇒ null
 * (el cliente queda con "Copiar Enlace" solitario).
 * Módulo PURO: el route pasa el request origin para la URL canónica.
 * ============================================================================ */

import { PUBLIC_LINK_PATH, canonicalizeLinkId } from '@/lib/links/identity';

/** Vigencia EXACTA de la spec R5: 30 días corridos. */
export const LINK_TTL_DAYS = 30;
export const LINK_TTL_MS = LINK_TTL_DAYS * 86_400_000;

/** Umbral del badge ámbar (R5: "por vencer (≤ 5 días)"). */
export const LINK_WARN_DAYS = 5;
export const LINK_WARN_MS = LINK_WARN_DAYS * 86_400_000;

/** Estado del EDITOR para una versión (R5 — los cuatro con su prioridad). */
export type LinkEditionState = 'vigente' | 'por_vencer' | 'vencido' | 'aprobado';

/** daysLeft = techo a días (badge negativo censurado a 0). */
export function linkDaysLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 86_400_000));
}

/**
 * Estado visible de UNA versión del editor (R5, prioridad exacta):
 * aprobado > vencido > por_vencer > vigente. La vigencia igual se muestra en
 * la fila (fecha de vencimiento), pero el BADGE gana el de aprobación.
 */
export function linkEditionState(input: {
  expiresAtMs: number;
  approved: boolean;
}, nowMs: number): LinkEditionState {
  if (input.approved) return 'aprobado';
  if (nowMs >= input.expiresAtMs) return 'vencido';
  if (input.expiresAtMs - nowMs <= LINK_WARN_MS) return 'por_vencer';
  return 'vigente';
}

/** Etiqueta del badge en el panel de versiones (R5 + R6). */
export function editionBadgeText(state: LinkEditionState, lastVariant: string | null): string {
  switch (state) {
    case 'aprobado':
      return lastVariant ? `APROBADO Opción ${lastVariant}` : 'APROBADO';
    case 'por_vencer':
      return 'POR VENCER';
    case 'vencido':
      return 'VENCIDO';
    default:
      return 'VIGENTE';
  }
}

/* -------------------------------------------------------------------------- */
/* URL canónica + WhatsApp (R2 + R8)                                          */
/* -------------------------------------------------------------------------- */

/**
 * URL canónica de la versión: `{origin}{PUBLIC_LINK_PATH}/{linkId}` (R2).
 * El server la resuelve con el origin del request (dev: :3000 / prod: dominio).
 */
export function canonicalLinkUrl(linkId: string, origin: string): string {
  const id = canonicalizeLinkId(linkId) ?? '';
  return `${origin.replace(/\/+$/, '')}${PUBLIC_LINK_PATH}/${id}`;
}

/**
 * Texto pre-armado EXACTO de la spec §4 (con el share link interpolado);
 * la misma cadena impresa en el mensaje de WhatsApp y en el modal.
 */
export function whatsappShareText(linkUrl: string): string {
  return `¡Hola! Te comparto la propuesta interactiva en 3D para tu mate personalizado: ${linkUrl}. Podés girarlo y elegir tu opción favorita.`;
}

/**
 * `wa.me/{digits}?text={en-encoded-text}` (R8). `phoneE164` llega con '+';
 * wan.me quiere SOLO dígitos. Sin número válido ⇒ null: el modal queda con
 * "Copiar Enlace" solitario y el mensaje omitido (R8 exacto).
 */
export function whatsappShareHref(phoneE164: string | null, linkUrl: string): string | null {
  const digits = (phoneE164 ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null; // señal de E.164 roto: jamás wa.me inválido
  return `https://wa.me/${digits}?text=${encodeURIComponent(whatsappShareText(linkUrl))}`;
}
