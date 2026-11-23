/* ============================================================================
 * SERVICIO LEGAL — posición 12 (spec_paginas_legales.md §5 + §6)
 * ----------------------------------------------------------------------------
 * Server-only. Todo lo que toca DB/MP/email vive acá:
 *   · legal_requests / legal_acceptances SOLO con service-role (sin policies
 *     públicas, R13.7/R13.8);
 *   · rate limit por email (5 min) e IP hasheada (5/hora);
 *   · baja con doble opt-in: token de 24 h hasheado, un solo uso, y cancelación
 *     del preapproval SOLO si el email pertenece a la cuenta (R13.6);
 *   · la transición de dinero usa `applyPreapproval` (máquina R9): no se
 *     duplican reglas de pagos. `suppressEmail` evita el email duplicado;
 *     el acuse propio de la baja lo manda este módulo.
 *
 * NUNCA importar desde componentes cliente.
 * ============================================================================ */

import { randomBytes, randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { applyPreapproval } from '@/lib/payments/apply';
import { formatPricePerMonth } from '@/lib/payments/core';
import {
  cancelPreapproval,
  getPreapproval,
  hasMercadoPagoCredentials,
} from '@/lib/payments/mercadopago';
import { sendMail } from '@/lib/payments/mail';
import { createSupabaseServiceClient, hasServiceCredentials } from '@/lib/supabase/service';
import { LEGAL_ENTITY, legalSiteBase } from './config';
import { legalConfirmationPath } from './links';
import {
  mailBajaConfirmation,
  mailBajaDone,
  mailLegalInternalAlert,
  mailPrivacyAck,
  mailWithdrawalAck,
  sendLegalNotifications,
} from './mail';
import {
  generateLegalCode,
  generateLegalToken,
  hashLegalToken,
  isLegalToken,
  isLegalTokenExpired,
  legalRateLimit,
  legalTokenExpiresAt,
  LEGAL_DATA_RIGHT_LABEL,
  LEGAL_EMAIL_RATE_WINDOW_MS,
  LEGAL_IP_RATE_MAX,
  LEGAL_IP_RATE_WINDOW_MS,
  LEGAL_TOKEN_BYTES,
  maskEmail,
  type LegalDataRight,
  type LegalRequestKind,
  type LegalRequestStatus,
  type ValidatedBaja,
  type ValidatedPrivacy,
  type ValidatedWithdrawal,
} from './requests';

/* -------------------------------------------------------------------------- */
/* Tipos de fila                                                               */
/* -------------------------------------------------------------------------- */

export interface LegalRequestRow {
  id: string;
  code: string;
  kind: LegalRequestKind;
  email: string;
  full_name: string | null;
  user_id: string | null;
  mp_payment_id: number | string | null;
  mp_preapproval_id: string | null;
  purchase_date: string | null;
  data_right: LegalDataRight | null;
  message: string | null;
  status: LegalRequestStatus;
  resolution_note: string | null;
  ip_hash: string | null;
  confirmation_token_hash: string | null;
  confirmation_expires_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  responded_at: string | null;
}

interface SubscriptionRow {
  preapproval_id: string | null;
  status: string | null;
  period_end: string | null;
}

export type LegalServiceFailure =
  | { ok: false; reason: 'service' }
  | { ok: false; reason: 'db'; detail: string }
  | { ok: false; reason: 'rate'; retryAfterSeconds: number };

/* -------------------------------------------------------------------------- */
/* Contexto de request, IP y salt                                              */
/* -------------------------------------------------------------------------- */

const FALLBACK_IP_SALT = 'simulador-mates-legal-ip-v1';
let warnedMissingSalt = false;

function ipSalt(): string {
  const salt = process.env.LEGAL_IP_SALT?.trim();
  if (!salt && process.env.NODE_ENV === 'production' && !warnedMissingSalt) {
    warnedMissingSalt = true;
    console.warn('[legal] LEGAL_IP_SALT ausente: se usa el salt por defecto (configuralo en producción).');
  }
  return salt || FALLBACK_IP_SALT;
}

/** Acepta IPv4/IPv6; descarta puertos, corchetes y zone-id. `null` = inválida. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith('[') && value.includes(']')) {
    value = value.slice(1, value.indexOf(']'));
  }
  if (value.includes('%')) value = value.split('%')[0] ?? '';
  if (isIP(value) === 4) return value;
  if (isIP(value) === 6) return value;
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  if (withPort && isIP(withPort[1]!) === 4) return withPort[1]!;
  return null;
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const raw =
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    '';
  return normalizeIp(raw) ?? 'unknown';
}

export function hashLegalIp(ip: string): string {
  return hashLegalToken(`${ipSalt()}:${ip}`);
}

export interface LegalRequestContext {
  ip: string;
  ipHash: string;
  userAgent: string | null;
}

export function legalRequestContext(request: Request): LegalRequestContext {
  const ip = requestIp(request);
  const ua = request.headers.get('user-agent')?.trim() ?? '';
  return {
    ip,
    ipHash: hashLegalIp(ip),
    userAgent: ua ? ua.slice(0, 512) : null,
  };
}

export function legalServiceAvailable(): boolean {
  return hasServiceCredentials();
}

/* -------------------------------------------------------------------------- */
/* Precio vigente (R13.11: sale de pricing_config, nunca hardcodeado)          */
/* -------------------------------------------------------------------------- */

export interface LegalPrice {
  amount: number;
  currency: string;
  label: string | null;
}

export async function readLegalPrice(): Promise<LegalPrice | null> {
  if (!hasServiceCredentials()) return null;
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from('pricing_config')
      .select('amount, currency')
      .eq('key', 'pro_monthly_ars')
      .maybeSingle<{ amount: number | string; currency: string }>();
    if (error || !data) return null;
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      amount,
      currency: data.currency || 'ARS',
      label: formatPricePerMonth(amount, data.currency || 'ARS'),
    };
  } catch (err) {
    console.error('[legal price]:', err instanceof Error ? err.message : err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Cuenta por email + suscripción (R13.6: nunca cancelar un preapproval ajeno)  */
/* -------------------------------------------------------------------------- */

export async function findUserByEmail(email: string): Promise<string | null> {
  if (!hasServiceCredentials()) return null;
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc('legal_find_user_by_email', {
      p_email: email,
    });
    if (error) {
      console.error('[legal user lookup]:', error.message);
      return null;
    }
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch (err) {
    console.error('[legal user lookup]:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function readSubscription(userId: string): Promise<SubscriptionRow | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('subscriptions')
    .select('preapproval_id, status, period_end')
    .eq('user_id', userId)
    .maybeSingle<SubscriptionRow>();
  if (error) {
    console.error('[legal subscription read]:', error.message);
    return null;
  }
  return data ?? null;
}

/* -------------------------------------------------------------------------- */
/* Rate limit                                                                  */
/* -------------------------------------------------------------------------- */

async function checkRateLimit(
  service: ReturnType<typeof createSupabaseServiceClient>,
  email: string,
  ipHash: string,
  nowMs: number,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number } | { error: string }> {
  const emailSince = new Date(nowMs - LEGAL_EMAIL_RATE_WINDOW_MS).toISOString();
  const ipSince = new Date(nowMs - LEGAL_IP_RATE_WINDOW_MS).toISOString();

  const [lastEmail, ipRows] = await Promise.all([
    service
      .from('legal_requests')
      .select('created_at')
      .eq('email', email)
      .gte('created_at', emailSince)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
    service
      .from('legal_requests')
      .select('created_at')
      .eq('ip_hash', ipHash)
      .gte('created_at', ipSince)
      .order('created_at', { ascending: true })
      .limit(LEGAL_IP_RATE_MAX),
  ]);

  if (lastEmail.error) return { error: lastEmail.error.message };
  if (ipRows.error) return { error: ipRows.error.message };

  const lastEmailAtMs = lastEmail.data ? Date.parse(lastEmail.data.created_at) : null;
  const ipTimestampsMs = (ipRows.data ?? [])
    .map((row) => Date.parse(String(row.created_at)))
    .filter((ms) => Number.isFinite(ms));

  const decision = legalRateLimit({
    lastEmailAtMs: lastEmailAtMs != null && Number.isFinite(lastEmailAtMs) ? lastEmailAtMs : null,
    ipTimestampsMs,
    nowMs,
  });
  return decision.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: decision.retryAfterSeconds };
}

/* -------------------------------------------------------------------------- */
/* Helpers de creación                                                         */
/* -------------------------------------------------------------------------- */

function nextCode(kind: LegalRequestKind, nowMs: number): string {
  return generateLegalCode(kind, nowMs, (max) => randomInt(max));
}

function newBajaToken(nowMs: number): { token: string; hash: string; expiresAtMs: number } {
  const token = generateLegalToken(randomBytes(LEGAL_TOKEN_BYTES));
  return {
    token,
    hash: hashLegalToken(token),
    expiresAtMs: legalTokenExpiresAt(nowMs),
  };
}

function ownerAlert(row: LegalRequestRow, detail?: string | null) {
  const to = LEGAL_ENTITY.email;
  if (!to) {
    console.log('[legal alert] sin LEGAL_EMAIL:', row.code, row.kind);
    return null;
  }
  return mailLegalInternalAlert({
    to,
    code: row.code,
    kind: row.kind,
    email: row.email,
    paymentId: row.mp_payment_id != null ? String(row.mp_payment_id) : null,
    preapprovalId: row.mp_preapproval_id,
    createdAtMs: Date.parse(row.created_at) || Date.now(),
    detail: detail ?? null,
  });
}

async function insertLegalRequest(
  service: ReturnType<typeof createSupabaseServiceClient>,
  kind: LegalRequestKind,
  payload: Record<string, unknown>,
  nowMs: number,
  withBajaToken: boolean,
): Promise<{ row: LegalRequestRow; token: string | null } | { error: string }> {
  let lastError = 'No pudimos guardar la solicitud.';

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = nextCode(kind, nowMs);
    const baja = withBajaToken ? newBajaToken(nowMs) : null;
    const { data, error } = await service
      .from('legal_requests')
      .insert({
        code,
        kind,
        ...payload,
        status: 'recibida',
        confirmation_token_hash: baja?.hash ?? null,
        confirmation_expires_at: baja
          ? new Date(baja.expiresAtMs).toISOString()
          : null,
      })
      .select('*')
      .single<LegalRequestRow>();

    if (!error && data) return { row: data, token: baja?.token ?? null };

    const dbCode = (error as { code?: string } | null)?.code;
    lastError = error?.message ?? lastError;
    if (dbCode === '23505') continue; // colisión de código/token: reintentar
    console.error('[legal insert]:', kind, lastError);
    return { error: lastError };
  }

  return { error: `No pudimos generar un código único: ${lastError}` };
}

/* -------------------------------------------------------------------------- */
/* Arrepentimiento (R13.5)                                                     */
/* -------------------------------------------------------------------------- */

export type CreateWithdrawalResult =
  | {
      ok: true;
      row: LegalRequestRow;
      emailSent: boolean;
    }
  | LegalServiceFailure;

export async function createWithdrawal(input: {
  value: ValidatedWithdrawal;
  context: LegalRequestContext;
  nowMs?: number;
}): Promise<CreateWithdrawalResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'service' };
  const nowMs = input.nowMs ?? Date.now();
  const service = createSupabaseServiceClient();

  const rate = await checkRateLimit(service, input.value.email, input.context.ipHash, nowMs);
  if ('error' in rate) return { ok: false, reason: 'db', detail: rate.error };
  if (!rate.allowed) return { ok: false, reason: 'rate', retryAfterSeconds: rate.retryAfterSeconds };

  const userId = await findUserByEmail(input.value.email);
  const price = await readLegalPrice();

  const inserted = await insertLegalRequest(
    service,
    'arrepentimiento',
    {
      email: input.value.email,
      full_name: input.value.fullName,
      user_id: userId,
      mp_payment_id: input.value.paymentId,
      purchase_date: input.value.purchaseDateIso,
      message: input.value.message,
      ip_hash: input.context.ipHash,
      resolution_note: input.value.withinWindow
        ? null
        : 'Fecha informada fuera de los 10 días corridos: revisar encuadre.',
    },
    nowMs,
    false,
  );
  if ('error' in inserted) return { ok: false, reason: 'db', detail: inserted.error };

  const internal = ownerAlert(inserted.row);
  const notified = await sendLegalNotifications({
    consumer: mailWithdrawalAck({
      to: input.value.email,
      code: inserted.row.code,
      fullName: input.value.fullName,
      purchaseDateMs: input.value.purchaseDateMs,
      withinWindow: input.value.withinWindow,
      amountArs: price?.amount ?? null,
    }),
    internal,
    timeoutMs: 8_000,
  });

  return { ok: true, row: inserted.row, emailSent: notified.consumer.sent };
}

