/* ============================================================================
 * CLIENTE REST DE MERCADO PAGO — posición 10B (spec_pagos.md R2/R3/R7/R9)
 * ----------------------------------------------------------------------------
 * TRANSPORTE server-side para el ciclo de cobro (Checkout Pro / preapproval):
 *   · POST /preapproval       → alta de suscripción (devuelve `init_point`,
 *     la página oficial de MP que hospeda el alta de tarjeta — R2: la
 *     plataforma JAMÁS ve datos de tarjeta).
 *   · GET  /preapproval/{id}  → lectura autoritativa (webhook + reconciliación).
 *   · GET  /v1/payments/{id}  → pull del recurso del webhook *en vez de*
 *     confiar en el body (R7), con `transaction_details.external_resource_url`
 *     como constancia para payments.receipt_url (R6; null si no viene).
 *
 * Desviación declarada de capacidad EQUIVALENTE: la guia_de_tecnologias
 * menciona el SDK oficial de MP; se guarda el REST directo (sin dependencia
 * nueva, mismos endpoints v1, mismos errores — el QA del titular corre con
 * las mismas HTTP). Si algún día aparece un comportamiento del SDK que el
 * REST no cubre, se documenta acá antes de tocar el route.
 *
 * Headers: auth Bearer MP_ACCESS_TOKEN + X-Idempotency-Key (crypto.randomUUID)
 * en la CREACIÓN: un retry de nada (fetch resent) jamás hace dos preapprovals.
 * Se leen envs vía process.env → SOLO server-side (nunca importar del cliente).
 * ============================================================================ */

const MP_API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 20_000;

/**
 * Timeout por llamada (R12.9 §6): el sync on-read tiene un presupuesto de 8 s
 * y el manual de 30 s. El llamador pasa lo que le queda; nunca supera los 20 s
 * del cliente y nunca baja de 1 s (un fetch con 0 ms es un abort inmediato).
 */
const timeoutSignal = (timeoutMs?: number): AbortSignal =>
  AbortSignal.timeout(Math.max(1_000, Math.min(TIMEOUT_MS, timeoutMs ?? TIMEOUT_MS)));

const asIso = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Envs del app MP: token obligatorio para operar; public key y webhook-sh opcional. */
export interface MpEnv {
  accessToken: string;
  publicKey: string | null;
  webhookSecret: string | null;
}

export function mpEnv(): MpEnv | null {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) return null;
  return {
    accessToken,
    publicKey: process.env.NEXT_PUBLIC_MP_PUBLIC_KEY ?? null,
    webhookSecret: process.env.MP_WEBHOOK_SECRET ?? null,
  };
}

