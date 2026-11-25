/* ============================================================================
 * TESTS POSICIÓN 10B — WEBHOOK BLINDADO (spec_pagos.md §3-R7 + §7 QA3):
 * firma HMAC x-signature (manifiesto id/request-id/ts, timing-safe, cualquier
 * v1), rechazo honesto ante piezas faltantes y ruteo del evento (nueva forma
 * POST JSON + query form legada). Módulo PURO: crypto local, sin fetch.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  missingResourceIsFinal,
  mpSignatureHex,
  parseLiveMode,
  parseMpSignature,
  parseWebhookEvent,
  verifyMpSignature,
} from '@/lib/payments/webhook';
import {
  arDateStrFromMs,
  arDateStrToMs,
  cycleAnchorDayOfStr,
  nextCycleDateMs,
} from '@/lib/payments/core';

const SECRET = 'secreto-webhook-qa-10b';
const DATA_ID = '123456789012345';
const REQUEST_ID = 'req-id-abc-42';
const TS = '1730868240';

describe('R7 — firma HMAC (x-signature `ts,v1`)', () => {
  const firmar = (dataId: string) =>
    createHmac('sha256', SECRET)
      .update(`id:${dataId};request-id:${REQUEST_ID};ts:${TS};`)
      .digest('hex');

  it('manifiesto OFICIAL de MP: id;request-id;ts; — firma válida ⇒ true', () => {
    const firma = firmar(DATA_ID);
    expect(
      verifyMpSignature({
        signatureHeader: `ts=${TS},v1=${firma}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toBe(true);
    // El helper propio debe producir EXACTAMENTE lo mismo que crypto puro:
    expect(mpSignatureHex({ dataId: DATA_ID, requestId: REQUEST_ID, ts: TS, secret: SECRET })).toBe(firma);
  });

  it('varios v1: uno podrido + uno válido ⇒ true (MP puede rotar claves)', () => {
    const firma = firmar(DATA_ID);
    expect(
      verifyMpSignature({
        signatureHeader: `ts=${TS},v1=${'f'.repeat(64)},v1=${firma}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('data.id retocado ⇒ false (QA3: puppetting queda AFUERA)', () => {
    expect(
      verifyMpSignature({
        signatureHeader: `ts=${TS},v1=${firmar('999999999')}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('secreto chico/otro, ts retocado, request-id retocado ⇒ false', () => {
    expect(
      verifyMpSignature({
        signatureHeader: `ts=${TS},v1=${firmar(DATA_ID)}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: 'otro-secreto',
      }),
    ).toBe(false);
    expect(
      verifyMpSignature({
        signatureHeader: `ts=999,v1=${firmar(DATA_ID)}`,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('piezas faltantes ⇒ false (fail-close), sin lanzar', () => {
    expect(verifyMpSignature({ signatureHeader: null, requestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET })).toBe(false);
    expect(verifyMpSignature({ signatureHeader: 'v1=abc', requestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET })).toBe(false);
    expect(verifyMpSignature({ signatureHeader: `ts=${TS}`, requestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET })).toBe(false);
    // Sin x-request-id NO hay manifiesto que matchee MP ⇒ false honesto.
    expect(
      verifyMpSignature({
        signatureHeader: `ts=${TS},v1=${firmar(DATA_ID)}`,
        requestId: null,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('parseMpSignature tolera MAYÚSCULAS y espacios (header real de MP)', () => {
    expect(parseMpSignature(`TS=${TS}, v1=abc123`)).toEqual({ ts: TS, versions: ['abc123'] });
    expect(parseMpSignature(null)).toBeNull();
    expect(parseMpSignature('')).toBeNull();
  });
});

describe('ruteo del evento (body JSON nuevo + query legada)', () => {
  const sp = (q: string) => new URL(`/api/webhooks/mercadopago${q}`, 'http://lo').searchParams;

  it('POST JSON nueva forma: payment/preapproval/tipos ajenos', () => {
    expect(parseWebhookEvent({ type: 'payment', data: { id: DATA_ID } }, sp(''))).toEqual({
      kind: 'payment',
      resourceId: DATA_ID,
    });
    expect(parseWebhookEvent({ topic: 'preapproval', data: { id: '2c9abc' } }, sp(''))).toEqual({
      kind: 'preapproval',
      resourceId: '2c9abc',
    });
    expect(parseWebhookEvent({ type: 'subscription_preapproval', data: { id: '2c9prod' } }, sp(''))).toEqual({
      kind: 'preapproval',
      resourceId: '2c9prod',
    });
    expect(
      parseWebhookEvent({ type: 'subscription_authorized_payment', data: { id: 'ap-1' } }, sp('')),
    ).toEqual({
      kind: 'authorized_payment',
      resourceId: 'ap-1',
    });
    expect(parseWebhookEvent({ type: 'authorized_payment', data: { id: 'ap-2' } }, sp(''))).toEqual({
      kind: 'authorized_payment',
      resourceId: 'ap-2',
    });
    expect(parseWebhookEvent({ type: 'chargeback', data: { id: 'cb-1' } }, sp(''))).toEqual({
      kind: 'chargeback',
      resourceId: 'cb-1',
    });
    expect(
      parseWebhookEvent({ topic: 'topic_chargebacks_wh', data: { id: 'cb-2' } }, sp('')),
    ).toEqual({
      kind: 'chargeback',
      resourceId: 'cb-2',
    });
    expect(parseWebhookEvent({ type: 'other', data: { id: 'x' } }, sp(''))).toEqual({
      kind: 'ignored',
      resourceId: 'x',
    });
    expect(parseWebhookEvent({ type: 'payment' }, sp('')).resourceId).toBeNull(); // sin data.id
  });

  it('query form legada: ?topic=payment&id= (QA curl manual)', () => {
    expect(parseWebhookEvent(null, sp('?topic=payment&id=777'))).toEqual({
      kind: 'payment',
      resourceId: '777',
    });
    expect(parseWebhookEvent(null, sp('?topic=preapproval&id=2c9xyz'))).toEqual({
      kind: 'preapproval',
      resourceId: '2c9xyz',
    });
    expect(parseWebhookEvent(null, sp('?topic=subscription_preapproval&id=2c9prod'))).toEqual({
      kind: 'preapproval',
      resourceId: '2c9prod',
    });
    expect(
      parseWebhookEvent(null, sp('?topic=subscription_authorized_payment&id=ap-3')),
    ).toEqual({
      kind: 'authorized_payment',
      resourceId: 'ap-3',
    });
    expect(parseWebhookEvent(null, sp('?topic=chargeback&id=cb-3'))).toEqual({
      kind: 'chargeback',
      resourceId: 'cb-3',
    });
  });
});

describe('404 del pull: botón "Probar" vs evento live', () => {
  it('parseLiveMode: solo false explícito se considera no-live', () => {
    expect(parseLiveMode({ live_mode: false })).toBe(false);
    expect(parseLiveMode({ live_mode: true })).toBe(true);
    expect(parseLiveMode({})).toBe(true); // ausente ⇒ se reintenta
    expect(parseLiveMode(null)).toBe(true);
  });

  it('missingResourceIsFinal: 404 no-live ⇒ 200; 404 live ⇒ 502 (reintento)', () => {
    expect(missingResourceIsFinal({ status: 404, liveMode: false })).toBe(true);
    expect(missingResourceIsFinal({ status: 404, liveMode: true })).toBe(false);
    expect(missingResourceIsFinal({ status: 500, liveMode: false })).toBe(false);
    expect(missingResourceIsFinal({ status: 403, liveMode: false })).toBe(false);
  });
});

describe('helpers DATE de Postgres ⇄ ms AR (cycle_anchor)', () => {
  it('arDateStrToMs: 00:00 AR del día (03:00 UTC) + null en strings rotos', () => {
    expect(arDateStrToMs('2026-11-06')).toBe(Date.UTC(2026, 10, 6, 3, 0, 0));
    expect(arDateStrToMs('')).toBeNull();
    expect(arDateStrToMs('06/11/2026')).toBeNull();
  });

  it('arDateStrFromMs: ida y vuelta con el ancla del día del pago', () => {
    const pago = Date.UTC(2026, 10, 6, 3, 0, 0); // 00:00 AR del 06/11
    expect(arDateStrFromMs(pago)).toBe('2026-11-06');
    expect(arDateStrToMs(arDateStrFromMs(nextCycleDateMs(6, pago)) as string)).toBe(
      Date.UTC(2026, 11, 6, 3, 0, 0),
    );
  });

  it('cycleAnchorDayOfStr: día 1..31 o null si la columna sigue vacía', () => {
    expect(cycleAnchorDayOfStr('2026-11-06')).toBe(6);
    expect(cycleAnchorDayOfStr('')).toBeNull();
  });
});
