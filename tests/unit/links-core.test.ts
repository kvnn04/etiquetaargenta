/* ============================================================================
 * TESTS POSICIÓN 10A — NÚCLEO DE LINKS (ÚNICA FUENTE:
 * spec_ficha_comercial_interactiva_shareable_link.md):
 * R2 (linkId 6 chars [a-z0-9] + URL canónica `/v/`), R4 (payload
 * schemaVersion 2: fracción 0–1.10 / grados módulo 360 / labels ≤40),
 * R5 (vigencia 30 días + por-vencer ≤5 días) y R8 (mensaje wa.me pre-armado).
 * Módulos PUROS: el `rand` y el `isTaken` se inyectan (sin DB, sin envs).
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  LINK_ID_LENGTH,
  LINK_ID_PATTERN,
  canonicalizeLinkId,
  generateLinkId,
  generateUniqueLinkId,
} from '@/lib/links/identity';
import {
  LINK_LABEL_MAX,
  LINK_SCHEMA_VERSION,
  buildLinkPayload,
  isLegacyPayload,
  isPublishableDraft,
  normalizeVariantLabel,
  rotationDegPayload,
  scaleFractionFromPct,
  type LinkVariantDraft,
  type LinkVariantId,
} from '@/lib/links/payload';
import {
  LINK_TTL_DAYS,
  LINK_TTL_MS,
  LINK_WARN_DAYS,
  canonicalLinkUrl,
  editionBadgeText,
  linkDaysLeft,
  linkEditionState,
  whatsappShareHref,
  whatsappShareText,
} from '@/lib/links/states';

/** LCG determinista (mulberry32) — igual semilla ⇒ misma secuencia. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** t0: 06-nov-2026 12:00 UTC — los ISO salen a exactamente ese instante. */
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

const draft = (over: Partial<LinkVariantDraft> = {}): LinkVariantDraft => ({
  id: 'A',
  label: 'Opción A: Iniciales Clásicas',
  scalePct: 92,
  rotationDeg: 225,
  mirror: false,
  ...over,
});

describe('R2 — linkId: alfabeto [a-z0-9], 6 chars, reintentos', () => {
  it('genera EXACTO el largo y patrón canónico (36⁶ de espacio)', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateLinkId(mulberry32(i + 42))).toMatch(LINK_ID_PATTERN);
      expect(generateLinkId(mulberry32(i + 42))).toHaveLength(LINK_ID_LENGTH);
    }
  });

  it('rand inyectable ⇒ extremos deterministas del alfabeto', () => {
    expect(generateLinkId(() => 0)).toBe('aaaaaa');
    expect(generateLinkId(() => 0.999999999)).toBe('999999');
  });

  it('generateUniqueLinkId: primera libre gana; colisión ⇒ reintenta', async () => {
    const seen: string[] = [];
    const taken = new Set();
    const id = await generateUniqueLinkId(async (c) => {
      seen.push(c);
      return taken.has(c);
    }, mulberry32(7));
    expect(seen).toContain(id);
    expect(seen).toHaveLength(1);
  });

  it('generateUniqueLinkId: 2 colisiones seguidas ⇒ tercera libre', async () => {
    let calls = 0;
    const isTaken = async (): Promise<boolean> => {
      calls += 1;
      return calls <= 2; // primeras dos candidatas tomadas
    };
    const id = await generateUniqueLinkId(isTaken, mulberry32(11));
    expect(calls).toBe(3);
    expect(id).toMatch(LINK_ID_PATTERN);
  });

  it('agotados todos los intentos ⇒ error dominio con motivo', async () => {
    await expect(generateUniqueLinkId(async () => true, mulberry32(3), 3)).rejects.toThrow(
      'LINK_ID_COLLISION',
    );
  });
});

describe('R2 — canonicalizeLinkId: consultas sin distinción de mayúsculas', () => {
  it('acepta mayúsculas y trozos pegados de URL (`/v/3A8F9B`)', () => {
    expect(canonicalizeLinkId('3A8F9B')).toBe('3a8f9b');
    expect(canonicalizeLinkId('  https://simulador.com/v/3A8F9B?utm=x ')).toBe('3a8f9b');
    expect(canonicalizeLinkId('/v/abcdef')).toBe('abcdef');
  });

  it('rechaza basura: corto, largo, alfabeto raro, no-string, vacío', () => {
    expect(canonicalizeLinkId('abcde')).toBeNull();
    expect(canonicalizeLinkId('abcdef0')).toBeNull();
    expect(canonicalizeLinkId('abc-ef')).toBeNull();
    expect(canonicalizeLinkId('abc_ée')).toBeNull();
    expect(canonicalizeLinkId(null)).toBeNull();
    expect(canonicalizeLinkId(123456)).toBeNull();
  });
});

