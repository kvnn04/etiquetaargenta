/* ============================================================================
 * POST /api/legal/privacidad — DERECHOS DE DATOS (R13.10)
 * ----------------------------------------------------------------------------
 * Público, sin login. Código PRIV-YYYYMMDD-XXXX, acuse inmediato y respuesta
 * dentro de 5 días hábiles. Si pide supresión, el borrado usa el flujo de 30
 * días ya existente (no se ejecuta desde acá).
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
  LEGAL_DATA_BUSINESS_DAYS,
  validatePrivacy,
} from '@/lib/legal/requests';
import { createPrivacyRequest, legalRequestContext } from '@/lib/legal/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) return invalidBody();
  if (!originAllowed(request)) return invalidOrigin();
  if (isHoneypotTripped(body)) return invalidBody();

  const validation = validatePrivacy(body);
  if (!validation.ok) return validationError(validation.fields);

  const result = await createPrivacyRequest({
    value: validation.value,
    context: legalRequestContext(request),
  });
  if (!result.ok) return serviceFailure(result, 'privacidad');

  return okJson(
    {
      code: result.row.code,
      email: result.row.email,
      emailSent: result.emailSent,
      responseBusinessDays: LEGAL_DATA_BUSINESS_DAYS,
      message: 'Solicitud registrada. Respondemos dentro de 5 días hábiles.',
    },
    201,
  );
}