export function hasMercadoPagoCredentials(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

/** Resultado consistente para que los routes decidan 502/503 con EL motivo. */
export type MpResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

/**
 * Detalle legible del error de MP (sin tokens ni datos de tarjeta): el body
 * de error trae `{ message, status }` y evita adivinar un 400. Se lee SOLO en
 * respuestas !ok, así no se consume el body de las respuestas válidas.
 */
async function mpErrorDetail(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const body = JSON.parse(text) as { message?: unknown; error?: unknown };
      const detail =
        typeof body.message === 'string'
          ? body.message
          : typeof body.error === 'string'
            ? body.error
            : text;
      return detail.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Preapproval — alta de suscripción (R2 + R3: ARS mensual)                    */
/* -------------------------------------------------------------------------- */

export interface PreapprovalDraft {
  /** "Simulador Mates — Plan PRO (suscripción mensual)": lo que ve el taller. */
  reason: string;
  payerEmail: string;
  /** user_id — mapeo RESILIENTE pago→usuario (no depende del email). */
  externalReference: string;
  /** Precio VIGENTE de pricing_config (R3); ARS exclusivo de este MVP. */
  amount: number;
  /**
   * Retorno del Checkout Pro: /perfil?pago=success|failure|pending (§4).
   * La API de preapproval acepta UN solo `back_url` string (verificado contra
   * MP TEST el 23-nov-2026: un objeto devuelve 400 "back_url is required").
   * Se usa `success` como retorno canónico; failure/pending quedan para los
   * banners internos y para la API de pagos, no para este payload.
   */
  backUrls: { success: string; failure: string; pending: string };
  /** Webhook público (túnel en dev, dominio en prod). */
  notificationUrl: string;
  /** Arranque deseado del débito (ISO). Se normaliza a futuro (ver helper). */
  startDateIso: string;
}

/**
 * MP rechaza `auto_recurring.start_date` en el pasado ("cannot be a past
 * date", verificado 23-nov-2026). El checkout dispara "ahora", así que el
 * instante exacto llega tarde por latencia. Margen de 5 min: el alta queda
 * autorizada igual y el primer cobro ocurre después de la autorización.
 */
export const PREAPPROVAL_START_MARGIN_MS = 5 * 60_000;

/** Normaliza el arranque a >= now + 5 min; nunca retrocede una fecha futura. */
export function preapprovalStartDateIso(
  requestedIso: string,
  nowMs: number = Date.now(),
): string {
  const requestedMs = Date.parse(requestedIso);
  const minMs = nowMs + PREAPPROVAL_START_MARGIN_MS;
  if (Number.isNaN(requestedMs) || requestedMs < minMs) {
    return new Date(minMs).toISOString();
  }
  return new Date(requestedMs).toISOString();
}

export interface MpPreapproval {
  id: string;
  initPoint: string;
  status: string; // 'pending' hasta que el taller autorice la tarjeta
}

export async function createPreapproval(
  draft: PreapprovalDraft,
): Promise<MpResult<MpPreapproval>> {
  const env = mpEnv();
  if (!env) {
    return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };
  }

  try {
    const res = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        'Content-Type': 'application/json',
        // Idempotencia EXPLÍCITA: el retry del network no duplica suscripciones.
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        reason: draft.reason,
        payer_email: draft.payerEmail,
        external_reference: draft.externalReference,
        // Checkout Pro: el taller entra a MP y autoriza; MP avisa por webhook.
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: draft.amount,
          currency_id: 'ARS', // R3: sin conversión, sin márgenes
          // MP exige start_date futura; el helper agrega el margen mínimo.
          start_date: preapprovalStartDateIso(draft.startDateIso),
        },
        // Preapproval: UN string (no el objeto de la API de pagos).
        back_url: draft.backUrls.success,
        notification_url: draft.notificationUrl,
      }),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { message?: string; error?: string; cause?: Array<{ code?: string; description?: string }> }
        | null;
      const message = body?.message ?? body?.error ?? `HTTP ${res.status}`;
      // El 400 "Parameters passed are invalid" de MP trae las COUSAS exactas en
      // `cause` (code/description por parámetro incumplido) — se logea entera:
      // es EL dato para el QA del titular.
      console.error(
        '[mp preapproval create]:', res.status, message,
        'back_url =', draft.backUrls.success,
        'notification_url =', draft.notificationUrl,
        'cause =', JSON.stringify(body?.cause ?? null),
      );
      return { ok: false, status: res.status, message };
    }

    const raw = (await res.json()) as {
      id?: string | number;
      init_point?: string;
      status?: string;
    };
    if (!raw.id || !raw.init_point) {
      console.error('[mp preapproval create]: respuesta sin id/init_point');
      return { ok: false, status: res.status, message: 'Respuesta incompleta de MP' };
    }
    return {
      ok: true,
      data: { id: String(raw.id), initPoint: raw.init_point, status: raw.status ?? 'pending' },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval create]:', message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Preapproval PLAN — checkout hospedado que pide la cuenta del pagador        */
/* -------------------------------------------------------------------------- */

/**
 * Plan de suscripción por intento de checkout (spec_pagos_plan_mp.md).
 * El `external_reference` del plan es el user_id: si MP lo hereda al
 * preapproval, la resolución es directa; si no, el mapping local por
 * `preapproval_plan_id` sigue siendo la fuente de verdad.
 */
export interface PreapprovalPlanDraft {
  reason: string;
  externalReference: string;
  amount: number;
  /** Retorno del checkout hospedado (string único, igual que preapproval). */
  backUrl: string;
}

export interface MpPreapprovalPlan {
  id: string;
  initPoint: string;
  status: string;
  externalReference: string | null;
}

