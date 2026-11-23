import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildLinkPayload, type LinkVariantId } from '@/lib/links/payload';
import { generateUniqueLinkId } from '@/lib/links/identity';
import { registerDecision, registerObservation } from '@/lib/links/response-service';
import { DAY_MS } from '@/lib/payments/core';
import {
  KHER_EMAIL,
  KHER_PASSWORD,
  KHER_USER_ID,
  QA_ORIGIN,
  captureResend,
  loginCookie,
  serviceClient,
  startNextServer,
  type NextServer,
  type ResendCapture,
} from './helpers';

/* ============================================================================
 * QA DE INTEGRACIÓN — POSICIÓN 14 (decisión y observaciones del cliente)
 * ----------------------------------------------------------------------------
 * Qué prueba DE VERDAD (sin mocks de DB):
 *   · migración 0010 aplicada: tabla, constraints, RLS y RPCs;
 *   · una decisión inmutable + doble escritura legacy;
 *   · rechazo con motivo obligatorio, 280 code points y normalización;
 *   · una observación sola, antes/después de aprobar, idempotente;
 *   · rechazo que reutiliza la observación y email real (capturado);
 *   · email fail-soft por HTTP (server sin credenciales Resend) + fallback;
 *   · WhatsApp disponible/ausente, href exacto y WHATSAPP_UNAVAILABLE;
 *   · legacy link_approvals ⇒ aprobado, sin decisión nueva, con observación;
 *   · vencido/borrado ⇒ 410/404 sin escrituras;
 *   · panel GET /api/links con decisión/observación/canales;
 *   · anon sin SELECT/INSERT ni EXECUTE de las RPCs;
 *   · escape HTML del email y ausencia de PII del cliente.
 *
 * Requiere Supabase TEST con `0010_link_responses.sql` aplicada a mano.
 * ========================================================================== */

const BASE_URL = QA_ORIGIN;
const WHATSAPP = '5491112345678';

interface ActionBody {
  ok?: boolean;
  error?: string;
  reason?: string;
  already?: boolean;
  legacy?: boolean;
  decision?: string | null;
  decisionVariantId?: string | null;
  decidedAt?: string | null;
  decisionChannel?: string | null;
  observation?: string | null;
  observedAt?: string | null;
  observationChannel?: string | null;
  emailSent?: boolean;
  emailError?: string;
  whatsappHref?: string;
}

interface ResponseRow {
  link_id: string;
  decision: string | null;
  decision_variant_id: string | null;
  decided_at: string | null;
  decision_channel: string | null;
  decision_email_sent_at: string | null;
  decision_email_error: string | null;
  observation: string | null;
  observed_at: string | null;
  observation_channel: string | null;
  observation_email_sent_at: string | null;
  observation_email_error: string | null;
}

let service: SupabaseClient;
let server: NextServer;
let capture: ResendCapture;
let cookie = '';
let projectId = '';
let versionCounter = 0;

async function seedLink(input: {
  whatsapp?: string | null;
  expiresAtMs?: number;
  variants?: LinkVariantId[];
} = {}): Promise<string> {
  const linkId = await generateUniqueLinkId(async (candidate) => {
    const hit = await service.from('links').select('link_id').eq('link_id', candidate).maybeSingle();
    if (hit.error) throw new Error(`linkId checker: ${hit.error.message}`);
    return Boolean(hit.data);
  });

  const now = Date.now();
  const expiresAtMs = input.expiresAtMs ?? now + 30 * DAY_MS;
  const payload = buildLinkPayload({
    linkId,
    nowMs: now,
    expiresMs: expiresAtMs,
    workshop: {
      name: 'Taller QA 14',
      logoUrl: null,
      whatsapp: input.whatsapp === undefined ? WHATSAPP : input.whatsapp,
      instagram: null,
    },
    mateConfig: {
      model: 'camionero',
      extDiameter: 123,
      intDiameter: 95,
      metal: 'alpaca',
      virolaColor: null,
      topFaceColor: null,
      cupMaterial: 'algarrobo',
      cupColor: null,
    },
    variants: (input.variants ?? ['A']).map((id) => ({
      id,
      label: `Opción ${id}`,
      scalePct: 100,
      rotationDeg: 0,
      mirror: false,
    })),
    assetUrl: 'https://example.test/qa-pos14.png',
  });

  const { error } = await service.from('links').insert({
    link_id: linkId,
    project_id: projectId,
    user_id: KHER_USER_ID,
    version: ++versionCounter,
    payload,
    expires_at: new Date(expiresAtMs).toISOString(),
    created_by_pro: true,
  });
  if (error) throw new Error(`seedLink ${linkId}: ${error.message}`);
  return linkId;
}

