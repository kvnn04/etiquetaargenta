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

/**
 * Origin para el `back_url` del checkout de suscripción.
 *
 * Un preview de Vercel (`etiquetaargenta-<hash>-…vercel.app`) es efímero y
 * puede pedir login: jamás debe ser el retorno de un pago. En producción se usa
 * el Host real (alias canónico); en preview/local se prefiere el origin público
 * configurado (`MP_PUBLIC_ORIGIN` o `NEXT_PUBLIC_SITE_URL`). Si no hay ninguno,
 * cae al Host de la request como antes.
 */
export function checkoutBackUrlOrigin(
  input: {
    nextUrlOrigin: string;
    nextUrlProtocol: string;
    host: string | null;
    forwardedProto: string | null;
  },
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.VERCEL_ENV === 'production') {
    return publicRequestOrigin(input);
  }

  const configured = (env.MP_PUBLIC_ORIGIN?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim() || '')
    .replace(/\/+$/, '');
  if (configured) {
    return configured.replace(
      /^(https?):\/\/localhost(?=[:/]|$)/i,
      '$1://127.0.0.1',
    );
  }

  return publicRequestOrigin(input);
}