export async function createPreapprovalPlan(
  draft: PreapprovalPlanDraft,
): Promise<MpResult<MpPreapprovalPlan>> {
  const env = mpEnv();
  if (!env) {
    return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };
  }

  try {
    const res = await fetch(`${MP_API}/preapproval_plan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        'Content-Type': 'application/json',
        // Retry de red no duplica el plan.
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        reason: draft.reason,
        external_reference: draft.externalReference,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: draft.amount,
          currency_id: 'ARS',
        },
        back_url: draft.backUrl,
      }),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { message?: string; error?: string; cause?: Array<{ code?: string; description?: string }> }
        | null;
      const message = body?.message ?? body?.error ?? `HTTP ${res.status}`;
      console.error(
        '[mp preapproval_plan create]:', res.status, message,
        'back_url =', draft.backUrl,
        'cause =', JSON.stringify(body?.cause ?? null),
      );
      return { ok: false, status: res.status, message };
    }

    const raw = (await res.json()) as {
      id?: string | number;
      init_point?: string;
      status?: string;
      external_reference?: string | null;
    };
    if (raw.id == null || !raw.init_point) {
      console.error('[mp preapproval_plan create]: respuesta sin id/init_point');
      return { ok: false, status: res.status, message: 'Respuesta incompleta de MP' };
    }
    return {
      ok: true,
      data: {
        id: String(raw.id),
        initPoint: raw.init_point,
        status: raw.status ?? 'active',
        externalReference: raw.external_reference ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval_plan create]:', message);
    return { ok: false, status: 0, message };
  }
}

export interface MpPreapprovalPlanDetail extends MpPreapprovalPlan {
  amount: number | null;
  currency: string | null;
  backUrl: string | null;
}

const asNumberLike = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * GET /preapproval_plan/{id} — se usa para REUTILIZAR el plan vigente antes de
 * crear otro. Un plan cancelado en MP invalida su checkout; reutilizarlo sin
 * leer su estado real devolvería un `init_point` muerto.
 */
export async function getPreapprovalPlan(
  planId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<MpPreapprovalPlanDetail>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/preapproval_plan/${encodeURIComponent(planId)}`, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp preapproval_plan get]:',
        planId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }

    const raw = (await res.json()) as {
      id?: string | number;
      init_point?: string;
      status?: string;
      external_reference?: string | null;
      back_url?: string | null;
      auto_recurring?: { transaction_amount?: unknown; currency_id?: unknown };
    };
    if (raw.id == null || !raw.init_point) {
      console.error('[mp preapproval_plan get]: respuesta sin id/init_point');
      return { ok: false, status: res.status, message: 'Respuesta incompleta de MP' };
    }
    return {
      ok: true,
      data: {
        id: String(raw.id),
        initPoint: raw.init_point,
        status: raw.status ?? 'active',
        externalReference: raw.external_reference ?? null,
        amount: asNumberLike(raw.auto_recurring?.transaction_amount),
        currency: asIso(raw.auto_recurring?.currency_id),
        backUrl: asIso(raw.back_url),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval_plan get]:', planId, message);
    return { ok: false, status: 0, message };
  }
}

/**
 * PUT /preapproval_plan/{id} con `back_url` — MP acepta actualizaciones
 * parciales (verificado en vivo el 26-nov-2026). Mantiene el retorno del plan
 * en el dominio canónico aunque el checkout se haya abierto desde un preview.
 */
export async function updatePreapprovalPlanBackUrl(
  planId: string,
  backUrl: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<{ id: string; status: string; backUrl: string | null }>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/preapproval_plan/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ back_url: backUrl }),
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp preapproval_plan update]:',
        planId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }
    const raw = (await res.json().catch(() => null)) as
      | { id?: string | number; status?: string; back_url?: string | null }
      | null;
    return {
      ok: true,
      data: {
        id: raw?.id != null ? String(raw.id) : planId,
        status: raw?.status ?? 'active',
        backUrl: asIso(raw?.back_url) ?? backUrl,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval_plan update]:', planId, message);
    return { ok: false, status: 0, message };
  }
}

/**
 * PUT /preapproval_plan/{id} con `status: cancelled` (verificado en vivo el
 * 24-nov-2026). Ya NO se usa para "un plan por checkout": cancelar el plan de
 * una pestaña abierta hacía que MP mostrara "Algo salió mal" (redirect
 * `/checkout/v1/subscription/redirect/expired`). Queda para el rollback de un
 * plan recién creado cuyo mapping no se pudo persistir.
 */
