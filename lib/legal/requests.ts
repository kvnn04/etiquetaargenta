/* ============================================================================
 * NÚCLEO LEGAL — posición 12 (spec_paginas_legales.md §3 + §6)
 * ----------------------------------------------------------------------------
 * Módulo PURO (sin DB, sin fetch, sin envs) con TODA la lógica que se puede
 * testear sin red:
 *   · códigos únicos legibles: ARR/BAJA/PRIV-YYYYMMDD-XXXX (R13.4);
 *   · validación de formularios públicos y ventana de 10 días corridos (R13.5);
 *   · rate limit 1/email/5 min + 5/IP/hora (hash) (§6);
 *   · token de baja: 64 hex, SHA-256, TTL 24 h, un solo uso (R13.6);
 *   · gate de aceptación versionada del checkout (R13.7/R13.13);
 *   · escape de HTML/XSS y honeypot/origen (§6).
 *
 * `node:crypto` solo para SHA-256: este módulo NUNCA se importa desde el
 * cliente (los formularios hablan por fetch con las API Routes).
 * ============================================================================ */

import { createHash } from 'node:crypto';
import { arDateParts, DAY_MS } from '@/lib/payments/core';

/* -------------------------------------------------------------------------- */
/* Tipos y constantes                                                          */
/* -------------------------------------------------------------------------- */

export const LEGAL_REQUEST_KINDS = ['arrepentimiento', 'baja', 'privacidad'] as const;
export type LegalRequestKind = (typeof LEGAL_REQUEST_KINDS)[number];

export const LEGAL_REQUEST_STATUSES = [
  'recibida',
  'en_proceso',
  'resuelta',
  'rechazada',
] as const;
export type LegalRequestStatus = (typeof LEGAL_REQUEST_STATUSES)[number];

export const LEGAL_DATA_RIGHTS = [
  'acceso',
  'rectificacion',
  'supresion',
  'oposicion',
] as const;
export type LegalDataRight = (typeof LEGAL_DATA_RIGHTS)[number];

export const LEGAL_KIND_LABEL: Record<LegalRequestKind, string> = {
  arrepentimiento: 'Arrepentimiento',
  baja: 'Baja de servicio',
  privacidad: 'Derechos de datos',
};

export const LEGAL_STATUS_LABEL: Record<LegalRequestStatus, string> = {
  recibida: 'Recibida',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
  rechazada: 'Rechazada',
};

export const LEGAL_DATA_RIGHT_LABEL: Record<LegalDataRight, string> = {
  acceso: 'Acceso',
  rectificacion: 'Rectificación',
  supresion: 'Supresión',
  oposicion: 'Oposición',
};

/** Plazos publicados (R13.4/R13.10/R13.14). */
export const LEGAL_RESPONSE_HOURS = 24;
export const LEGAL_DATA_BUSINESS_DAYS = 5;
export const LEGAL_WITHDRAWAL_DAYS = 10;
export const LEGAL_BAJA_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const LEGAL_EMAIL_RATE_WINDOW_MS = 5 * 60 * 1000;
export const LEGAL_IP_RATE_WINDOW_MS = 60 * 60 * 1000;
export const LEGAL_IP_RATE_MAX = 5;

export const LEGAL_MAX_NAME = 120;
export const LEGAL_MAX_MESSAGE = 2_000;
export const LEGAL_MAX_EMAIL = 254;

/* -------------------------------------------------------------------------- */
/* Códigos (R13.4): sin caracteres ambiguos, sin datos personales              */
/* -------------------------------------------------------------------------- */

export const LEGAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LEGAL_CODE_LENGTH = 4;

const LEGAL_CODE_SUFFIX_RE = new RegExp(`^[${LEGAL_CODE_ALPHABET}]{${LEGAL_CODE_LENGTH}}$`);
const LEGAL_CODE_RE = /^(ARR|BAJA|PRIV)-\d{8}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

