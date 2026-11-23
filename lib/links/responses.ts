/* ============================================================================
 * RESPUESTA DEL CLIENTE — posición 14
 * (spec_decision_y_observaciones_del_cliente.md R14)
 * ----------------------------------------------------------------------------
 * Módulo PURO (sin DB, sin fetch, sin envs) con:
 *   · límite real de 280 code points y normalización del texto;
 *   · validación de decisión/canal/variante;
 *   · normalización de la fila pública de `link_responses`;
 *   · textos y hrefs de WhatsApp para rechazo/observación.
 * La decisión es INMUTABLE (R14.1): aprobar y luego rechazar no se permite.
 * ============================================================================ */

import { isLinkVariantId, type LinkVariantId } from '@/lib/links/payload';

/** Límite EXACTO de la observación (R14.14): code points, no UTF-16. */
export const OBSERVATION_MAX = 280;

export type LinkDecision = 'approved' | 'rejected';
export type LinkChannel = 'email' | 'whatsapp';

export function isLinkDecision(raw: unknown): raw is LinkDecision {
  return raw === 'approved' || raw === 'rejected';
}

export function isLinkChannel(raw: unknown): raw is LinkChannel {
  return raw === 'email' || raw === 'whatsapp';
}

/** Cuenta code points (mismo criterio que `char_length` de PostgreSQL). */
export function observationLength(text: string): number {
  return [...text].length;
}

export type ObservationNormalization =
  | { ok: true; text: string; length: number }
  | { ok: false; reason: 'not_string' | 'empty' | 'too_long'; length: number };

/**
 * Normaliza el texto del cliente (R14.14):
 *   · `\r\n`/`\r` ⇒ `\n`;
 *   · elimina controles C0 (salvo `\n` y `\t`) y DEL;
 *   · colapsa 3+ saltos consecutivos a 2;
 *   · recorta extremos;
 *   · rechaza vacío/solo-espacios y >280 code points.
 */
export function normalizeObservation(raw: unknown): ObservationNormalization {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_string', length: 0 };
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const length = observationLength(text);
  if (length === 0) return { ok: false, reason: 'empty', length };
  if (length > OBSERVATION_MAX) return { ok: false, reason: 'too_long', length };
  return { ok: true, text, length };
}

/** Fila cruda de `link_responses` (snake_case, service-role). */
export interface LinkResponseRow {
  link_id?: string;
  decision: string | null;
  decision_variant_id: string | null;
  decided_at: string | null;
  decision_channel: string | null;
  decision_email_sent_at: string | null;
  decision_email_error: string | null;
  observation: string | null;
  observed_at: string | null;
  observation_channel: string | null;
  observation_email_sent_at: string | null;
  observation_email_error: string | null;
}

/** Vista camelCase que consumen el visor y el panel (sin user-agent). */
export interface PublicLinkResponse {
  decision: LinkDecision | null;
  decisionVariantId: LinkVariantId | null;
  decidedAt: string | null;
  decisionChannel: LinkChannel | null;
  decisionEmailSentAt: string | null;
  decisionEmailError: string | null;
  observation: string | null;
  observedAt: string | null;
  observationChannel: LinkChannel | null;
  observationEmailSentAt: string | null;
  observationEmailError: string | null;
}

export const EMPTY_LINK_RESPONSE: PublicLinkResponse = {
  decision: null,
  decisionVariantId: null,
  decidedAt: null,
  decisionChannel: null,
  decisionEmailSentAt: null,
  decisionEmailError: null,
  observation: null,
  observedAt: null,
  observationChannel: null,
  observationEmailSentAt: null,
  observationEmailError: null,
};

function isoOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Normaliza una fila cruda a la vista pública. Devuelve `null` si la fila no
 * tiene ni decisión ni observación (no hay nada que mostrar). Tolera basura:
 * un valor inválido se descarta en vez de romper el visor.
 */