describe('R4/§6 — label: ≤ 40 con truncado elegante (palabra jamás a mitades)', () => {
  it('limpia espacios dobles y bordes sin tocar labels cortos', () => {
    expect(normalizeVariantLabel('Opción A:  Iniciales   Clásicas   ')).toBe(
      'Opción A: Iniciales Clásicas',
    );
  });

  it('trunca al último espacio previo al límite', () => {
    const label = 'alfa bravo charlie delta echo foxtrot golf'; // 42 chars
    expect(normalizeVariantLabel(label)).toBe('alfa bravo charlie delta echo foxtrot'); // 37
    expect(normalizeVariantLabel(label).length).toBeLessThanOrEqual(LINK_LABEL_MAX);
  });

  it('sin espacios útiles (palabra solitaria) ⇒ corte duro sin basura', () => {
    expect(normalizeVariantLabel('xxxxx'.repeat(9))).toBe('x'.repeat(LINK_LABEL_MAX));
  });

  it('no-string ⇒ vacío (el route validará la publicación, no rompe)', () => {
    expect(normalizeVariantLabel(null)).toBe('');
    expect(normalizeVariantLabel(42)).toBe('');
  });
});

describe('R4 — serialization canónica: fracción 0–1.10 / módulo 360', () => {
  it('escala: % del editor ⇒ fracción con 3 decimales (0.92, 0.925, 1.1)', () => {
    expect(scaleFractionFromPct(100)).toBe(1);
    expect(scaleFractionFromPct(92)).toBe(0.92);
    expect(scaleFractionFromPct(92.3)).toBe(0.925); // paso 0.5% de pos 7 primero
    expect(scaleFractionFromPct(110)).toBe(1.1);
    expect(scaleFractionFromPct(70)).toBe(0.7);
    expect(scaleFractionFromPct(Number.NaN)).toBe(1); // R8: basura ⇒ 100% ⇒ 1
  });

  it('rotación: módulo 360 canónico con el paso 0.5° de pos 6', () => {
    expect(rotationDegPayload(370)).toBe(10);
    expect(rotationDegPayload(-90)).toBe(270);
    expect(rotationDegPayload(45.25)).toBe(45.5);
    expect(rotationDegPayload(Number.NaN)).toBe(0); // R8
  });
});

describe('§6 — publicable: ≥1 y ≤3 variantes, ids únicos A/B/C con label', () => {
  it('acepta 1..3 y rechaza 0, 4, duplicados, ids raros y labels vacíos', () => {
    expect(isPublishableDraft([draft()])).toBe(true);
    expect(isPublishableDraft([draft(), draft({ id: 'B' }), draft({ id: 'C' })])).toBe(true);
    expect(isPublishableDraft([])).toBe(false);
    expect(
      isPublishableDraft([draft(), draft({ id: 'B' }), draft({ id: 'C' }), draft({ id: 'A' })]),
    ).toBe(false); // 4 (A repetida
    expect(isPublishableDraft([draft(), draft({ id: 'A' })])).toBe(false); // ids duplicados
    expect(isPublishableDraft([draft({ label: '   ' })])).toBe(false);
    expect(isPublishableDraft([draft({ id: 'D' as LinkVariantId })])).toBe(false); // D jamás existió
  });
});

describe('R4 — buildLinkPayload: schemaVersion 2 congelado al publicar', () => {
  it('forma EXACTA: fracción, módulo, label limpio y assetUrl COMPARTIDO', () => {
    const payload = buildLinkPayload({
      linkId: '3a8f9b',
      nowMs: T0,
      expiresMs: T0 + LINK_TTL_MS,
      workshop: {
        name: 'Etiqueta Argenta',
        logoUrl: 'https://cdn.example/logo.png',
        whatsapp: '5491112345678',
        instagram: 'etiqueta.argenta',
      },
      mateConfig: {
        model: 'imperial',
        extDiameter: 123,
        intDiameter: 95,
        metal: 'alpaca',
        virolaColor: '#2A2A2A',
        topFaceColor: null, // compat legacy (R6 pos 5)
        cupMaterial: 'algarrobo',
        cupColor: '#E6C48E',
      },
      variants: [draft(), draft({ id: 'B', label: 'Opción B: Escudo', scalePct: 110, rotationDeg: 370, mirror: true })],
      assetUrl: 'https://supabase.example/storage/v1/object/public/link-assets/3a8f9b/design.png',
    });
    expect(payload.schemaVersion).toBe(LINK_SCHEMA_VERSION);
    expect(payload.schemaVersion).toBe(2); // pin exacto de la spec (§3-R4)
    expect(payload.linkId).toBe('3a8f9b');
    expect(new Date(payload.createdAt).getTime()).toBe(T0);
    expect(new Date(payload.expiresAt).getTime()).toBe(T0 + LINK_TTL_MS);

    const [a, b] = payload.variants;
    expect(a!.id).toBe('A');
    expect(a!.label).toBe('Opción A: Iniciales Clásicas');
    expect(a!.scale).toBe(0.92); // fracción (R4), no %
    expect(a!.rotation).toBe(225);
    expect(a!.assetUrl).toContain('link-assets/3a8f9b/design.png');
    expect(b!.id).toBe('B');
    expect(b!.scale).toBe(1.1); // 110 % ⇒ 1.10
    expect(b!.rotation).toBe(10); // 370° módulo 360
    expect(b!.mirror).toBe(true);
    // Decisión 10A: las variantes son configs del mismo diseño ⇒ una sola URL
    expect(a!.assetUrl).toBe(b!.assetUrl);
  });

  it('compat R4: payload sin schemaVersion o con 1 ⇒ RUTA LEGADO (1:1)', () => {
    expect(isLegacyPayload({})).toBe(true);
    expect(isLegacyPayload({ schemaVersion: 1 })).toBe(true);
    expect(isLegacyPayload({ schemaVersion: 2 })).toBe(false);
  });
});