export function legalCodePrefix(kind: LegalRequestKind): 'ARR' | 'BAJA' | 'PRIV' {
  if (kind === 'arrepentimiento') return 'ARR';
  if (kind === 'baja') return 'BAJA';
  return 'PRIV';
}

/** YYYYMMDD en la zona canónica AR (misma tz que el ciclo de pagos). */
export function legalCodeDate(ms: number): string {
  const p = arDateParts(ms);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/**
 * Genera el sufijo de 4 caracteres. `pickIndex` inyectable (randomInt en el
 * server, determinista en tests) para que el código sea reproducible.
 */
export function generateLegalCodeSuffix(pickIndex: (maxExclusive: number) => number): string {
  let suffix = '';
  for (let i = 0; i < LEGAL_CODE_LENGTH; i += 1) {
    const idx = Math.abs(Math.trunc(pickIndex(LEGAL_CODE_ALPHABET.length))) % LEGAL_CODE_ALPHABET.length;
    suffix += LEGAL_CODE_ALPHABET[idx];
  }
  return suffix;
}

export function generateLegalCode(
  kind: LegalRequestKind,
  nowMs: number,
  pickIndex: (maxExclusive: number) => number,
): string {
  return `${legalCodePrefix(kind)}-${legalCodeDate(nowMs)}-${generateLegalCodeSuffix(pickIndex)}`;
}

export function isLegalCode(value: unknown): value is string {
  return typeof value === 'string' && LEGAL_CODE_RE.test(value.trim());
}

/* -------------------------------------------------------------------------- */
/* Normalización y validación                                                  */
/* -------------------------------------------------------------------------- */

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 5 || email.length > LEGAL_MAX_EMAIL) return null;
  // Formato razonable: una @, dominio con punto y TLD de 2+; sin espacios.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function normalizeFullName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > LEGAL_MAX_NAME) return null;
  // Sin caracteres de control (incluye saltos de línea): un nombre no los lleva.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed.replace(/\s+/g, ' ');
}

/** `YYYY-MM-DD` → medianoche AR (03:00 UTC). `null` si no es fecha real. */
export function parseLegalDate(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day, 3); // 00:00 AR = 03:00 UTC
  const check = arDateParts(ms);
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return ms;
}

/** Medianoche AR del día de `nowMs` (03:00 UTC). */
export function legalTodayStartMs(nowMs: number): number {
  const p = arDateParts(nowMs);
  return Date.UTC(p.year, p.month - 1, p.day, 3);
}

/**
 * R13.5: 10 días CORRIDOS desde la celebración/entrega, contados en calendario
 * argentino. El día de la compra es el día 0; el día 10 todavía está dentro.
 */
export function isWithinWithdrawalWindow(purchaseMs: number, nowMs: number): boolean {
  const days = Math.round((legalTodayStartMs(nowMs) - legalTodayStartMs(purchaseMs)) / DAY_MS);
  return days >= 0 && days <= LEGAL_WITHDRAWAL_DAYS;
}

export type LegalValidation<T> =
  | { ok: true; value: T }
  | { ok: false; fields: Record<string, string> };

export interface ValidatedWithdrawal {
  fullName: string;
  email: string;
  purchaseDateIso: string;
  purchaseDateMs: number;
  paymentId: string | null;
  message: string | null;
  withinWindow: boolean;
}

export interface ValidatedBaja {
  email: string;
  paymentId: string | null;
  preapprovalId: string | null;
  message: string | null;
}

export interface ValidatedPrivacy {
  email: string;
  dataRight: LegalDataRight;
  message: string;
}

function normalizePaymentId(raw: unknown): { value: string | null; error?: string } {
  if (raw == null || raw === '') return { value: null };
  const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,18}$/.test(value)) {
    return { value: null, error: 'El identificador de pago debe contener solo números.' };
  }
  return { value };
}

function normalizePreapprovalId(raw: unknown): { value: string | null; error?: string } {
  if (raw == null || raw === '') return { value: null };
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) {
    return { value: null, error: 'El identificador de la suscripción no es válido.' };
  }
  return { value };
}

