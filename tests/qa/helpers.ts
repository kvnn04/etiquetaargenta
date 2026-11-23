import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { mpSignatureHex } from '@/lib/payments/webhook';
import {
  cancelPreapproval,
  createPreapproval,
  getPreapproval,
} from '@/lib/payments/mercadopago';

/* ============================================================================
 * Helpers del QA de integración — posición 13
 * ----------------------------------------------------------------------------
 * Las credenciales del `.env` son de un usuario TEST de MP, pero los pagos
 * semilla son `live_mode: true` (cobros reales): el QA NUNCA llama al endpoint
 * de refunds. El fold de reembolsos se prueba con eventos sintéticos; los
 * pulls, el checkout y los preapprovals sí son reales contra MP TEST.
 * ========================================================================== */

export const KHER_USER_ID = 'ced3fa8c-41b4-4068-89c6-4007076dba07';
export const KHER_EMAIL = 'kherrera@pioix.edu.ar';
export const KHER_PASSWORD = 'Admin1234';
export const OTHER_USER_ID = '12fa683e-f255-4dad-8c7e-ac382e5f3b79'; // kvnherrera@gmail.com
export const TEST_PAYER_EMAIL = 'test_user_532412195559500595@testuser.com';
export const TEST_PAYER_PASSWORD = 'Admin1234';

/** Pagos TEST ya existentes, creados en QA anteriores (MP TEST). */
export const SEED_PAYMENTS = {
  current: 187300201985,
  partial: 188362068082,
  past: 188361624478,
  rejected: 187299351371,
} as const;

