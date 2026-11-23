/* ============================================================================
 * POST /api/legal/baja — BOTÓN DE BAJA DE SERVICIO (R13.4/R13.6)
 * ----------------------------------------------------------------------------
 * Público, sin login. Crea/reutiliza una solicitud BAJA-… y manda el link de
 * confirmación de 24 h. NO cancela nada en este POST: la baja se ejecuta solo
 * al abrir el link desde el email (doble opt-in, Q7).
 * ============================================================================ */

import type { NextRequest } from 'next/server';
import {
  invalidBody,
  invalidOrigin,
  okJson,
  originAllowed,
  readJsonObject,
  serviceFailure,
  validationError,
} from '@/lib/legal/http';
import { isHoneypotTripped, validateBaja } from '@/lib/legal/requests';
import { createBaja, legalRequestContext } from '@/lib/legal/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return invalidBody();
  if (!originAllowed(request)) return invalidOrigin();
  if (isHoneypotTripped(body)) return invalidBody();

  const validation = validateBaja(body);
  if (!validation.ok) return validationError(validation.fields);

  const result = await createBaja({
    value: validation.value,
    context: legalRequestContext(request),
    origin: request.nextUrl.origin,
  });
  if (!result.ok) return serviceFailure(result, 'baja');

  return okJson(
    {
      code: result.row.code,
      email: result.row.email,
      emailSent: result.emailSent,
      confirmExpiresAt: result.confirmExpiresAt,
      resent: result.resent,
      requiresConfirmation: true,
      message: result.resent
        ? 'Reenviamos el link de confirmación. Revisá tu email.'
        : 'Solicitud registrada. Te enviamos un link para confirmar la baja.',
    },
    201,
  );
}