function normalizeMessage(raw: unknown): { value: string | null; error?: string } {
  if (raw == null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { value: null, error: 'El motivo no es válido.' };
  const value = raw.trim();
  if (value.length > LEGAL_MAX_MESSAGE) {
    return { value: null, error: `El texto no puede superar los ${LEGAL_MAX_MESSAGE} caracteres.` };
  }
  return { value: value || null };
}

export function validateWithdrawal(raw: unknown, nowMs: number): LegalValidation<ValidatedWithdrawal> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const fullName = normalizeFullName(input.fullName);
  if (!fullName) fields.fullName = 'Ingresá tu nombre y apellido (2 a 120 caracteres).';

  const email = normalizeEmail(input.email);
  if (!email) fields.email = 'Ingresá un email válido.';

  const purchaseDateMs = parseLegalDate(input.purchaseDate);
  if (purchaseDateMs == null) {
    fields.purchaseDate = 'Ingresá una fecha de compra válida (AAAA-MM-DD).';
  } else if (purchaseDateMs > legalTodayStartMs(nowMs)) {
    fields.purchaseDate = 'La fecha de compra no puede ser futura.';
  }

  const payment = normalizePaymentId(input.paymentId);
  if (payment.error) fields.paymentId = payment.error;

  const message = normalizeMessage(input.message);
  if (message.error) fields.message = message.error;

  if (input.declaration !== true) {
    fields.declaration = 'Tenés que declarar que la solicitud se hace dentro del plazo legal.';
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      fullName: fullName!,
      email: email!,
      purchaseDateIso: input.purchaseDate as string,
      purchaseDateMs: purchaseDateMs!,
      paymentId: payment.value,
      message: message.value,
      withinWindow: isWithinWithdrawalWindow(purchaseDateMs!, nowMs),
    },
  };
}

export function validateBaja(raw: unknown): LegalValidation<ValidatedBaja> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const email = normalizeEmail(input.email);
  if (!email) fields.email = 'Ingresá el email con el que contrataste el servicio.';

  const payment = normalizePaymentId(input.paymentId);
  if (payment.error) fields.paymentId = payment.error;

  const preapproval = normalizePreapprovalId(input.preapprovalId);
  if (preapproval.error) fields.preapprovalId = preapproval.error;

  const message = normalizeMessage(input.message);
  if (message.error) fields.message = message.error;

  if (input.confirmation !== true) {
    fields.confirmation = 'Tenés que confirmar que querés dar de baja el servicio.';
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      email: email!,
      paymentId: payment.value,
      preapprovalId: preapproval.value,
      message: message.value,
    },
  };
}