export const QA_ORIGIN = (process.env.MP_PUBLIC_ORIGIN ?? 'http://127.0.0.1:3100').replace(
  /\/+$/,
  '',
);

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function mpFetch(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`https://api.mercadopago.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body };
}

/**
 * Los pagos semilla son `live_mode: true` (verificado 23-nov-2026): son cobros
 * REALES, aunque el usuario tenga tag `test_user`. Este QA NUNCA les pega al
 * endpoint de refunds. El fold de reembolsos se ejercita con eventos
 * sintéticos que replican el payload de MP; la app no emite refunds (los
 * inicia el titular desde Mercado Pago).
 */
export async function mpPayment(paymentId: number): Promise<Record<string, unknown>> {
  const { status, body } = await mpFetch(`/v1/payments/${paymentId}`);
  if (status !== 200) throw new Error(`MP payment ${paymentId} (${status}): ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

/** Crea un preapproval REAL en MP TEST con el payer de prueba. */
export async function createTestPreapproval(label: string): Promise<string> {
  const result = await createPreapproval({
    reason: `QA posición 13 — ${label}`,
    payerEmail: TEST_PAYER_EMAIL,
    externalReference: KHER_USER_ID,
    amount: 20000,
    backUrls: {
      success: `${QA_ORIGIN}/perfil?pago=success`,
      failure: `${QA_ORIGIN}/perfil?pago=failure`,
      pending: `${QA_ORIGIN}/perfil?pago=pending`,
    },
    notificationUrl: `${QA_ORIGIN}/api/webhooks/mercadopago`,
    startDateIso: new Date().toISOString(),
  });
  if (!result.ok) {
    throw new Error(`createPreapproval ${label} falló (${result.status}): ${result.message}`);
  }
  return result.data.id;
}

export async function cancelTestPreapproval(id: string): Promise<void> {
  const result = await cancelPreapproval(id);
  if (!result.ok) throw new Error(`cancelPreapproval ${id} falló (${result.status}): ${result.message}`);
}

export async function preapprovalStatus(id: string): Promise<string> {
  const result = await getPreapproval(id);
  if (!result.ok) throw new Error(`getPreapproval ${id} falló (${result.status}): ${result.message}`);
  return result.data.status;
}

/* -------------------------------------------------------------------------- */
/* Auth: cookie de sesión para pegarle al Next real                           */
/* -------------------------------------------------------------------------- */

export async function loginCookie(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Faltan URL/ANON_KEY de Supabase');

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const { name, value } of items) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  if (jar.size === 0) throw new Error(`login ${email}: cookie jar vacío`);
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

/* -------------------------------------------------------------------------- */
/* Next dev server (para UI + webhook + checkout por HTTP)                     */
/* -------------------------------------------------------------------------- */

export interface NextServer {
  proc: ChildProcess;
  logs: () => string;
  stop: () => Promise<void>;
}

export async function startNextServer(port: number): Promise<NextServer> {
  const nextBin = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');
  // MP rechaza `http://localhost:...` como back_url ("must be a valid URL",
  // verificado 23-nov-2026). Next dev usa `nextUrl.origin = localhost` por
  // defecto; bindear a 127.0.0.1 hace que el origin del checkout sea válido
  // para MP sin tocar el código de producción.
  const proc = spawn(process.execPath, [nextBin, 'dev', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // El .env de QA no configura soporte: el QA del contracargo necesita
      // ejercitar el CTA "Contactar soporte" sin inventar un canal real.
      NEXT_PUBLIC_SUPPORT_EMAIL:
        process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || 'soporte-qa@simuladormates.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = '';
  proc.stdout?.on('data', (chunk) => {
    buffer += chunk.toString();
  });
  proc.stderr?.on('data', (chunk) => {
    buffer += chunk.toString();
  });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) {
      throw new Error(`Next dev terminó (${proc.exitCode}). Logs:\n${buffer.slice(-5000)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/setup`, { redirect: 'manual' });
      if (res.status < 500) {
        return {
          proc,
          logs: () => buffer,
          stop: () => stopProcess(proc),
        };
      }
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Next dev no arrancó en 180 s. Logs:\n${buffer.slice(-5000)}`);
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode != null) return;
  if (process.platform === 'win32' && proc.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
    return;
  }
  proc.kill('SIGTERM');
}

/* -------------------------------------------------------------------------- */
/* Captura de Resend (no manda emails reales durante el QA)                   */
/* -------------------------------------------------------------------------- */

export interface CapturedEmail {
  to: string[];
  subject: string;
  html: string;
  idempotencyKey: string | null;
  at: number;
}

export interface ResendCapture {
  emails: CapturedEmail[];
  reset: () => void;
  restore: () => void;
}

export function captureResend(): ResendCapture {
  const realFetch = globalThis.fetch.bind(globalThis);
  const emails: CapturedEmail[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.resend.com/emails') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        to?: string[];
        subject?: string;
        html?: string;
      };
      const headers = new Headers(init?.headers);
      emails.push({
        to: body.to ?? [],
        subject: body.subject ?? '',
        html: body.html ?? '',
        idempotencyKey: headers.get('Idempotency-Key'),
        at: Date.now(),
      });
      return new Response(JSON.stringify({ id: `qa-mail-${emails.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  return {
    emails,
    reset: () => {
      emails.length = 0;
    },
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Webhook firmado (manifiesto oficial de MP)                                 */
/* -------------------------------------------------------------------------- */

export function signedWebhookHeaders(
  dataId: string,
  opts: { requestId?: string; ts?: string } = {},
): Record<string, string> {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) throw new Error('MP_WEBHOOK_SECRET ausente');
  const requestId = opts.requestId ?? `qa-${crypto.randomUUID()}`;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000).toString();
  const v1 = mpSignatureHex({ dataId, requestId, ts, secret });
  return {
    'Content-Type': 'application/json',
    'x-request-id': requestId,
    'x-signature': `ts=${ts},v1=${v1}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Lecturas de DB                                                             */
/* -------------------------------------------------------------------------- */

export async function readUser(service: SupabaseClient, userId: string) {
  const { data, error } = await service.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`readUser: ${error.message}`);
  return data as Record<string, unknown> | null;
}

export async function readSubscription(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`readSubscription: ${error.message}`);
  return data as Record<string, unknown> | null;
}

export async function readPayments(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });
  if (error) throw new Error(`readPayments: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function readAdjustments(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from('payment_adjustments')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: true });
  if (error) throw new Error(`readAdjustments: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}
