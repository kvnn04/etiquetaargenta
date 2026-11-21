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

/* -------------------------------------------------------------------------- */
/* Evento entrante: RUTA× (nueva form) × topic/id (query form legada)          */
/* -------------------------------------------------------------------------- */

export type MpWebhookKind = 'payment' | 'preapproval' | 'ignored';

export interface MpWebhookEvent {
  kind: MpWebhookKind;
  /** id del RECURSO a pullear (¡no el id del evento webhook!). */
  resourceId: string | null;
}

/**
 * Topics de suscripción: el panel de MP (Tus integraciones → Webhooks) usa
 * `subscription_preapproval` para suscripciones SIN plan (las nuestras);
 * `preapproval` es el nombre legado que usan los tests/curl. Ambos apuntan al
 * MISMO recurso (`/preapproval/{id}`), así que se normalizan al mismo kind.
 */
const isPreapprovalTopic = (topic: string): boolean =>
  topic === 'preapproval' || topic === 'subscription_preapproval';

/** Nueva forma MP: POST JSON `{ type|topic, data:{ id } }`; legada: `?topic=&id=`. */
export function parseWebhookEvent(payload: unknown, searchParams: URLSearchParams): MpWebhookEvent {
  // Query form (webhooks legados o QA manual con curl):
  const qTopic = searchParams.get('type') ?? searchParams.get('topic');
  const qId = searchParams.get('id');
  if (qTopic && qId) {
    if (qTopic === 'payment') return { kind: 'payment', resourceId: qId };
    if (isPreapprovalTopic(qTopic)) return { kind: 'preapproval', resourceId: qId };
    return { kind: 'ignored', resourceId: qId };
  }

  const body = payload as
    | { type?: string; topic?: string; action?: string; data?: { id?: unknown } | unknown[] }
    | null;
  const type = body?.type ?? body?.topic;
  // R7: eventos tratados — payment.updated y preapproval/subscription_preapproval
  // (el resto se logea). `subscription_authorized_payment` es otro recurso
  // (/authorized_payments/{id}) y este flujo planless-pending no lo necesita.
  const id = body?.data && !Array.isArray(body.data) ? body.data.id : undefined;
  const resourceId = typeof id === 'string' || typeof id === 'number' ? String(id) : null;
  if (type === 'payment') return { kind: 'payment', resourceId };
  if (type && isPreapprovalTopic(type)) return { kind: 'preapproval', resourceId };
  return { kind: 'ignored', resourceId };
}
