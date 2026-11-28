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
import {
  BOTTLE_MODEL_ID,
  SPORT_BOTTLE_MODEL_ID,
  resolveThermoProduct,
} from '@/lib/catalog';

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

  it('el System se resuelve con sus medidas fijas y familia thermo', () => {
    const payload = thermoPayload({ model: 'termo-system-1l' });
    const view = buildPublicView(payload);
    expect(view.mate.modelId).toBe('termo-system-1l');
    expect(view.mate.family).toBe('thermo');
    expect(view.mate.extDiameter).toBeCloseTo(84.96, 2);
    expect(view.mate.intDiameter).toBeCloseTo(84.96, 2);
    expect(view.mate.thermo).toEqual({ offsetYPct: 20, invert: true, finish: 'satin' });
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

/* ============================================================================
 * BOTELLA BOWLING — el spec del producto manda sobre el default del termo
 * ============================================================================ */

const bottleSpec = resolveThermoProduct(BOTTLE_MODEL_ID).thermo;

function bottlePayload(scalePct = 72) {
  return buildLinkPayload({
    linkId: 'b0ttl3',
    nowMs: Date.UTC(2026, 0, 1),
    expiresMs: Date.UTC(2026, 0, 31),
    workshop: WORKSHOP,
    mateConfig: {
      ...THERMO_MATE,
      model: BOTTLE_MODEL_ID,
      extDiameter: 77.76,
      intDiameter: 77.76,
    },
    variants: [
      {
        id: 'A',
        label: 'Diseño actual',
        scalePct,
        rotationDeg: 0,
        mirror: false,
      },
    ],
    assetUrl: 'https://cdn.example.com/link-assets/b0ttl3/design.png',
  });
}

describe('payload de la botella — escala 15–100 / default 72', () => {
  it('usa el default y el rango del SPEC, no los del termo', () => {
    expect(scaleFractionFromPct(undefined, 'thermo', bottleSpec)).toBe(0.72);
    expect(scaleFractionFromPct(5, 'thermo', bottleSpec)).toBe(0.15);
    expect(scaleFractionFromPct(150, 'thermo', bottleSpec)).toBe(1);
    expect(scaleFractionFromPct(72, 'thermo', bottleSpec)).toBe(0.72);
  });

  it('buildPublishVariant respeta el spec del producto', () => {
    const bottle = buildPublishVariant({
      scale: 5,
      rotation: 0,
      mirror: false,
      family: 'thermo',
      spec: bottleSpec,
    });
    expect(bottle.scalePct).toBe(15);
  });

  it('el payload congela 0.72 y el visor lo re-arbitra a 72 %', () => {
    const payload = bottlePayload();
    expect(payload.variants[0]!.scale).toBe(0.72);
    const view = buildPublicView(payload);
    expect(view.mate.modelId).toBe(BOTTLE_MODEL_ID);
    expect(view.mate.family).toBe('thermo');
    expect(view.mate.extDiameter).toBeCloseTo(77.76, 2);
    expect(view.variants[0]!.scalePct).toBe(72);
  });

  it('escala ausente ⇒ 72 % (no el 45 % del termo ni el 100 % del mate)', () => {
    const payload = bottlePayload();
    const withoutScale = {
      ...payload,
      variants: [{ ...payload.variants[0]!, scale: undefined as unknown as number }],
    };
    expect(buildPublicView(withoutScale).variants[0]!.scalePct).toBe(72);
  });

  it('el borrador de variantes clampea al rango de la botella', () => {
    const rows = normalizeVariantRows(
      [
        { id: 'A', label: 'A', scalePct: 5, rotationDeg: 0, mirror: false },
        { id: 'B', label: 'B', scalePct: 72, rotationDeg: 0, mirror: false },
        { id: 'C', label: 'C', scalePct: 150, rotationDeg: 0, mirror: false },
      ],
      'thermo',
      bottleSpec,
    );
    expect(rows.map((r) => r.scalePct)).toEqual([15, 72, 100]);
  });
});

/* ============================================================================
 * BOTELLA DEPORTIVA — el link congela el modelo y el visor resuelve su spec
 * ============================================================================ */

const sportSpec = resolveThermoProduct(SPORT_BOTTLE_MODEL_ID).thermo;

describe('payload de la botella Deportiva — misma escala, modelo propio', () => {
  it('congela 0.72 y el visor resuelve la Deportiva con sus medidas', () => {
    const payload = buildLinkPayload({
      linkId: 'sport1',
      nowMs: Date.UTC(2026, 0, 1),
      expiresMs: Date.UTC(2026, 0, 31),
      workshop: WORKSHOP,
      mateConfig: {
        ...THERMO_MATE,
        model: SPORT_BOTTLE_MODEL_ID,
        extDiameter: Number((sportSpec.radiusMm * 2).toFixed(2)),
        intDiameter: Number((sportSpec.radiusMm * 2).toFixed(2)),
      },
      variants: [
        {
          id: 'A',
          label: 'Diseño actual',
          scalePct: 72,
          rotationDeg: 0,
          mirror: false,
        },
      ],
      assetUrl: 'https://cdn.example.com/link-assets/sport1/design.png',
    });
    expect(payload.variants[0]!.scale).toBe(0.72);
    const view = buildPublicView(payload);
    expect(view.mate.modelId).toBe(SPORT_BOTTLE_MODEL_ID);
    expect(view.mate.family).toBe('thermo');
    expect(view.mate.extDiameter).toBeCloseTo(sportSpec.radiusMm * 2, 2);
    expect(view.variants[0]!.scalePct).toBe(72);
  });

  it('el borrador de variantes usa el rango 15–100 de la botella', () => {
    const rows = normalizeVariantRows(
      [
        { id: 'A', label: 'A', scalePct: 5, rotationDeg: 0, mirror: false },
        { id: 'B', label: 'B', scalePct: 72, rotationDeg: 0, mirror: false },
        { id: 'C', label: 'C', scalePct: 150, rotationDeg: 0, mirror: false },
      ],
      'thermo',
      sportSpec,
    );
    expect(rows.map((r) => r.scalePct)).toEqual([15, 72, 100]);
  });
});