export function validatePrivacy(raw: unknown): LegalValidation<ValidatedPrivacy> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const email = normalizeEmail(input.email);
  if (!email) fields.email = 'Ingresá un email válido.';

  const dataRight = typeof input.dataRight === 'string' ? input.dataRight : '';
  if (!LEGAL_DATA_RIGHTS.includes(dataRight as LegalDataRight)) {
    fields.dataRight = 'Elegí el derecho que querés ejercer.';
  }

  const message = normalizeMessage(input.message);
  if (!message.value || message.error) {
    fields.message = message.error ?? 'Contanos brevemente qué necesitás (máximo 2.000 caracteres).';
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      email: email!,
      dataRight: dataRight as LegalDataRight,
      message: message.value!,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Honeypot, origen y rate limit (§6)                                          */
/* -------------------------------------------------------------------------- */

/** Campo invisible: si viene con contenido, es un bot. */
export function isHoneypotTripped(raw: unknown, field = 'website'): boolean {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const value = input[field];
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Valida Origin/Referer cuando el navegador los manda. Un cliente no-browser
 * (curl/health check) sin ambos headers se acepta: la barrera real contra abuso
 * es honeypot + rate limit; el formulario no usa cookies de sesión (no hay CSRF
 * de sesión). Un Origin/Referer PRESENTE y ajeno se rechaza.
 */
export function isReasonableOrigin(input: {
  origin: string | null;
  referer: string | null;
  expectedOrigin: string;
}): boolean {
  const expected = input.expectedOrigin.replace(/\/+$/, '');
  if (input.origin) {
    if (input.origin === 'null') return false;
    try {
      return new URL(input.origin).origin === expected;
    } catch {
      return false;
    }
  }
  if (input.referer) {
    try {
      return new URL(input.referer).origin === expected;
    } catch {
      return false;
    }
  }
  return true;
}

export interface LegalRateLimitInput {
  lastEmailAtMs: number | null;
  /** Timestamps de las solicitudes de la IP, ascendentes (máx. 5). */
  ipTimestampsMs: readonly number[];
  nowMs: number;
}

export interface LegalRateLimitResult {
  allowed: boolean;
  reason?: 'email' | 'ip';
  retryAfterSeconds: number;
}

/** 1 solicitud/email cada 5 min y 5/IP por hora (§6) — sin revelar cuentas. */
export function legalRateLimit(input: LegalRateLimitInput): LegalRateLimitResult {
  if (input.lastEmailAtMs != null) {
    const elapsed = input.nowMs - input.lastEmailAtMs;
    if (elapsed >= 0 && elapsed < LEGAL_EMAIL_RATE_WINDOW_MS) {
      return {
        allowed: false,
        reason: 'email',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((LEGAL_EMAIL_RATE_WINDOW_MS - elapsed) / 1000),
        ),
      };
    }
  }

  if (input.ipTimestampsMs.length >= LEGAL_IP_RATE_MAX) {
    const oldest = input.ipTimestampsMs[0] ?? input.nowMs;
    const elapsed = input.nowMs - oldest;
    return {
      allowed: false,
      reason: 'ip',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((LEGAL_IP_RATE_WINDOW_MS - elapsed) / 1000),
      ),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/* -------------------------------------------------------------------------- */
/* Token de baja (R13.6)                                                       */
/* -------------------------------------------------------------------------- */

export const LEGAL_TOKEN_BYTES = 32;
export const LEGAL_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** 32 bytes → 64 hex; el token crudo solo viaja en el email. */
export function generateLegalToken(bytes: Uint8Array): string {
  if (bytes.length < LEGAL_TOKEN_BYTES) {
    throw new Error('LEGAL_TOKEN_TOO_SHORT');
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isLegalToken(value: unknown): value is string {
  return typeof value === 'string' && LEGAL_TOKEN_PATTERN.test(value.trim());
}

export function hashLegalToken(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

export function legalTokenExpiresAt(nowMs: number): number {
  return nowMs + LEGAL_BAJA_TOKEN_TTL_MS;
}

export function isLegalTokenExpired(expiresAtMs: number | null, nowMs: number): boolean {
  return expiresAtMs == null || nowMs >= expiresAtMs;
}

/* -------------------------------------------------------------------------- */
/* Checkout (R13.7/R13.13)                                                     */
/* -------------------------------------------------------------------------- */

export type CheckoutLegalGate =
  | { ok: true }
  | { ok: false; error: 'LEGAL_NOT_ACCEPTED' | 'LEGAL_VERSION_CHANGED' };

export function checkCheckoutAcceptance(
  raw: unknown,
  expected: { terms: string; privacy: string },
): CheckoutLegalGate {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (input.legalAccepted !== true) return { ok: false, error: 'LEGAL_NOT_ACCEPTED' };
  if (
    typeof input.termsVersion !== 'string' ||
    typeof input.privacyVersion !== 'string' ||
    input.termsVersion !== expected.terms ||
    input.privacyVersion !== expected.privacy
  ) {
    return { ok: false, error: 'LEGAL_VERSION_CHANGED' };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Presentación segura                                                         */
/* -------------------------------------------------------------------------- */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeHtmlMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

/** `kevin@taller.com` → `k***n@taller.com` (nunca revela el email completo). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}
