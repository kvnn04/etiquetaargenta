import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { EXPORT_TICKET_TTL_MS, verifyExportTicket } from '@/lib/exports/ticket';
import { ticketSecret } from '@/lib/exports/ticket-server';

/**
 * POST /api/exports/ticket/verificar — contra-portada del ticket de export
 * (pos 9): el motor gráfico de la Ficha ("makeQuoteCanvas" + PDF A4) NO
 * adjunta el artefacto hasta que este endpoint re-verifica server-side lo
 * que el cliente recibió.
 * ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md §3-R7 (ticket firmado,
 * vigencia EXACTA 5 min, ligado al hash del snapshot inmutable) heredando el
 * mismo criterio de pos 8 (spec_autenticacion_y_modelo_freemium.md §3-R4).
 * ----------------------------------------------------------------------------
 * · Sesión por cookies (getUser) ⇒ 401 si no hay (mismo patrón que /ticket).
 * · Firma HMAC (comparación timing-safe) + ventana + estructura v1 completas
 *   ⇒ cualquier desvío ⇒ **403** { error: 'TICKET_INVALIDO' } (ajuste, TTL
 *   vencido, secreto distinto, payload recortado…): NUNCA se acepta un ticket
 *   sospechoso "con buena voluntad".
 * · Si el body adjunta `snapshotHash`, debe coincidir EXACTO con el firmado:
 *   el ticket queda ligado a UN snapshot (R7) — otro contenido ⇒ 403.
 * · 200 { ok, sub, snapshotHash, exp, ttlMs } para el registro QA del modal.
 */
export const runtime = 'nodejs'; // node:crypto para el HMAC
export const dynamic = 'force-dynamic'; // sesión por cookies: nada de cache

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { ticket?: unknown; snapshotHash?: unknown }
    | null;
  const ticket = typeof body?.ticket === 'string' ? body.ticket.trim() : '';
  if (!ticket) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'ticket' }, { status: 400 });
  }

  const secret = ticketSecret();
  const payload = secret ? verifyExportTicket(ticket, secret) : null;
  if (!payload) {
    return NextResponse.json({ error: 'TICKET_INVALIDO' }, { status: 403 });
  }

  // R7: si el cliente declara contra qué snapshot exporta, es el firmado (o 403).
  if (typeof body?.snapshotHash === 'string' && body.snapshotHash.trim() !== payload.snapshotHash) {
    return NextResponse.json({ error: 'TICKET_INVALIDO', reason: 'snapshot_hash' }, { status: 403 });
  }

  return NextResponse.json({
    ok: true as const,
    sub: payload.sub,
    snapshotHash: payload.snapshotHash,
    exp: payload.exp,
    ttlMs: EXPORT_TICKET_TTL_MS,
  });
}
