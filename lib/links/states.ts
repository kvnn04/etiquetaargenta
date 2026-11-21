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
 * R8: mensaje pre-armado EXACTO de la spec §4 con URL-encoding. El SHARE del
 * taller usa `wa.me/?text=` SIN destinatario (selector de contactos): el E.164
 * del Perfil es el número del taller para la APROBACIÓN del cliente, no el
 * destinatario del enlace (usarlo acá mandaba el link al propio taller).
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
 * COMPARTIR el enlace con el cliente final: `wa.me/?text=…` SIN número de
 * destinatario. WhatsApp abre el selector de contactos y el taller elige a
 * quién mandarlo (su cliente, no su propio número de negocio).
 *
 * El E.164 del Perfil sigue siendo el destino del CTA de APROBACIÓN (R6,
 * `whatsappApprovalHref`): el cliente le escribe AL taller. Son dos flujos
 * distintos y mezclarlos mandaba el link al WhatsApp del propio taller.
 *
 * Siempre devuelve href: compartir depende del WhatsApp del dispositivo, no
 * de que el Perfil tenga número cargado.
 */
export function whatsappShareHref(linkUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsappShareText(linkUrl))}`;
}

/* -------------------------------------------------------------------------- */
/* Cierre comercial del CLIENTE (R6 + spec usuario §R5)                        */
/* -------------------------------------------------------------------------- */

/** RPM del giro del visor público (spec §4: "giro automático tenue 0.5 RPM"). */
export const LINK_VIEWER_SPIN_RPM = 0.5;

/**
 * Código de aprobación EXACTO del fallback sin WhatsApp (spec usuario R5):
 * `APROBADA-{VARIANTE}-{LINKID}` en mayúsculas (ej. `APROBADA-B-3A8F9B`).
 * linkId llega minúscula (canónico R2); el formato lo imprime en MAYÚSCULAS.
 */
export function approvalCode(linkId: string, variantId: string): string {
  return `APROBADA-${variantId}-${linkId.toUpperCase()}`;
}

/**
 * Texto que el Modo Cliente manda por WhatsApp al aprobar (R6: el mensaje
 * "nombra exactamente la opción visible" — el label congelado del payload,
 * jamás una etiqueta genérica "Opción A" cuando el taller renombró).
 */
export function whatsappApprovalText(linkUrl: string, variantLabel: string): string {
  return `¡Hola! Aprobé la opción "${variantLabel}" de mi mate personalizado: ${linkUrl}. ¿Sigamos con el pedido?`;
}

/**
 * `wa.me` de la APROBACIÓN (R6: se dispara DESPUÉS de que el POST registra el
 * evento). Mismo contrato de dígitos que el share (E.164 roto ⇒ null).
 */
export function whatsappApprovalHref(
  phoneE164: string | null,
  linkUrl: string,
  variantLabel: string,
): string | null {
  const digits = (phoneE164 ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(
    whatsappApprovalText(linkUrl, variantLabel),
  )}`;
}
