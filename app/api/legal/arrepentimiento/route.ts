/* ============================================================================
 * POST /api/legal/arrepentimiento — BOTÓN DE ARREPENTIMIENTO (R13.4/R13.5)
 * ----------------------------------------------------------------------------
 * Público, sin login. Valida, aplica rate limit, crea `legal_requests` con
 * código ARR-YYYYMMDD-XXXX, manda acuse + alerta interna y devuelve el código
 * en pantalla aunque el email falle (fail-soft).
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
import {
  isHoneypotTripped,
  LEGAL_RESPONSE_HOURS,
  validateWithdrawal,
} from '@/lib/legal/requests';
import { createWithdrawal, legalRequestContext } from '@/lib/legal/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return invalidBody();
  if (!originAllowed(request)) return invalidOrigin();
  if (isHoneypotTripped(body)) return invalidBody();

  const validation = validateWithdrawal(body, Date.now());
  if (!validation.ok) return validationError(validation.fields);

  const result = await createWithdrawal({
    value: validation.value,
    context: legalRequestContext(request),
  });
  if (!result.ok) return serviceFailure(result, 'arrepentimiento');

  return okJson(
    {
      code: result.row.code,
      email: result.row.email,
      emailSent: result.emailSent,
      withinWindow: validation.value.withinWindow,
      responseHours: LEGAL_RESPONSE_HOURS,
      message: validation.value.withinWindow
        ? 'Solicitud registrada dentro de los 10 días corridos.'
        : 'Solicitud registrada. La fecha informada queda fuera de los 10 días corridos: la revisamos igual.',
    },
    201,
  );
}