/* -------------------------------------------------------------------------- */
/* Baja (R13.6: doble opt-in)                                                  */
/* -------------------------------------------------------------------------- */

interface OpenBajaRow {
  id: string;
  code: string;
  created_at: string;
  status: LegalRequestStatus;
  confirmation_expires_at: string | null;
}

/**
 * Una solicitud de baja sin confirmar sigue ABIERTA aunque su token haya
 * vencido: el reenvío regenera el token, conserva el código y no crea otra
 * fila (spec §3.4). La antigüedad no se usa como filtro.
 */
async function findOpenBaja(
  service: ReturnType<typeof createSupabaseServiceClient>,
  email: string,
): Promise<OpenBajaRow | null> {
  const { data, error } = await service
    .from('legal_requests')
    .select('id, code, created_at, status, confirmation_expires_at')
    .eq('kind', 'baja')
    .eq('email', email)
    .in('status', ['recibida', 'en_proceso'])
    .is('confirmed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<OpenBajaRow>();
  if (error) {
    console.error('[legal open baja]:', error.message);
    return null;
  }
  return data ?? null;
}

export type CreateBajaResult =
  | {
      ok: true;
      row: LegalRequestRow;
      emailSent: boolean;
      confirmExpiresAt: string;
      resent: boolean;
    }
  | LegalServiceFailure;

export async function createBaja(input: {
  value: ValidatedBaja;
  context: LegalRequestContext;
  origin: string;
  nowMs?: number;
}): Promise<CreateBajaResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'service' };
  const nowMs = input.nowMs ?? Date.now();
  const service = createSupabaseServiceClient();

  const rate = await checkRateLimit(service, input.value.email, input.context.ipHash, nowMs);
  if ('error' in rate) return { ok: false, reason: 'db', detail: rate.error };
  if (!rate.allowed) return { ok: false, reason: 'rate', retryAfterSeconds: rate.retryAfterSeconds };

  const userId = await findUserByEmail(input.value.email);
  const sub = userId ? await readSubscription(userId) : null;
  const preapprovalId = input.value.preapprovalId ?? sub?.preapproval_id ?? null;

  const open = await findOpenBaja(service, input.value.email);
  const openExpiresAt = open?.confirmation_expires_at
    ? Date.parse(open.confirmation_expires_at)
    : null;
  const openExpired =
    open != null &&
    isLegalTokenExpired(Number.isFinite(openExpiresAt) ? openExpiresAt : null, nowMs);
  let row: LegalRequestRow | null = null;
  let token: string | null = null;
  let confirmExpiresAtMs = legalTokenExpiresAt(nowMs);

  if (open) {
    /* Reenvío: se conserva el código y solo se regenera el token (spec §3.4).
     * Si el token anterior venció, la solicitud pasa a cola manual con aviso
     * al titular y el link nuevo sigue habilitado para confirmar. */
    const baja = newBajaToken(nowMs);
    token = baja.token;
    confirmExpiresAtMs = baja.expiresAtMs;
    const updated = await service
      .from('legal_requests')
      .update({
        confirmation_token_hash: baja.hash,
        confirmation_expires_at: new Date(baja.expiresAtMs).toISOString(),
        mp_preapproval_id: preapprovalId,
        message: input.value.message,
        ip_hash: input.context.ipHash,
        user_id: userId,
        ...(openExpired
          ? {
              status: 'en_proceso',
              resolution_note: noteForManual(
                'El link de confirmación anterior venció sin confirmar; se reenvió uno nuevo (mismo código).',
              ),
            }
          : {}),
      })
      .eq('id', open.id)
      .is('confirmed_at', null)
      .select('*')
      .maybeSingle<LegalRequestRow>();
    if (updated.error || !updated.data) {
      return {
        ok: false,
        reason: 'db',
        detail: updated.error?.message ?? 'La solicitud abierta cambió de estado.',
      };
    }
    row = updated.data;
  } else {
    const inserted = await insertLegalRequest(
      service,
      'baja',
      {
        email: input.value.email,
        user_id: userId,
        mp_payment_id: input.value.paymentId,
        mp_preapproval_id: preapprovalId,
        message: input.value.message,
        ip_hash: input.context.ipHash,
      },
      nowMs,
      true,
    );
    if ('error' in inserted) return { ok: false, reason: 'db', detail: inserted.error };
    row = inserted.row;
    token = inserted.token;
    if (row.confirmation_expires_at) {
      confirmExpiresAtMs = Date.parse(row.confirmation_expires_at);
    }
  }

  const confirmUrl = `${legalSiteBase(input.origin)}${legalConfirmationPath(token!)}`;
  const internal = ownerAlert(
    row,
    open
      ? openExpired
        ? 'Link de confirmación vencido: cola manual y link nuevo (mismo código).'
        : 'Reenvío de link de confirmación (mismo código).'
      : 'Baja pendiente de confirmación por email.',
  );
  const notified = await sendLegalNotifications({
    consumer: mailBajaConfirmation({
      to: input.value.email,
      code: row.code,
      confirmUrl,
      expiresAtMs: confirmExpiresAtMs,
    }),
    internal,
    timeoutMs: 8_000,
  });

  return {
    ok: true,
    row,
    emailSent: notified.consumer.sent,
    confirmExpiresAt: new Date(confirmExpiresAtMs).toISOString(),
    resent: Boolean(open),
  };
}

