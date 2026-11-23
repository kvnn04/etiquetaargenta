import { NextResponse, type NextRequest } from 'next/server';
import { canonicalizeLinkId } from '@/lib/links/identity';
import { isLinkVariantId } from '@/lib/links/payload';
import {
  isLinkChannel,
  isLinkDecision,
  normalizeObservation,
  observationLength,
  type LinkChannel,
} from '@/lib/links/responses';
import { registerDecision } from '@/lib/links/response-service';

/* ============================================================================
 * POST /api/links/[linkId]/decision — DECISIÓN DEL CLIENTE (posición 14)
 * ÚNICA FUENTE: spec_decision_y_observaciones_del_cliente.md §6.1 + R14
 * ----------------------------------------------------------------------------
 * PÚBLICA SIN SESIÓN (el link es la credencial). La DB es la última palabra:
 * `link_register_decision` valida existencia, vigencia, variante y la regla
 * de UNA decisión inmutable por link (R14.1/R14.2/R14.13).
 *
 * `approved`: no acepta observación ni canal (la observación va por
 * `/observations`, R14.4). `rejected`: exige canal y un motivo 1..280 — nuevo
 * o el ya observado (R14.3/R14.4). El email/WhatsApp se dispara DESPUÉS de
 * guardar: cerrar WhatsApp no pierde el texto (R14.6).
 * ============================================================================ */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const { linkId: rawLinkId } = await params;
  const linkId = canonicalizeLinkId(rawLinkId);
  if (!linkId) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'link_id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isLinkDecision(body.decision)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'decision' }, { status: 400 });
  }
  if (!isLinkVariantId(body.variantId)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'variant_id' }, { status: 400 });
  }

  const decision = body.decision;
  const variantId = body.variantId;

  /* Observación: solo en rechazo. Se normaliza ACÁ para que la comparación
   * idempotente contra la DB use exactamente el mismo texto (R14.14). */
  let observation: string | null = null;
  if (body.observation !== undefined && body.observation !== null) {
    if (decision === 'approved') {
      return NextResponse.json(
        { error: 'BAD_REQUEST', reason: 'observation_not_allowed' },
        { status: 400 },
      );
    }
    const normalized = normalizeObservation(body.observation);
    if (!normalized.ok) {
      return NextResponse.json({ error: 'BAD_REQUEST', reason: 'observation' }, { status: 400 });
    }
    observation = normalized.text;
  }

  let channel: LinkChannel | null = null;
  if (body.channel !== undefined && body.channel !== null) {
    if (!isLinkChannel(body.channel)) {
      return NextResponse.json({ error: 'BAD_REQUEST', reason: 'channel' }, { status: 400 });
    }
    channel = body.channel;
  }
  if (decision === 'approved' && channel !== null) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'channel' }, { status: 400 });
  }
  if (decision === 'rejected' && channel === null) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'channel' }, { status: 400 });
  }

  const result = await registerDecision({
    linkId,
    decision,
    variantId,
    observation,
    channel,
    userAgent: request.headers.get('user-agent'),
    origin: request.nextUrl.origin,
  });

  if (result.status === 200) {
    console.log(
      '[link decision QA registro]',
      JSON.stringify({
        artifact: 'decision',
        linkId,
        decision,
        variantId,
        channel,
        observationLength: observation ? observationLength(observation) : null,
        at: new Date().toISOString(),
      }),
    );
  }

  return NextResponse.json(result.body, { status: result.status });
}
