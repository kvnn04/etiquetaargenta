/* ============================================================================
 * SERVICIO DE RESPUESTAS DEL ENLACE — posición 14
 * ----------------------------------------------------------------------------
 * Orquesta, SOLO server-side:
 *   1. lectura pública del link (existencia/vigencia) con service-role;
 *   2. RPC transaccional (`link_register_decision` / `link_register_observation`);
 *   3. aviso por email al taller (fail-soft: la fila YA quedó guardada);
 *   4. href de WhatsApp pre-armado (la fila también quedó guardada antes).
 *
 * La DB es la última palabra: la RPC revalida link, vigencia, variante y las
 * reglas de una-sola-vez. Este módulo solo traduce el resultado a HTTP y
 * completa los efectos externos que la RPC no puede hacer (email).
 * ============================================================================ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { canonicalLinkUrl, whatsappApprovalHref } from '@/lib/links/states';
import {
  isWhatsappAvailable,
  linkVariantExists,
  loadPublicLink,
  variantLabelOf,
  workshopEmail,
} from '@/lib/links/server';
import {
  toPublicLinkResponse,
  whatsappObservationHref,
  whatsappRejectionHref,
  type LinkChannel,
  type LinkDecision,
  type LinkResponseRow,
  type PublicLinkResponse,
} from '@/lib/links/responses';
import { sendLinkDecisionMail, sendLinkObservationMail } from '@/lib/links/mail';
import type { MailOutcome } from '@/lib/payments/mail';

export interface LinkActionRouteResult {
  status: number;
  body: Record<string, unknown>;
}

interface RpcOutcome {
  ok?: boolean;
  code?: string;
  already?: boolean;
  fallback?: boolean;
  legacy?: boolean;
  decision?: string | null;
  decision_variant_id?: string | null;
  decided_at?: string | null;
  response?: LinkResponseRow | null;
}

const UA_MAX = 200;

function fail(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): LinkActionRouteResult {
  return { status, body: { error, ...extra } };
}

/** Traduce el código de dominio de la RPC al contrato HTTP de §6. */
function fromRpcError(rpc: RpcOutcome): LinkActionRouteResult {
  const row = rpc.response ?? null;
  switch (rpc.code) {
    case 'LINK_NOT_FOUND':
      return fail(404, 'NOT_FOUND');
    case 'LINK_EXPIRED':
      return fail(410, 'LINK_EXPIRED');
    case 'INVALID_DECISION':
      return fail(400, 'BAD_REQUEST', { reason: 'decision' });
    case 'INVALID_VARIANT':
      return fail(400, 'BAD_REQUEST', { reason: 'variant_id' });
    case 'INVALID_CHANNEL':
      return fail(400, 'BAD_REQUEST', { reason: 'channel' });
    case 'INVALID_OBSERVATION':
      return fail(400, 'BAD_REQUEST', { reason: 'observation' });
    case 'OBSERVATION_REQUIRED':
      return fail(400, 'BAD_REQUEST', { reason: 'observation_required' });
    case 'OBSERVATION_NOT_ALLOWED':
      return fail(400, 'BAD_REQUEST', { reason: 'observation_not_allowed' });
    case 'DECISION_TAKEN':
      return fail(409, 'DECISION_TAKEN', {
        decision: rpc.decision ?? row?.decision ?? null,
        decisionVariantId: rpc.decision_variant_id ?? row?.decision_variant_id ?? null,
        decidedAt: rpc.decided_at ?? row?.decided_at ?? null,
        ...(rpc.legacy ? { legacy: true } : {}),
      });
    case 'OBSERVATION_TAKEN':
      return fail(409, 'OBSERVATION_TAKEN', {
        observation: row?.observation ?? null,
        observedAt: row?.observed_at ?? null,
        observationChannel: row?.observation_channel ?? null,
      });
    default:
      console.error('[link response rpc]:', rpc.code ?? 'unknown');
      return fail(503, 'UNAVAILABLE');
  }
}

