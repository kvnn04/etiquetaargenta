/* ============================================================================
 * MAILER TRANSACCIONAL — posición 10B (spec_pagos.md R6/R8/R9 + §5 Resend)
 * ----------------------------------------------------------------------------
 * R10: la lista de emails LEGÍTIMOS es cerrada: recibo de cobro, aviso de
 * gracia, cierre programado, reembolsos/contracargos (pos 13), decisión y
 * observación del cliente del enlace (pos 14), ciclo de vida de cuenta y
 * legales. CERO email de recuperación de checkout abandonado — ese único
 * registro vive en `checkout_intents`.
 * Degradación HONESTA (decisión del titular): sin RESEND_API_KEY o sin
 * EMAIL_FROM ⇒ el evento se logea `[mail <kind>]` y NADA más falla — el
 * estado de dinero es la fuente; el email es un aviso, no su puerta.
 * Remitente: EMAIL_FROM verificado en Resend (dominio con DNS al deployar).
 * ============================================================================ */

import { formatArs, formatDateAR, MERCADOPAGO_PORTAL_URL } from '@/lib/payments/core';

const RESEND_API = 'https://api.resend.com/emails';

export type MailKind =
  | 'recibo_cobro'
  | 'aviso_gracia'
  | 'cierre_programado'
  /* Posición 13 (R11.9): reembolsos, contracargo y alerta operativa. */
  | 'reembolso_total'
  | 'reembolso_parcial'
  | 'contracargo'
  | 'alerta_pago'
  /* Posición 12 (R13.4/R13.6/R13.10): acuses y alertas legales. */
  | 'solicitud_legal'
  | 'alerta_legal'
  /* Posición 14 (R14.5): decisión/observación del cliente del enlace. */
  | 'decision_cliente'
  | 'observacion_cliente';

export interface MailContent {
  kind: MailKind;
  to: string;
  subject: string;
  html: string;
  /**
   * R12.7: clave de idempotencia del proveedor (`receipt:{mp_payment_id}`).
   * Resend la soporta por header; si el proveedor no la soporta, el claim de
   * `payments.email_claimed_at` sigue siendo la barrera principal.
   */
  idempotencyKey?: string;
}

export interface MailOutcome {
  sent: boolean;
  note: string;
}