export async function cancelPreapprovalPlan(
  planId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<{ id: string; status: string }>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/preapproval_plan/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'cancelled' }),
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp preapproval_plan cancel]:',
        planId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }
    const raw = (await res.json().catch(() => null)) as
      | { id?: string | number; status?: string }
      | null;
    return {
      ok: true,
      data: {
        id: raw?.id != null ? String(raw.id) : planId,
        status: raw?.status ?? 'cancelled',
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval_plan cancel]:', planId, message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Cancelación del preapproval (R9 + R13.6)                                    */
/* -------------------------------------------------------------------------- */

/**
 * PUT /preapproval/{id} con `status: cancelled` (API oficial de MP).
 * La baja legal NO cancela sin confirmar el email; este helper solo ejecuta el
 * verbo de MP una vez verificada la identidad. Es idempotente del lado de MP:
 * cancelar un preapproval ya cancelado no genera un cobro.
 */
export async function cancelPreapproval(
  preapprovalId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<{ id: string; status: string }>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'cancelled' }),
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp preapproval cancel]:',
        preapprovalId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }
    const raw = (await res.json().catch(() => null)) as
      | { id?: string | number; status?: string }
      | null;
    return {
      ok: true,
      data: {
        id: raw?.id != null ? String(raw.id) : preapprovalId,
        status: raw?.status ?? 'cancelled',
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval cancel]:', preapprovalId, message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Lecturas autoritativas (webhook pull + reconciliación al-vuelo)             */
/* -------------------------------------------------------------------------- */

/** Subconjunto de preapproval relevante al ciclo (R7/R9). */
export interface MpPreapprovalFull {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  externalReference: string | null; // user_id (mapeo resiliente)
  /** Plan del checkout hospedado; clave de identidad si falta external_ref. */
  preapprovalPlanId?: string | null;
  payerEmail: string | null;
  /** Fecha del próximo vencimiento que MP anuncia (reagendar): null si no vino. */
  nextPaymentDate: string | null;
  transactionAmount: number | null;
  currency: string | null;
  /** Ordena adopciones y detecta eventos tardíos de planes viejos. */
  dateCreated?: string | null;
  lastModified?: string | null;
}

export async function getPreapproval(
  preapprovalId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<MpPreapprovalFull>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      console.error('[mp preapproval read]:', preapprovalId, message);
      return { ok: false, status: res.status, message };
    }
    const raw = (await res.json()) as {
      id?: string | number;
      status?: string;
      external_reference?: string | null;
      preapproval_plan_id?: string | null;
      payer_email?: string | null;
      next_payment_date?: string | null;
      date_created?: string | null;
      last_modified?: string | null;
      auto_recurring?: { transaction_amount?: number; currency_id?: string };
    };
    if (!raw.id) {
      return { ok: false, status: res.status, message: 'Respuesta sin id' };
    }
    return {
      ok: true,
      data: {
        id: String(raw.id),
        status: raw.status ?? 'unknown',
        externalReference: raw.external_reference ?? null,
        preapprovalPlanId: raw.preapproval_plan_id ?? null,
        payerEmail: raw.payer_email ?? null,
        nextPaymentDate: raw.next_payment_date ?? null,
        transactionAmount: raw.auto_recurring?.transaction_amount ?? null,
        currency: raw.auto_recurring?.currency_id ?? null,
        dateCreated: raw.date_created ?? null,
        lastModified: raw.last_modified ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval read]:', preapprovalId, message);
    return { ok: false, status: 0, message };
  }
}

/** Reembolso individual que MP expone dentro del pago (R11.2/R11.7). */
export interface MpRefund {
  id: string;
  amount: number | null;
  dateCreated: string | null;
}

/** Subconjunto de payment relevante al cobro (R6 constancia + R7/R11). */
export interface MpPaymentFull {
  id: number;
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  /** R11.2: acumulado devuelto que MP informa (parciales incluidos). */
  transactionAmountRefunded: number | null;
  /** R11.7: ids de refunds cuando MP los expone (dedupe de ajustes). */
  refunds: MpRefund[];
  /** Constancia MP (R6) solo si MP la trae; null = el panel lo muestra sin link. */
  receiptUrl: string | null;
  dateApproved: string | null;
  /** Última mutación del pago (momento del rechazo/reembolso, R8/R11). */
  dateLastUpdated: string | null;
  /** Fecha de creación: ordena el sync y alimenta la ventana R12.4. */
  dateCreated: string | null;
  /** Moneda del cobro (R12.12: solo ARS). */
  currencyId: string | null;
  /** El preapproval que generó el cobro (p/recuperar la fila del ciclo). */
  preapprovalId: string | null;
  /** Plan asociado si MP lo expone en metadata (fallback de identidad). */
  preapprovalPlanId?: string | null;
  payerEmail: string | null;
}

