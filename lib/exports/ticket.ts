/* ============================================================================
 * TICKET DE EXPORT FIRMADO — posiciones 8–9
 * ÚNICA FUENTE: spec_autenticacion_y_modelo_freemium.md §3-R4/QA-3 (FREE ⇒ 402,
 * jamás artefacto limpio) + spec_detalle_del_modelo_en_ficha.md §3-R7
 * (ticket server-side, vigencia 5 min, ligado al hash del snapshot inmutable).
 * ----------------------------------------------------------------------------
 * Formato del token: `v1.<payload-b64url>.<hmac-b64url>` con
 *   payload   = JSON { v, sub, snapshotHash, iat, exp } (claves en ese orden ⇒
 *               serialización determinista),
 *   hmac      = HMAC-SHA256(payload-json, secreto del server).
 * El secreto vive SOLO en el server (env `EXPORT_TICKET_SECRET`, con
 * `SUPABASE_SERVICE_ROLE_KEY` como fallback documentado) — el cliente jamás
 * puede emitir ni falsificar un ticket: el motor gráfico de pos 9 (makeQuote-
 * Canvas + PDF A4) exige un token válido en `/api/exports/ticket/verificar`
 * antes de adjuntar el artefacto.
 * `node:crypto` está bien: SOLO lo importan la Route API (runtime nodejs) y
 * este test de Vitest (ambiente node).
 * ============================================================================ */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Vigencia EXACTA del ticket: 5 min (spec_detalle R7). */
export const EXPORT_TICKET_TTL_MS = 5 * 60_000;

/** Cota del hash del snapshot que el cliente adjunta (pos 9 manda el real). */
export const EXPORT_TICKET_HASH_MAX = 256;

export interface ExportTicketPayload {
  /** Versión del formato — rota claves/payload sin romper consumers viejos. */
  v: 'v1';
  /** userId del tallerista (el plan real vive en la tabla users, no acá). */
  sub: string;
  /** Hash del snapshot inmutable al que queda ligado el artefacto (R7). */
  snapshotHash: string;
  /** Emisión / expiración (ms epoch). */
  iat: number;
  exp: number;
}

/* b64url seguro para URLs/tokens (sin +, / ni padding). */
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(tokenPart: string): Buffer | null {
  try {
    return Buffer.from(tokenPart, 'base64url');
  } catch {
    return null;
  }
}

function hmacOf(json: Buffer, secret: string): Buffer {
  return createHmac('sha256', secret).update(json).digest();
}

/**
 * Emite un ticket firmado (vigencia 5 min EXACTAS) ligado al snapshotHash.
 * Lanza si los datos están vacíos o exceden cotas — nada silencioso: el
 * endpoint traduce el throw en 400 para el caller.
 */
export function signExportTicket(input: {
  userId: string;
  snapshotHash: string;
  secret: string;
  nowMs?: number;
}): { token: string; payload: ExportTicketPayload } {
  const { userId, snapshotHash, secret, nowMs } = input;
  if (!userId.trim()) throw new Error('TICKET_SUB_VACIO');
  if (!snapshotHash.trim()) throw new Error('TICKET_HASH_VACIO');
  if (snapshotHash.length > EXPORT_TICKET_HASH_MAX) throw new Error('TICKET_HASH_EXCEDIDO');
  if (!secret) throw new Error('TICKET_SECRETO_VACIO');

  const now = nowMs ?? Date.now();
  // Orden de claves FIJO: la serialización es determinista (misma entrada ⇒
  // mismo token, salvo el tiempo) — facilita QA de reproducibilidad.
  const payload: ExportTicketPayload = {
    v: 'v1',
    sub: userId,
    snapshotHash,
    iat: now,
    exp: now + EXPORT_TICKET_TTL_MS,
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const token = `${payload.v}.${b64url(json)}.${b64url(hmacOf(json, secret))}`;
  return { token, payload };
}

/**
 * Verifica un ticket: estructura v1, firma HMAC (comparación timing-safe),
 * ventana temporal vigente y campos completos. Retorna null ante CUALQUIER
 * desvío — el caller trata null como ticket inválido (jamás como fusible).
 */
export function verifyExportTicket(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): ExportTicketPayload | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, payloadB64, macB64] = parts;
  if (version !== 'v1') return null;

  const json = fromB64url(payloadB64);
  const mac = fromB64url(macB64);
  if (!json || !mac) return null;

  // La firma se recalcula sobre los bytes ORIGINALES del payload (jamás sobre
  // un re-serializado): un cambio de una sola coma invalida el MAC completo.
  const expected = hmacOf(json, secret);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json.toString('utf8'));
  } catch {
    return null;
  }
  const p = parsed as Partial<ExportTicketPayload> | null;
  if (!p || p.v !== 'v1') return null;
  if (typeof p.sub !== 'string' || !p.sub) return null;
  if (
    typeof p.snapshotHash !== 'string' ||
    !p.snapshotHash ||
    p.snapshotHash.length > EXPORT_TICKET_HASH_MAX
  ) {
    return null;
  }
  if (typeof p.iat !== 'number' || typeof p.exp !== 'number') return null;
  if (!Number.isFinite(p.iat) || !Number.isFinite(p.exp)) return null;
  if (p.exp - p.iat !== EXPORT_TICKET_TTL_MS) return null; // TTL exacto R7
  if (p.exp <= nowMs) return null; // vencido ⇒ null

  return { v: 'v1', sub: p.sub, snapshotHash: p.snapshotHash, iat: p.iat, exp: p.exp };
}