export function toPublicLinkResponse(raw: unknown): PublicLinkResponse | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Partial<LinkResponseRow>;

  const decision = isLinkDecision(row.decision) ? row.decision : null;
  const decisionVariantId =
    decision && isLinkVariantId(row.decision_variant_id) ? row.decision_variant_id : null;
  const decisionChannel =
    decision === 'rejected' && isLinkChannel(row.decision_channel) ? row.decision_channel : null;
  const observation =
    typeof row.observation === 'string' && row.observation.trim().length > 0
      ? row.observation
      : null;
  const observationChannel =
    observation && isLinkChannel(row.observation_channel) ? row.observation_channel : null;

  if (!decision && !observation) return null;

  return {
    decision,
    decisionVariantId,
    decidedAt: decision ? isoOrNull(row.decided_at) : null,
    decisionChannel,
    decisionEmailSentAt: decisionChannel === 'email' ? isoOrNull(row.decision_email_sent_at) : null,
    decisionEmailError: decisionChannel === 'email' ? isoOrNull(row.decision_email_error) : null,
    observation,
    observedAt: observation ? isoOrNull(row.observed_at) : null,
    observationChannel,
    observationEmailSentAt:
      observationChannel === 'email' ? isoOrNull(row.observation_email_sent_at) : null,
    observationEmailError:
      observationChannel === 'email' ? isoOrNull(row.observation_email_error) : null,
  };
}

/** ¿El link ya tiene una decisión (nueva o legacy)? */
export function linkResponseIsDecided(
  response: PublicLinkResponse | null,
  legacyApproval: boolean,
): boolean {
  return Boolean(response?.decision) || legacyApproval;
}

/** Etiqueta del canal para el panel/visor. */
export function channelLabel(channel: LinkChannel | null): string {
  if (channel === 'email') return 'Email';
  if (channel === 'whatsapp') return 'WhatsApp';
  return '—';
}

/**
 * Fecha + hora es-AR para el visor y el panel (ISO inválido ⇒ `—`).
 * El huso es EXPLÍCITO para que el HTML del server y la hidratación del
 * cliente coincidan aunque el servidor corra en UTC (Vercel).
 */
export function formatLinkDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Estado visible del email del aviso (`Enviado`/`Pendiente`/`Falló`).
 * Un canal WhatsApp no tiene email: devuelve cadena vacía. El texto NO
 * incluye el separador (`·`): cada superficie decide cómo pegarlo.
 */
export function emailStatusLabel(
  channel: LinkChannel | null,
  sentAt: string | null,
  error: string | null,
): string {
  if (channel !== 'email') return '';
  if (sentAt) return 'Email enviado';
  if (error) return 'El email no salió';
  return 'Email pendiente';
}

/* -------------------------------------------------------------------------- */
/* WhatsApp (R14.5/R14.6): textos exactos + href con dígitos del taller        */
/* -------------------------------------------------------------------------- */

/** Mismo contrato que `whatsappApprovalHref`: E.164 roto ⇒ null. */
export function whatsappHref(phoneE164: string | null, text: string): string | null {
  const digits = (phoneE164 ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function whatsappRejectionText(linkUrl: string, message: string): string {
  return `¡Hola! Revisé la propuesta de mi mate personalizado y quiero rechazarla. Mi observación: "${message}". Link: ${linkUrl}`;
}

export function whatsappObservationText(linkUrl: string, message: string): string {
  return `¡Hola! Tengo una observación sobre la propuesta de mi mate personalizado: "${message}". Link: ${linkUrl}`;
}

export function whatsappRejectionHref(
  phoneE164: string | null,
  linkUrl: string,
  message: string,
): string | null {
  return whatsappHref(phoneE164, whatsappRejectionText(linkUrl, message));
}

export function whatsappObservationHref(
  phoneE164: string | null,
  linkUrl: string,
  message: string,
): string | null {
  return whatsappHref(phoneE164, whatsappObservationText(linkUrl, message));
}
