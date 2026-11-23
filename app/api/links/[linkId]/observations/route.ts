import { NextResponse, type NextRequest } from 'next/server';
import { canonicalizeLinkId } from '@/lib/links/identity';
import {
  isLinkChannel,
  normalizeObservation,
  observationLength,
} from '@/lib/links/responses';
import { registerObservation } from '@/lib/links/response-service';

/* ============================================================================
 * POST /api/links/[linkId]/observations — OBSERVACIÓN DEL CLIENTE (pos 14)
 * ÚNICA FUENTE: spec_decision_y_observaciones_del_cliente.md §6.2 + R14.4
 * ----------------------------------------------------------------------------
 * PÚBLICA SIN SESIÓN. Escribe UNA observación por link (1..280 code points)
 * sin tocar la decisión: puede ir antes o después de aprobar. Si ya existe,
 * la RPC solo acepta el mismo texto/canal (idempotente) o el fallback
 * email→WhatsApp cuando el email no salió.
 *
 * El texto se guarda ANTES de abrir WhatsApp (R14.6). Si el email falla, la
 * fila queda y la UI ofrece WhatsApp/panel como respaldo.
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
  const normalized = normalizeObservation(body?.message);
  if (!normalized.ok) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'observation' }, { status: 400 });
  }
  if (!isLinkChannel(body?.channel)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'channel' }, { status: 400 });
  }

  const result = await registerObservation({
    linkId,
    message: normalized.text,
    channel: body.channel,
    userAgent: request.headers.get('user-agent'),
    origin: request.nextUrl.origin,
  });

  if (result.status === 200) {
    console.log(
      '[link observation QA registro]',
      JSON.stringify({
        artifact: 'observation',
        linkId,
        channel: body.channel,
        observationLength: observationLength(normalized.text),
        at: new Date().toISOString(),
      }),
    );
  }

  return NextResponse.json(result.body, { status: result.status });
}