export async function getPayment(
  paymentId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<MpPaymentFull>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      console.error('[mp payment read]:', paymentId, message);
      return { ok: false, status: res.status, message };
    }
    const raw = (await res.json()) as {
      id?: number;
      status?: string;
      status_detail?: string | null;
      external_reference?: string | null;
      transaction_amount?: number;
      transaction_amount_refunded?: number | null;
      refunds?: Array<{
        id?: string | number;
        amount?: number;
        date_created?: string | null;
      }>;
      currency_id?: string | null;
      transaction_details?: { external_resource_url?: string | null };
      date_created?: string | null;
      date_approved?: string | null;
      date_last_updated?: string | null;
      preapproval_id?: string | null;
      metadata?: {
        preapproval_id?: string | null;
        preapproval_plan_id?: string | null;
      } | null;
      payer?: { email?: string | null };
    };
    if (typeof raw.id !== 'number') {
      return { ok: false, status: res.status, message: 'Respuesta sin id' };
    }
    return {
      ok: true,
      data: {
        id: raw.id,
        status: raw.status ?? 'unknown',
        statusDetail: raw.status_detail ?? null,
        externalReference: raw.external_reference ?? null,
        transactionAmount: raw.transaction_amount ?? null,
        transactionAmountRefunded: asNumberOrNull(raw.transaction_amount_refunded),
        refunds: (raw.refunds ?? [])
          .filter((r) => r.id != null)
          .map((r) => ({
            id: String(r.id),
            amount: asNumberOrNull(r.amount),
            dateCreated: asIso(r.date_created),
          })),
        receiptUrl: raw.transaction_details?.external_resource_url ?? null,
        dateApproved: raw.date_approved ?? null,
        dateLastUpdated: raw.date_last_updated ?? null,
        dateCreated: raw.date_created ?? null,
        currencyId: raw.currency_id ?? null,
        preapprovalId: raw.preapproval_id ?? raw.metadata?.preapproval_id ?? null,
        preapprovalPlanId: raw.metadata?.preapproval_plan_id ?? null,
        payerEmail: raw.payer?.email ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp payment read]:', paymentId, message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Reembolsos de un pago (R9 + R11.5 — baja inmediata)                         */
/* -------------------------------------------------------------------------- */

/** Respuesta de `POST /v1/payments/{id}/refunds` (total o parcial). */
export interface MpRefundResult {
  id: string;
  paymentId: number | null;
  amount: number | null;
  status: string;
  dateCreated: string | null;
}

/**
 * POST /v1/payments/{payment_id}/refunds — API oficial de reembolsos.
 *
 *   · `amount == null` ⇒ reembolso TOTAL (sin body, como documenta MP);
 *   · `amount > 0`    ⇒ reembolso PARCIAL con `{ amount }`.
 *
 * `X-Idempotency-Key` es OBLIGATORIO: el caller guarda la key en
 * `refund_requests` y la reutiliza en cada reintento. Un fetch repetido con la
 * misma key jamás devuelve dos veces el dinero. Solo se considera éxito un
 * HTTP 200/201 con `id`; el caller decide además por `status`.
 */
export async function refundPayment(
  paymentId: string | number,
  input: { amount?: number | null; idempotencyKey: string; timeoutMs?: number },
): Promise<MpResult<MpRefundResult>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return { ok: false, status: 0, message: 'X-Idempotency-Key requerido' };
  }
  if (
    input.amount != null &&
    (!Number.isFinite(input.amount) || input.amount <= 0)
  ) {
    return { ok: false, status: 0, message: 'Monto de reembolso inválido' };
  }

  try {
    const res = await fetch(
      `${MP_API}/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: input.amount != null ? JSON.stringify({ amount: input.amount }) : undefined,
        signal: timeoutSignal(input.timeoutMs),
      },
    );
    /* Solo 200/201 confirman el reembolso (decisión del titular): un 202/204
     * no es una confirmación y NO puede disparar el downgrade. */
    if (res.status !== 200 && res.status !== 201) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp refund]:',
        paymentId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }

    const raw = (await res.json()) as {
      id?: string | number;
      payment_id?: number | string | null;
      amount?: number | string | null;
      status?: string | null;
      date_created?: string | null;
    };
    if (raw.id == null) {
      console.error('[mp refund]: respuesta sin id');
      return { ok: false, status: res.status, message: 'Respuesta sin id de reembolso' };
    }
    const paymentIdRaw = raw.payment_id;
    return {
      ok: true,
      data: {
        id: String(raw.id),
        paymentId:
          typeof paymentIdRaw === 'number'
            ? paymentIdRaw
            : typeof paymentIdRaw === 'string' && /^\d+$/.test(paymentIdRaw)
              ? Number(paymentIdRaw)
              : null,
        amount: asNumberLike(raw.amount),
        status: raw.status ?? 'approved',
        dateCreated: asIso(raw.date_created),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp refund]:', paymentId, message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Invoice de suscripción (topic subscription_authorized_payment)              */
/* -------------------------------------------------------------------------- */

/**
 * Subconjunto de `GET /authorized_payments/{id}` (spec_pagos_plan_mp.md §3.4).
 * El invoice es la red de seguridad de los cobros recurrentes: trae el
 * `preapproval_id` y el `payment.id` aunque el pago no exponga
 * `external_reference`. El estado del invoice NO decide PRO; el pago sí.
 */
export interface MpAuthorizedPaymentFull {
  id: string;
  status: string;
  preapprovalId: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  paymentId: number | null;
  paymentStatus: string | null;
  paymentStatusDetail: string | null;
  dateCreated: string | null;
  lastModified: string | null;
}

export async function getAuthorizedPayment(
  invoiceId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<MpAuthorizedPaymentFull>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/authorized_payments/${encodeURIComponent(invoiceId)}`, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp authorized_payment read]:',
        invoiceId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }
    const raw = (await res.json()) as {
      id?: string | number;
      status?: string;
      preapproval_id?: string | null;
      external_reference?: string | null;
      transaction_amount?: number | string | null;
      currency_id?: string | null;
      date_created?: string | null;
      last_modified?: string | null;
      payment?: {
        id?: string | number | null;
        status?: string | null;
        status_detail?: string | null;
      } | null;
    };
    if (raw.id == null) {
      return { ok: false, status: res.status, message: 'Respuesta sin id' };
    }
    const paymentIdRaw = raw.payment?.id;
    const paymentId =
      typeof paymentIdRaw === 'number'
        ? paymentIdRaw
        : typeof paymentIdRaw === 'string' && /^\d+$/.test(paymentIdRaw)
          ? Number(paymentIdRaw)
          : null;
    const amount =
      typeof raw.transaction_amount === 'number'
        ? raw.transaction_amount
        : typeof raw.transaction_amount === 'string' && raw.transaction_amount.trim() !== ''
          ? Number(raw.transaction_amount)
          : null;
    return {
      ok: true,
      data: {
        id: String(raw.id),
        status: raw.status ?? 'unknown',
        preapprovalId: raw.preapproval_id ?? null,
        externalReference: raw.external_reference ?? null,
        transactionAmount: amount != null && Number.isFinite(amount) ? amount : null,
        currencyId: raw.currency_id ?? null,
        paymentId,
        paymentStatus: raw.payment?.status ?? null,
        paymentStatusDetail: raw.payment?.status_detail ?? null,
        dateCreated: raw.date_created ?? null,
        lastModified: raw.last_modified ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp authorized_payment read]:', invoiceId, message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Búsquedas del sync (R12.1/R12.5) — por external_reference, nunca por body   */
/* -------------------------------------------------------------------------- */

export interface MpPaymentSearchItem {
  id: number;
  status: string;
  externalReference: string | null;
  transactionAmount: number | null;
  /** R11.2: permite detectar parciales aunque el status siga `approved`. */
  transactionAmountRefunded: number | null;
  currencyId: string | null;
  dateCreated: string | null;
  dateLastUpdated: string | null;
  preapprovalId: string | null;
}

/**
 * `GET /v1/payments/search` por external_reference (el user_id). Devuelve la
 * página pedida; el sync arma el cap de 100 y ordena por fecha. La verdad del
 * pago SIEMPRE se confirma después con `getPayment(id)` (R12.1).
 */
export async function searchPaymentsByExternalReference(
  externalReference: string,
  opts?: { limit?: number; offset?: number; timeoutMs?: number },
): Promise<MpResult<{ items: MpPaymentSearchItem[]; total: number | null }>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  const limit = Math.max(1, Math.min(50, opts?.limit ?? 50));
  const offset = Math.max(0, opts?.offset ?? 0);
  const url =
    `${MP_API}/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}` +
    `&sort=date_created&criteria=desc&limit=${limit}&offset=${offset}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      const detail = await mpErrorDetail(res);
      console.error('[mp payments search]:', message, detail ? `— ${detail}` : '');
      return { ok: false, status: res.status, message };
    }
    const raw = (await res.json()) as {
      results?: Array<{
        id?: number;
        status?: string;
        external_reference?: string | null;
        transaction_amount?: number;
        transaction_amount_refunded?: number | null;
        currency_id?: string | null;
        date_created?: string | null;
        date_last_updated?: string | null;
        preapproval_id?: string | null;
      }>;
      paging?: { total?: number };
    };
    const items: MpPaymentSearchItem[] = [];
    for (const row of raw.results ?? []) {
      if (typeof row.id !== 'number') continue;
      items.push({
        id: row.id,
        status: row.status ?? 'unknown',
        externalReference: row.external_reference ?? null,
        transactionAmount: asNumberOrNull(row.transaction_amount),
        transactionAmountRefunded: asNumberOrNull(row.transaction_amount_refunded),
        currencyId: row.currency_id ?? null,
        dateCreated: asIso(row.date_created),
        dateLastUpdated: asIso(row.date_last_updated),
        preapprovalId: row.preapproval_id ?? null,
      });
    }
    return {
      ok: true,
      data: { items, total: asNumberOrNull(raw.paging?.total) },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp payments search]:', message);
    return { ok: false, status: 0, message };
  }
}

export interface MpPreapprovalSearchItem {
  id: string;
  status: string;
  externalReference: string | null;
  dateCreated: string | null;
  transactionAmount: number | null;
  currency: string | null;
}

/**
 * `GET /preapproval/search` por external_reference. Se usa SOLO cuando la fila
 * local no tiene `preapproval_id` (R12.8): se adopta el más nuevo.
 */
export async function searchPreapprovalsByExternalReference(
  externalReference: string,
  opts?: { limit?: number; timeoutMs?: number },
): Promise<MpResult<MpPreapprovalSearchItem[]>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
  // MP exige `sort=campo:orden` en preapproval/search; con `sort` + `criteria`
  // separados responde 400 "Invalid sorting value format." (verificado 23-nov).
  const url =
    `${MP_API}/preapproval/search?external_reference=${encodeURIComponent(externalReference)}` +
    `&sort=date_created%3Adesc&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      const detail = await mpErrorDetail(res);
      console.error('[mp preapproval search]:', message, detail ? `— ${detail}` : '');
      return { ok: false, status: res.status, message };
    }
    const raw = (await res.json()) as
      | {
          results?: Array<{
            id?: string | number;
            status?: string;
            external_reference?: string | null;
            date_created?: string | null;
            auto_recurring?: { transaction_amount?: number; currency_id?: string };
          }>;
        }
      | Array<{
          id?: string | number;
          status?: string;
          external_reference?: string | null;
          date_created?: string | null;
          auto_recurring?: { transaction_amount?: number; currency_id?: string };
        }>;
    const rows = Array.isArray(raw) ? raw : (raw.results ?? []);
    const items: MpPreapprovalSearchItem[] = [];
    for (const row of rows) {
      if (row.id == null) continue;
      items.push({
        id: String(row.id),
        status: row.status ?? 'unknown',
        externalReference: row.external_reference ?? null,
        dateCreated: asIso(row.date_created),
        transactionAmount: asNumberOrNull(row.auto_recurring?.transaction_amount),
        currency: row.auto_recurring?.currency_id ?? null,
      });
    }
    return { ok: true, data: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval search]:', message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Búsquedas del checkout con plan (spec_pagos_plan_mp.md)                    */
