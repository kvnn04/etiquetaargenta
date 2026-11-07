import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient, createSupabasePublicClient } from '@/lib/supabase/service';
import { canonicalizeLinkId } from '@/lib/links/identity';
import { isLinkVariantId, isLegacyPayload, type LinkPayload } from '@/lib/links/payload';

/* ============================================================================
 * /api/links/[linkId]/approvals — REGISTRO DE APROBACIÓN (posición 10A)
 * ÚNICA FUENTE: spec_ficha_comercial_interactiva_shareable_link.md §3-R6 + §6
 * ----------------------------------------------------------------------------
 * R6: pulsar el CTA del Modo Cliente dispara ESTA ruta ANTES de abrir
 * WhatsApp — "el registro es observable aunque el mensaje nunca llegue". Se
 * permiten múltiples eventos (acumulables); el badge del editor usa el último.
 *
 * PÚBLICA SIN SESIÓN (R8/§6: abrir/ver/aprobar un link es público):
 *   1. linkId del path ⇒ canónico (R2); raro ⇒ 400.
 *   2. Lectura del registro con SERVICE-ROLE ⇒ 404 si no existe, 410 si
 *      VENCIDO (página amable, jamás contenido ni registro post-vigencia).
 *   3. `variantId` debe existir EN el payload de la versión (A/B/C) ⇒ 400 si
 *      no — la aprobación nombra EXACTAMENTE la opción visible (QA §7.4).
 *   4. El INSERT corre con el cliente ANÓNIMO: pasa por la policy
 *      `approvals_public_insert` de RLS (0004) — la DB es la última palabra
 *      (el chequeo de vigencia también vive en link_open_for_approval()).
 * Nada de datos personales del opinante: solo variante + timestamp +
 * user-agent (§5). Los eventos son acumulables (R6).
 * ============================================================================ */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA_MAX = 200;

interface LinkRow {
  link_id: string;
  expires_at: string;
  payload: unknown;
}

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
  const variantId = body!.variantId;

  const service = createSupabaseServiceClient();
  const link = await service
    .from('links')
    .select('link_id, expires_at, payload')
    .eq('link_id', linkId)
    .maybeSingle<LinkRow>();
  if (link.error) {
    console.error('[link approvals read]:', link.error.message);
    return NextResponse.json({ error: 'LINK_UNAVAILABLE' }, { status: 503 });
  }
  if (!link.data) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (new Date(link.data.expires_at).getTime() <= Date.now()) {
    // §6/R5: el contenido vencido jamás se muestra ni se registra — la página
    // amable del visor no ofrece el CTA; defensa por si un cliente viejo choca.
    return NextResponse.json({ error: 'LINK_EXPIRED' }, { status: 410 });
  }

  // La variante aprobada debe existir EN el payload congelado de esta versión:
  const payload = link.data.payload as LinkPayload | null;
  const variants = !isLegacyPayload(payload) ? (payload?.variants ?? []) : [];
  if (!variants.some((v) => v.id === variantId)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'variant_id' }, { status: 400 });
  }

  /* INSERT con CLIENTE ANÓNIMO ⇒ la policy approvals_public_insert de RLS
   * (link_open_for_approval: existe + vigente) aplica ANTES de grabar.
   * SIN RETURNING: 0004 revoca SELECT de anon POR DISEÑO ("SELECT jamás para
   * anon") y un `insert().select()` obliga a Postgres a pedir el privilegio
   * SELECT para el RETURNING (QA 06-nov: permission denied de anon ya con los
   * grants). La verdad queda en la fila; el badge del panel la lee con
   * service-role (GET /api/links). */
  const anon = createSupabasePublicClient();
  const userAgent = request.headers.get('user-agent')?.slice(0, UA_MAX) ?? null;
  const insert = await anon.from('link_approvals').insert({
    link_id: linkId,
    variant_id: variantId,
    user_agent: userAgent,
  });
  if (insert.error) {
    // Un rechazo de RLS acá = link vencido entre el chequeo y el insert (o
    // anon sin grant de insert — ver ops/0910): se logea con el motivo exacto.
    console.error('[link approvals insert]:', insert.error?.message);
    return NextResponse.json({ error: 'APPROVAL_UNAVAILABLE' }, { status: 503 });
  }
  const approvedAt = new Date().toISOString(); // eco del visor: la fila real la lee el panel

  /* QA registro (complemento de '[links QA registro]': la decisión del cliente) */
  console.log(
    '[link approvals QA registro]',
    JSON.stringify({ artifact: 'approval', linkId, variantId, at: approvedAt }),
  );

  return NextResponse.json(
    {
      ok: true as const,
      linkId,
      variantId,
      approvedAt,
    },
    { status: 201 },
  );
}
