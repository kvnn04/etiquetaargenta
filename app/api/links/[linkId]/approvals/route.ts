import { NextResponse, type NextRequest } from 'next/server';
import { canonicalizeLinkId } from '@/lib/links/identity';
import { isLinkVariantId } from '@/lib/links/payload';
import { registerLegacyApproval } from '@/lib/links/response-service';

/* ============================================================================
 * POST /api/links/[linkId]/approvals — ALIAS LEGACY DE APROBACIÓN (pos 10A)
 * ÚNICA FUENTE: spec_ficha_comercial_interactiva_shareable_link.md R6 +
 * spec_decision_y_observaciones_del_cliente.md §6.3 (posición 14)
 * ----------------------------------------------------------------------------
 * Se mantiene la ruta y el body `{ variantId }` para los visores ya abiertos
 * en pestañas viejas. Internamente es `link_register_decision('approved')`:
 *   · la decisión es ÚNICA e inmutable (R14.1): un segundo evento con la
 *     misma variante devuelve `200 already`; con otra variante o si el link
 *     ya fue rechazado ⇒ `409 DECISION_TAKEN`;
 *   · la doble escritura en `link_approvals` la hace la RPC (historial legacy);
 *   · ya NO se inserta directo con anon: toda escritura pasa por service-role
 *     y la RPC transaccional.
 * El contrato de respuesta de la posición 10A se conserva:
 * `201 {ok, linkId, variantId, approvedAt}` / `200 already`.
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

  const body = (await request.json().catch(() => null)) as { variantId?: unknown } | null;
  if (!isLinkVariantId(body?.variantId)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'variant_id' }, { status: 400 });
  }

  const result = await registerLegacyApproval({
    linkId,
    variantId: body!.variantId,
    userAgent: request.headers.get('user-agent'),
  });

  if (result.status === 200 || result.status === 201) {
    console.log(
      '[link approvals QA registro]',
      JSON.stringify({
        artifact: 'approval',
        linkId,
        variantId: body!.variantId,
        at: new Date().toISOString(),
      }),
    );
  }

  return NextResponse.json(result.body, { status: result.status });
}
