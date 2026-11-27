/* ============================================================================
 * EMAILS LEGALES — posición 12 (spec_paginas_legales.md §4 + R13.4/R13.6/R13.10)
 * ----------------------------------------------------------------------------
 * Cuatro emails transaccionales legítimos:
 *   · acuse de arrepentimiento (código ARR-…, plazo de 10 días y 24 h);
 *   · confirmación de baja (link de doble opt-in de 24 h);
 *   · baja efectivizada (segundo email, con el fin del ciclo ya pago);
 *   · acuse/respuesta de derechos de datos (PRIV-…, 5 días hábiles).
 * Más la alerta interna al titular (`LEGAL_EMAIL`), sin motivo sensible ni
 * datos de tarjeta.
 *
 * Todos los valores del usuario se ESCAPAN (XSS en email, §6). `sendMail` es
 * fail-soft: la solicitud se guarda aunque el proveedor de email falle.
 * ============================================================================ */

import { formatArs, formatDateAR } from '@/lib/payments/core';
import { sendMail, type MailContent, type MailOutcome } from '@/lib/payments/mail';
import type { WithdrawalRefundReason } from '@/lib/payments/refunds';
import {
  escapeHtml,
  escapeHtmlMultiline,
  type LegalDataRight,
  LEGAL_DATA_RIGHT_LABEL,
  type LegalRequestKind,
  LEGAL_KIND_LABEL,
} from './requests';

const WRAP_STYLE = 'font-family:sans-serif;color:#1c1917;line-height:1.55';
const MUTED_STYLE = 'margin-top:12px;color:#78716c;font-size:13px';

function shell(title: string, body: string): string {
  return `<div style="${WRAP_STYLE}"><h2 style="margin:0 0 8px">${title}</h2>${body}</div>`;
}

/** `$ 36.799` o null si el precio no está disponible (nunca inventar). */
function priceText(amountArs: number | null): string {
  if (amountArs == null) return 'el precio vigente del plan';
  return formatArs(amountArs) ?? 'el precio vigente del plan';
}

/* -------------------------------------------------------------------------- */
/* Acuses al consumidor                                                        */
/* -------------------------------------------------------------------------- */

export function mailWithdrawalAck(input: {
  to: string;
  code: string;
  fullName: string;
  purchaseDateMs: number | null;
  withinWindow: boolean;
  amountArs?: number | null;
  /** Resultado ya ejecutado por el server (si lo hubo). */
  outcome?: 'processed' | 'sync_pending' | 'failed' | 'scheduled' | null;
  /** Motivo del cierre sin reembolso (solo cuando `outcome='scheduled'`). */
  scheduledReason?: WithdrawalRefundReason | null;
  periodEndMs?: number | null;
}): MailContent {
  const nombre = escapeHtml(input.fullName);
  const fecha = input.purchaseDateMs ? formatDateAR(input.purchaseDateMs) : null;
  const fin = input.periodEndMs ? formatDateAR(input.periodEndMs) : null;
  const plazo = input.withinWindow
    ? `<p>Tu solicitud queda dentro de los <strong>10 días corridos</strong> del arrepentimiento (Ley 24.240 art. 34 y Disposición 954/2025). Si el pago real también está dentro de la ventana, el reembolso es del <strong>100 %</strong> del último pago.</p>`
    : `<p>Registramos la solicitud aunque la fecha informada queda fuera de los 10 días corridos. Si el pago real también está fuera, <strong>no corresponde reembolso</strong>: cancelamos la renovación y el acceso sigue hasta el fin del ciclo ya pago.</p>`;
  const sinReembolso =
    input.scheduledReason === 'no_payment'
      ? 'No hay un pago aprobado asociado a la cuenta'
      : input.scheduledReason === 'no_balance'
        ? 'El pago ya fue devuelto en su totalidad'
        : input.scheduledReason === 'invalid_dates'
          ? 'La fecha del pago no permite verificar la ventana'
          : 'El pago real queda <strong>fuera de los 10 días corridos</strong>';
  const resolution =
    input.outcome === 'processed'
      ? `<p>Procesamos el reembolso del <strong>100 %</strong> del último pago por el mismo medio de pago y el plan PRO quedó <strong>inactivo</strong>.</p>`
      : input.outcome === 'sync_pending'
        ? `<p>Procesamos el reembolso del <strong>100 %</strong> del último pago por el mismo medio de pago. Estamos terminando de actualizar el estado del plan; si no se refleja en unos minutos, te contactamos.</p>`
        : input.outcome === 'failed'
          ? `<p>Cancelamos la renovación, pero Mercado Pago no aceptó el reembolso en este intento: lo reintentamos y te contactamos. Tu PRO sigue ${fin ? `hasta el <strong>${fin}</strong>` : 'hasta el fin del ciclo ya pago'}.</p>`
          : input.outcome === 'scheduled'
            ? `<p>${sinReembolso}: no corresponde reembolso. Cancelamos la renovación y tu PRO sigue ${fin ? `hasta el <strong>${fin}</strong>` : 'hasta el fin del ciclo ya pago'}.</p>`
            : `<p>En un plazo máximo de <strong>24 horas</strong> te confirmamos el encuadre y el resultado. Cuando corresponde, el reintegro se hace por el mismo medio de pago, por el <strong>100 %</strong> del último pago (${priceText(input.amountArs ?? null)}), y el acceso PRO se da de baja; la acreditación final depende de Mercado Pago y del banco emisor.</p>`;
  const cierre =
    input.outcome === 'processed' || input.outcome === 'sync_pending'
      ? '<p>Tus proyectos, assets y links se conservan: podés reactivar PRO cuando quieras.</p>'
      : input.outcome === 'failed'
        ? '<p>Mientras tanto, tus proyectos, assets y links se conservan y la renovación quedó cancelada.</p>'
        : input.outcome === 'scheduled'
          ? '<p>Tus proyectos, assets y links se conservan; al terminar el ciclo vuelven los límites del plan FREE.</p>'
          : '<p>Si no corresponde reembolso, la baja opera al final del ciclo ya pago. Tus proyectos, assets y links se conservan.</p>';
  return {
    kind: 'solicitud_legal',
    to: input.to,
    subject: `Recibimos tu solicitud de arrepentimiento (${input.code}) — Simulador Mates`,
    html: shell(
      'Recibimos tu solicitud de arrepentimiento',
      `<p>Hola ${nombre}: tu solicitud quedó registrada con el código <strong>${escapeHtml(input.code)}</strong>.</p>
       ${fecha ? `<p>Fecha de compra informada: <strong>${fecha}</strong>.</p>` : ''}
       ${plazo}
       ${resolution}
       ${cierre}
       <p style="${MUTED_STYLE}">Guardá este código para cualquier consulta. Respondé este email si necesitás agregar información.</p>`,
    ),
  };
}

