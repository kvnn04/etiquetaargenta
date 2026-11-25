import { describe, expect, it } from 'vitest';
import {
  APPROVAL_LEGEND,
  MOCAP_FALLBACK_TITLE,
  approvalCode,
  digitsOnly,
  initialsOf,
  normalizeInstagram,
  resolveBranding,
  splitE164,
  toE164,
} from '@/lib/branding';
import { completionCopy, completionPct } from '@/lib/profile';

/* =====================================================================
 * SPEC registro §3-R3/R5/R6 + §4: los fallbacks son canónicos y ÚNICOS.
 * ===================================================================== */

describe('initialsOf (escudo de iniciales R3)', () => {
  it('toma hasta las primeras 2 palabras', () => {
    expect(initialsOf('Kevin Firma')).toBe('KF');
  });
  it('inutilizable ⇒ MT (ej. solo números)', () => {
    expect(initialsOf('12345')).toBe('MT');
    expect(initialsOf('')).toBe('MT');
    expect(initialsOf(null)).toBe('MT');
  });
  it('una palabra ⇒ 1 inicial', () => {
    expect(initialsOf('Taller')).toBe('T');
  });
});

describe('fallback de nombre (R3)', () => {
  it('sin nada ⇒ título de plataforma', () => {
    const resolved = resolveBranding({}, { plan: 'free' });
    expect(resolved.title).toBe(MOCAP_FALLBACK_TITLE);
    expect(resolved.initials).toBe('MT');
  });
  it('displayName (derivado útil) actúa como fallback del nombre comercial', () => {
    const resolved = resolveBranding({ displayName: 'Kevin Firma' }, { plan: 'free' });
    expect(resolved.title).toBe('Kevin Firma');
  });
  it("el derivado genérico 'MI TALLER' NO se imprime: va el fallback de plataforma", () => {
    const resolved = resolveBranding({ displayName: 'MI TALLER' }, { plan: 'free' });
    expect(resolved.title).toBe(MOCAP_FALLBACK_TITLE);
    expect(resolved.initials).toBe('MT'); // escudo sí lo usa
  });
  it('brandName pisa al derivado', () => {
    const resolved = resolveBranding(
      { displayName: 'Kevin Firma', brandName: 'Firma Láser Studio' },
      { plan: 'pro' },
    );
    expect(resolved.title).toBe('Firma Láser Studio');
  });
});

describe('logo en outputs según plan (matriz R2 — white-label PRO)', () => {
  const profile = { logoThumbUrl: 'branding/seen/logo_thumb.webp' } as const;
  it('FREE ve el fallback aunque haya subido logo', () => {
    const resolved = resolveBranding(profile, { plan: 'free' });
    expect(resolved.logoAllowed).toBe(false);
    expect(resolved.logoThumbUrl).toBeNull();
  });
  it('PRO y PRO_GRACE sí aprovechan el logo cargado', () => {
    expect(resolveBranding(profile, { plan: 'pro' }).logoThumbUrl).toBe(profile.logoThumbUrl);
    expect(resolveBranding(profile, { plan: 'pro_grace' }).logoAllowed).toBe(true);
  });
});

describe('whatsapp E.164 (§6)', () => {
  it('digitsOnly filtra lo pegado del clipboard', () => {
    expect(digitsOnly('11 2345-6789')).toBe('1123456789');
  });
  it('cota 10–15 totales con prefijo', () => {
    expect(toE164('54', '1123456789')).toBe('+541123456789');
    expect(toE164('54', '54')).toBeNull();
    expect(toE164('54', '112345678901234')).toBeNull(); // 16 total
  });
  it('tira el 0 inicial para el formato E.164', () => {
    expect(toE164('54', '01123456789')).toBe('+541123456789');
  });
});