/* -------------------------------------------------------------------------- */

/**
 * `GET /preapproval/search?preapproval_plan_id=...`. Se usa SOLO cuando la
 * suscripción tiene plan pero todavía no tiene `preapproval_id` (webhook
 * perdido): adopta el preapproval más nuevo del plan.
 */
export async function searchPreapprovalsByPlanId(
  planId: string,
  opts?: { limit?: number; timeoutMs?: number },
): Promise<MpResult<MpPreapprovalSearchItem[]>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
  const url =
    `${MP_API}/preapproval/search?preapproval_plan_id=${encodeURIComponent(planId)}` +
    `&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      const detail = await mpErrorDetail(res);
      console.error('[mp preapproval search plan]:', message, detail ? `— ${detail}` : '');
      return { ok: false, status: res.status, message };
    }
    const raw = (await res.json()) as
      | {
          results?: Array<{
            id?: string | number;
            status?: string;
            external_reference?: string | null;
            date_created?: string | null;
            auto_recurring?: { transaction_amount?: number; currency_id?: string };
          }>;
        }
      | Array<{
          id?: string | number;
          status?: string;
          external_reference?: string | null;
          date_created?: string | null;
          auto_recurring?: { transaction_amount?: number; currency_id?: string };
        }>;
    const rows = Array.isArray(raw) ? raw : (raw.results ?? []);
    const items: MpPreapprovalSearchItem[] = [];
    for (const row of rows) {
      if (row.id == null) continue;
      items.push({
        id: String(row.id),
        status: row.status ?? 'unknown',
        externalReference: row.external_reference ?? null,
        dateCreated: asIso(row.date_created),
        transactionAmount: asNumberOrNull(row.auto_recurring?.transaction_amount),
        currency: row.auto_recurring?.currency_id ?? null,
      });
    }
    return { ok: true, data: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval search plan]:', message);
    return { ok: false, status: 0, message };
  }
}

export interface MpAuthorizedPaymentSearchItem {
  id: string;
  preapprovalId: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  dateCreated: string | null;
  lastModified: string | null;
  paymentId: number | null;
  paymentStatus: string | null;
}

/**
 * Tope REAL de `/authorized_payments/search`: `limit=16` o más responde
 * 400 "Invalid value for limit" (verificado contra la API el 25-nov-2026;
 * el paging devuelve hasta 15 facturas). No confundir con los buscadores de
 * pagos/preapprovals, que sí aceptan 50.
 */
const AUTHORIZED_PAYMENTS_MAX_LIMIT = 15;

/**
 * `GET /authorized_payments/search?preapproval_id=...`. Red de recuperación
 * de cobros recurrentes cuando el pago no trae `external_reference`: el
 * invoice sí trae `preapproval_id` + `payment.id`.
 */
export async function searchAuthorizedPaymentsByPreapproval(
  preapprovalId: string,
  opts?: { limit?: number; timeoutMs?: number },
): Promise<MpResult<MpAuthorizedPaymentSearchItem[]>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  const limit = Math.max(
    1,
    Math.min(AUTHORIZED_PAYMENTS_MAX_LIMIT, opts?.limit ?? AUTHORIZED_PAYMENTS_MAX_LIMIT),
  );
  const url =
    `${MP_API}/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}` +
    `&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: timeoutSignal(opts?.timeoutMs),
    });
    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      const detail = await mpErrorDetail(res);
      console.error('[mp authorized_payment search]:', message, detail ? `— ${detail}` : '');
      return { ok: false, status: res.status, message };
    }
    const raw = (await res.json()) as {
      results?: Array<{
        id?: string | number;
        preapproval_id?: string | null;
        external_reference?: string | null;
        transaction_amount?: number | string | null;
        currency_id?: string | null;
        date_created?: string | null;
        last_modified?: string | null;
        payment?: { id?: string | number | null; status?: string | null } | null;
      }>;
    };
    const items: MpAuthorizedPaymentSearchItem[] = [];
    for (const row of raw.results ?? []) {
      if (row.id == null) continue;
      const paymentIdRaw = row.payment?.id;
      const paymentId =
        typeof paymentIdRaw === 'number'
          ? paymentIdRaw
          : typeof paymentIdRaw === 'string' && /^\d+$/.test(paymentIdRaw)
            ? Number(paymentIdRaw)
            : null;
      const amount =
        typeof row.transaction_amount === 'number'
          ? row.transaction_amount
          : typeof row.transaction_amount === 'string' && row.transaction_amount.trim() !== ''
            ? Number(row.transaction_amount)
            : null;
      items.push({
        id: String(row.id),
        preapprovalId: row.preapproval_id ?? null,
        externalReference: row.external_reference ?? null,
        transactionAmount: amount != null && Number.isFinite(amount) ? amount : null,
        currencyId: row.currency_id ?? null,
        dateCreated: asIso(row.date_created),
        lastModified: asIso(row.last_modified),
        paymentId,
        paymentStatus: row.payment?.status ?? null,
      });
    }
    return { ok: true, data: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp authorized_payment search]:', message);
    return { ok: false, status: 0, message };
  }
}