export function mailBajaConfirmation(input: {
  to: string;
  code: string;
  confirmUrl: string;
  expiresAtMs: number;
}): MailContent {
  const vence = formatDateAR(input.expiresAtMs) ?? 'las próximas 24 horas';
  return {
    kind: 'solicitud_legal',
    to: input.to,
    subject: `Confirmá tu solicitud de baja (${input.code}) — Simulador Mates`,
    html: shell(
      'Confirmá tu solicitud de baja',
      `<p>Recibimos un pedido de baja con el código <strong>${escapeHtml(input.code)}</strong>. Para cuidar tu cuenta, todavía <strong>no cancelamos nada</strong>: falta confirmar desde este email.</p>
       <p style="margin:18px 0"><a href="${escapeHtml(input.confirmUrl)}" style="background:#b88a4e;color:#fff8ef;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar la baja</a></p>
       <p>El link vence el <strong>${vence}</strong> (24 horas) y se puede usar una sola vez. Si no lo abrís, la solicitud queda en revisión manual y te contactamos.</p>
       <p>Al confirmar, cancelamos el débito automático. <strong>Tu acceso sigue hasta el fin del ciclo ya pago</strong>; no se generan cobros posteriores (R9).</p>
       <p style="${MUTED_STYLE}">Si no pediste la baja, ignorá este email: no se cancela nada.</p>`,
    ),
  };
}

export function mailBajaDone(input: {
  to: string;
  code: string;
  periodEndMs: number | null;
  manual?: boolean;
}): MailContent {
  const fin = input.periodEndMs ? formatDateAR(input.periodEndMs) : null;
  const estado = input.manual
    ? `<p>La solicitud quedó en la cola de atención manual. Te contactamos dentro de las próximas 24 horas para terminarla.</p>`
    : `<p>La baja quedó confirmada. ${fin ? `Tu acceso sigue activo hasta el <strong>${fin}</strong> (fin del ciclo ya pago).` : 'No se generan cobros posteriores.'}</p>`;
  return {
    kind: 'solicitud_legal',
    to: input.to,
    subject: `Baja confirmada (${input.code}) — Simulador Mates`,
    html: shell(
      'Baja de servicio',
      `<p>Tu solicitud <strong>${escapeHtml(input.code)}</strong> fue procesada.</p>${estado}
       <p>Tus proyectos, assets y links guardados quedan intactos: siempre podés volver a suscribirte.</p>
       <p style="${MUTED_STYLE}">Si necesitás revertir la baja o tenés dudas, respondé este email dentro de los próximos 30 días.</p>`,
    ),
  };
}

