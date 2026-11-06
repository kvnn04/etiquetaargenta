import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { planOf } from '@/lib/exports/ticket-server';

/**
 * GET /api/exports?type=png|pdf — registro QA de exports (pos 9).
 * ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md §7 QA (registro de
 * *exports* para verificación manual — decisión del titular: consola del
 * server + JSON 200; NO crea tablas ni persiste nada).
 * ----------------------------------------------------------------------------
 * · Sesión por cookies (getUser) ⇒ 401 si no hay (mismo patrón que /ticket).
 * · `type` obligatorio ∈ {png, pdf}: son DOS artefactos distintos y el
 *   registro QA los separa (otro valor / ausente ⇒ 400).
 * · El artefacto ya se consumió en el lado del cliente; este GET SOLO
 *   REGISTRA: log en consola con el snippet exacto `{user, plan, artifact, at}`
 *   y devuelve 200 JSON para que el modal confirme en su QA manual.
 * · Plan autoritativo (service-role; fail-closed 'free') — el log deja
 *   rastreado quién exportó con qué plan SIN tocar la base.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // sesión por cookies: nada de cache

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get('type');
  if (type !== 'png' && type !== 'pdf') {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'type' }, { status: 400 });
  }

  const plan = (await planOf(user.id)) ?? 'free'; // sin fila ⇒ free (fail-closed)
  const at = new Date().toISOString();

  // Registro QA pedido por la spec §7: legible a simple vista en la consola
  // del server (deploy local o de prod). Snippet EXACTO del titular.
  console.log('[exports QA registro]', JSON.stringify({ user: user.id, plan, artifact: type, at }));

  return NextResponse.json({ ok: true as const, user: user.id, plan, type, at });
}
