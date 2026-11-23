/* ============================================================================
 * HELPERS HTTP DE LAS RUTAS LEGALES — posición 12
 * ----------------------------------------------------------------------------
 * Parseo defensivo del body, validación de Origin/Referer, rate-limit headers
 * y traducción de fallos del servicio a respuestas honestas. Sin sesión: los
 * formularios son públicos (R13.2/R13.3).
 * ============================================================================ */

import { NextResponse, type NextRequest } from 'next/server';
import { isReasonableOrigin } from './requests';
import type { LegalServiceFailure } from './service';

export async function readJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Origin/Referer presente y ajeno ⇒ false. Sin headers (curl) ⇒ true. */
export function originAllowed(request: NextRequest): boolean {
  return isReasonableOrigin({
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    expectedOrigin: request.nextUrl.origin,
  });
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function invalidBody(message = 'La solicitud no tiene el formato esperado.'): NextResponse {
  return NextResponse.json(
    { error: 'SOLICITUD_INVALIDA', message },
    { status: 400, headers: NO_STORE },
  );
}

export function invalidOrigin(): NextResponse {
  return NextResponse.json(
    { error: 'ORIGEN_INVALIDO', message: 'No pudimos validar el origen del formulario.' },
    { status: 403, headers: NO_STORE },
  );
}

export function validationError(fields: Record<string, string>): NextResponse {
  return NextResponse.json(
    {
      error: 'VALIDACION',
      message: 'Revisá los campos marcados.',
      fields,
    },
    { status: 400, headers: NO_STORE },
  );
}

export function rateLimited(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error: 'SOLICITUD_DUPLICADA',
      message:
        'Ya recibimos una solicitud hace instantes. Esperá unos minutos antes de volver a enviarla.',
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        ...NO_STORE,
        'Retry-After': String(Math.max(1, retryAfterSeconds)),
      },
    },
  );
}

export function serviceFailure(failure: LegalServiceFailure, label: string): NextResponse {
  if (failure.reason === 'rate') return rateLimited(failure.retryAfterSeconds);
  if (failure.reason === 'service') {
    return NextResponse.json(
      {
        error: 'SERVICIO_NO_DISPONIBLE',
        message: 'El canal legal no está disponible en este momento. Reintentá en unos minutos.',
      },
      { status: 503, headers: NO_STORE },
    );
  }
  console.error(`[legal ${label}]:`, failure.detail);
  return NextResponse.json(
    {
      error: 'NO_DISPONIBLE',
      message:
        'No pudimos guardar la solicitud por un problema técnico. Reintentá en unos minutos; si urge, usá el canal de contacto publicado.',
    },
    { status: 503, headers: NO_STORE },
  );
}

export function okJson(
  payload: Record<string, unknown>,
  status: 200 | 201 | 202 = 200,
): NextResponse {
  return NextResponse.json({ ok: true, ...payload }, { status, headers: NO_STORE });
}
