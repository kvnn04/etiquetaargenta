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

  const message =
    result.autoRefund === 'processed'
      ? 'Arrepentimiento ejecutado: reembolso total procesado y plan PRO dado de baja.'
      : result.autoRefund === 'sync_pending'
        ? 'Reembolso total procesado. Estamos actualizando el estado del plan; en unos minutos vas a ver el PRO inactivo.'
        : result.autoRefund === 'failed'
          ? 'Solicitud registrada. La renovación quedó cancelada, pero Mercado Pago no aceptó el reembolso en este intento: lo reintentamos y te contactamos.'
          : validation.value.withinWindow
            ? 'Solicitud registrada dentro de los 10 días corridos.'
            : 'Solicitud registrada. La fecha informada queda fuera de los 10 días corridos: la revisamos igual.';

  return okJson(
    {
      code: result.row.code,
      email: result.row.email,
      emailSent: result.emailSent,
      withinWindow: validation.value.withinWindow,
      responseHours: LEGAL_RESPONSE_HOURS,
      autoRefund: result.autoRefund,
      autoRefundAmountArs: result.autoRefundAmountArs,
      message,
    },
    201,
  );
}
