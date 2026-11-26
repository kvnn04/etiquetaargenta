import { describe, expect, it } from 'vitest';
import {
  canonicalSiteOrigin,
  checkoutBackUrlOrigin,
  publicRequestOrigin,
} from '@/lib/http/origin';

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

describe('checkoutBackUrlOrigin', () => {
  const request = {
    nextUrlOrigin: 'https://preview-abc.vercel.app',
    nextUrlProtocol: 'https:',
    host: 'preview-abc.vercel.app',
    forwardedProto: 'https',
  };

  it('en producción prefiere el origin canónico configurado sobre el Host', () => {
    expect(
      checkoutBackUrlOrigin(request, {
        VERCEL_ENV: 'production',
        MP_PUBLIC_ORIGIN: 'https://etiquetaargenta.vercel.app/',
      }),
    ).toBe('https://etiquetaargenta.vercel.app');
  });

  it('en producción usa NEXT_PUBLIC_SITE_URL si MP_PUBLIC_ORIGIN está vacío', () => {
    expect(
      checkoutBackUrlOrigin(request, {
        VERCEL_ENV: 'production',
        MP_PUBLIC_ORIGIN: '',
        NEXT_PUBLIC_SITE_URL: 'https://etiquetaargenta.vercel.app/',
      }),
    ).toBe('https://etiquetaargenta.vercel.app');
  });

  it('en preview prefiere MP_PUBLIC_ORIGIN para no volver a un deploy efímero', () => {
    expect(
      checkoutBackUrlOrigin(request, {
        VERCEL_ENV: 'preview',
        MP_PUBLIC_ORIGIN: 'https://etiquetaargenta-gilt.vercel.app/',
        NEXT_PUBLIC_SITE_URL: 'https://etiquetaargenta.vercel.app',
      }),
    ).toBe('https://etiquetaargenta-gilt.vercel.app');
  });

  it('en local usa NEXT_PUBLIC_SITE_URL si MP_PUBLIC_ORIGIN está vacío', () => {
    expect(
      checkoutBackUrlOrigin(
        { ...request, host: '127.0.0.1:3100', nextUrlOrigin: 'http://127.0.0.1:3100' },
        { MP_PUBLIC_ORIGIN: '', NEXT_PUBLIC_SITE_URL: 'https://etiquetaargenta-gilt.vercel.app' },
      ),
    ).toBe('https://etiquetaargenta-gilt.vercel.app');
  });

  it('sin origin configurado cae al Host de la request', () => {
    expect(checkoutBackUrlOrigin(request, {})).toBe('https://preview-abc.vercel.app');
  });
});

describe('canonicalSiteOrigin', () => {
  it('usa NEXT_PUBLIC_SITE_URL y limpia la barra final', () => {
    expect(
      canonicalSiteOrigin(
        'https://preview-abc.vercel.app',
        'https://etiquetaargenta.vercel.app/',
      ),
    ).toBe('https://etiquetaargenta.vercel.app');
  });

  it('sin NEXT_PUBLIC_SITE_URL conserva el origin actual', () => {
    expect(canonicalSiteOrigin('https://preview-abc.vercel.app/', undefined)).toBe(
      'https://preview-abc.vercel.app',
    );
  });
});
