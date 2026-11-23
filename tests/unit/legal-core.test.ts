import { describe, expect, it } from 'vitest';
import {
  checkCheckoutAcceptance,
  escapeHtml,
  generateLegalCode,
  generateLegalCodeSuffix,
  generateLegalToken,
  hashLegalToken,
  isHoneypotTripped,
  isLegalCode,
  isLegalToken,
  isLegalTokenExpired,
  isReasonableOrigin,
  isWithinWithdrawalWindow,
  legalRateLimit,
  LEGAL_CODE_ALPHABET,
  LEGAL_EMAIL_RATE_WINDOW_MS,
  LEGAL_IP_RATE_MAX,
  LEGAL_TOKEN_BYTES,
  LEGAL_WITHDRAWAL_DAYS,
  legalTokenExpiresAt,
  maskEmail,
  normalizeEmail,
  normalizeFullName,
  parseLegalDate,
  validateBaja,
  validatePrivacy,
  validateWithdrawal,
} from '@/lib/legal/requests';

const NOW = Date.UTC(2026, 10, 10, 15); // 2026-11-10 12:00 AR

describe('códigos legales (R13.4)', () => {
  it('usa la fecha del calendario argentino, no UTC', () => {
    // 2026-01-01 02:00 UTC = 2025-12-31 23:00 en Argentina.
    const code = generateLegalCode('baja', Date.UTC(2026, 0, 1, 2), () => 0);
    expect(code).toBe(`BAJA-20251231-${'A'.repeat(4)}`);
    expect(isLegalCode(code)).toBe(true);
  });

  it('genera el prefijo correcto por tipo', () => {
    expect(generateLegalCode('arrepentimiento', NOW, () => 1)).toMatch(/^ARR-20261110-/);
    expect(generateLegalCode('privacidad', NOW, () => 2)).toMatch(/^PRIV-20261110-/);
  });

  it('el sufijo usa el alfabeto sin caracteres ambiguos', () => {
    const suffix = generateLegalCodeSuffix((max) => max - 1);
    expect(suffix).toHaveLength(4);
    for (const char of suffix) expect(LEGAL_CODE_ALPHABET).toContain(char);
    expect(suffix).not.toMatch(/[01ILO]/);
  });

  it('rechaza códigos con formato inválido', () => {
    expect(isLegalCode('ARR-20261110-ABCD')).toBe(true);
    expect(isLegalCode('ARR-2026-ABCD')).toBe(false);
    expect(isLegalCode('XXX-20261110-ABCD')).toBe(false);
    expect(isLegalCode('ARR-20261110-AB1D')).toBe(false);
  });
});