/* -------------------------------------------------------------------------- */
/* Contracargos (R11.1/R11.6): GET /v1/chargebacks/{id}                       */
/* -------------------------------------------------------------------------- */

/**
 * Subconjunto del recurso chargeback de MP. El shape real varía: el pago
 * asociado puede venir en `payments[0]` o en `payment_id`; se toleran ambos.
 * Si no hay pago ni external_reference, el route responde 200 con log (no se
 * inventa un usuario, §3.4).
 */
export interface MpChargebackFull {
  id: string;
  status: string;
  paymentId: number | null;
  externalReference: string | null;
  amount: number | null;
  currencyId: string | null;
  dateCreated: string | null;
  dateLastUpdated: string | null;
}

export async function getChargeback(
  chargebackId: string,
  opts?: { timeoutMs?: number },
): Promise<MpResult<MpChargebackFull>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(
      `${MP_API}/v1/chargebacks/${encodeURIComponent(chargebackId)}`,
      {
        headers: { Authorization: `Bearer ${env.accessToken}` },
        signal: timeoutSignal(opts?.timeoutMs),
      },
    );
    if (!res.ok) {
      const detail = await mpErrorDetail(res);
      console.error(
        '[mp chargeback read]:',
        chargebackId,
        `HTTP ${res.status}`,
        detail ? `— ${detail}` : '',
      );
      return { ok: false, status: res.status, message: detail ?? `HTTP ${res.status}` };
    }
    const raw = (await res.json()) as {
      id?: string | number;
      status?: string;
      payment_id?: string | number | null;
      external_reference?: string | null;
      transaction_amount?: number;
      amount?: number;
      currency_id?: string | null;
      date_created?: string | null;
      date_last_updated?: string | null;
      payments?: Array<{
        id?: string | number;
        external_reference?: string | null;
        transaction_amount?: number;
        currency_id?: string | null;
        date_created?: string | null;
        date_last_updated?: string | null;
      }>;
    };
    if (raw.id == null) {
      return { ok: false, status: res.status, message: 'Respuesta sin id' };
    }
    const first = raw.payments?.[0];
    const paymentIdRaw = first?.id ?? raw.payment_id;
    const paymentId =
      typeof paymentIdRaw === 'number'
        ? paymentIdRaw
        : typeof paymentIdRaw === 'string' && /^\d+$/.test(paymentIdRaw)
          ? Number(paymentIdRaw)
          : null;
    return {
      ok: true,
      data: {
        id: String(raw.id),
        status: raw.status ?? 'unknown',
        paymentId,
        externalReference: first?.external_reference ?? raw.external_reference ?? null,
        amount:
          asNumberOrNull(first?.transaction_amount) ??
          asNumberOrNull(raw.transaction_amount) ??
          asNumberOrNull(raw.amount),
        currencyId: first?.currency_id ?? raw.currency_id ?? null,
        dateCreated: asIso(first?.date_created ?? raw.date_created),
        dateLastUpdated: asIso(first?.date_last_updated ?? raw.date_last_updated),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp chargeback read]:', chargebackId, message);
    return { ok: false, status: 0, message };
  }
}
