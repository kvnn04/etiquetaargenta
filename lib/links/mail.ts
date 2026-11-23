/* ============================================================================
 * EMAILS DEL ENLACE — posición 14
 * (spec_decision_y_observaciones_del_cliente.md §7 + R14.5/R14.6)
 * ----------------------------------------------------------------------------
 * Dos avisos legítimos al TALLER (R10 ampliada):
 *   · `decision_cliente`: rechazo, con el motivo (nuevo o reutilizado);
 *   · `observacion_cliente`: observación sola o posterior a una aprobación.
 * El cliente NO deja datos de contacto: el cuerpo lo aclara y el Reply-To no
 * se setea. Todo valor del cliente se escapa (HTML/XSS). `sendMail` es
 * fail-soft: la fila ya quedó guardada antes de intentar el envío.
 * ============================================================================ */

import { formatDateAR } from '@/lib/payments/core';
import { sendMail, type MailContent, type MailOutcome } from '@/lib/payments/mail';
import { escapeHtml, escapeHtmlMultiline } from '@/lib/legal/requests';
import {
  channelLabel,
  type LinkChannel,
  type LinkDecision,
} from '@/lib/links/responses';

const MAIL_STYLE = 'font-family:sans-serif;color:#1c1917';
const MUTED_STYLE = 'margin-top:12px;color:#78716c';
const QUOTE_STYLE =
  'margin:8px 0;padding:10px 12px;border-left:3px solid #b88a4e;background:#faf7f2;white-space:pre-wrap';

/** Fecha + hora en es-AR (mismo huso que el resto de los emails). */
function formatDateTimeAR(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  const date = formatDateAR(ms) ?? '';
  const time = new Date(ms).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} ${time}`.trim();
}

/** El asunto no es HTML, pero un salto de línea del branding no debe colarse. */
function subjectSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
}

function channelOrDash(channel: LinkChannel | null): string {
  return channel ? channelLabel(channel) : '—';
}

export interface LinkDecisionMailInput {
  to: string;
  linkId: string;
  linkUrl: string;
  workshopName: string;
  variantLabel: string | null;
  observation: string;
  observedAtMs: number | null;
  observationChannel: LinkChannel | null;
  decisionChannel: LinkChannel | null;
}

/**
 * Aviso de RECHAZO. Incluye el motivo completo y los dos canales (el de la
 * observación y el del aviso de rechazo), que pueden diferir si el cliente
 * había dejado la observación antes de decidir.
 */
export function mailDecisionCliente(input: LinkDecisionMailInput): MailContent {
  const workshop = escapeHtml(input.workshopName);
  const linkUrl = escapeHtml(input.linkUrl);
  const variant = input.variantLabel ? escapeHtml(input.variantLabel) : null;
  const motive = escapeHtmlMultiline(input.observation);
  const observedAt = formatDateTimeAR(input.observedAtMs);
  const decisionChannel = channelOrDash(input.decisionChannel);
  const observationChannel = channelOrDash(input.observationChannel);
  const subject = `Tu cliente rechazó la propuesta /v/${input.linkId} — ${subjectSafe(input.workshopName)}`;

  return {
    kind: 'decision_cliente',
    to: input.to,
    subject,
    html: `<div style="${MAIL_STYLE}">
      <h2 style="margin:0 0 8px">Tu cliente rechazó la propuesta</h2>
      <p><strong>${workshop}</strong> · <a href="${linkUrl}">/v/${input.linkId}</a></p>
      ${variant ? `<p><strong>Opción:</strong> ${variant}</p>` : ''}
      <p><strong>Motivo informado por el cliente:</strong></p>
      <blockquote style="${QUOTE_STYLE}">${motive}</blockquote>
      <p>
        <strong>Fecha:</strong> ${observedAt || '—'}<br/>
        <strong>Observación enviada por:</strong> ${observationChannel}<br/>
        <strong>Aviso de rechazo por:</strong> ${decisionChannel}
      </p>
      <p style="${MUTED_STYLE}">Este aviso no incluye datos de contacto del cliente; respondé por el WhatsApp con el que le compartiste el enlace.</p>
      <p><a href="${linkUrl}">Abrir la propuesta</a></p>
    </div>`,
    idempotencyKey: `link-decision:${input.linkId}`,
  };
}

export interface LinkObservationMailInput {
  to: string;
  linkId: string;
  linkUrl: string;
  workshopName: string;
  decision: LinkDecision | null;
  variantLabel: string | null;
  observation: string;
  observedAtMs: number | null;
  observationChannel: LinkChannel | null;
}

/**
 * Aviso de OBSERVACIÓN sola o posterior a una aprobación. Si la decisión ya
 * existe, el cuerpo la nombra para dar contexto sin pedir nada al taller.
 */
export function mailObservationCliente(input: LinkObservationMailInput): MailContent {
  const workshop = escapeHtml(input.workshopName);
  const linkUrl = escapeHtml(input.linkUrl);
  const observation = escapeHtmlMultiline(input.observation);
  const observedAt = formatDateTimeAR(input.observedAtMs);
  const channel = channelOrDash(input.observationChannel);
  const variant = input.variantLabel ? escapeHtml(input.variantLabel) : null;

  const decisionLine =
    input.decision === 'approved'
      ? `La propuesta está <strong>aprobada</strong>${variant ? ` (${variant})` : ''}.`
      : input.decision === 'rejected'
        ? 'La propuesta está <strong>rechazada</strong>.'
        : 'La propuesta todavía no tiene una decisión registrada.';

  return {
    kind: 'observacion_cliente',
    to: input.to,
    subject: `Nueva observación de tu cliente — /v/${input.linkId}`,
    html: `<div style="${MAIL_STYLE}">
      <h2 style="margin:0 0 8px">Nueva observación de tu cliente</h2>
      <p><strong>${workshop}</strong> · <a href="${linkUrl}">/v/${input.linkId}</a></p>
      <p>${decisionLine}</p>
      <blockquote style="${QUOTE_STYLE}">${observation}</blockquote>
      <p><strong>Fecha:</strong> ${observedAt || '—'}<br/><strong>Enviada por:</strong> ${channel}</p>
      <p style="${MUTED_STYLE}">Este aviso no incluye datos de contacto del cliente; respondé por el WhatsApp con el que le compartiste el enlace.</p>
      <p><a href="${linkUrl}">Abrir la propuesta</a></p>
    </div>`,
    idempotencyKey: `link-observation:${input.linkId}`,
  };
}

/** Envía el aviso de rechazo; nunca lanza. */
export async function sendLinkDecisionMail(input: LinkDecisionMailInput): Promise<MailOutcome> {
  if (!input.to) return { sent: false, note: 'workshop-email-missing' };
  return sendMail(mailDecisionCliente(input));
}

/** Envía el aviso de observación; nunca lanza. */
export async function sendLinkObservationMail(input: LinkObservationMailInput): Promise<MailOutcome> {
  if (!input.to) return { sent: false, note: 'workshop-email-missing' };
  return sendMail(mailObservationCliente(input));
}