describe('normalización de datos', () => {
  it('normaliza email a minúsculas y sin espacios', () => {
    expect(normalizeEmail('  Kevin@Taller.COM ')).toBe('kevin@taller.com');
    expect(normalizeEmail('sin-arroba.com')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it('normaliza nombres y rechaza controles', () => {
    expect(normalizeFullName('  Kevin   Pérez ')).toBe('Kevin Pérez');
    expect(normalizeFullName('A')).toBeNull();
    expect(normalizeFullName('Kevin\nPérez')).toBeNull();
  });

  it('parsea solo fechas reales en calendario AR', () => {
    expect(parseLegalDate('2026-11-10')).toBe(Date.UTC(2026, 10, 10, 3));
    expect(parseLegalDate('2026-02-30')).toBeNull();
    expect(parseLegalDate('10/11/2026')).toBeNull();
    expect(parseLegalDate('1899-01-01')).toBeNull();
  });
});

describe('ventana de arrepentimiento (R13.5)', () => {
  const purchase = parseLegalDate('2026-11-01')!;

  it('el día de la compra es el día 0', () => {
    expect(isWithinWithdrawalWindow(purchase, parseLegalDate('2026-11-01')!)).toBe(true);
  });

  it('el día 10 todavía está dentro y el 11 queda fuera', () => {
    expect(isWithinWithdrawalWindow(purchase, parseLegalDate('2026-11-11')!)).toBe(true);
    expect(isWithinWithdrawalWindow(purchase, parseLegalDate('2026-11-12')!)).toBe(false);
    expect(LEGAL_WITHDRAWAL_DAYS).toBe(10);
  });

  it('una fecha futura nunca está dentro', () => {
    expect(isWithinWithdrawalWindow(parseLegalDate('2026-11-20')!, purchase)).toBe(false);
  });
});

describe('validación de formularios públicos', () => {
  it('acepta un arrepentimiento completo y marca withinWindow', () => {
    const result = validateWithdrawal(
      {
        fullName: 'Kevin Pérez',
        email: 'Kevin@Taller.com',
        purchaseDate: '2026-11-01',
        paymentId: '123456789',
        declaration: true,
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.email).toBe('kevin@taller.com');
    expect(result.value.withinWindow).toBe(true);
  });

  it('rechaza falta de declaración, fecha futura y email inválido', () => {
    const result = validateWithdrawal(
      {
        fullName: 'Kevin Pérez',
        email: 'no-es-email',
        purchaseDate: '2026-11-20',
        declaration: false,
      },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.email).toBeTruthy();
    expect(result.fields.purchaseDate).toBeTruthy();
    expect(result.fields.declaration).toBeTruthy();
  });

  it('registra fuera de plazo sin bloquear la solicitud', () => {
    const result = validateWithdrawal(
      {
        fullName: 'Kevin Pérez',
        email: 'kevin@taller.com',
        purchaseDate: '2026-10-01',
        declaration: true,
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.withinWindow).toBe(false);
  });

  it('la baja exige confirmación explícita', () => {
    const missing = validateBaja({ email: 'kevin@taller.com' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.fields.confirmation).toBeTruthy();

    const ok = validateBaja({ email: 'kevin@taller.com', confirmation: true });
    expect(ok.ok).toBe(true);
  });

  it('privacidad exige derecho válido y detalle', () => {
    const result = validatePrivacy({ email: 'kevin@taller.com', dataRight: 'borrar' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.dataRight).toBeTruthy();
      expect(result.fields.message).toBeTruthy();
    }

    const ok = validatePrivacy({
      email: 'Kevin@Taller.com',
      dataRight: 'acceso',
      message: 'Quiero saber qué datos tienen.',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.dataRight).toBe('acceso');
  });
});

describe('rate limit (§6)', () => {
  it('bloquea el mismo email dentro de los 5 minutos', () => {
    const decision = legalRateLimit({
      lastEmailAtMs: NOW - 60_000,
      ipTimestampsMs: [],
      nowMs: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('email');
    expect(decision.retryAfterSeconds).toBe(240);
  });

  it('deja pasar el mismo email pasada la ventana', () => {
    const decision = legalRateLimit({
      lastEmailAtMs: NOW - LEGAL_EMAIL_RATE_WINDOW_MS,
      ipTimestampsMs: [],
      nowMs: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it('limita a 5 solicitudes por IP por hora', () => {
    const blocked = legalRateLimit({
      lastEmailAtMs: null,
      ipTimestampsMs: Array.from({ length: LEGAL_IP_RATE_MAX }, (_, i) => NOW - i * 60_000),
      nowMs: NOW,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('ip');

    const allowed = legalRateLimit({
      lastEmailAtMs: null,
      ipTimestampsMs: Array.from({ length: LEGAL_IP_RATE_MAX - 1 }, (_, i) => NOW - i * 60_000),
      nowMs: NOW,
    });
    expect(allowed.allowed).toBe(true);
  });
});

describe('token de baja de un solo uso (R13.6)', () => {
  const bytes = Uint8Array.from({ length: LEGAL_TOKEN_BYTES }, (_, i) => i);

  it('genera 64 hex y lo hashea de forma estable', () => {
    const token = generateLegalToken(bytes);
    expect(token).toHaveLength(64);
    expect(isLegalToken(token)).toBe(true);
    expect(hashLegalToken(token)).toBe(hashLegalToken(token));
    expect(hashLegalToken(token)).toHaveLength(64);
    expect(hashLegalToken(token)).not.toBe(token);
  });

  it('rechaza tokens cortos o con formato inválido', () => {
    expect(() => generateLegalToken(new Uint8Array(16))).toThrow('LEGAL_TOKEN_TOO_SHORT');
    expect(isLegalToken('abc')).toBe(false);
    expect(isLegalToken('Z'.repeat(64))).toBe(false);
  });

  it('vence a las 24 horas', () => {
    const expiresAt = legalTokenExpiresAt(NOW);
    expect(expiresAt).toBe(NOW + 24 * 60 * 60 * 1000);
    expect(isLegalTokenExpired(expiresAt, NOW)).toBe(false);
    expect(isLegalTokenExpired(expiresAt, expiresAt)).toBe(true);
    expect(isLegalTokenExpired(null, NOW)).toBe(true);
  });
});

describe('gate de aceptación del checkout (R13.7/R13.13)', () => {
  const expected = { terms: '1.0', privacy: '1.0' };

  it('exige checkbox marcado', () => {
    expect(checkCheckoutAcceptance({}, expected)).toEqual({
      ok: false,
      error: 'LEGAL_NOT_ACCEPTED',
    });
    expect(
      checkCheckoutAcceptance(
        { legalAccepted: true, termsVersion: '1.0', privacyVersion: '1.0' },
        expected,
      ),
    ).toEqual({ ok: true });
  });

  it('rechaza versiones viejas o ausentes', () => {
    expect(
      checkCheckoutAcceptance(
        { legalAccepted: true, termsVersion: '0.9', privacyVersion: '1.0' },
        expected,
      ),
    ).toEqual({ ok: false, error: 'LEGAL_VERSION_CHANGED' });
    expect(
      checkCheckoutAcceptance({ legalAccepted: true, termsVersion: '1.0' }, expected),
    ).toEqual({ ok: false, error: 'LEGAL_VERSION_CHANGED' });
  });
});

describe('defensas del formulario (§6)', () => {
  it('detecta honeypot y valida origen', () => {
    expect(isHoneypotTripped({ website: 'spam' })).toBe(true);
    expect(isHoneypotTripped({ website: '   ' })).toBe(false);

    expect(
      isReasonableOrigin({
        origin: 'https://simulador.mates',
        referer: null,
        expectedOrigin: 'https://simulador.mates',
      }),
    ).toBe(true);
    expect(
      isReasonableOrigin({
        origin: 'https://evil.example',
        referer: null,
        expectedOrigin: 'https://simulador.mates',
      }),
    ).toBe(false);
    expect(
      isReasonableOrigin({
        origin: null,
        referer: 'https://simulador.mates/baja',
        expectedOrigin: 'https://simulador.mates',
      }),
    ).toBe(true);
    expect(
      isReasonableOrigin({ origin: 'null', referer: null, expectedOrigin: 'https://x.test' }),
    ).toBe(false);
    // Sin headers (curl/health check) no se bloquea: la barrera es honeypot + rate.
    expect(
      isReasonableOrigin({ origin: null, referer: null, expectedOrigin: 'https://x.test' }),
    ).toBe(true);
  });

  it('escapa HTML y enmascara emails', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
    expect(maskEmail('kevin@taller.com')).toBe('k***n@taller.com');
    expect(maskEmail('ab@taller.com')).toBe('a***@taller.com');
    expect(maskEmail('inválido')).toBe('***');
  });
});