export function mailPrivacyAck(input: {
  to: string;
  code: string;
  dataRight: LegalDataRight;
}): MailContent {
  const derecho = LEGAL_DATA_RIGHT_LABEL[input.dataRight];
  return {
    kind: 'solicitud_legal',
    to: input.to,
    subject: `Recibimos tu solicitud de datos (${input.code}) — Simulador Mates`,
    html: shell(
      'Solicitud de derechos de datos',
      `<p>Registramos tu pedido de <strong>${derecho}</strong> con el código <strong>${escapeHtml(input.code)}</strong>.</p>
       <p>La Ley 25.326 nos obliga a responder dentro de <strong>5 días hábiles</strong>. Si tu pedido requiere el borrado de la cuenta, se aplica el flujo de eliminación con 30 días de restauración.</p>
       <p>Si no recibís respuesta en ese plazo, podés presentarte ante la Agencia de Acceso a la Información Pública (AAIP).</p>
       <p style="${MUTED_STYLE}">Guardá este código para seguir el caso. Respondé este email si necesitás ampliar el pedido.</p>`,
    ),
  };
}

export function mailPrivacyResponse(input: {
  to: string;
  code: string;
  dataRight: LegalDataRight;
  note: string;
}): MailContent {
  return {
    kind: 'solicitud_legal',
    to: input.to,
    subject: `Respondimos tu solicitud de datos (${input.code}) — Simulador Mates`,
    html: shell(
      'Respuesta a tu solicitud de datos',
      `<p>Respondemos tu pedido de <strong>${LEGAL_DATA_RIGHT_LABEL[input.dataRight]}</strong> (código <strong>${escapeHtml(input.code)}</strong>).</p>
       <p>${escapeHtmlMultiline(input.note)}</p>
       <p style="${MUTED_STYLE}">Si la respuesta no te conforma, podés reclamar ante la AAIP.</p>`,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Alerta interna al titular (§4: sin datos de tarjeta ni motivo sensible)     */
/* -------------------------------------------------------------------------- */

export function mailLegalInternalAlert(input: {
  to: string;
  code: string;
  kind: LegalRequestKind;
  email: string;
  paymentId?: string | null;
  preapprovalId?: string | null;
  createdAtMs: number;
  detail?: string | null;
}): MailContent {
  const fecha = formatDateAR(input.createdAtMs) ?? '';
  const detail = input.detail
    ? `<p><strong>Detalle operativo:</strong> ${escapeHtml(input.detail)}</p>`
    : '';
  return {
    kind: 'alerta_legal',
    to: input.to,
    subject: `[LEGAL] ${input.code} · ${LEGAL_KIND_LABEL[input.kind]} · ${input.email}`,
    html: shell(
      'Nueva solicitud legal',
      `<p><strong>Tipo:</strong> ${LEGAL_KIND_LABEL[input.kind]}<br/>
       <strong>Código:</strong> ${escapeHtml(input.code)}<br/>
       <strong>Email informado:</strong> ${escapeHtml(input.email)}<br/>
       <strong>Fecha:</strong> ${fecha}</p>
       ${input.paymentId ? `<p><strong>Pago MP:</strong> ${escapeHtml(input.paymentId)}</p>` : ''}
       ${input.preapprovalId ? `<p><strong>Preapproval MP:</strong> ${escapeHtml(input.preapprovalId)}</p>` : ''}
       ${detail}
       <p>Plazo legal: 24 h para arrepentimiento/baja; 5 días hábiles para datos. Respondé desde el canal publicado.</p>
       <p style="${MUTED_STYLE}">Alerta automática del simulador. No incluye datos de tarjeta ni el texto sensible del motivo.</p>`,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Envío fail-soft                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Manda el acuse al consumidor y la alerta interna. NUNCA lanza: devuelve si
 * el acuse salió para que la pantalla sea honesta ("código en pantalla").
 */
export async function sendLegalNotifications(input: {
  consumer: MailContent;
  internal: MailContent | null;
  timeoutMs?: number;
}): Promise<{ consumer: MailOutcome; internal: MailOutcome | null }> {
  const [consumer, internal] = await Promise.all([
    sendMail(input.consumer, { timeoutMs: input.timeoutMs }),
    input.internal
      ? sendMail(input.internal, { timeoutMs: input.timeoutMs })
      : Promise.resolve(null),
  ]);
  return { consumer, internal };
}
