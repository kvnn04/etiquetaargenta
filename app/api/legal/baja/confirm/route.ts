/* ============================================================================
 * POST /api/legal/baja/confirm — ejecuta la baja tras el doble opt-in (R13.6)
 * ----------------------------------------------------------------------------
 * El token crudo llega desde el link del email; se hashea y se busca. Un solo
 * uso, 24 h. Antes de cancelar se verifica que el email pertenezca a la cuenta
 * y que el preapproval sea de esa cuenta. Si algo no coincide, NO se cancela
 * y la solicitud queda en cola manual con alerta.
 * ============================================================================ */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { invalidBody, invalidOrigin, okJson, originAllowed, readJsonObject } from '@/lib/legal/http';
import { confirmBajaByToken } from '@/lib/legal/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return invalidBody();
  if (!originAllowed(request)) return invalidOrigin();

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return invalidBody('Falta el token de confirmación.');

  const result = await confirmBajaByToken(token);
  if (result.ok) {
    return okJson(
      {
        code: result.code,
        status: result.status,
        periodEndMs: result.periodEndMs,
        manual: result.manual,
        alreadyConfirmed: result.alreadyConfirmed,
        message: result.message,
      },
      result.manual ? 202 : 200,
    );
  }

  const status =
    result.reason === 'invalid'
      ? 400
      : result.reason === 'expired'
        ? 410
        : result.reason === 'security' || result.reason === 'email_mismatch'
          ? 409
          : 503;

  return NextResponse.json(
    {
      error:
        result.reason === 'invalid'
          ? 'TOKEN_INVALIDO'
          : result.reason === 'expired'
            ? 'TOKEN_VENCIDO'
            : result.reason === 'security'
              ? 'NO_VERIFICADO'
              : result.reason === 'email_mismatch'
                ? 'EMAIL_NO_COINCIDE'
                : 'NO_DISPONIBLE',
      code: result.code ?? null,
      status: result.status ?? null,
      message: result.message,
    },
    { status, headers: NO_STORE },
  );
}