/* -------------------------------------------------------------------------- */
/* Derechos de datos (R13.10)                                                  */
/* -------------------------------------------------------------------------- */

export type CreatePrivacyResult =
  | { ok: true; row: LegalRequestRow; emailSent: boolean }
  | LegalServiceFailure;

export async function createPrivacyRequest(input: {
  value: ValidatedPrivacy;
  context: LegalRequestContext;
  nowMs?: number;
}): Promise<CreatePrivacyResult> {
  if (!hasServiceCredentials()) return { ok: false, reason: 'service' };
  const nowMs = input.nowMs ?? Date.now();
  const service = createSupabaseServiceClient();

  const rate = await checkRateLimit(service, input.value.email, input.context.ipHash, nowMs);
  if ('error' in rate) return { ok: false, reason: 'db', detail: rate.error };
  if (!rate.allowed) return { ok: false, reason: 'rate', retryAfterSeconds: rate.retryAfterSeconds };

  const userId = await findUserByEmail(input.value.email);
  const inserted = await insertLegalRequest(
    service,
    'privacidad',
    {
      email: input.value.email,
      user_id: userId,
      data_right: input.value.dataRight,
      message: input.value.message,
      ip_hash: input.context.ipHash,
    },
    nowMs,
    false,
  );
  if ('error' in inserted) return { ok: false, reason: 'db', detail: inserted.error };

  const internal = ownerAlert(
    inserted.row,
    `Derecho solicitado: ${LEGAL_DATA_RIGHT_LABEL[input.value.dataRight]}.`,
  );
  const notified = await sendLegalNotifications({
    consumer: mailPrivacyAck({
      to: input.value.email,
      code: inserted.row.code,
      dataRight: input.value.dataRight,
    }),
    internal,
    timeoutMs: 8_000,
  });

  return { ok: true, row: inserted.row, emailSent: notified.consumer.sent };
}

