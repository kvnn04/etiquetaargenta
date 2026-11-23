/* ============================================================================
 * ORIGIN PÚBLICO DE LA REQUEST — back_urls de Mercado Pago
 * ----------------------------------------------------------------------------
 * Next dev expone `nextUrl.origin` como `http://localhost:PORT` aunque el
 * server escuche en `127.0.0.1` (verificado 23-nov-2026). MP rechaza
 * `http://localhost:...` como back_url ("must be a valid URL"), así que:
 *   1. se prefiere el `Host` real de la request;
 *   2. se normaliza `localhost` → `127.0.0.1` (MP sí acepta loopback);
 *   3. en prod, el Host público + `x-forwarded-proto` dan el origin HTTPS.
 * No se confía en `x-forwarded-host`: si un proxy altera el Host, el operador
 * setea `MP_PUBLIC_ORIGIN` (spec_pagos_ida_a_produccion.md P2).
 * ========================================================================== */

export function publicRequestOrigin(input: {
  nextUrlOrigin: string;
  nextUrlProtocol: string;
  host: string | null;
  forwardedProto: string | null;
}): string {
  const host = input.host?.trim();
  const forwardedProto = input.forwardedProto?.split(',')[0]?.trim();
  const protocol =
    forwardedProto ||
    input.nextUrlProtocol.replace(/:$/, '') ||
    'http';
  const raw = host ? `${protocol}://${host}` : input.nextUrlOrigin;
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.replace(/^(https?):\/\/localhost(?=[:/]|$)/i, '$1://127.0.0.1');
}