describe('R5 — vigencia: 30 días exactos con umbral por-venir de 5', () => {
  it('constantes EXACTAS de la spec', () => {
    expect(LINK_TTL_DAYS).toBe(30);
    expect(LINK_TTL_MS).toBe(30 * 86_400_000);
    expect(LINK_WARN_DAYS).toBe(5);
  });

  it('daysLeft techo (0 al vencer)', () => {
    expect(linkDaysLeft(T0 + LINK_TTL_MS, T0)).toBe(30);
    expect(linkDaysLeft(T0, T0)).toBe(0);
    expect(linkDaysLeft(T0 - 1, T0)).toBe(0); // vencido no muestra negativos
    expect(linkDaysLeft(T0 + 1.5 * 86_400_000, T0)).toBe(2);
  });

  it('estados del editor: prioridad aprobado > vencido > por_vencer > vigente', () => {
    expect(linkEditionState({ expiresAtMs: T0 + LINK_TTL_MS, approved: false }, T0)).toBe('vigente');
    // Umbral ≤ 5 días inclusive (R5: "≤ 5 días")
    expect(linkEditionState({ expiresAtMs: T0 + 5 * 86_400_000, approved: false }, T0)).toBe('por_vencer');
    expect(linkEditionState({ expiresAtMs: T0 + 5 * 86_400_000 + 1, approved: false }, T0)).toBe('vigente');
    expect(linkEditionState({ expiresAtMs: T0, approved: false }, T0)).toBe('vencido');
    expect(linkEditionState({ expiresAtMs: T0 - 1, approved: false }, T0)).toBe('vencido');
    // La aprobación gana el badge aunque la vigencia se haya pasado (el propio
    // R5 pinta ambos datos; el badge con la Opción es el estado)
    expect(linkEditionState({ expiresAtMs: T0 - 1, approved: true }, T0)).toBe('aprobado');
  });

  it('texto del badge EXACTO (R6 badge "APROBADO Opción B")', () => {
    expect(editionBadgeText('vigente', null)).toBe('VIGENTE');
    expect(editionBadgeText('por_vencer', null)).toBe('POR VENCER');
    expect(editionBadgeText('vencido', null)).toBe('VENCIDO');
    expect(editionBadgeText('aprobado', 'B')).toBe('APROBADO Opción B');
    expect(editionBadgeText('aprobado', null)).toBe('APROBADO');
  });
});

describe('R2/R8 — URL canónica + cierre por WhatsApp', () => {
  it('URL canónica `{origin}/v/{id}` normalizada (2 inclusive)', () => {
    expect(canonicalLinkUrl('3A8F9B', 'https://simulador.com')).toBe('https://simulador.com/v/3a8f9b');
    expect(canonicalLinkUrl('3a8f9b', 'https://simulador.com/')).toBe('https://simulador.com/v/3a8f9b');
  });

  it('texto pre-armado EXACTO de la spec §4 con el link inserido', () => {
    expect(whatsappShareText('https://simulador.com/v/3a8f9b')).toBe(
      '¡Hola! Te comparto la propuesta interactiva en 3D para tu mate personalizado: https://simulador.com/v/3a8f9b. Podés girarlo y elegir tu opción favorita.',
    );
  });

  it('wa.me/{E164}?text= url-encoded (R8); sin PhoneNumber válido ⇒ null', () => {
    const url = 'https://simulador.com/v/3a8f9b';
    const href = whatsappShareHref('+5491112345678', url);
    expect(href).toBe(`https://wa.me/5491112345678?text=${encodeURIComponent(whatsappShareText(url))}`);
    // El '+', espacios y guiones del E164 humano ⇒ solo dígitos
    expect(whatsappShareHref('+54 9 11 1234-5678', url)).toBe(
      `https://wa.me/5491112345678?text=${encodeURIComponent(whatsappShareText(url))}`,
    );
    expect(whatsappShareHref(null, url)).toBeNull(); // Copiar Enlace solitario
    expect(whatsappShareHref('12345', url)).toBeNull(); // jamás wa.me inválido
  });
});