async function readResponse(linkId: string): Promise<ResponseRow | null> {
  const { data, error } = await service
    .from('link_responses')
    .select('*')
    .eq('link_id', linkId)
    .maybeSingle<ResponseRow>();
  if (error) throw new Error(`readResponse ${linkId}: ${error.message}`);
  return data;
}

async function readApprovals(linkId: string): Promise<Array<{ variant_id: string; approved_at: string }>> {
  const { data, error } = await service
    .from('link_approvals')
    .select('variant_id, approved_at')
    .eq('link_id', linkId);
  if (error) throw new Error(`readApprovals ${linkId}: ${error.message}`);
  return (data ?? []) as Array<{ variant_id: string; approved_at: string }>;
}

async function post(path: string, body: unknown): Promise<{ status: number; data: ActionBody | null }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: (await res.json().catch(() => null)) as ActionBody | null,
  };
}

async function page(linkId: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE_URL}/v/${linkId}`);
  return { status: res.status, html: await res.text() };
}

async function linksPanel(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${BASE_URL}/api/links?projectId=${projectId}`, {
    headers: { Cookie: cookie },
  });
  const data = (await res.json().catch(() => null)) as {
    versions?: Array<Record<string, unknown>>;
  } | null;
  return data?.versions ?? [];
}

function directDecision(
  linkId: string,
  decision: 'approved' | 'rejected',
  variantId: LinkVariantId,
  observation: string | null,
  channel: 'email' | 'whatsapp' | null,
) {
  return registerDecision({
    linkId,
    decision,
    variantId,
    observation,
    channel,
    userAgent: 'qa-posicion-14',
    origin: BASE_URL,
  });
}

function directObservation(linkId: string, message: string, channel: 'email' | 'whatsapp') {
  return registerObservation({
    linkId,
    message,
    channel,
    userAgent: 'qa-posicion-14',
    origin: BASE_URL,
  });
}

beforeAll(async () => {
  service = serviceClient();

  /* La migración se aplica a mano en Supabase TEST: si falta, el QA lo dice
   * con claridad en vez de fallar con PGRST205 más abajo. */
  const probe = await service.from('link_responses').select('link_id').limit(1);
  if (probe.error) {
    throw new Error(
      `Aplicá supabase/migrations/0010_link_responses.sql en Supabase TEST antes del QA: ${probe.error.message}`,
    );
  }

  const project = await service
    .from('projects')
    .insert({ user_id: KHER_USER_ID, title: 'QA posición 14 — respuestas', state: {} })
    .select('id')
    .single<{ id: string }>();
  if (project.error || !project.data) {
    throw new Error(`QA project: ${project.error?.message ?? 'sin id'}`);
  }
  projectId = project.data.id;

  /* El server de QA NO manda emails reales: las credenciales Resend quedan
   * vacías en el proceso hijo. El email real se prueba en proceso con capture. */
  server = await startNextServer(3100, { RESEND_API_KEY: '', EMAIL_FROM: '' });
  cookie = await loginCookie(KHER_EMAIL, KHER_PASSWORD);
  capture = captureResend();
});

afterAll(async () => {
  capture?.restore();
  await server?.stop();
  if (projectId) {
    const { error } = await service.from('projects').delete().eq('id', projectId);
    if (error) console.error('[QA pos 14 cleanup]:', error.message);
  }
});

