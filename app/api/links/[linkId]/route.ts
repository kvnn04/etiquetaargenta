import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient, removeStoragePrefix } from '@/lib/supabase/service';
import { canonicalizeLinkId } from '@/lib/links/identity';

/* ============================================================================
 * /api/links/[linkId] — ELIMINACIÓN DE UNA VERSIÓN (decisión del titular)
 * ----------------------------------------------------------------------------
 * El dueño puede borrar un enlace creado. El payload sigue siendo INMUTABLE
 * (jamás UPDATE): se elimina la fila completa y `link_approvals` cae por el
 * ON DELETE CASCADE de 0004. La limpieza de Storage es best-effort después de
 * la DB: si falla, el enlace ya no resuelve y el huérfano se logea.
 *
 * Seguridad: sesión por cookies + ownership service-role. Un link ajeno
 * responde 404 (no revela si existe). El borrado directo desde el cliente
 * sigue revocado en 0004; esta ruta es el único camino.
 * ============================================================================ */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OwnedLinkRow {
  link_id: string;
  project_id: string;
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const { linkId: rawLinkId } = await params;
  const linkId = canonicalizeLinkId(rawLinkId);
  if (!linkId) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'link_id' }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const owned = await service
    .from('links')
    .select('link_id, project_id')
    .eq('link_id', linkId)
    .eq('user_id', user.id)
    .maybeSingle<OwnedLinkRow>();
  if (owned.error) {
    console.error('[link delete read]:', owned.error.message);
    return NextResponse.json({ error: 'LINK_UNAVAILABLE' }, { status: 503 });
  }
  if (!owned.data) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const deleted = await service
    .from('links')
    .delete()
    .eq('link_id', linkId)
    .eq('user_id', user.id);
  if (deleted.error) {
    console.error('[link delete]:', deleted.error.message);
    return NextResponse.json({ error: 'LINK_UNAVAILABLE' }, { status: 503 });
  }

  /* Best-effort: textura + logo congelados de ESTA versión. El original del
   * proyecto (`designs/...`) se conserva: puede alimentar otras versiones. */
  await removeStoragePrefix('link-assets', linkId);

  const at = new Date().toISOString();
  console.log(
    '[links QA registro]',
    JSON.stringify({
      user: user.id,
      artifact: 'link_deleted',
      linkId,
      projectId: owned.data.project_id,
      at,
    }),
  );

  return NextResponse.json({ ok: true as const, linkId, deletedAt: at });
}
