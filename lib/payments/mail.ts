/* ============================================================================
 * MAILER TRANSACCIONAL — posición 10B (spec_pagos.md R6/R8/R9 + §5 Resend)
 * ----------------------------------------------------------------------------
 * R10: la lista de emails LEGÍTIMOS es cerrada: recibo de cobro, aviso de
 * gracia, cierre programado (+ ciclo de vida de cuenta, ya definidos en la
 * spec de usuario). CERO email de recuperación de checkout abandonado — ese
 * único registro vive en `checkout_intents`.
 * Degradación HONESTA (decisión del titular): sin RESEND_API_KEY o sin
 * EMAIL_FROM ⇒ el evento se logea `[mail <kind>]` y NADA más falla — el
 * estado de dinero es la fuente; el email es un aviso, no su puerta.
 * Remitente: EMAIL_FROM verificado en Resend (dominio con DNS al deployar).
 * ============================================================================ */

import { formatArs, formatDateAR, MERCADOPAGO_PORTAL_URL } from '@/lib/payments/core';

const RESEND_API = 'https://api.resend.com/emails';

export type MailKind = 'recibo_cobro' | 'aviso_gracia' | 'cierre_programado';

export interface MailContent {
  kind: MailKind;
  to: string;
  subject: string;
  html: string;
}

export interface MailOutcome {
  sent: boolean;
  note: string;
}

export function hasResendCredentials(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Envío único; NUNCA lanza — el webhook decide si el fallo importa. */
export async function sendMail(content: MailContent): Promise<MailOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.log(`[mail ${content.kind}] sin env o EMAIL_FROM — evento anotado en log, sin envío:`);
    console.log(`  to=${content.to} subject="${content.subject}"`);
    return { sent: false, note: 'env-no-configurado' };
  }
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [content.to],
        subject: content.subject,
        html: content.html,
      }),
      signal: AbortSignal.timeout(15_000),
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

export function mailScheduledClose(input: { to: string; periodEndMs: number }): MailContent {
  const fecha = formatDateAR(input.periodEndMs) ?? '';
  return {
    kind: 'cierre_programado',
    to: input.to,
    subject: `Cierre programado de tu suscripción PRO (${fecha})`,
    html: `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 8px">Cierre programado</h2><p>Pediste la baja desde el Portal de Mercado Pago: tu plan sigue <strong>activo hasta el ${fecha}</strong> (fin del ciclo ya pago). Ese día vuelven los candados y NO se generan cobros extra (R9).</p><p style="margin-top:12px">Tus proyectos, assets y links guardados quedan intactos — siempre podés volver.</p></div>`,
  };
}
