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
  /** Retorno del Checkout Pro: /perfil?pago=success|failure|pending (§4). */
  backUrls: { success: string; failure: string; pending: string };
  /** Webhook público (túnel en dev, dominio en prod). */
  notificationUrl: string;
  /** Arranque del débito: el alta (now, ISO). */
  startDateIso: string;
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
          start_date: draft.startDateIso,
        },
        back_url: {
          success: draft.backUrls.success,
          failure: draft.backUrls.failure,
          pending: draft.backUrls.pending,
        },
        notification_url: draft.notificationUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
/* Lecturas autoritativas (webhook pull + reconciliación al-vuelo)             */
/* -------------------------------------------------------------------------- */

/** Subconjunto de preapproval relevante al ciclo (R7/R9). */
export interface MpPreapprovalFull {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  externalReference: string | null; // user_id (mapeo resiliente)
  payerEmail: string | null;
  /** Fecha del próximo vencimiento que MP anuncia (reagendar): null si no vino. */
  nextPaymentDate: string | null;
  transactionAmount: number | null;
  currency: string | null;
}

export async function getPreapproval(
  preapprovalId: string,
): Promise<MpResult<MpPreapprovalFull>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
      payer_email?: string | null;
      next_payment_date?: string | null;
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
        payerEmail: raw.payer_email ?? null,
        nextPaymentDate: raw.next_payment_date ?? null,
        transactionAmount: raw.auto_recurring?.transaction_amount ?? null,
        currency: raw.auto_recurring?.currency_id ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp preapproval read]:', preapprovalId, message);
    return { ok: false, status: 0, message };
  }
}

/** Subconjunto de payment relevante al cobro (R6 constancia + R7 dedupe). */
export interface MpPaymentFull {
  id: number;
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  /** Constancia MP (R6) solo si MP la trae; null = el panel lo muestra sin link. */
  receiptUrl: string | null;
  dateApproved: string | null;
  /** Última mutación del pago (momento del rechazo, para la nota de gracia). */
  dateLastUpdated: string | null;
  /** El preapproval que generó el cobro (p/recuperar la fila del ciclo). */
  preapprovalId: string | null;
  payerEmail: string | null;
}

export async function getPayment(paymentId: string): Promise<MpResult<MpPaymentFull>> {
  const env = mpEnv();
  if (!env) return { ok: false, status: 0, message: 'MP_ACCESS_TOKEN no configurado' };

  try {
    const res = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${env.accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
      transaction_details?: { external_resource_url?: string | null };
      date_approved?: string | null;
      date_last_updated?: string | null;
      preapproval_id?: string | null;
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
        receiptUrl: raw.transaction_details?.external_resource_url ?? null,
        dateApproved: raw.date_approved ?? null,
        dateLastUpdated: raw.date_last_updated ?? null,
        preapprovalId: raw.preapproval_id ?? null,
        payerEmail: raw.payer?.email ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fallo de red';
    console.error('[mp payment read]:', paymentId, message);
    return { ok: false, status: 0, message };
  }
}
