/* ============================================================================
 * TESTS POSICIÓN 10A — MODO CLIENTE (ÚNICA FUENTE:
 * spec_ficha_comercial_interactiva_shareable_link.md §4/§6 + spec_usuario R5):
 * · código de aprobación EXACTO `APROBADA-{VARIANTE}-{LINKID}` (fallback sin
 *   WhatsApp, evento registrado igual, R6);
 * · texto wa.me de aprobación nombrando la opción EXACTA (R6);
 * · buildPublicView: re-arbitra los contratos del payload (fracción→%,
 *   módulo 360, labels ≤40, model fallback camionero QA, diámetros saneados),
 *   gating por asset ausente (variante deshabilitada, §6) y compat legacy 1:1.
 * Módulos PUROS: sin DB, sin envs, sin canvas.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import { buildPublicView } from '@/lib/links/view-shape';
import { approvalCode, whatsappApprovalHref, whatsappApprovalText } from '@/lib/links/states';
import { LINK_LABEL_MAX, LINK_SCHEMA_VERSION, type LinkPayload } from '@/lib/links/payload';

/* ── Specs ejemplo freezer del payload v2 (idéntica a la que congela el POST) ── */
function payloadFixture(overrides?: Partial<LinkPayload>): LinkPayload {
  return {
    schemaVersion: LINK_SCHEMA_VERSION,
    linkId: '3a8f9b',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-31T00:00:00.000Z',
    workshop: { name: 'Taller Karina', logoUrl: null, whatsapp: '5491100000000', instagram: null },
    mateConfig: {
      model: 'imperial',
      extDiameter: 135,
      intDiameter: 108,
      metal: 'bronce',
      virolaColor: null,
      topFaceColor: null,
      cupMaterial: 'algarrobo',
      cupColor: null,
    },
    variants: [
      {
        id: 'A',
        label: 'Bandera Titular',
        assetUrl: 'https://cdn.example.com/link-assets/3a8f9b/design.png',
        scale: 0.925,
        rotation: 10,
        mirror: false,
        risk: null,
      },
      {
        id: 'B',
        label: 'Bandera Suplente',
        assetUrl: '', // sin asset ⇒ variante deshabilitada (§6), A/C siguen
        scale: 1.05,
        rotation: 370, // módulo 360 ⇒ 10°
        mirror: true,
        risk: null,
      },
    ],
    ...overrides,
  };
}

describe('R5 (spec usuario) — código de aprobación sin WhatsApp', () => {
  it('formato EXACTO APROBADA-{VARIANTE}-{LINKID} en mayúsculas (ej. APROBADA-B-3A8F9B)', () => {
    expect(approvalCode('3a8f9b', 'B')).toBe('APROBADA-B-3A8F9B');
    expect(approvalCode('a1b2c3', 'C')).toBe('APROBADA-C-A1B2C3');
  });
});

describe('R6 — cierre por WhatsApp nombrando la opción EXACTA', () => {
  it('el texto incluye el label congelado, jamás una etiqueta genérica', () => {
    const text = whatsappApprovalText('https://mocap.app/v/3a8f9b', 'Bandera Titular');
    expect(text).toContain('Bandera Titular');
    expect(text).toContain('https://mocap.app/v/3a8f9b');
  });

  it('wa.me con SOLO dígitos y texto URL-encodeado (E.164 con + se pelan símbolos)', () => {
    const href = whatsappApprovalHref('+54 9 11 5555-0000', 'https://mocap.app/v/3a8f9b', 'Opción X');
    expect(href).toContain('https://wa.me/5491155550000?text=');
    expect(href).toContain(encodeURIComponent('"Opción X"'));
  });

  it('aprobación sin número válido ⇒ null (nunca wa.me inválido; el share ya no depende del Perfil)', () => {
    expect(whatsappApprovalHref(null, 'https://mocap.app/v/3a8f9b', 'Opción A')).toBeNull();
    expect(whatsappApprovalHref('+123', 'https://mocap.app/v/3a8f9b', 'Opción A')).toBeNull();
  });
});