describe('splitE164 (el select debe mostrar el país guardado)', () => {
  it('Argentina +54 no se parte como +541', () => {
    expect(splitE164('+541151351658')).toEqual({
      prefix: '54',
      local: '1151351658',
    });
  });
  it('respeta prefijos de 3 dígitos (Paraguay +595)', () => {
    expect(splitE164('+595981123456')).toEqual({
      prefix: '595',
      local: '981123456',
    });
  });
  it('US/Canadá +1', () => {
    expect(splitE164('+12125550123')).toEqual({
      prefix: '1',
      local: '2125550123',
    });
  });
  it('vacío ⇒ Argentina por defecto', () => {
    expect(splitE164('')).toEqual({ prefix: '54', local: '' });
  });
  it('round-trip: split + toE164 conserva el número', () => {
    const { prefix, local } = splitE164('+541151351658');
    expect(toE164(prefix, local)).toBe('+541151351658');
  });
});

describe('CTA de aprobación (R3/R5) — palette de degradación', () => {
  it('con WhatsApp válido ⇒ wa.me sin el +', () => {
    const resolved = resolveBranding(
      { whatsappE164: '+541123456789' },
      { plan: 'free', variant: 'B', linkId: '3a8f9b' },
    );
    expect(resolved.cta).toEqual({ kind: 'whatsapp', href: 'https://wa.me/541123456789' });
  });
  it('sin WhatsApp válido ⇒ código APROBADA-…, jamás un wa.me inválido', () => {
    const resolved = resolveBranding(
      { whatsappE164: '+5411' },
      { variant: 'B', linkId: '3a8f9b' },
    );
    expect(resolved.cta).toEqual({
      kind: 'code',
      code: 'APROBADA-B-3A8F9B',
      legend: APPROVAL_LEGEND,
      helper: expect.stringContaining('Opción B'),
    });
  });
  it('formato exacto del código: mayúsculas + variante única', () => {
    expect(approvalCode('b', '3a8f9b')).toBe('APROBADA-B-3A8F9B');
    expect(approvalCode('C', 'a-b/c')).toBe('APROBADA-C-ABC'); // letras y dígitos solamente
  });
});

describe('Instagram (§6 normalización)', () => {
  it('strip @ + minúsculas', () => {
    expect(normalizeInstagram('@Taller.DelValle')).toBe('taller.delvalle');
  });
  it('permite letras/números/._ y bloquea lo demás', () => {
    expect(normalizeInstagram('taller_delvalle')).toBe('taller_delvalle');
    expect(normalizeInstagram('taller delvalle')).toBeNull();
    expect(normalizeInstagram('hot 🔥')).toBeNull();
  });
  it('30 caracteres máximo', () => {
    expect(normalizeInstagram('a'.repeat(30))).toBe('a'.repeat(30));
    expect(normalizeInstagram('a'.repeat(31))).toBeNull();
  });
});

describe('ubicación interna jamás impresa (R2 del módulo)', () => {
  it('el resuelto no exponga location aunque la fila la tenga', () => {
    const resolved = resolveBranding(
      { brandName: 'Firma', location: 'Vicente López' } as never,
      { plan: 'pro' },
    );
    expect(Object.keys(resolved)).not.toContain('location');
    expect(JSON.stringify(resolved)).not.toContain('Vicente');
  });
});

describe('completitud del perfil (§4: 5 campos × 20 %)', () => {
  const fully = {
    logoUrl: 'branding/u/logo.webp',
    whatsappE164: '+541123456789',
    brandName: 'Firma',
    instagramHandle: 'firma.laser',
    location: 'Bernal',
  };
  it('vacío ⇒ 0 %, completo ⇒ 100 %', () => {
    expect(completionPct({ logoUrl: null, whatsappE164: null, brandName: null, instagramHandle: null, location: null })).toBe(0);
    expect(completionPct(fully)).toBe(100);
  });
  it('+20 % por cada campo', () => {
    expect(completionPct({ ...fully, location: null })).toBe(80);
    expect(completionPct({ ...fully, instagramHandle: null, location: null })).toBe(60);
  });
  it('el copy menciona porcentaje y prioriza WhatsApp primero', () => {
    const copy = completionCopy({ ...fully, whatsappE164: null });
    expect(copy).toMatch(/^Perfil al 80 % — así se imprimirá en tus fichas\./);
    expect(copy).toContain('WhatsApp');
  });
  it('al 100 % el copy se compone con el caso perfecto', () => {
    expect(completionCopy(fully)).toContain('Perfil al 100 %');
  });
});