/** Marca el resultado del email de la DECISIÓN (y de la observación si el
 * mismo aviso la creó). Nunca lanza: un fallo de UPDATE no invalida la fila. */
async function markDecisionEmail(
  service: SupabaseClient,
  linkId: string,
  outcome: MailOutcome,
  alsoObservation: boolean,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const errorNote = outcome.note.slice(0, 300);
  const patch: Record<string, unknown> = outcome.sent
    ? { decision_email_sent_at: nowIso, decision_email_error: null }
    : { decision_email_error: errorNote };
  if (alsoObservation) {
    if (outcome.sent) {
      patch.observation_email_sent_at = nowIso;
      patch.observation_email_error = null;
    } else {
      patch.observation_email_error = errorNote;
    }
  }
  const { error } = await service.from('link_responses').update(patch).eq('link_id', linkId);
  if (error) console.error('[link response decision email mark]:', error.message);
}

/** Marca el resultado del email de la OBSERVACIÓN. */
async function markObservationEmail(
  service: SupabaseClient,
  linkId: string,
  outcome: MailOutcome,
): Promise<void> {
  const patch = outcome.sent
    ? {
        observation_email_sent_at: new Date().toISOString(),
        observation_email_error: null,
      }
    : { observation_email_error: outcome.note.slice(0, 300) };
  const { error } = await service.from('link_responses').update(patch).eq('link_id', linkId);
  if (error) console.error('[link response observation email mark]:', error.message);
}

