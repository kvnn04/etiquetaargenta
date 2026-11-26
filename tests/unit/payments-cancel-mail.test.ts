import { describe, expect, it } from 'vitest';
import { mailScheduledClose } from '@/lib/payments/mail';

/* ============================================================================
 * R9 — el email de cierre debe decir la VERDAD sobre el origen de la baja:
 * la app no puede atribuirse una cancelación hecha desde el Portal de MP.
 * ========================================================================== */

const PERIOD_END = Date.UTC(2026, 11, 7, 3); // 00:00 AR del 07/12/2026

describe('mailScheduledClose — origen de la baja (R9)', () => {
  it('baja desde la app: lo dice explícitamente y no menciona el Portal', () => {
    const mail = mailScheduledClose({
      to: 'taller@example.com',
      periodEndMs: PERIOD_END,
      source: 'app',
    });
    expect(mail.subject).toContain('Cierre programado');
    expect(mail.html).toContain('Pediste la baja desde la app');
    expect(mail.html).not.toContain('Portal de Mercado Pago');
  });

  it('origen genérico (portal/webhook): no atribuye la baja a la app', () => {
    const mail = mailScheduledClose({
      to: 'taller@example.com',
      periodEndMs: PERIOD_END,
      source: 'portal',
    });
    expect(mail.html).toContain('Pediste la baja de tu suscripción PRO');
    expect(mail.html).not.toContain('desde la app');
  });
});