/* -------------------------------------------------------------------------- */
/* Confirmación de baja (GET page + POST confirm)                              */
/* -------------------------------------------------------------------------- */

export type PeekBajaResult =
  | {
      ok: true;
      code: string;
      emailMasked: string;
      expiresAtMs: number | null;
      expired: boolean;
      confirmed: boolean;
      status: LegalRequestStatus;
    }
  | { ok: false; reason: 'invalid' | 'db' };

export async function peekBajaByToken(token: string, nowMs = Date.now()): Promise<PeekBajaResult> {
  if (!isLegalToken(token) || !hasServiceCredentials()) return { ok: false, reason: 'invalid' };
  try {
    const service = createSupabaseServiceClient();
    const tokenHash = hashLegalToken(token);
    const { data, error } = await service
      .from('legal_requests')
      .select('*')
      .eq('confirmation_token_hash', tokenHash)
      .eq('kind', 'baja')
      .maybeSingle<LegalRequestRow>();
    if (error) {
      console.error('[legal peek baja]:', error.message);
      return { ok: false, reason: 'db' };
    }
    if (!data) return { ok: false, reason: 'invalid' };
    const expiresAtMs = data.confirmation_expires_at
      ? Date.parse(data.confirmation_expires_at)
      : null;
    const confirmed = Boolean(data.confirmed_at) || data.status === 'resuelta';
    const expired = !confirmed && isLegalTokenExpired(expiresAtMs, nowMs);
    let status = data.status;
    if (expired) {
      /* Barrido perezoso: sin cron, el vencimiento se materializa cuando el
       * link se abre. No cancela nada y no toca `confirmed_at`. */
      const marked = await alertExpiredBaja(service, data, tokenHash);
      if (marked) status = marked.status;
    }
    return {
      ok: true,
      code: data.code,
      emailMasked: maskEmail(data.email),
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
      expired,
      confirmed,
      status,
    };
  } catch (err) {
    console.error('[legal peek baja]:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'db' };
  }
}

export type ConfirmBajaResult =
  | {
      ok: true;
      code: string;
      status: LegalRequestStatus;
      periodEndMs: number | null;
      manual: boolean;
      alreadyConfirmed: boolean;
      message: string;
    }
  | {
      ok: false;
      reason: 'invalid' | 'expired' | 'email_mismatch' | 'security' | 'service' | 'db';
      code?: string;
      status?: LegalRequestStatus;
      message: string;
    };

function noteForManual(reason: string): string {
  return `Cola manual: ${reason}`;
}

async function markManual(
  service: ReturnType<typeof createSupabaseServiceClient>,
  row: LegalRequestRow,
  note: string,
): Promise<LegalRequestRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await service
    .from('legal_requests')
    .update({
      status: 'en_proceso',
      confirmed_at: nowIso,
      confirmation_token_hash: null,
      confirmation_expires_at: null,
      resolution_note: noteForManual(note),
    })
    .eq('id', row.id)
    .select('*')
    .maybeSingle<LegalRequestRow>();
  if (error) {
    console.error('[legal manual update]:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Cola manual perezosa: si el link venció sin confirmar, la solicitud pasa a
 * `en_proceso` SIN marcar `confirmed_at` (la identidad no se verificó). Así
 * sigue siendo reutilizable por el reenvío, que conserva el código.
 *
 * El `update` condicionado al hash hace que la alerta al titular se mande una
 * sola vez por token vencido, incluso con refreshes de la página.
 */
async function markExpiredBaja(
  service: ReturnType<typeof createSupabaseServiceClient>,
  row: LegalRequestRow,
  tokenHash: string,
): Promise<LegalRequestRow | null> {
  if (row.confirmed_at || row.status === 'resuelta' || row.status === 'rechazada') return null;
  const { data, error } = await service
    .from('legal_requests')
    .update({
      status: 'en_proceso',
      confirmation_token_hash: null,
      confirmation_expires_at: null,
      resolution_note: noteForManual(
        'Link de confirmación vencido sin confirmar (24 h). Se puede reenviar desde el Botón de Baja.',
      ),
    })
    .eq('id', row.id)
    .eq('confirmation_token_hash', tokenHash)
    .is('confirmed_at', null)
    .in('status', ['recibida', 'en_proceso'])
    .select('*')
    .maybeSingle<LegalRequestRow>();
  if (error) {
    console.error('[legal expired baja]:', error.message);
    return null;
  }
  return data ?? null;
}

async function alertExpiredBaja(
  service: ReturnType<typeof createSupabaseServiceClient>,
  row: LegalRequestRow,
  tokenHash: string,
): Promise<LegalRequestRow | null> {
  const expired = await markExpiredBaja(service, row, tokenHash);
  if (!expired) return null;
  const alert = ownerAlert(
    expired,
    'Link de confirmación vencido sin confirmar: solicitud en cola manual; NO se canceló nada.',
  );
  if (alert) await sendMail(alert, { timeoutMs: 8_000 });
  return expired;
}

export async function confirmBajaByToken(
  token: string,
  nowMs = Date.now(),
): Promise<ConfirmBajaResult> {
  if (!isLegalToken(token)) {
    return { ok: false, reason: 'invalid', message: 'El link de confirmación no es válido.' };
  }
  if (!hasServiceCredentials()) {
    return { ok: false, reason: 'service', message: 'El servicio no está disponible en este momento.' };
  }

  const service = createSupabaseServiceClient();
  const tokenHash = hashLegalToken(token);

  const found = await service
    .from('legal_requests')
    .select('*')
    .eq('confirmation_token_hash', tokenHash)
    .eq('kind', 'baja')
    .maybeSingle<LegalRequestRow>();

  if (found.error) {
    console.error('[legal confirm read]:', found.error.message);
    return { ok: false, reason: 'db', message: 'No pudimos leer la solicitud — reintentá en un momento.' };
  }
  if (!found.data) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'El link ya se usó o no existe. Pedí uno nuevo desde el Botón de Baja.',
    };
  }

  const row = found.data;
  if (row.confirmed_at || row.status === 'resuelta') {
    return {
      ok: true,
      code: row.code,
      status: row.status,
      periodEndMs: null,
      manual: row.status === 'en_proceso',
      alreadyConfirmed: true,
      message: 'Esta solicitud ya estaba confirmada.',
    };
  }

  const expiresAtMs = row.confirmation_expires_at
    ? Date.parse(row.confirmation_expires_at)
    : null;
  if (isLegalTokenExpired(Number.isFinite(expiresAtMs) ? expiresAtMs : null, nowMs)) {
    /* Vencido: a cola manual (sin `confirmed_at`), alerta única al titular y
     * token quemado. La solicitud queda reutilizable para un reenvío. */
    await alertExpiredBaja(service, row, tokenHash);
    return {
      ok: false,
      reason: 'expired',
      code: row.code,
      status: 'en_proceso',
      message: `El link venció (24 h). Pedí uno nuevo desde el Botón de Baja con el código ${row.code}.`,
    };
  }

  /* Claim de un solo uso: dos clicks concurrentes no cancelan dos veces. */
  const claim = await service
    .from('legal_requests')
    .update({ confirmation_token_hash: null, confirmation_expires_at: null })
    .eq('id', row.id)
    .eq('confirmation_token_hash', tokenHash)
    .is('confirmed_at', null)
    .select('id');
  if (claim.error) {
    console.error('[legal confirm claim]:', claim.error.message);
    return { ok: false, reason: 'db', message: 'No pudimos confirmar la baja — reintentá en un momento.' };
  }
  if (!claim.data || claim.data.length === 0) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Otra confirmación ya tomó este link. Si la baja no figura, escribinos.',
    };
  }

  /* Verificación de identidad: el email debe pertenecer a una cuenta real.
   * Fail closed: sin cuenta verificable NO se cancela nada, aunque la fila
   * tenga un user_id viejo o la búsqueda haya fallado. */
  const byEmail = await findUserByEmail(row.email);
  if (row.user_id && byEmail && row.user_id !== byEmail) {
    const updated = await markManual(service, row, 'Email no coincide con la cuenta de la solicitud.');
    if (updated) {
      const alert = ownerAlert(updated, 'BLOQUEADO: email no coincide con la cuenta; NO se canceló nada.');
      if (alert) await sendMail(alert, { timeoutMs: 8_000 });
    }
    return {
      ok: false,
      reason: 'security',
      code: row.code,
      status: 'en_proceso',
      message: 'No pudimos verificar que ese email sea el de la cuenta. No cancelamos nada; te contactamos para verificarlo.',
    };
  }

  if (!byEmail) {
    const updated = await markManual(service, row, 'Email sin cuenta asociada.');
    if (updated) {
      const alert = ownerAlert(updated, 'Baja con email sin cuenta: NO se canceló nada.');
      if (alert) await sendMail(alert, { timeoutMs: 8_000 });
    }
    return {
      ok: false,
      reason: 'email_mismatch',
      code: row.code,
      status: 'en_proceso',
      message:
        'El email informado no coincide con una cuenta suscripta. No cancelamos nada. Usá el email de la cuenta o el Portal de Mercado Pago.',
    };
  }

  const userId = byEmail;
  if (row.user_id !== userId) {
    await service.from('legal_requests').update({ user_id: userId }).eq('id', row.id);
  }

  const sub = await readSubscription(userId);
  /* Solo se cancela el preapproval que está en la fila de subscriptions del
   * usuario. NUNCA se usa el id que haya tipeado el formulario. */
  const preapprovalId = sub?.preapproval_id ?? null;

  if (!preapprovalId) {
    const updated = await markManual(service, row, 'Cuenta sin preapproval: baja manual.');
    if (updated) {
      const alert = ownerAlert(updated, 'Baja confirmada sin preapproval: procesar en el Portal de MP.');
      if (alert) await sendMail(alert, { timeoutMs: 8_000 });
      await sendMail(
        mailBajaDone({ to: row.email, code: row.code, periodEndMs: null, manual: true }),
        { timeoutMs: 8_000 },
      );
    }
    return {
      ok: true,
      code: row.code,
      status: 'en_proceso',
      periodEndMs: null,
      manual: true,
      alreadyConfirmed: false,
      message: 'Confirmamos tu identidad. La cuenta no tiene un débito automático asociado: la baja queda en atención manual dentro de 24 h.',
    };
  }

  if (!hasMercadoPagoCredentials()) {
    const updated = await markManual(service, row, 'MP sin credenciales: baja manual.');
    if (updated) {
      const alert = ownerAlert(updated, 'MP sin credenciales: cancelar desde el panel.');
      if (alert) await sendMail(alert, { timeoutMs: 8_000 });
      await sendMail(
        mailBajaDone({ to: row.email, code: row.code, periodEndMs: null, manual: true }),
        { timeoutMs: 8_000 },
      );
    }
    return {
      ok: true,
      code: row.code,
      status: 'en_proceso',
      periodEndMs: null,
      manual: true,
      alreadyConfirmed: false,
      message: 'Confirmamos tu identidad. La baja quedó en la cola manual y se procesa dentro de 24 h.',
    };
  }

  /* Lectura autoritativa antes de cancelar: nunca un preapproval ajeno. */
  const pre = await getPreapproval(preapprovalId, { timeoutMs: 8_000 });
  if (!pre.ok) {
    const updated = await markManual(service, row, `MP no respondió al leer ${preapprovalId}.`);
    if (updated) {
      const alert = ownerAlert(updated, 'MP no respondió: reintentar cancelación desde el panel.');
      if (alert) await sendMail(alert, { timeoutMs: 8_000 });
      await sendMail(
        mailBajaDone({ to: row.email, code: row.code, periodEndMs: null, manual: true }),
        { timeoutMs: 8_000 },
      );
    }
    return {
      ok: true,
      code: row.code,
      status: 'en_proceso',
      periodEndMs: null,
      manual: true,
      alreadyConfirmed: false,
      message: 'Confirmamos tu identidad. Mercado Pago no respondió: la baja queda en atención manual dentro de 24 h.',
    };
  }

  if (!pre.data.externalReference || pre.data.externalReference !== userId) {
    const updated = await markManual(service, row, 'Preapproval ajeno o sin external_reference: NO se canceló.');
    if (updated) {
      const alert = ownerAlert(updated, 'BLOQUEADO: el preapproval no pertenece a la cuenta.');
      if (alert) await sendMail(alert, { timeoutMs: 8_000 });
    }
    return {
      ok: false,
      reason: 'security',
      code: row.code,
      status: 'en_proceso',
      message: 'No pudimos validar la titularidad de la suscripción. No cancelamos nada; te contactamos para verificarlo.',
    };
  }

  if (pre.data.status !== 'cancelled') {
    const cancelled = await cancelPreapproval(preapprovalId, { timeoutMs: 12_000 });
    if (!cancelled.ok) {
      const updated = await markManual(service, row, `MP rechazó la cancelación: ${cancelled.message}`);
      if (updated) {
        const alert = ownerAlert(updated, 'MP rechazó la cancelación: hacerlo desde el panel.');
        if (alert) await sendMail(alert, { timeoutMs: 8_000 });
        await sendMail(
          mailBajaDone({ to: row.email, code: row.code, periodEndMs: null, manual: true }),
          { timeoutMs: 8_000 },
        );
      }
      return {
        ok: true,
        code: row.code,
        status: 'en_proceso',
        periodEndMs: null,
        manual: true,
        alreadyConfirmed: false,
        message: 'Confirmamos tu identidad. Mercado Pago no aceptó la cancelación automática: la baja queda en atención manual dentro de 24 h.',
      };
    }
  }

  /* Máquina R9: programada_cierre hasta period_end. Sin email duplicado. */
  const applied = await applyPreapproval(
    {
      id: preapprovalId,
      status: 'cancelled',
      externalReference: userId,
      payerEmail: row.email,
      nextPaymentDate: pre.data.nextPaymentDate,
      transactionAmount: pre.data.transactionAmount,
      currency: pre.data.currency,
    },
    { userId, source: 'legal', suppressEmail: true },
  );

  const parsedPeriodEnd = applied.periodEndMs
    ? applied.periodEndMs
    : sub?.period_end
      ? Date.parse(sub.period_end)
      : null;
  const periodEndMs =
    parsedPeriodEnd != null && Number.isFinite(parsedPeriodEnd) ? parsedPeriodEnd : null;
  const action = applied.action;
  const manual = action === 'error';
  const status: LegalRequestStatus = manual ? 'en_proceso' : 'resuelta';
  const nowIso = new Date().toISOString();

  const updated = await service
    .from('legal_requests')
    .update({
      status,
      confirmed_at: nowIso,
      responded_at: manual ? null : nowIso,
      resolution_note: manual
        ? noteForManual('Preapproval cancelado en MP; falta reconciliar el estado local (R9).')
        : 'Baja confirmada y preapproval cancelado (R9).',
    })
    .eq('id', row.id)
    .select('*')
    .maybeSingle<LegalRequestRow>();

  if (updated.error) {
    console.error('[legal confirm update]:', updated.error.message);
    return {
      ok: false,
      reason: 'db',
      code: row.code,
      message: 'La baja se canceló en Mercado Pago, pero no pudimos guardar la confirmación. Guardá tu código y escribinos.',
    };
  }

  const finalRow = updated.data ?? row;
  const alert = ownerAlert(
    finalRow,
    manual
      ? 'Preapproval cancelado en MP; apply R9 devolvió error (reconciliar).'
      : `Baja efectiva: preapproval ${preapprovalId} cancelado; periodo hasta ${periodEndMs ? new Date(periodEndMs).toISOString() : 'sin fecha'}.`,
  );
  if (alert) await sendMail(alert, { timeoutMs: 8_000 });

  await sendMail(
    mailBajaDone({
      to: row.email,
      code: row.code,
      periodEndMs,
      manual,
    }),
    { timeoutMs: 8_000 },
  );

  return {
    ok: true,
    code: row.code,
    status,
    periodEndMs,
    manual,
    alreadyConfirmed: false,
    message: manual
      ? 'Cancelamos el débito en Mercado Pago. La confirmación local queda en proceso; te contactamos si hace falta.'
      : periodEndMs
        ? `Baja confirmada. Tu acceso sigue hasta el ${new Date(periodEndMs).toLocaleDateString('es-AR')} (fin del ciclo ya pago).`
        : 'Baja confirmada. No se generan cobros posteriores.',
  };
}

/* -------------------------------------------------------------------------- */
/* Checkout: evidencia de aceptación (R13.7/R13.8)                             */
/* -------------------------------------------------------------------------- */

export type RecordAcceptancesResult = { ok: true } | { ok: false; detail: string };

export async function recordCheckoutAcceptances(input: {
  userId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  versions: { terms: string; privacy: string };
}): Promise<RecordAcceptancesResult> {
  if (!hasServiceCredentials()) return { ok: false, detail: 'service-no-configurado' };
  try {
    const service = createSupabaseServiceClient();
    const acceptedAt = new Date().toISOString();
    const rows = (['terms', 'privacy'] as const).map((document) => ({
      user_id: input.userId,
      email: input.email.trim().toLowerCase(),
      document,
      version: input.versions[document],
      context: 'checkout',
      accepted_at: acceptedAt,
      ip: input.ip,
      user_agent: input.userAgent,
    }));

    const { error } = await service.from('legal_acceptances').upsert(rows, {
      onConflict: 'user_id,document,version,context',
      ignoreDuplicates: true,
    });
    if (error) {
      console.error('[legal acceptances]:', error.message);
      return { ok: false, detail: error.message };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'error';
    console.error('[legal acceptances]:', detail);
    return { ok: false, detail };
  }
}
