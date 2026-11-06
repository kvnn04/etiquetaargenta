import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  EXPORT_TICKET_HASH_MAX,
  EXPORT_TICKET_TTL_MS,
  signExportTicket,
} from '@/lib/exports/ticket';

/**
 * POST /api/exports/ticket — servidor del *ticket de export* (pos 8, la matriz
 * R2 SE ENCIENDE en el export; el artefacto gráfico llega en pos 9):
 * ÚNICA FUENTE: spec_autenticacion_y_modelo_freemium.md §3-R4/QA-3
 * + spec_detalle_del_modelo_en_ficha.md §3-R7 (ticket firmado 5 min ligado al
 * hash del snapshot).
 * ----------------------------------------------------------------------------
 * · Sesión por cookies (getUser) ⇒ 401 si no hay.
 * · El plan se lee de `users` con el CLIENTE DE SERVICIO — el claim del JWT es
 *   cache NO autoritativa (§6: limpiar localStorage no concede nada).
 * · plan `free` ⇒ **402** { error: 'PAYWALL_REQUIRED', capability: 'export.hd' }
 *   — la UI abre el modal Paywall SIEMPRE ante 402 (nunca error crudo, §6).
 * · plan `pro`/`pro_grace` ⇒ 200 { ticket, exp, ttlMs } firmado HMAC-SHA256
 *   (vigencia EXACTA 5 min, export de spec_detalle: los 5 min son su momento).
 * · Sin fila en users ⇒ fallback `free` (igual que la shell del editor:
 *   fail-closed — fila ausente JAMÁS desbloquea).
 * · Secreto HMAC: env `EXPORT_TICKET_SECRET` (override recomendado para poder
 *   rotarlo sin tocar el service key) con fallback `SUPABASE_SERVICE_ROLE_KEY`.
 *   Ambos viven SOLO en envs del server.
 */
export const runtime = 'nodejs'; // node:crypto para el HMAC
export const dynamic = 'force-dynamic'; // sesión por cookies: nada de cache

function ticketSecret(): string {
  return process.env.EXPORT_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

type Plan = 'free' | 'pro' | 'pro_grace';

/** Plan autoritativo desde la base (service-role). Null si la fila no existe. */
async function planOf(userId: string): Promise<Plan | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('users')
    .select('plan')
    .eq('id', userId)
    .maybeSingle<{ plan: string }>();
  if (error) {
    console.error('[exports/ticket plan read]:', error.message);
    // Fallo de lectura ⇒ fail-closed: se trata como free (402), jamás como pro.
    return 'free';
  }
  if (!data?.plan) return null; // sin fila (trigger no corrió) ⇒ fallback en caller
  if (data.plan === 'pro' || data.plan === 'pro_grace') return data.plan;
  return 'free';
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { snapshotHash?: unknown }
    | null;
  const snapshotHash = typeof body?.snapshotHash === 'string' ? body.snapshotHash.trim() : '';
  if (!snapshotHash || snapshotHash.length > EXPORT_TICKET_HASH_MAX) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', reason: 'snapshot_hash', max: EXPORT_TICKET_HASH_MAX },
      { status: 400 },
    );
  }

  const resolved = await planOf(user.id);
  // Sin fila en users ⇒ 'free' (fail-closed, pattern de la shell del editor).
  const plan: Plan = resolved ?? 'free';

  if (plan === 'free') {
    // La matriz R2 encendida: FREE ⇒ 402 + payload que la UI traduce a Paywall.
    // NINGÚN artefacto clean sale por acá jamás (QA-3 de la spec).
    return NextResponse.json(
      { error: 'PAYWALL_REQUIRED', capability: 'export.hd' },
      { status: 402 },
    );
  }

  const secret = ticketSecret();
  if (!secret) {
    console.error('[exports/ticket]: falta secreto HMAC (EXPORT_TICKET_SECRET / SERVICE_ROLE)');
    return NextResponse.json({ error: 'TICKET_INDISPONIBLE' }, { status: 503 });
  }

  try {
    const { token, payload } = signExportTicket({
      userId: user.id,
      snapshotHash,
      secret,
    });
    return NextResponse.json({
      ticket: token,
      sub: payload.sub,
      snapshotHash: payload.snapshotHash,
      exp: payload.exp,
      ttlMs: EXPORT_TICKET_TTL_MS,
    });
  } catch (err) {
    console.error('[exports/ticket sign]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'TICKET_INDISPONIBLE' }, { status: 503 });
  }
}