export function hasResendCredentials(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Envío único; NUNCA lanza — el webhook decide si el fallo importa.
 * `timeoutMs` permite que el sync on-read recorte el envío al presupuesto que
 * le queda (8 s) sin bloquear el render; el webhook usa el default de 15 s.
 */
export async function sendMail(
  content: MailContent,
  opts: { timeoutMs?: number } = {},
): Promise<MailOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.log(`[mail ${content.kind}] sin env o EMAIL_FROM — evento anotado en log, sin envío:`);
    console.log(`  to=${content.to} subject="${content.subject}"`);
    return { sent: false, note: 'env-no-configurado' };
  }
  try {
    const timeoutMs = Math.max(1_000, Math.min(15_000, opts.timeoutMs ?? 15_000));
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(content.idempotencyKey
          ? { 'Idempotency-Key': content.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from,
        to: [content.to],
        subject: content.subject,
        html: content.html,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      console.error(`[mail ${content.kind}]: HTTP ${res.status}`, body?.message ?? '');
      return { sent: false, note: `HTTP ${res.status}` };
    }
    console.log(`[mail ${content.kind}]: enviado a ${content.to}`);
    return { sent: true, note: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error(`[mail ${content.kind}]:`, message);
    return { sent: false, note: message };
  }
}

/* -------------------------------------------------------------------------- */
/* Emails legítimos (los únicos que existen — R10)                            */
/* -------------------------------------------------------------------------- */

export function mailReceipt(input: {
  to: string;
  amountArs: number;
  occurredAtMs: number;
  receiptUrl: string | null;
}): MailContent {
  const monto = formatArs(input.amountArs) ?? 'monto indeterminado';
  const fecha = formatDateAR(input.occurredAtMs) ?? '';
  const constancia = input.receiptUrl
    ? `<p style="margin-top:12px">Tu constancia de Mercado Pago: <a href="${input.receiptUrl}">${input.receiptUrl}</a></p>`
    : '<p style="margin-top:12px">La constancia también está en tu Centro de Suscripción (Perfil → Suscripción).</p>';
  return {
    kind: 'recibo_cobro',
    to: input.to,
    subject: `Recibimos tu pago de ${monto} — Simulador Mates PRO`,
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Recibo de cobro</h2><p>Pago de tu suscripción PRO por <strong>${monto}</strong> el día ${fecha} (ARS, débito automático de tarjeta).</p>${constancia}<p style="margin-top:12px;color:#78716c">La factura ARCA la emite el responsable del SaaS a mano (R6): si la necesitás, respondé este email.</p></div>`,
  };
}

export function mailGrace(input: { to: string; graceExpiresAtMs: number }): MailContent {
  const vence = formatDateAR(input.graceExpiresAtMs) ?? '';
  return {
    kind: 'aviso_gracia',
    to: input.to,
    subject: 'Pago rechazado — tenés 5 días de gracia para seguir en PRO',
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Tu pago no se pudo procesar</h2><p>Sin drama: tu taller sigue con <strong>todo el acceso PRO</strong> hasta el <strong>${vence}</strong> (5 días corridos). Actualizá la tarjeta en el Portal de Mercado Pago y el débito se reintenta solo.</p><p style="margin-top:12px"><a href="${MERCADOPAGO_PORTAL_URL}">Abrir Portal de Mercado Pago</a></p><p style="margin-top:12px;color:#78716c">Si no se procesa antes de vencer la ventana, tu cuenta vuelve a FREE conservando proyectos, assets y links (R8).</p></div>`,
  };
}

export function mailScheduledClose(input: {
  to: string;
  periodEndMs: number;
  /** `app` = baja pedida desde el Centro de Suscripción; el resto, genérico. */
  source?: 'app' | 'portal' | 'legal';
}): MailContent {
  const fecha = formatDateAR(input.periodEndMs) ?? '';
  const origen =
    input.source === 'app'
      ? 'Pediste la baja desde la app'
      : 'Pediste la baja de tu suscripción PRO';
  return {
    kind: 'cierre_programado',
    to: input.to,
    subject: `Cierre programado de tu suscripción PRO (${fecha})`,
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Cierre programado</h2><p>${origen}: tu plan sigue <strong>activo hasta el ${fecha}</strong> (fin del ciclo ya pago). Ese día vuelven los candados y NO se generan cobros extra (R9).</p><p style="margin-top:12px">Tus proyectos, assets y links guardados quedan intactos — siempre podés volver.</p></div>`,
  };
}

/* -------------------------------------------------------------------------- */
/* Posición 13 — reembolsos y contracargos (R11.9)                            */
/* -------------------------------------------------------------------------- */

/** Escape mínimo para la alerta interna (ids/notas, nunca datos de tarjeta). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Reembolso TOTAL del ciclo (Q1): el acceso ya se cortó. No promete plazos
 * de acreditación del banco (R11.9).
 */
export function mailRefundTotal(input: {
  to: string;
  amountArs: number;
  refundedArs: number;
  occurredAtMs: number;
}): MailContent {
  const monto = formatArs(input.refundedArs) ?? formatArs(input.amountArs) ?? 'el monto del pago';
  const fecha = formatDateAR(input.occurredAtMs) ?? '';
  return {
    kind: 'reembolso_total',
    to: input.to,
    subject: 'Reembolso procesado — Plan PRO inactivo',
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Reembolso procesado</h2><p>Reembolsamos <strong>${monto}</strong> de tu pago del ${fecha}. El plan PRO quedó <strong>inactivo</strong>.</p><p>Tus proyectos, assets y links siguen guardados: podés reactivar PRO cuando quieras desde Perfil → Suscripción.</p><p style="margin-top:12px;color:#78716c">El reintegro se procesa por el mismo medio de pago. Los plazos de acreditación dependen de Mercado Pago y de tu banco: no prometemos fechas.</p></div>`,
  };
}

/**
 * Reembolso PARCIAL (Q2): el plan sigue activo hasta el fin del ciclo.
 */
export function mailRefundPartial(input: {
  to: string;
  amountArs: number;
  refundedArs: number;
  cycleEndMs: number | null;
}): MailContent {
  const devuelto = formatArs(input.refundedArs) ?? 'el monto devuelto';
  const original = formatArs(input.amountArs) ?? 'tu pago';
  const fin = input.cycleEndMs ? formatDateAR(input.cycleEndMs) : null;
  const vigencia = fin
    ? `hasta el <strong>${fin}</strong> (fin del ciclo en curso)`
    : 'hasta el <strong>fin del ciclo en curso</strong>';
  return {
    kind: 'reembolso_parcial',
    to: input.to,
    subject: 'Registramos un reembolso parcial — Simulador Mates',
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Reembolso parcial</h2><p>Registramos un reembolso parcial de <strong>${devuelto}</strong> sobre tu pago de ${original}.</p><p>Tu plan PRO sigue activo ${vigencia}. No se generan cobros extra por este ajuste.</p><p style="margin-top:12px;color:#78716c">Tus proyectos, assets y links se conservan. Si tenés dudas, respondé este email.</p></div>`,
  };
}

/**
 * Contracargo (Q4): suspensión inmediata, sin culpar al usuario y sin
 * prometer resultado de la disputa (R11.9).
 */
export function mailChargeback(input: {
  to: string;
  amountArs: number;
  occurredAtMs: number;
  supportEmail?: string | null;
}): MailContent {
  const monto = formatArs(input.amountArs) ?? 'el monto del pago';
  const fecha = formatDateAR(input.occurredAtMs) ?? '';
  const soporte = input.supportEmail
    ? `<p>Si necesitás ayuda, escribinos a <a href="mailto:${esc(input.supportEmail)}">${esc(input.supportEmail)}</a>.</p>`
    : '<p>Si necesitás ayuda, respondé este email.</p>';
  return {
    kind: 'contracargo',
    to: input.to,
    subject: 'Contracargo recibido — acceso suspendido',
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Contracargo recibido</h2><p>Se inició un contracargo sobre tu pago de <strong>${monto}</strong> del ${fecha}. El acceso PRO quedó <strong>suspendido</strong> mientras se resuelve.</p><p>No es una acusación: es el proceso habitual de la tarjeta. La gestión de la disputa vive en Mercado Pago.</p>${soporte}<p style="margin-top:12px;color:#78716c">Tus proyectos, assets y links siguen guardados. No prometemos plazos ni resultados de la disputa.</p></div>`,
  };
}

export type PaymentAlertKind =
  | 'refund_total'
  | 'refund_partial'
  | 'chargeback'
  | 'chargeback_reversal';

const PAYMENT_ALERT_LABEL: Record<PaymentAlertKind, string> = {
  refund_total: 'Reembolso total',
  refund_partial: 'Reembolso parcial',
  chargeback: 'Contracargo',
  chargeback_reversal: 'Contracargo revertido/ganado',
};

/**
 * Alerta operativa al titular (Q7): ids, montos y tipo. NUNCA datos de
 * tarjeta ni el motivo sensible del usuario.
 */
export function mailPaymentInternalAlert(input: {
  to: string;
  kind: PaymentAlertKind;
  userId: string;
  mpPaymentId: number;
  amountArs: number;
  refundedArs: number;
  impact: string;
  mpSourceId?: string | null;
  note?: string | null;
}): MailContent {
  const monto = formatArs(input.amountArs) ?? String(input.amountArs);
  const devuelto = formatArs(input.refundedArs) ?? String(input.refundedArs);
  return {
    kind: 'alerta_pago',
    to: input.to,
    subject: `[PAGOS] ${PAYMENT_ALERT_LABEL[input.kind]} · pago ${input.mpPaymentId}`,
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">${PAYMENT_ALERT_LABEL[input.kind]}</h2><p><strong>Usuario:</strong> ${esc(input.userId)}<br/><strong>Pago MP:</strong> ${input.mpPaymentId}<br/><strong>Monto:</strong> ${monto}<br/><strong>Devuelto:</strong> ${devuelto}<br/><strong>Impacto:</strong> ${esc(input.impact)}${input.mpSourceId ? `<br/><strong>Origen MP:</strong> ${esc(input.mpSourceId)}` : ''}</p>${input.note ? `<p><strong>Nota:</strong> ${esc(input.note)}</p>` : ''}<p style="margin-top:12px;color:#78716c">Alerta automática del ciclo de pagos. No incluye datos de tarjeta.</p></div>`,
  };
}
