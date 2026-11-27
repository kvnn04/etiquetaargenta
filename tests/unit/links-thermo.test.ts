/* ============================================================================
 * LINKS DEL TERMO — payload congelado + visor público
 * ----------------------------------------------------------------------------
 * El link del termo conserva el contrato del mate y suma:
 *   · familia thermo en `mateConfig` (el modelo del catálogo es la verdad);
 *   · bloque `thermo` (posición vertical, invertido y acabado);
 *   · escala en el rango del termo [10,100] (no el [70,110] del mate);
 *   · medidas fijas del termo en el visor (sin virola).
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  buildLinkPayload,
  buildPublishVariant,
  normalizeVariantRows,
  scaleFractionFromPct,
  type LinkMateConfigBlock,
} from '@/lib/links/payload';
import { buildPublicView } from '@/lib/links/view-shape';

const WORKSHOP = {
  name: 'Taller Karina',
  logoUrl: null,
  whatsapp: '5491100000000',
  instagram: null,
};

const THERMO_MATE: LinkMateConfigBlock = {
  model: 'termo-media-manija-1l',
  extDiameter: 80.64,
  intDiameter: 80.64,
  metal: 'alpaca',
  virolaColor: null,
  topFaceColor: null,
  cupMaterial: 'algarrobo',
  cupColor: '#181A1F',
  family: 'thermo',
  thermo: { offsetYPct: 20, invert: true, finish: 'satin' },
};

function thermoPayload(overrides: Partial<LinkMateConfigBlock> = {}, scalePct = 45) {
  return buildLinkPayload({
    linkId: '3a8f9b',
    nowMs: Date.UTC(2026, 0, 1),
    expiresMs: Date.UTC(2026, 0, 31),
    workshop: WORKSHOP,
    mateConfig: { ...THERMO_MATE, ...overrides },
    variants: [
      {
        id: 'A',
        label: 'Diseño actual',
        scalePct,
        rotationDeg: 90,
        mirror: false,
      },
    ],
    assetUrl: 'https://cdn.example.com/link-assets/3a8f9b/design.png',
  });
}

describe('payload del termo — fracción de escala por familia', () => {
  it('45 % del termo ⇒ 0.45 (no se clampa al mínimo mate de 70 %)', () => {
    expect(scaleFractionFromPct(45, 'thermo')).toBe(0.45);
    expect(scaleFractionFromPct(10, 'thermo')).toBe(0.1);
    expect(scaleFractionFromPct(100, 'thermo')).toBe(1);
  });

  it('un mate conserva el contrato [70,110]', () => {
    expect(scaleFractionFromPct(100, 'mate')).toBe(1);
    expect(scaleFractionFromPct(45, 'mate')).toBe(0.7);
    expect(scaleFractionFromPct(undefined, 'thermo')).toBe(0.45);
  });

  it('buildPublishVariant usa la familia vigente', () => {
    const thermo = buildPublishVariant({
      scale: 45,
      rotation: 0,
      mirror: false,
      family: 'thermo',
    });
    expect(thermo.scalePct).toBe(45);
    const mate = buildPublishVariant({ scale: 45, rotation: 0, mirror: false, family: 'mate' });
    expect(mate.scalePct).toBe(70);
  });
});

describe('payload del termo — bloque congelado', () => {
  it('serializa familia, thermo y escala del termo', () => {
    const payload = thermoPayload();
    expect(payload.mateConfig.family).toBe('thermo');
    expect(payload.mateConfig.thermo).toEqual({
      offsetYPct: 20,
      invert: true,
      finish: 'satin',
    });
    expect(payload.variants[0]!.scale).toBe(0.45);
    expect(payload.variants[0]!.rotation).toBe(90);
  });

  it('el visor re-arbitra la familia desde el MODELO (payload manipulado incluido)', () => {
    const payload = thermoPayload();
    const tampered = {
      ...payload,
      mateConfig: { ...payload.mateConfig, family: 'mate' as const },
    };
    const view = buildPublicView(tampered);
    expect(view.mate.modelId).toBe('termo-media-manija-1l');
    expect(view.mate.family).toBe('thermo');
    expect(view.mate.thermo).toEqual({ offsetYPct: 20, invert: true, finish: 'satin' });
    expect(view.mate.extDiameter).toBeCloseTo(80.64, 2);
    expect(view.mate.intDiameter).toBeCloseTo(80.64, 2);
    expect(view.variants[0]!.scalePct).toBe(45);
  });

  it('escala ausente en el payload ⇒ default del termo (45 %), no 100 %', () => {
    const payload = thermoPayload();
    const withoutScale = {
      ...payload,
      variants: [{ ...payload.variants[0]!, scale: undefined as unknown as number }],
    };
    const view = buildPublicView(withoutScale);
    expect(view.variants[0]!.scalePct).toBe(45);
  });

  it('un payload de mate conserva family mate y thermo null', () => {
    const payload = thermoPayload({ model: 'imperial', family: 'mate', thermo: null });
    const view = buildPublicView(payload);
    expect(view.mate.family).toBe('mate');
    expect(view.mate.thermo).toBeNull();
    expect(view.variants[0]!.scalePct).toBe(70); // 45 % mate ⇒ mínimo canónico
  });
});

describe('borrador de variantes del termo', () => {
  it('normaliza la escala a [10,100]', () => {
    const rows = normalizeVariantRows(
      [
        { id: 'A', label: 'A', scalePct: 45, rotationDeg: 0, mirror: false },
        { id: 'B', label: 'B', scalePct: 110, rotationDeg: 0, mirror: false },
        { id: 'C', label: 'C', scalePct: 5, rotationDeg: 0, mirror: false },
      ],
      'thermo',
    );
    expect(rows.map((r) => r.scalePct)).toEqual([45, 100, 10]);
  });
});
