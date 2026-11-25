/* ============================================================================
 * WEBHOOK DE MERCADO PAGO — piezas PURAS (spec_pagos.md R7 + QA3)
 * ----------------------------------------------------------------------------
 * R7: la firma `x-signature` viaja como `ts=<unix>,v1=<hex32×2>` (puede venir
 * más de un v1 vigente); el manifiesto que se firma es EXACTamente
 *   id:{data.id};request-id:{x-request-id};ts:{ts};
 * (documentación de MP, sin espacios). Verificación timing-safe
 * (timingSafeEqual) y `false` inmediato ante cualquier pieza faltante.
 * El pull del recurso (GET del payment/preapproval real) vive en el route:
 * NUNCA se confía en el body para decidir dinero (§6 Seguridad).
 * ============================================================================ */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MpSigParts {
  ts: string;
  versions: string[]; // v1 values (puede haber más de una)
}

/** Parseo tolerante del header `x-signature`: null si no hay ts ni v1. */
export function parseMpSignature(header: string | null): MpSigParts | null {
  if (!header) return null;
  let ts: string | null = null;
  const versions: string[] = [];
  for (const chunk of header.split(',')) {
    const [rawKey, ...rest] = chunk.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (!key || !value) continue;
    if (key === 'ts') ts = value;
    if (key === 'v1') versions.push(value.slice(0, 64)); // 32 bytes hex … por las dudas recorte
  }
  if (!ts || versions.length === 0) return null;
  return { ts, versions };
}

/** HMAC-SHA256 hex del manifiesto oficial de MP (para tests y verificación). */
export function mpSignatureHex(input: {
  dataId: string;
  requestId: string;
  ts: string;
  secret: string;
}): string {
  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${input.ts};`;
  return createHmac('sha256', input.secret).update(manifest).digest('hex');
}

/**
 * Firma VÁLIDA ⇒ true (R7). `v1` esperado: hex de 32 bytes; compara bytes con
 * timingSafeEqual contra CADA v1 declarado (cualquiera vale, que uno cualifique).
 */
export function verifyMpSignature(input: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string;
  secret: string;
}): boolean {
  const parsed = parseMpSignature(input.signatureHeader);
  if (!parsed) return false;
  const expectedHex = mpSignatureHex({
    dataId: input.dataId,
    requestId: input.requestId ?? '',
    ts: parsed.ts,
    secret: input.secret,
  });
  const expected = Buffer.from(expectedHex, 'hex');
  return parsed.versions.some((given) => {
    const givenBuf = Buffer.from(given, 'hex');
    if (givenBuf.length !== expected.length) return false;
    return timingSafeEqual(givenBuf, expected);
  });
}

/**
 * `live_mode` del body: ausente ⇒ true (se trata como evento real y, ante un
 * 404, se pide reintento). Solo `false` explícito habilita el descarte.
 */
export function parseLiveMode(payload: unknown): boolean {
  const body = payload as { live_mode?: unknown } | null;
  return body?.live_mode !== false;
}

/**
 * 404 definitivo: el botón "Probar" del panel manda un id ficticio con
 * `live_mode: false`, que jamás va a existir. En cambio, un 404 de un evento
 * live puede ser un desfasaje de credenciales (TEST vs producción): hay que
 * responder 502 para que MP reintente cuando el entorno se corrija.
 */
export function missingResourceIsFinal(input: { status: number; liveMode: boolean }): boolean {
  return input.status === 404 && !input.liveMode;
}

/* -------------------------------------------------------------------------- */
/* Evento entrante: RUTA× (nueva form) × topic/id (query form legada)          */
/* -------------------------------------------------------------------------- */

export type MpWebhookKind =
  | 'payment'
  | 'preapproval'
  | 'authorized_payment'
  | 'chargeback'
  | 'ignored';

export interface MpWebhookEvent {
  kind: MpWebhookKind;
  /** id del RECURSO a pullear (¡no el id del evento webhook!). */
  resourceId: string | null;
}

/**
 * Topics de suscripción: el panel de MP (Tus integraciones → Webhooks) usa
 * `subscription_preapproval` para el alta/estado del preapproval y
 * `subscription_authorized_payment` para el invoice de cada cobro recurrente.
 * `preapproval` / `authorized_payment` son los nombres cortos que usan los
 * tests/curl. Apuntan a recursos distintos (`/preapproval/{id}` y
 * `/authorized_payments/{id}`), así que NO se normalizan al mismo kind.
 */
const isPreapprovalTopic = (topic: string): boolean =>
  topic === 'preapproval' || topic === 'subscription_preapproval';

const isAuthorizedPaymentTopic = (topic: string): boolean =>
  topic === 'authorized_payment' || topic === 'subscription_authorized_payment';

/**
 * Topics de contracargo (R11.1/§3.4): MP usa `chargeback` en la API y
 * `topic_chargebacks_wh` en el panel. Ambos apuntan a `/v1/chargebacks/{id}`.
 */
const isChargebackTopic = (topic: string): boolean =>
  topic === 'chargeback' || topic === 'topic_chargebacks_wh' || topic === 'chargebacks';

/** Nueva forma MP: POST JSON `{ type|topic, data:{ id } }`; legada: `?topic=&id=`. */
export function parseWebhookEvent(payload: unknown, searchParams: URLSearchParams): MpWebhookEvent {
  // Query form (webhooks legados o QA manual con curl):
  const qTopic = searchParams.get('type') ?? searchParams.get('topic');
  const qId = searchParams.get('id');
  if (qTopic && qId) {
    if (qTopic === 'payment') return { kind: 'payment', resourceId: qId };
    if (isPreapprovalTopic(qTopic)) return { kind: 'preapproval', resourceId: qId };
    if (isAuthorizedPaymentTopic(qTopic)) return { kind: 'authorized_payment', resourceId: qId };
    if (isChargebackTopic(qTopic)) return { kind: 'chargeback', resourceId: qId };
    return { kind: 'ignored', resourceId: qId };
  }

  const body = payload as
    | { type?: string; topic?: string; action?: string; data?: { id?: unknown } | unknown[] }
    | null;
  const type = body?.type ?? body?.topic;
  // R7/R11: eventos tratados — payment, preapproval/subscription_preapproval,
  // authorized_payment/subscription_authorized_payment y
  // chargeback/topic_chargebacks_wh (el resto se logea).
  const id = body?.data && !Array.isArray(body.data) ? body.data.id : undefined;
  const resourceId = typeof id === 'string' || typeof id === 'number' ? String(id) : null;
  if (type === 'payment') return { kind: 'payment', resourceId };
  if (type && isPreapprovalTopic(type)) return { kind: 'preapproval', resourceId };
  if (type && isAuthorizedPaymentTopic(type)) return { kind: 'authorized_payment', resourceId };
  if (type && isChargebackTopic(type)) return { kind: 'chargeback', resourceId };
  return { kind: 'ignored', resourceId };
}
