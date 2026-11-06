/* ============================================================================
 * TESTS POSICIÓN 8 — Ticket de export firmado (ÚNICA FUENTE:
 * spec_autenticacion_y_modelo_freemium.md §3-R4/QA-3 + spec_detalle_del_
 * modelo_en_ficha.md §3-R7: vigencia EXACTA 5 min, ligado al hash, 402 FREE).
 * Ambiente node: `node:crypto` corre igual que en la Route API (runtime nodejs).
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  EXPORT_TICKET_HASH_MAX,
  EXPORT_TICKET_TTL_MS,
  signExportTicket,
  verifyExportTicket,
} from '@/lib/exports/ticket';

const SECRET = 'secreto-de-test-para-el-hmac';

/** t0 fijo: 05-nov-2026 18:00 UTC — hace los asserts de tiempos deterministas. */
const T0 = Date.UTC(2026, 10, 5, 18, 0, 0);

describe('ticket de export (pos 8 · R7 spec_detalle / R4 spec_auth)', () => {
  it('ida/vuelta: el ticket firmado se verifica con el mismo secreto', () => {
    const { token, payload } = signExportTicket({
      userId: 'user-abc-123',
      snapshotHash: 'snp#9f2c',
      secret: SECRET,
      nowMs: T0,
    });
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // b64url sin padding
    expect(verifyExportTicket(token, SECRET, T0 + 1000)).toEqual({
      v: 'v1',
      sub: 'user-abc-123',
      snapshotHash: 'snp#9f2c',
      iat: T0,
      exp: T0 + EXPORT_TICKET_TTL_MS,
    });
  });

  it('vigencia EXACTA de 5 minutos (QA R7: los 5 min son válidos, los 5:01 no)', () => {
    const { payload } = signExportTicket({
      userId: 'u',
      snapshotHash: 'h',
      secret: SECRET,
      nowMs: T0,
    });
    expect(EXPORT_TICKET_TTL_MS).toBe(5 * 60_000);
    expect(payload.exp - payload.iat).toBe(5 * 60_000);
    // Al minuto 5:00.999 todavía vale; a 5:01 ya no.
    const { token } = signExportTicket({ userId: 'u', snapshotHash: 'h', secret: SECRET, nowMs: T0 });
    expect(verifyExportTicket(token, SECRET, T0 + 5 * 60_000 - 1)).not.toBeNull();
    expect(verifyExportTicket(token, SECRET, T0 + 5 * 60_000)).toBeNull();
  });

  it('firma con OTRO secreto no verifica (ronda de claves / forjado)', () => {
    const { token } = signExportTicket({
      userId: 'user-1',
      snapshotHash: 'hash',
      secret: SECRET,
      nowMs: T0,
    });
    expect(verifyExportTicket(token, 'otra-clave', T0)).toBeNull();
  });

  it('payload tocado de UN solo byte invalida el MAC completo', () => {
    const { token } = signExportTicket({
      userId: 'user-1',
      snapshotHash: 'hash-original',
      secret: SECRET,
      nowMs: T0,
    });
    // Cambia 'a' por 'b' en el segmento de payload (siguiente char del alfabeto
    // b64url puede no existir por el bit-mapping — busca un reemplazo válido).
    const [v, payloadB64, macB64] = token.split('.');
    let tampered: string | null = null;
    for (const ch of 'BCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefg') {
      const candidate = payloadB64.replace('a', ch);
      if (candidate !== payloadB64) {
        tampered = `${v}.${candidate}.${macB64}`;
        break;
      }
    }
    expect(tampered).not.toBeNull();
    expect(verifyExportTicket(tampered!, SECRET, T0)).toBeNull();
  });

  it('estructura malformada ⇒ null (sin partes, versión desconocida o b64 roto)', () => {
    expect(verifyExportTicket('', SECRET, T0)).toBeNull();
    expect(verifyExportTicket('solo-un-pedazo', SECRET, T0)).toBeNull();
    expect(verifyExportTicket('dos.solo.partes'.padEnd(30, '.').slice(0, 29), SECRET, T0)).toBeNull();
    const { token } = signExportTicket({ userId: 'u', snapshotHash: 'h', secret: SECRET, nowMs: T0 });
    const [, payloadB64, macB64] = token.split('.');
    expect(verifyExportTicket(`v2.${payloadB64}.${macB64}`, SECRET, T0)).toBeNull(); // versión rotada sin firma vieja válida
    expect(verifyExportTicket(`v1.$$$no-valido.b64url-roll`, SECRET, T0)).toBeNull(); // b64 roto
  });

  it('re-serializar el payload NO finge un ticket: la firma va sobre bytes originales', () => {
    const { token } = signExportTicket({
      userId: 'user-1',
      snapshotHash: 'h',
      secret: SECRET,
      nowMs: T0,
    });
    const [, payloadB64, macB64] = token.split('.');
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as Record<string, unknown>;
    delete obj.iat; // re-armo el JSON en otro orden: mismos datos, otros bytes
    obj.exp = obj.exp;
    obj.iat = T0;
    obj.snapshotHash = 'h';
    obj.sub = 'user-1';
    obj.v = 'v1';
    const rearmado = Buffer.from(JSON.stringify(obj)).toString('base64url');
    expect(verifyExportTicket(`v1.${rearmado}.${macB64}`, SECRET, T0)).toBeNull();
  });

  it('datos vacíos o fuera de cota se rechazan ANTES de firmar', () => {
    expect(() =>
      signExportTicket({ userId: '', snapshotHash: 'h', secret: SECRET, nowMs: T0 }),
    ).toThrow();
    expect(() =>
      signExportTicket({ userId: 'u', snapshotHash: '', secret: SECRET, nowMs: T0 }),
    ).toThrow();
    expect(() =>
      signExportTicket({
        userId: 'u',
        snapshotHash: 'x'.repeat(EXPORT_TICKET_HASH_MAX + 1),
        secret: SECRET,
        nowMs: T0,
      }),
    ).toThrow();
    expect(() => signExportTicket({ userId: 'u', snapshotHash: 'h', secret: '', nowMs: T0 })).toThrow();
  });
});