function successBody(
  response: PublicLinkResponse,
  opts: {
    already?: boolean;
    emailSent?: boolean;
    emailError?: string | null;
    whatsappHref?: string | null;
  } = {},
): Record<string, unknown> {
  return {
    ok: true,
    decision: response.decision,
    decisionVariantId: response.decisionVariantId,
    decidedAt: response.decidedAt,
    decisionChannel: response.decisionChannel,
    observation: response.observation,
    observedAt: response.observedAt,
    observationChannel: response.observationChannel,
    ...(opts.already ? { already: true } : {}),
    ...(opts.emailSent === undefined ? {} : { emailSent: opts.emailSent }),
    ...(opts.emailError ? { emailError: opts.emailError } : {}),
    ...(opts.whatsappHref ? { whatsappHref: opts.whatsappHref } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Decisión                                                                   */
/* -------------------------------------------------------------------------- */

export interface RegisterDecisionInput {
  linkId: string;
  decision: LinkDecision;
  variantId: string;
  /** Ya normalizado por el route (1..280 code points) o null. */
  observation: string | null;
  /** Obligatorio en `rejected`; null en `approved`. */
  channel: LinkChannel | null;
  userAgent: string | null;
  origin: string;
}

export async function registerDecision(
  input: RegisterDecisionInput,
): Promise<LinkActionRouteResult> {
  const service = createSupabaseServiceClient();

  const loaded = await loadPublicLink(service, input.linkId);
  if (!loaded.ok) return fail(loaded.status, loaded.error);

  /* Defensa temprana: sin número no se escribe nada si el cliente pidió
   * WhatsApp (R14.5). El email sigue disponible. */
  if (input.channel === 'whatsapp' && !isWhatsappAvailable(loaded.view)) {
    return fail(400, 'WHATSAPP_UNAVAILABLE');
  }

  /* La RPC valida la variante; este chequeo previo permite un 400 claro y
   * evita escribir una decisión que no nombra una opción visible (R14.2). */
  if (!linkVariantExists(loaded.link, input.variantId)) {
    return fail(400, 'BAD_REQUEST', { reason: 'variant_id' });
  }

  const { data, error } = await service.rpc('link_register_decision', {
    p_link_id: input.linkId,
    p_decision: input.decision,
    p_variant_id: input.variantId,
    p_observation: input.observation,
    p_channel: input.channel,
    p_user_agent: input.userAgent?.slice(0, UA_MAX) ?? null,
  });
  if (error) {
    console.error('[link decision rpc]:', error.message);
    return fail(503, 'UNAVAILABLE');
  }

  const rpc = (data ?? {}) as RpcOutcome;
  if (!rpc.ok) return fromRpcError(rpc);

  let response = toPublicLinkResponse(rpc.response);
  if (!response) {
    console.error('[link decision rpc]: respuesta vacía');
    return fail(503, 'UNAVAILABLE');
  }

  const url = canonicalLinkUrl(input.linkId, input.origin);
  const label = variantLabelOf(loaded.link, input.variantId);
  let whatsappHref: string | null = null;
  let emailSent: boolean | undefined;
  let emailError: string | null = null;

  if (input.decision === 'approved') {
    /* R6: la aprobación sigue usando WhatsApp/código, no email. */
    whatsappHref = whatsappApprovalHref(loaded.view.workshop.whatsapp, url, label);
  } else {
    const decisionChannel = response.decisionChannel;
    if (decisionChannel === 'email') {
      if (response.decisionEmailSentAt) {
        emailSent = true;
      } else if (response.decisionEmailError) {
        emailSent = false;
        emailError = response.decisionEmailError;
      } else {
        const to = await workshopEmail(service, loaded.link.user_id);
        const alsoObservation =
          response.observationChannel === 'email' && !response.observationEmailSentAt;
        if (!to) {
          emailSent = false;
          emailError = 'workshop-email-missing';
          await markDecisionEmail(
            service,
            input.linkId,
            { sent: false, note: emailError },
            alsoObservation,
          );
          response = {
            ...response,
            decisionEmailError: emailError,
            ...(alsoObservation ? { observationEmailError: emailError } : {}),
          };
        } else {
          const outcome = await sendLinkDecisionMail({
            to,
            linkId: input.linkId,
            linkUrl: url,
            workshopName: loaded.view.workshop.name,
            variantLabel: label,
            observation: response.observation ?? '',
            observedAtMs: response.observedAt ? Date.parse(response.observedAt) : null,
            observationChannel: response.observationChannel,
            decisionChannel,
          });
          emailSent = outcome.sent;
          if (!outcome.sent) emailError = outcome.note;
          await markDecisionEmail(service, input.linkId, outcome, alsoObservation);
          response = {
            ...response,
            decisionEmailSentAt: outcome.sent ? new Date().toISOString() : null,
            decisionEmailError: outcome.sent ? null : outcome.note,
            ...(alsoObservation
              ? {
                  observationEmailSentAt: outcome.sent ? new Date().toISOString() : null,
                  observationEmailError: outcome.sent ? null : outcome.note,
                }
              : {}),
          };
        }
      }
      /* Fallback honesto: la fila quedó guardada aunque el email no salga. */
      if (emailSent === false) {
        whatsappHref = whatsappRejectionHref(
          loaded.view.workshop.whatsapp,
          url,
          response.observation ?? '',
        );
      }
    } else if (decisionChannel === 'whatsapp') {
      whatsappHref = whatsappRejectionHref(
        loaded.view.workshop.whatsapp,
        url,
        response.observation ?? '',
      );
    }
  }

  return {
    status: 200,
    body: successBody(response, {
      already: Boolean(rpc.already),
      emailSent,
      emailError,
      whatsappHref,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Observación sola                                                           */
/* -------------------------------------------------------------------------- */

export interface RegisterObservationInput {
  linkId: string;
  /** Ya normalizada por el route (1..280 code points). */
  message: string;
  channel: LinkChannel;
  userAgent: string | null;
  origin: string;
}

export async function registerObservation(
  input: RegisterObservationInput,
): Promise<LinkActionRouteResult> {
  const service = createSupabaseServiceClient();

  const loaded = await loadPublicLink(service, input.linkId);
  if (!loaded.ok) return fail(loaded.status, loaded.error);

  if (input.channel === 'whatsapp' && !isWhatsappAvailable(loaded.view)) {
    return fail(400, 'WHATSAPP_UNAVAILABLE');
  }

  const { data, error } = await service.rpc('link_register_observation', {
    p_link_id: input.linkId,
    p_message: input.message,
    p_channel: input.channel,
    p_user_agent: input.userAgent?.slice(0, UA_MAX) ?? null,
  });
  if (error) {
    console.error('[link observation rpc]:', error.message);
    return fail(503, 'UNAVAILABLE');
  }

  const rpc = (data ?? {}) as RpcOutcome;
  if (!rpc.ok) return fromRpcError(rpc);

  let response = toPublicLinkResponse(rpc.response);
  if (!response) {
    console.error('[link observation rpc]: respuesta vacía');
    return fail(503, 'UNAVAILABLE');
  }

  const url = canonicalLinkUrl(input.linkId, input.origin);
  let whatsappHref: string | null = null;
  let emailSent: boolean | undefined;
  let emailError: string | null = null;

  if (response.observationChannel === 'email') {
    if (response.observationEmailSentAt) {
      emailSent = true;
    } else if (response.observationEmailError) {
      emailSent = false;
      emailError = response.observationEmailError;
    } else {
      const to = await workshopEmail(service, loaded.link.user_id);
      if (!to) {
        emailSent = false;
        emailError = 'workshop-email-missing';
        await markObservationEmail(
          service,
          input.linkId,
          { sent: false, note: emailError },
        );
        response = { ...response, observationEmailError: emailError };
      } else {
        const outcome = await sendLinkObservationMail({
          to,
          linkId: input.linkId,
          linkUrl: url,
          workshopName: loaded.view.workshop.name,
          decision: response.decision,
          variantLabel: response.decisionVariantId
            ? variantLabelOf(loaded.link, response.decisionVariantId)
            : null,
          observation: response.observation ?? input.message,
          observedAtMs: response.observedAt ? Date.parse(response.observedAt) : null,
          observationChannel: response.observationChannel,
        });
        emailSent = outcome.sent;
        if (!outcome.sent) emailError = outcome.note;
        await markObservationEmail(service, input.linkId, outcome);
        response = {
          ...response,
          observationEmailSentAt: outcome.sent ? new Date().toISOString() : null,
          observationEmailError: outcome.sent ? null : outcome.note,
        };
      }
    }
    if (emailSent === false) {
      whatsappHref = whatsappObservationHref(
        loaded.view.workshop.whatsapp,
        url,
        response.observation ?? input.message,
      );
    }
  } else if (response.observationChannel === 'whatsapp') {
    whatsappHref = whatsappObservationHref(
      loaded.view.workshop.whatsapp,
      url,
      response.observation ?? input.message,
    );
  }

  return {
    status: 200,
    body: successBody(response, {
      already: Boolean(rpc.already),
      emailSent,
      emailError,
      whatsappHref,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Alias legacy: POST /approvals                                              */
/* -------------------------------------------------------------------------- */

export async function registerLegacyApproval(input: {
  linkId: string;
  variantId: string;
  userAgent: string | null;
}): Promise<LinkActionRouteResult> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('link_register_decision', {
    p_link_id: input.linkId,
    p_decision: 'approved',
    p_variant_id: input.variantId,
    p_observation: null,
    p_channel: null,
    p_user_agent: input.userAgent?.slice(0, UA_MAX) ?? null,
  });
  if (error) {
    console.error('[link legacy approval rpc]:', error.message);
    return fail(503, 'APPROVAL_UNAVAILABLE');
  }

  const rpc = (data ?? {}) as RpcOutcome;
  if (!rpc.ok) {
    const mapped = fromRpcError(rpc);
    /* El cliente viejo solo conoce APPROVAL_UNAVAILABLE: se mantiene el
     * contrato de la ruta para 503, pero los códigos de dominio son nuevos. */
    if (mapped.status === 503) return fail(503, 'APPROVAL_UNAVAILABLE');
    return mapped;
  }

  const response = toPublicLinkResponse(rpc.response);
  return {
    status: rpc.already ? 200 : 201,
    body: {
      ok: true,
      linkId: input.linkId,
      variantId: response?.decisionVariantId ?? input.variantId,
      approvedAt: response?.decidedAt ?? new Date().toISOString(),
      ...(rpc.already ? { already: true } : {}),
    },
  };
}

/* -------------------------------------------------------------------------- */