describe('buildPublicView — re-arbitra los contratos del payload (§6/QA1)', () => {
  it('versión 2: fracción→%, módulo 360, espejo y gating por asset ausente', () => {
    const view = buildPublicView(payloadFixture());
    expect(view.linkId).toBe('3a8f9b');
    expect(view.mate.modelId).toBe('imperial');
    expect(view.mate.extDiameter).toBe(135);
    expect(view.mate.intDiameter).toBe(108);

    const [a, b] = view.variants;
    expect(a.scalePct).toBe(92.5); // fracción 0.925 ⇒ 92.5% canónico
    expect(a.rotationDeg).toBe(10);
    expect(a.mirror).toBe(false);
    expect(a.healthy).toBe(true);

    expect(b.healthy).toBe(false); // sin assetUrl ⇒ "no disponible"
    expect(b.scalePct).toBe(105); // 1.05 ⇒ 105%
    expect(b.rotationDeg).toBe(10); // 370 ⇒ módulo 360
    expect(b.mirror).toBe(true);
  });

  it('model desconocido ⇒ camionero (QA/R4); diámetros basura ⇒ defaults geométricos', () => {
    const view = buildPublicView(
      payloadFixture({
        mateConfig: {
          model: 'imperial-x-desconocido',
          extDiameter: -5,
          intDiameter: 99999, // hueco ≥ corona: imposible
          metal: '',
          virolaColor: 'no-es-hex',
          topFaceColor: null,
          cupMaterial: '',
          cupColor: null,
        },
      }),
    );
    expect(view.mate.modelId).toBe('camionero');
    expect(view.mate.extDiameter).toBe(123);
    expect(view.mate.intDiameter).toBe(95);
    expect(view.mate.metal).toBe('alpaca'); // preset vacío ⇒ default
    expect(view.mate.cupMaterial).toBe('algarrobo');
    expect(view.mate.virolaColor).toBeNull();
  });

  it('labels >40 llegan truncados ▬mismos del payload (normalizeVariantLabel)', () => {
    const longLabel = 'B'.repeat(80);
    const view = buildPublicView(
      payloadFixture({
        variants: [
          {
            id: 'A',
            label: longLabel,
            assetUrl: 'https://cdn.example.com/x.png',
            scale: 1,
            rotation: 0,
            mirror: false,
            risk: null,
          },
        ],
      }),
    );
    expect(view.variants[0].label.length).toBeLessThanOrEqual(LINK_LABEL_MAX);
  });

  it('quirk legacy 1:1 (schemaVersion ≤1 + textureDataUrl) ⇒ UNA variante A', () => {
    const view = buildPublicView({
      schemaVersion: 1,
      linkId: 'zz9w8x',
      mateModel: 'imperial',
      extDiameter: 99,
      intDiameter: 76,
      metalPreset: 'bronce',
      virolaColor: null,
      bodyPreset: 'algarrobo',
      bodyColor: null,
      textureDataUrl: 'data:image/png;base64,QUJD',
    });
    expect(view.mate.modelId).toBe('imperial');
    expect(view.workshop.whatsapp).toBeNull(); // legacy no congelaba branding
    expect(view.variants.length).toBe(1);
    expect(view.variants[0].id).toBe('A');
    expect(view.variants[0].healthy).toBe(true);
    expect(view.variants[0].assetUrl.startsWith('data:image/')).toBe(true);
    expect(view.variants[0].scalePct).toBe(100); // legacy: sin config por variante
  });

  it('jsonb basura ⇒ vista vacía polite (sin variantes útiles, nunca lanza)', () => {
    const view = buildPublicView(null);
    // ruta legacy tolerante: UNA variante 'A' sin asset ⇒ deshabilitada (healthy false)
    expect(view.variants.length).toBe(1);
    expect(view.variants[0].healthy).toBe(false);
    expect(view.workshop.whatsapp).toBeNull();

    const broken = buildPublicView({ variants: [{ id: 'Z' }], workshop: undefined } as unknown);
    expect(broken.workshop.name.length).toBeGreaterThan(0); // "MOCAP 3D" tolito
    expect(broken.variants.filter((v) => v.healthy).length).toBe(0);
  });

  it('variantes inválidas (id inexistente/duplicado) se caen del visor', () => {
    const view = buildPublicView(
      payloadFixture({
        variants: [
          { id: 'A', label: 'X', assetUrl: 'https://cdn.example.com/a.png', scale: 1, rotation: 0, mirror: false, risk: null },
          { id: 'A', label: 'dup', assetUrl: 'https://cdn.example.com/b.png', scale: 1, rotation: 0, mirror: false, risk: null },
          { id: 'Z', label: 'rota', assetUrl: 'https://cdn.example.com/z.png', scale: 1, rotation: 0, mirror: false, risk: null },
        ],
      } as unknown as Partial<LinkPayload>),
    );
    expect(view.variants.map((v) => v.id)).toEqual(['A']);
  });
});

