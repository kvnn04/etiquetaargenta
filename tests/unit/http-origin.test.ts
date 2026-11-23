import { describe, expect, it } from 'vitest';
import { publicRequestOrigin } from '@/lib/http/origin';

/* ============================================================================
 * Origin para back_urls de MP (QA 23-nov-2026)
 * ----------------------------------------------------------------------------
 * Regresión real: Next dev devuelve nextUrl.origin = http://localhost:3100
 * aunque el server escuche en 127.0.0.1; MP rechaza `localhost` como back_url.
 * ========================================================================== */

describe('publicRequestOrigin', () => {
  it('prefiere el Host real sobre nextUrl.origin (Next dev)', () => {
    expect(
      publicRequestOrigin({
        nextUrlOrigin: 'http://localhost:3100',
        nextUrlProtocol: 'http:',
        host: '127.0.0.1:3100',
        forwardedProto: null,
      }),
    ).toBe('http://127.0.0.1:3100');
  });

  it('normaliza localhost a 127.0.0.1 (MP no acepta localhost)', () => {
    expect(
      publicRequestOrigin({
        nextUrlOrigin: 'http://localhost:3000',
        nextUrlProtocol: 'http:',
        host: 'localhost:3000',
        forwardedProto: null,
      }),
    ).toBe('http://127.0.0.1:3000');
  });

  it('respeta el protocolo HTTPS del proxy', () => {
    expect(
      publicRequestOrigin({
        nextUrlOrigin: 'http://internal:3000',
        nextUrlProtocol: 'http:',
        host: 'simuladormates.com',
        forwardedProto: 'https',
      }),
    ).toBe('https://simuladormates.com');
  });

  it('toma el primer valor de x-forwarded-proto y limpia la barra final', () => {
    expect(
      publicRequestOrigin({
        nextUrlOrigin: 'http://internal:3000/',
        nextUrlProtocol: 'http:',
        host: 'simuladormates.com/',
        forwardedProto: 'https, http',
      }),
    ).toBe('https://simuladormates.com');
  });

  it('sin Host cae a nextUrl.origin', () => {
    expect(
      publicRequestOrigin({
        nextUrlOrigin: 'https://simuladormates.com',
        nextUrlProtocol: 'https:',
        host: null,
        forwardedProto: null,
      }),
    ).toBe('https://simuladormates.com');
  });

  it('NO toca un host que solo empieza con "localhost"', () => {
    expect(
      publicRequestOrigin({
        nextUrlOrigin: 'http://localhost:3000',
        nextUrlProtocol: 'http:',
        host: 'localhost.evil.com',
        forwardedProto: null,
      }),
    ).toBe('http://localhost.evil.com');
  });
});
