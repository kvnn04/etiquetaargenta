/* ============================================================================
 * TESTS POSICIÓN 14 — RESPUESTA DEL CLIENTE
 * (spec_decision_y_observaciones_del_cliente.md R14.1–R14.14)
 * ----------------------------------------------------------------------------
 * Módulos PUROS: límite real de 280 code points, normalización, fila pública,
 * canales y textos de WhatsApp. La DB/RPC se prueban en el QA de integración.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_LINK_RESPONSE,
  OBSERVATION_MAX,
  channelLabel,
  emailStatusLabel,
  formatLinkDate,
  isLinkChannel,
  isLinkDecision,
  linkResponseIsDecided,
  normalizeObservation,
  observationLength,
  toPublicLinkResponse,
  whatsappHref,
  whatsappObservationHref,
  whatsappObservationText,
  whatsappRejectionHref,
  whatsappRejectionText,
} from '@/lib/links/responses';
import { editionBadgeText, linkEditionState } from '@/lib/links/states';

const T0 = Date.UTC(2026, 10, 23, 15, 0, 0);
const T0_ISO = new Date(T0).toISOString();

describe('R14.14 — límite real: 280 code points (no UTF-16)', () => {
  it('cuenta code points: acentos y emoji simple cuentan 1', () => {
    expect(observationLength('mate')).toBe(4);
    expect(observationLength('ñandú')).toBe(5);
    expect(observationLength('🪵')).toBe(1);
    expect(observationLength('a🪵b')).toBe(3);
  });

  it('un emoji compuesto puede contar más de 1 (mismo criterio que char_length)', () => {
    // Familia: varios code points unidos por ZWJ.
    expect(observationLength('👨‍👩‍👧‍👦')).toBeGreaterThan(1);
  });

  it('280 exactos ⇒ válido; 281 ⇒ too_long', () => {
    const ok = normalizeObservation('a'.repeat(OBSERVATION_MAX));
    expect(ok).toMatchObject({ ok: true, length: OBSERVATION_MAX });
    const tooLong = normalizeObservation('a'.repeat(OBSERVATION_MAX + 1));
    expect(tooLong).toEqual({ ok: false, reason: 'too_long', length: OBSERVATION_MAX + 1 });
  });

  it('normaliza CRLF/CR a \\n, colapsa 3+ saltos y recorta extremos', () => {
    const result = normalizeObservation('  hola\r\n\r\n\r\nmundo\r  ');
    expect(result).toEqual({ ok: true, text: 'hola\n\nmundo', length: 11 });
  });

  it('elimina controles C0 (salvo \\n y \\t) y DEL', () => {
    const result = normalizeObservation('a\u0000b\u0007c\u007fd\te');
    expect(result).toMatchObject({ ok: true, text: 'abcd\te' });
  });

  it('solo espacios ⇒ empty; no-string ⇒ not_string', () => {
    expect(normalizeObservation('   \n\t  ')).toEqual({
      ok: false,
      reason: 'empty',
      length: 0,
    });
    expect(normalizeObservation(null)).toEqual({
      ok: false,
      reason: 'not_string',
      length: 0,
    });
    expect(normalizeObservation(42)).toEqual({
      ok: false,
      reason: 'not_string',
      length: 0,
    });
  });

  it('el texto normalizado se guarda sin extremos y con saltos internos', () => {
    const result = normalizeObservation('  Cambiar el grabado\n\npor las iniciales  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('Cambiar el grabado\n\npor las iniciales');
  });
});

describe('R14.1/R14.5 — decisión y canal: validadores cerrados', () => {
  it('solo approved/rejected y email/whatsapp', () => {
    expect(isLinkDecision('approved')).toBe(true);
    expect(isLinkDecision('rejected')).toBe(true);
    expect(isLinkDecision('pending')).toBe(false);
    expect(isLinkDecision(null)).toBe(false);
    expect(isLinkChannel('email')).toBe(true);
    expect(isLinkChannel('whatsapp')).toBe(true);
    expect(isLinkChannel('sms')).toBe(false);
  });

  it('channelLabel: etiquetas visibles del panel/visor', () => {
    expect(channelLabel('email')).toBe('Email');
    expect(channelLabel('whatsapp')).toBe('WhatsApp');
    expect(channelLabel(null)).toBe('—');
  });
});

describe('R14.10 — fila pública de link_responses', () => {
  it('mapea una decisión aprobada y descarta el canal (la aprobación no avisa por email)', () => {
    const response = toPublicLinkResponse({
      link_id: '3a8f9b',
      decision: 'approved',
      decision_variant_id: 'B',
      decided_at: T0_ISO,
      decision_channel: 'email',
      decision_email_sent_at: T0_ISO,
      observation: null,
      observed_at: null,
      observation_channel: null,
    });
    expect(response).toEqual({
      ...EMPTY_LINK_RESPONSE,
      decision: 'approved',
      decisionVariantId: 'B',
      decidedAt: T0_ISO,
    });
  });

  it('mapea rechazo + observación y conserva los estados de email', () => {
    const response = toPublicLinkResponse({
      decision: 'rejected',
      decision_variant_id: 'A',
      decided_at: T0_ISO,
      decision_channel: 'email',
      decision_email_sent_at: T0_ISO,
      decision_email_error: null,
      observation: 'Quiero cambiar el grabado',
      observed_at: T0_ISO,
      observation_channel: 'email',
      observation_email_sent_at: null,
      observation_email_error: 'HTTP 500',
    });
    expect(response).toMatchObject({
      decision: 'rejected',
      decisionVariantId: 'A',
      decisionChannel: 'email',
      decisionEmailSentAt: T0_ISO,
      observation: 'Quiero cambiar el grabado',
      observationChannel: 'email',
      observationEmailError: 'HTTP 500',
    });
  });

  it('canal WhatsApp ⇒ no inventa estados de email', () => {
    const response = toPublicLinkResponse({
      decision: 'rejected',
      decision_variant_id: 'A',
      decided_at: T0_ISO,
      decision_channel: 'whatsapp',
      decision_email_sent_at: T0_ISO,
      decision_email_error: 'no debería mostrarse',
      observation: 'Motivo',
      observed_at: T0_ISO,
      observation_channel: 'whatsapp',
      observation_email_sent_at: T0_ISO,
      observation_email_error: 'no debería mostrarse',
    });
    expect(response).toMatchObject({
      decisionChannel: 'whatsapp',
      decisionEmailSentAt: null,
      decisionEmailError: null,
      observationChannel: 'whatsapp',
      observationEmailSentAt: null,
      observationEmailError: null,
    });
  });

  it('fila vacía, basura o sin decisión/observación ⇒ null', () => {
    expect(toPublicLinkResponse(null)).toBeNull();
    expect(toPublicLinkResponse({})).toBeNull();
    expect(toPublicLinkResponse({ decision: 'pending', observation: '   ' })).toBeNull();
    expect(
      toPublicLinkResponse({ decision: 'approved', decision_variant_id: 'D' }),
    ).toMatchObject({ decision: 'approved', decisionVariantId: null });
  });

  it('linkResponseIsDecided: respuesta nueva o legacy bloquean la decisión', () => {
    expect(linkResponseIsDecided(null, false)).toBe(false);
    expect(linkResponseIsDecided(null, true)).toBe(true);
    expect(linkResponseIsDecided({ ...EMPTY_LINK_RESPONSE, decision: 'approved' }, false)).toBe(true);
    expect(linkResponseIsDecided({ ...EMPTY_LINK_RESPONSE, observation: 'solo observación' }, false)).toBe(
      false,
    );
  });

  it('formatLinkDate: ISO inválido/null ⇒ —; válido ⇒ fecha visible es-AR', () => {
    expect(formatLinkDate(null)).toBe('—');
    expect(formatLinkDate('no-es-fecha')).toBe('—');
    expect(formatLinkDate(T0_ISO)).not.toBe('—');
    // 15:00 UTC = 12:00 en Argentina (huso explícito, no el del server).
    expect(formatLinkDate(T0_ISO)).toContain('12:00');
  });

  it('emailStatusLabel: Enviado > Falló > Pendiente; WhatsApp no aplica', () => {
    expect(emailStatusLabel('email', T0_ISO, null)).toBe('Email enviado');
    expect(emailStatusLabel('email', null, 'HTTP 500')).toBe('El email no salió');
    expect(emailStatusLabel('email', null, null)).toBe('Email pendiente');
    expect(emailStatusLabel('whatsapp', T0_ISO, 'HTTP 500')).toBe('');
    expect(emailStatusLabel(null, T0_ISO, null)).toBe('');
  });
});

describe('R14.10 — badge del panel: rechazo gana y no se pierde al vencer', () => {
  it('prioridad rechazado > aprobado > vencido > por vencer > vigente', () => {
    expect(
      linkEditionState({ expiresAtMs: T0 - 1, approved: true, rejected: true }, T0),
    ).toBe('rechazado');
    expect(
      linkEditionState({ expiresAtMs: T0 - 1, approved: true, rejected: false }, T0),
    ).toBe('aprobado');
    expect(
      linkEditionState({ expiresAtMs: T0 - 1, approved: false, rejected: false }, T0),
    ).toBe('vencido');
    expect(
      linkEditionState({ expiresAtMs: T0 + 86_400_000, approved: false, rejected: false }, T0),
    ).toBe('por_vencer');
    expect(
      linkEditionState({ expiresAtMs: T0 + 30 * 86_400_000, approved: false, rejected: false }, T0),
    ).toBe('vigente');
  });

  it('texto RECHAZADO sin opción', () => {
    expect(editionBadgeText('rechazado', 'A')).toBe('RECHAZADO');
    expect(editionBadgeText('rechazado', null)).toBe('RECHAZADO');
  });
});

describe('R14.5/R14.6 — WhatsApp: texto exacto + href codificado', () => {
  const url = 'https://simulador.com/v/3a8f9b';
  const message = 'Quiero cambiar "el grabado" & el tamaño';

  it('rechazo: texto pre-armado con el motivo y el link', () => {
    expect(whatsappRejectionText(url, message)).toBe(
      `¡Hola! Revisé la propuesta de mi mate personalizado y quiero rechazarla. Mi observación: "${message}". Link: ${url}`,
    );
  });

  it('observación sola: texto pre-armado con el motivo y el link', () => {
    expect(whatsappObservationText(url, message)).toBe(
      `¡Hola! Tengo una observación sobre la propuesta de mi mate personalizado: "${message}". Link: ${url}`,
    );
  });

  it('href usa SOLO dígitos del taller y encodeURIComponent del texto', () => {
    expect(whatsappRejectionHref('+54 9 11 1234-5678', url, message)).toBe(
      `https://wa.me/5491112345678?text=${encodeURIComponent(whatsappRejectionText(url, message))}`,
    );
    expect(whatsappObservationHref('5491112345678', url, message)).toBe(
      `https://wa.me/5491112345678?text=${encodeURIComponent(whatsappObservationText(url, message))}`,
    );
  });

  it('sin número válido (null o <6 dígitos) ⇒ null: el botón no se muestra', () => {
    expect(whatsappHref(null, 'hola')).toBeNull();
    expect(whatsappHref('123', 'hola')).toBeNull();
    expect(whatsappRejectionHref(null, url, message)).toBeNull();
    expect(whatsappObservationHref('', url, message)).toBeNull();
  });
});
