import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildPaymentReceiptPdf } from '@/lib/payments/receipt-pdf';
import { mailReceipt, sendMail } from '@/lib/payments/mail';

/* ============================================================================
 * R6 ampliada — constancia de pago en PDF.
 * El documento es comercial (no fiscal) y debe generarse aunque falten datos
 * del emisor, con nombres largos o con emojis en el branding del taller.
 * ========================================================================== */

const BASE = {
  paymentId: '11111111-2222-4333-8444-555555555555',
  mpPaymentId: 190672595499,
  amountArs: 50,
  currency: 'ARS',
  status: 'approved',
  occurredAtMs: Date.UTC(2026, 10, 26, 17, 10),
  workshopName: 'Taller de Mates',
  subscriberEmail: 'taller@example.com',
  receiptUrl: null,
};

function pdfHeader(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 5));
}

describe('buildPaymentReceiptPdf', () => {
  it('genera un PDF A4 válido con los datos del pago', async () => {
    const bytes = await buildPaymentReceiptPdf(BASE);
    expect(pdfHeader(bytes)).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it('no se rompe con branding largo, emojis ni reembolsos', async () => {
    const bytes = await buildPaymentReceiptPdf({
      ...BASE,
      workshopName: '🔥 Taller de mates personalizados con un nombre larguísimo 🔥',
      status: 'partially_refunded',
      refundedAmountArs: 20,
      receiptUrl: 'https://www.mercadopago.com.ar/payments/190672595499/receipt',
    });
    expect(pdfHeader(bytes)).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});

describe('mailReceipt — constancia adjunta', () => {
  it('menciona el PDF adjunto cuando se pudo generar', () => {
    const mail = mailReceipt({
      to: 'taller@example.com',
      amountArs: 50,
      occurredAtMs: BASE.occurredAtMs,
      receiptUrl: null,
      hasReceiptPdf: true,
    });
    expect(mail.html).toContain('constancia de pago en PDF');
    expect(mail.html).toContain('Perfil');
  });

  it('sin PDF ni receipt_url mantiene la referencia al Centro', () => {
    const mail = mailReceipt({
      to: 'taller@example.com',
      amountArs: 50,
      occurredAtMs: BASE.occurredAtMs,
      receiptUrl: null,
    });
    expect(mail.html).toContain('Centro de Suscripción');
  });
});

describe('sendMail — adjuntos', () => {
  it('manda el PDF en base64 dentro del payload de Resend', async () => {
    const previousKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'Test <test@example.com>';

    let payload: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return new Response('{}', { status: 200 });
      }),
    );

    try {
      const outcome = await sendMail({
        kind: 'recibo_cobro',
        to: 'taller@example.com',
        subject: 'Recibo',
        html: '<p>Hola</p>',
        attachments: [{ filename: 'constancia.pdf', content: 'JVBERi0=' }],
      });
      expect(outcome.sent).toBe(true);
      expect(payload).toMatchObject({
        attachments: [{ filename: 'constancia.pdf', content: 'JVBERi0=' }],
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousKey == null) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousKey;
      if (previousFrom == null) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = previousFrom;
    }
  });
});