describe('R14.1/R14.7 — una decisión, doble escritura legacy e inmutabilidad', () => {
  it('aprueba una vez, reintenta idempotente y bloquea variante/rechazo', async () => {
    const linkId = await seedLink({ variants: ['A', 'B'] });
    capture.reset();

    const first = await post(`/api/links/${linkId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({
      ok: true,
      decision: 'approved',
      decisionVariantId: 'A',
    });
    expect(first.data?.whatsappHref).toContain(`https://wa.me/${WHATSAPP}`);
    expect(first.data?.whatsappHref).toContain('text=');

    const row = await readResponse(linkId);
    expect(row).toMatchObject({
      decision: 'approved',
      decision_variant_id: 'A',
      decision_channel: null,
      observation: null,
    });
    expect(row?.decided_at).toBeTruthy();
    expect(await readApprovals(linkId)).toHaveLength(1);

    const retry = await post(`/api/links/${linkId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(retry.status).toBe(200);
    expect(retry.data?.already).toBe(true);
    expect(await readApprovals(linkId)).toHaveLength(1);

    const otherVariant = await post(`/api/links/${linkId}/decision`, {
      decision: 'approved',
      variantId: 'B',
    });
    expect(otherVariant.status).toBe(409);
    expect(otherVariant.data).toMatchObject({
      error: 'DECISION_TAKEN',
      decision: 'approved',
      decisionVariantId: 'A',
    });

    const rejected = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'Ya no quiero este diseño',
      channel: 'email',
    });
    expect(rejected.status).toBe(409);
    expect(rejected.data?.error).toBe('DECISION_TAKEN');

    expect((await readResponse(linkId))?.decision).toBe('approved');
    expect(capture.emails).toHaveLength(0); // aprobar no manda email (R6)

    const html = await page(linkId);
    expect(html.status).toBe(200);
    expect(html.html).toContain('APROBADO');
    expect(html.html).toContain('Contactar al taller por WhatsApp');
    expect(html.html).not.toContain('¡Aprobar este diseño!');
    expect(html.html).not.toContain('Rechazar diseño');
  });
});

describe('R14.3/R14.14 — rechazo con motivo obligatorio y 280 code points', () => {
  it('valida motivo, persiste una fila y no duplica el rechazo', async () => {
    const linkId = await seedLink();
    capture.reset();

    const withoutMotive = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      channel: 'email',
    });
    expect(withoutMotive.status).toBe(400);
    expect(withoutMotive.data).toMatchObject({
      error: 'BAD_REQUEST',
      reason: 'observation_required',
    });
    expect(await readResponse(linkId)).toBeNull();

    const blank = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: '   \n\t  ',
      channel: 'email',
    });
    expect(blank.status).toBe(400);
    expect(blank.data?.reason).toBe('observation');

    const tooLong = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'a'.repeat(281),
      channel: 'email',
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.data?.reason).toBe('observation');

    /* 280 code points reales: cada emoji simple son 2 unidades UTF-16. */
    const emoji = '🪵'.repeat(280);
    const accepted = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: emoji,
      channel: 'email',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.data).toMatchObject({
      decision: 'rejected',
      decisionVariantId: 'A',
      decisionChannel: 'email',
      observationChannel: 'email',
    });
    expect(accepted.data?.emailSent).toBe(false);
    expect(accepted.data?.emailError).toBe('env-no-configurado');
    expect(accepted.data?.whatsappHref).toContain(`https://wa.me/${WHATSAPP}`);

    const row = await readResponse(linkId);
    expect(row?.decision).toBe('rejected');
    expect(row?.observation).toBe(emoji);
    expect([...(row?.observation ?? '')].length).toBe(280);
    expect(row?.decision_email_error).toBe('env-no-configurado');
    expect(row?.observation_email_error).toBe('env-no-configurado');
    expect(await readApprovals(linkId)).toHaveLength(0);

    const retry = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: emoji,
      channel: 'email',
    });
    expect(retry.status).toBe(200);
    expect(retry.data?.already).toBe(true);
    expect((await readResponse(linkId))?.observation).toBe(emoji);

    const different = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'Otro motivo',
      channel: 'email',
    });
    expect(different.status).toBe(409);
    expect(different.data).toMatchObject({
      error: 'OBSERVATION_TAKEN',
      observation: emoji,
    });

    const approve = await post(`/api/links/${linkId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(approve.status).toBe(409);
    expect(approve.data?.error).toBe('DECISION_TAKEN');

    const html = await page(linkId);
    expect(html.html).toContain('RECHAZADO');
    expect(html.html).toContain(emoji);
    expect(html.html).not.toContain('¡Aprobar este diseño!');
    expect(capture.emails).toHaveLength(0); // el server de QA no tiene Resend
  });
});

describe('R14.4 — observación sola, una vez y antes/después de aprobar', () => {
  it('normaliza, persiste sin decisión, es idempotente y sobrevive a la aprobación', async () => {
    const linkId = await seedLink();
    capture.reset();

    const first = await post(`/api/links/${linkId}/observations`, {
      message: '  Quiero cambiar\n\n\nel grabado  ',
      channel: 'whatsapp',
    });
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({
      decision: null,
      observation: 'Quiero cambiar\n\nel grabado',
      observationChannel: 'whatsapp',
    });
    expect(first.data?.whatsappHref).toContain(`https://wa.me/${WHATSAPP}`);
    expect(first.data?.whatsappHref).toContain(
      encodeURIComponent('Quiero cambiar\n\nel grabado'),
    );

    const row = await readResponse(linkId);
    expect(row?.decision).toBeNull();
    expect(row?.observation).toBe('Quiero cambiar\n\nel grabado');
    expect(row?.observation_channel).toBe('whatsapp');
    expect(row?.observed_at).toBeTruthy();

    const retry = await post(`/api/links/${linkId}/observations`, {
      message: 'Quiero cambiar\n\nel grabado',
      channel: 'whatsapp',
    });
    expect(retry.status).toBe(200);
    expect(retry.data?.already).toBe(true);

    const different = await post(`/api/links/${linkId}/observations`, {
      message: 'Otro texto',
      channel: 'whatsapp',
    });
    expect(different.status).toBe(409);
    expect(different.data?.error).toBe('OBSERVATION_TAKEN');

    const approve = await post(`/api/links/${linkId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(approve.status).toBe(200);
    expect(await readResponse(linkId)).toMatchObject({
      decision: 'approved',
      observation: 'Quiero cambiar\n\nel grabado',
    });

    const after = await post(`/api/links/${linkId}/observations`, {
      message: 'Quiero cambiar\n\nel grabado',
      channel: 'whatsapp',
    });
    expect(after.status).toBe(200);
    expect(after.data?.already).toBe(true);

    const html = await page(linkId);
    expect(html.html).toContain('TU OBSERVACIÓN');
    expect(html.html).not.toContain('¿Querés dejar una observación?');
    expect(capture.emails).toHaveLength(0);
  });
});

describe('R14.3/R14.4 — rechazo que reutiliza la observación + email real', () => {
  it('envía el aviso de rechazo una sola vez y conserva ambos canales', async () => {
    const linkId = await seedLink();
    const observation = await directObservation(linkId, 'Cambiar el color', 'whatsapp');
    expect(observation.status).toBe(200);
    capture.reset();

    const decision = await directDecision(linkId, 'rejected', 'A', null, 'email');
    expect(decision.status).toBe(200);
    const body = decision.body as ActionBody;
    expect(body).toMatchObject({
      ok: true,
      decision: 'rejected',
      decisionVariantId: 'A',
      decisionChannel: 'email',
      observation: 'Cambiar el color',
      observationChannel: 'whatsapp',
      emailSent: true,
    });
    expect(body.whatsappHref).toBeUndefined();

    const row = await readResponse(linkId);
    expect(row).toMatchObject({
      decision: 'rejected',
      decision_channel: 'email',
      observation: 'Cambiar el color',
      observation_channel: 'whatsapp',
    });
    expect(row?.decision_email_sent_at).toBeTruthy();
    expect(row?.observation_email_sent_at).toBeNull();
    expect(await readApprovals(linkId)).toHaveLength(0);

    expect(capture.emails).toHaveLength(1);
    const email = capture.emails[0];
    expect(email.to).toContain(KHER_EMAIL);
    expect(email.subject).toContain('rechazó');
    expect(email.html).toContain('Cambiar el color');
    expect(email.html).toContain('Aviso de rechazo por:</strong> Email');
    expect(email.html).toContain('Observación enviada por:</strong> WhatsApp');

    const retry = await directDecision(linkId, 'rejected', 'A', null, 'email');
    expect(retry.status).toBe(200);
    expect((retry.body as ActionBody).already).toBe(true);
    expect(capture.emails).toHaveLength(1);
    expect((await readResponse(linkId))?.decision_email_sent_at).toBe(
      row?.decision_email_sent_at,
    );
  });
});

describe('R14.5/R14.6 — email de observación posterior a la aprobación', () => {
  it('envía el aviso con el contexto de la decisión y no lo repite', async () => {
    const linkId = await seedLink();
    const approved = await directDecision(linkId, 'approved', 'A', null, null);
    expect(approved.status).toBe(200);
    capture.reset();

    const observation = await directObservation(linkId, 'Más grande', 'email');
    expect(observation.status).toBe(200);
    expect(observation.body as ActionBody).toMatchObject({
      ok: true,
      decision: 'approved',
      observation: 'Más grande',
      observationChannel: 'email',
      emailSent: true,
    });

    const row = await readResponse(linkId);
    expect(row?.observation_email_sent_at).toBeTruthy();
    expect(row?.observation_email_error).toBeNull();

    expect(capture.emails).toHaveLength(1);
    const email = capture.emails[0];
    expect(email.subject).toBe(`Nueva observación de tu cliente — /v/${linkId}`);
    expect(email.html).toContain('aprobada');
    expect(email.html).toContain('Más grande');

    const retry = await directObservation(linkId, 'Más grande', 'email');
    expect(retry.status).toBe(200);
    expect((retry.body as ActionBody).already).toBe(true);
    expect(capture.emails).toHaveLength(1);
  });
});

describe('R14.5/R14.6 — WhatsApp ausente y email fail-soft', () => {
  it('sin número ⇒ WHATSAPP_UNAVAILABLE y cero filas', async () => {
    const linkId = await seedLink({ whatsapp: null });
    capture.reset();

    const rejected = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'Motivo',
      channel: 'whatsapp',
    });
    expect(rejected.status).toBe(400);
    expect(rejected.data?.error).toBe('WHATSAPP_UNAVAILABLE');
    expect(await readResponse(linkId)).toBeNull();

    const observation = await post(`/api/links/${linkId}/observations`, {
      message: 'Motivo',
      channel: 'whatsapp',
    });
    expect(observation.status).toBe(400);
    expect(observation.data?.error).toBe('WHATSAPP_UNAVAILABLE');
    expect(await readResponse(linkId)).toBeNull();

    const html = await page(linkId);
    expect(html.html).not.toContain('Enviar por WhatsApp');
    expect(html.html).not.toContain('Rechazar y enviar por WhatsApp');
  });

  it('email sin credenciales ⇒ fila persistida + fallback WhatsApp', async () => {
    const linkId = await seedLink();
    capture.reset();

    const first = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'Probar el fallback',
      channel: 'email',
    });
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({
      decision: 'rejected',
      emailSent: false,
      emailError: 'env-no-configurado',
    });
    expect(first.data?.whatsappHref).toContain(`https://wa.me/${WHATSAPP}`);
    expect(first.data?.whatsappHref).toContain(
      encodeURIComponent('Probar el fallback'),
    );

    const row = await readResponse(linkId);
    expect(row?.decision).toBe('rejected');
    expect(row?.decision_email_error).toBe('env-no-configurado');
    expect(row?.observation_email_error).toBe('env-no-configurado');

    const retry = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'Probar el fallback',
      channel: 'email',
    });
    expect(retry.status).toBe(200);
    expect(retry.data).toMatchObject({
      already: true,
      emailSent: false,
      emailError: 'env-no-configurado',
    });
    expect(capture.emails).toHaveLength(0);
  });
});

