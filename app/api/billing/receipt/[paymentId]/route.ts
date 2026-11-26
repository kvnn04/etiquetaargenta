import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ============================================================================
 * /api/billing/receipt/[paymentId] — CONSTANCIA DE PAGO EN PDF (R6 ampliada)
 * ----------------------------------------------------------------------------
 * Contrato:
 *   · Sesión obligatoria ⇒ 401 AUTH_REQUIRED.
 *   · Solo el dueño del pago: la lectura va con la RLS del usuario; un pago
 *     ajeno o inexistente responde 404 (no revela si existe).
 *   · `paymentId` es el UUID interno de `payments.id` (el del historial).
 *   · Un pago RECHAZADO no genera constancia ⇒ 404.
 *   · 200 application/pdf con `Content-Disposition: attachment`.
 *   · La constancia es comercial: NO es factura fiscal (la ARCA es manual).
 * ========================================================================== */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReceiptRow {
  id: string;
  mp_payment_id: number | string;
  amount: number | string;
  status: string;
  occurred_at: string;
  receipt_url: string | null;
  refunded_amount: number | string | null;
}

interface ProfileRow {
  base_name: string | null;
  brand_name: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const { paymentId } = await params;
  if (!UUID_RE.test(paymentId)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const paymentResult = await supabase
    .from('payments')
    .select('id, mp_payment_id, amount, status, occurred_at, receipt_url, refunded_amount')
    .eq('id', paymentId)
    .maybeSingle<ReceiptRow>();

  if (paymentResult.error) {
    console.error('[billing receipt read]:', paymentResult.error.message);
    return NextResponse.json({ error: 'RECEIPT_UNAVAILABLE' }, { status: 503 });
  }
  const payment = paymentResult.data;
  if (!payment || payment.status === 'rejected') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const occurredMs = Date.parse(payment.occurred_at);
  if (!Number.isFinite(occurredMs)) {
    console.error('[billing receipt date]:', payment.id, payment.occurred_at);
    return NextResponse.json({ error: 'RECEIPT_UNAVAILABLE' }, { status: 503 });
  }

  const profileResult = await supabase
    .from('users')
    .select('base_name, brand_name')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();
  if (profileResult.error) {
    console.error('[billing receipt profile]:', profileResult.error.message);
  }
  const workshopName =
    profileResult.data?.brand_name?.trim() ||
    profileResult.data?.base_name?.trim() ||
    'Taller';

  try {
    const { buildPaymentReceiptPdf } = await import('@/lib/payments/receipt-pdf');
    const pdfBytes = await buildPaymentReceiptPdf({
      paymentId: payment.id,
      mpPaymentId: Number(payment.mp_payment_id),
      amountArs: Number(payment.amount),
      currency: 'ARS',
      status: payment.status,
      occurredAtMs: occurredMs,
      workshopName,
      subscriberEmail: user.email ?? 'No disponible',
      receiptUrl: payment.receipt_url,
      refundedAmountArs: Number(payment.refunded_amount ?? 0),
    });

    const safeMpId = String(payment.mp_payment_id).replace(/[^0-9]/g, '') || payment.id;
    const body = new Uint8Array(pdfBytes);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="constancia-pago-${safeMpId}.pdf"`,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error(
      '[billing receipt build]:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'RECEIPT_UNAVAILABLE' }, { status: 503 });
  }
}
