/* ============================================================================
 * TESTS POSICIÓN 14 — EMAILS AL TALLER
 * (spec_decision_y_observaciones_del_cliente.md §7 + R14.5/R14.11)
 * ----------------------------------------------------------------------------
 * El contenido es PURO (no toca Resend): se fija el asunto, el escapado HTML,
 * la ausencia de datos del cliente y la clave de idempotencia. El envío real
 * se prueba en el QA de integración con el taller.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import { mailDecisionCliente, mailObservationCliente } from '@/lib/links/mail';

const T0 = Date.UTC(2026, 10, 23, 15, 0, 0);

describe('R14.5 — email de RECHAZO', () => {
  it('asunto, destinatario, idempotencia y motivo completo', () => {
    const mail = mailDecisionCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: 'Etiqueta Argenta',
      variantLabel: 'Opción A: Iniciales',
      observation: 'Quiero cambiar el grabado',
      observedAtMs: T0,
      observationChannel: 'email',
      decisionChannel: 'whatsapp',
    });
    expect(mail.kind).toBe('decision_cliente');
    expect(mail.to).toBe('taller@example.com');
    expect(mail.subject).toBe(
      'Tu cliente rechazó la propuesta /v/3a8f9b — Etiqueta Argenta',
    );
    expect(mail.idempotencyKey).toBe('link-decision:3a8f9b');
    expect(mail.html).toContain('Quiero cambiar el grabado');
    expect(mail.html).toContain('Opción A: Iniciales');
    expect(mail.html).toContain('Aviso de rechazo por:</strong> WhatsApp');
    expect(mail.html).toContain('no incluye datos de contacto del cliente');
  });

  it('escapa HTML del taller y del motivo (XSS)', () => {
    const mail = mailDecisionCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: '<script>alert(1)</script>',
      variantLabel: '<b>Opción</b>',
      observation: '<img src=x onerror=alert(1)>',
      observedAtMs: T0,
      observationChannel: 'email',
      decisionChannel: 'email',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('preserva los saltos de línea del motivo', () => {
    const mail = mailDecisionCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: 'Taller',
      variantLabel: null,
      observation: 'Primera línea\nSegunda línea',
      observedAtMs: T0,
      observationChannel: 'whatsapp',
      decisionChannel: 'email',
    });
    expect(mail.html).toContain('Primera línea<br>Segunda línea');
  });
});

describe('R14.5 — email de OBSERVACIÓN', () => {
  it('sin decisión: lo dice explícitamente y no inventa una aprobación', () => {
    const mail = mailObservationCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: 'Etiqueta Argenta',
      decision: null,
      variantLabel: null,
      observation: '¿Puedo cambiar el color?',
      observedAtMs: T0,
      observationChannel: 'email',
    });
    expect(mail.kind).toBe('observacion_cliente');
    expect(mail.subject).toBe('Nueva observación de tu cliente — /v/3a8f9b');
    expect(mail.idempotencyKey).toBe('link-observation:3a8f9b');
    expect(mail.html).toContain('todavía no tiene una decisión registrada');
    expect(mail.html).toContain('¿Puedo cambiar el color?');
  });

  it('aprobada: nombra la opción; rechazada: lo dice sin pedir motivo', () => {
    const approved = mailObservationCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: 'Taller',
      decision: 'approved',
      variantLabel: 'Opción B: Escudo',
      observation: 'Me gustaría más grande',
      observedAtMs: T0,
      observationChannel: 'whatsapp',
    });
    expect(approved.html).toContain('aprobada');
    expect(approved.html).toContain('Opción B: Escudo');

    const rejected = mailObservationCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: 'Taller',
      decision: 'rejected',
      variantLabel: 'Opción A',
      observation: 'No era lo que esperaba',
      observedAtMs: T0,
      observationChannel: 'email',
    });
    expect(rejected.html).toContain('rechazada');
    expect(rejected.html).toContain('No era lo que esperaba');
  });

  it('el cuerpo no incluye email/teléfono del cliente (no los recibe)', () => {
    const mail = mailObservationCliente({
      to: 'taller@example.com',
      linkId: '3a8f9b',
      linkUrl: 'https://simulador.com/v/3a8f9b',
      workshopName: 'Taller',
      decision: null,
      variantLabel: null,
      observation: 'Consulta',
      observedAtMs: T0,
      observationChannel: 'email',
    });
    expect(mail.html).not.toMatch(/cliente@/i);
    expect(mail.html).not.toMatch(/\+54/);
  });
});