describe('R14.13 — compatibilidad legacy con link_approvals', () => {
  it('bloquea la decisión, permite una observación y el panel conserva el badge', async () => {
    const linkId = await seedLink({ variants: ['A', 'B'] });
    const legacy = await service.from('link_approvals').insert({
      link_id: linkId,
      variant_id: 'B',
      approved_at: new Date().toISOString(),
      user_agent: 'legacy-qa',
    });
    if (legacy.error) throw new Error(`legacy approval: ${legacy.error.message}`);

    const decision = await post(`/api/links/${linkId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(decision.status).toBe(409);
    expect(decision.data).toMatchObject({
      error: 'DECISION_TAKEN',
      legacy: true,
      decision: 'approved',
      decisionVariantId: 'B',
    });

    const observation = await post(`/api/links/${linkId}/observations`, {
      message: 'Observación legacy',
      channel: 'whatsapp',
    });
    expect(observation.status).toBe(200);

    const row = await readResponse(linkId);
    expect(row?.decision).toBeNull();
    expect(row?.observation).toBe('Observación legacy');
    expect(await readApprovals(linkId)).toHaveLength(1);

    const html = await page(linkId);
    expect(html.html).toContain('Aprobación registrada previamente');
    expect(html.html).toContain('APROBADO');
    expect(html.html).toContain('TU OBSERVACIÓN');
    expect(html.html).not.toContain('¡Aprobar este diseño!');

    const panel = (await linksPanel()).find((version) => version.linkId === linkId);
    expect(panel).toMatchObject({
      decision: null,
      approvalsCount: 1,
      lastApprovedVariant: 'B',
      observation: 'Observación legacy',
      observationChannel: 'whatsapp',
    });
  });
});

describe('R14.9 — vigencia y existencia', () => {
  it('vencido ⇒ 410 y borrado ⇒ 404, sin escrituras', async () => {
    const expiredId = await seedLink({ expiresAtMs: Date.now() - 60_000 });
    capture.reset();

    const decision = await post(`/api/links/${expiredId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(decision.status).toBe(410);
    expect(decision.data?.error).toBe('LINK_EXPIRED');

    const observation = await post(`/api/links/${expiredId}/observations`, {
      message: 'Hola',
      channel: 'whatsapp',
    });
    expect(observation.status).toBe(410);
    expect(observation.data?.error).toBe('LINK_EXPIRED');
    expect(await readResponse(expiredId)).toBeNull();

    const expiredHtml = await page(expiredId);
    expect(expiredHtml.status).toBe(200);
    expect(expiredHtml.html).toContain('Esta propuesta finalizó su vigencia');
    expect(expiredHtml.html).not.toContain('¡Aprobar este diseño!');

    const deletedId = await seedLink();
    const deleted = await service.from('links').delete().eq('link_id', deletedId);
    if (deleted.error) throw new Error(`delete link: ${deleted.error.message}`);

    const deletedDecision = await post(`/api/links/${deletedId}/decision`, {
      decision: 'approved',
      variantId: 'A',
    });
    expect(deletedDecision.status).toBe(404);
    expect(deletedDecision.data?.error).toBe('NOT_FOUND');

    const deletedObservation = await post(`/api/links/${deletedId}/observations`, {
      message: 'Hola',
      channel: 'whatsapp',
    });
    expect(deletedObservation.status).toBe(404);
    expect(deletedObservation.data?.error).toBe('NOT_FOUND');
  });
});

describe('R14.10 — panel: decisión, observación, fecha y canales', () => {
  it('GET /api/links devuelve la respuesta completa del link rechazado', async () => {
    const linkId = await seedLink();
    const decision = await post(`/api/links/${linkId}/decision`, {
      decision: 'rejected',
      variantId: 'A',
      observation: 'Panel QA',
      channel: 'email',
    });
    expect(decision.status).toBe(200);

    const panel = (await linksPanel()).find((version) => version.linkId === linkId);
    expect(panel).toMatchObject({
      decision: 'rejected',
      decisionVariantId: 'A',
      observation: 'Panel QA',
      observationChannel: 'email',
      decisionChannel: 'email',
      approvalsCount: 0,
      decisionEmailError: 'env-no-configurado',
      observationEmailError: 'env-no-configurado',
    });
    expect(typeof panel?.decidedAt).toBe('string');
    expect(typeof panel?.observedAt).toBe('string');
  });
});

describe('R14.11/R14.14 — seguridad y escape', () => {
  it('anon no lee/escribe link_responses ni ejecuta las RPCs', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('Faltan URL/ANON_KEY de Supabase');
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const read = await anon.from('link_responses').select('link_id').limit(1);
    expect(read.error).not.toBeNull();
    expect(read.error?.message ?? '').toMatch(
      /permission denied|not allowed|row-level security|JWT/i,
    );

    const insert = await anon.from('link_responses').insert({ link_id: 'zzzzzz' });
    expect(insert.error).not.toBeNull();

    const rpc = await anon.rpc('link_register_decision', {
      p_link_id: 'zzzzzz',
      p_decision: 'approved',
      p_variant_id: 'A',
    });
    expect(rpc.error).not.toBeNull();
    expect(rpc.error?.message ?? '').toMatch(/permission denied|not allowed|function|JWT/i);
  });

  it('el email escapa el HTML y no incluye datos del cliente', async () => {
    const linkId = await seedLink();
    capture.reset();

    const result = await directObservation(linkId, '<script>alert(1)</script>', 'email');
    expect(result.status).toBe(200);
    expect((result.body as ActionBody).emailSent).toBe(true);
    expect(capture.emails).toHaveLength(1);

    const email = capture.emails[0];
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toMatch(/cliente@/i);
    expect(email.html).not.toMatch(/\+54/);
  });
});
