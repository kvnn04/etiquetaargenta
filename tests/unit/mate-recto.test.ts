/* ============================================================================
 * MATE RECTO TÉRMICO DE ACERO INOXIDABLE — geometría, paleta, ficha y links
 * ----------------------------------------------------------------------------
 * Es una variante de la familia thermo (`geometry: 'recto'`) que vive en la
 * categoría mates y conserva el grabado lateral sobre el cuerpo pintado:
 *   · cuerpo cilíndrico Ø 75.6 mm × 90 mm de alto (36 mm/unidad);
 *   · labio de acero, interior cóncavo y disco de base, sin tapa ni manija;
 *   · frente fijo de 90° (±45°) centrado en +Z;
 *   · escala 15–100 % con default 65 %.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  RECTO_MATE_MODEL_ID,
  RECTO_MM_PER_UNIT,
  THERMO_MODEL_ID,
  hasFixedFrontGeometry,
  isBottleGeometry,
  isMateThermoGeometry,
  resolveProduct,
  resolveThermoProduct,
  silhouetteOf,
} from '@/lib/catalog';
import {
  buildThermoBaseDiscGeometry,
  buildThermoBaseGeometry,
  buildThermoBodyGeometry,
  buildThermoCollarGeometry,
  buildThermoEngravingGeometry,
  buildThermoGrooveGeometry,
  buildThermoHandleGeometry,
  buildThermoInnerGeometry,
  buildThermoLidGeometry,
  buildThermoRimGeometry,
  buildThermoSeamGeometry,
} from '@/three/thermo-builder';
import {
  RECTO_PALETTE,
  THERMO_PALETTE,
  clampThermoRotation,
  normalizeThermoScaleFor,
  thermoAngleBounds,
  thermoBodyPbr,
  thermoColorName,
  thermoDefaultBodyColor,
  thermoDesignSizeMm,
  thermoLaserBurn,
  thermoOverflowText,
  thermoPaletteFor,
  thermoSurface,
} from '@/lib/thermo';
import { normalizeState } from '@/lib/projects/persistence';
import { useEditorStore } from '@/lib/store/editor';
import { captureFichaSnapshot } from '@/lib/quote/snapshot';
import type { ResolvedBranding } from '@/lib/branding';
import { buildLinkPayload, type LinkMateConfigBlock } from '@/lib/links/payload';
import { buildPublicView } from '@/lib/links/view-shape';
import { thermoFramingMm } from '@/three/framing';

const product = resolveThermoProduct(RECTO_MATE_MODEL_ID);
const spec = product.thermo;

function positionCount(geometry: {
  getAttribute(name: string): { count: number } | undefined;
}): number {
  return geometry.getAttribute('position')?.count ?? 0;
}

function testBrand(): ResolvedBranding {
  return {
    title: 'Taller Recto',
    initials: 'TR',
    logoThumbUrl: null,
    logoAllowed: false,
    instagramHandle: 'taller.recto',
    cta: { kind: 'whatsapp', href: 'https://wa.me/5491100000000' },
  };
}

describe('Mate Recto — catálogo y medidas del prototipo', () => {
  it('vive en la categoría mates como variante thermo con geometría recta', () => {
    expect(product.family).toBe('thermo');
    expect(product.category).toBe('mates');
    expect(product.label).toBe('Mate Recto Térmico');
    expect(product.description).toContain('Acero inoxidable');
    expect(spec.geometry).toBe('recto');
    expect(isMateThermoGeometry(spec.geometry)).toBe(true);
    expect(hasFixedFrontGeometry(spec.geometry)).toBe(true);
    expect(isBottleGeometry(spec.geometry)).toBe(false);
    expect(CATALOG.some((p) => p.id === RECTO_MATE_MODEL_ID)).toBe(true);
  });

  it('mide 90 mm de alto × Ø 75.6 mm (36 mm/unidad)', () => {
    expect(RECTO_MM_PER_UNIT).toBe(36);
    expect(spec.radiusMm).toBeCloseTo(37.8, 6);
    expect(spec.totalHeightMm).toBe(90);
    expect(spec.neckRadiusMm).toBeCloseTo(35.64, 6);
    expect(spec.bodyBottomMm).toBeCloseTo(20.52, 6);
    expect(spec.bodyTopMm).toBeCloseTo(83.88, 6);
    expect(spec.capacityLabel).toBe('—');
  });

  it('la zona de grabado del prototipo va de 20.97 a 76.33 mm', () => {
    expect(spec.engraveMinYMm).toBeCloseTo(20.97, 2);
    expect(spec.engraveMaxYMm).toBeCloseTo(76.33, 2);
    const surface = thermoSurface(spec);
    expect(surface.heightMm).toBeCloseTo(55.36, 2);
    expect(surface.centerYMm).toBeCloseTo(48.65, 2);
    expect(spec.engraveRadiusMm).toBeCloseTo(37.89, 2);
  });

  it('el frente fijo de 90° (±45°) centra el arco en +Z', () => {
    const surface = thermoSurface(spec);
    const usableArcDeg = (surface.usableWidthMm / spec.engraveRadiusMm) * (180 / Math.PI);
    expect(usableArcDeg).toBeCloseTo(90, 2);
    const bounds = thermoAngleBounds(spec, spec.defaultScalePct, 1);
    expect(bounds.centerDeg).toBeCloseTo(0, 5);
    expect(bounds.minDeg).toBeCloseTo(-18.9, 1);
    expect(bounds.maxDeg).toBeCloseTo(18.9, 1);
    // El dorso (270°) queda bloqueado: cualquier ángulo viejo cae al frente.
    const clamped = clampThermoRotation(spec, 180, spec.defaultScalePct, 1);
    expect(Math.abs(clamped)).toBeLessThanOrEqual(45);
  });

  it('escala 15–100 con default 65 %', () => {
    expect(spec.defaultScalePct).toBe(65);
    expect(spec.minScalePct).toBe(15);
    expect(spec.maxScalePct).toBe(100);
    expect(normalizeThermoScaleFor(spec, undefined)).toBe(65);
    expect(normalizeThermoScaleFor(spec, 5)).toBe(15);
    expect(normalizeThermoScaleFor(spec, 150)).toBe(100);
    expect(normalizeThermoScaleFor(spec, 65.3)).toBe(65.5);
  });

  it('el 100 % sigue entrando en el frente fijo', () => {
    const surface = thermoSurface(spec);
    const size = thermoDesignSizeMm(spec, 1, 100);
    expect(size.widthMm).toBeLessThanOrEqual(surface.usableWidthMm * 0.96 + 1e-9);
    const bounds = thermoAngleBounds(spec, 100, 1);
    expect(bounds.minDeg).toBeLessThan(0);
    expect(bounds.maxDeg).toBeGreaterThan(0);
  });

  it('el aviso de desborde habla de "el mate"', () => {
    const text = thermoOverflowText(
      {
        status: 'overflow',
        overflowOuter: true,
        overflowInner: false,
        overflowOuterMm: 2,
        overflowInnerMm: 0,
      },
      spec,
    );
    expect(text).toContain('el mate');
  });

  it('la silueta de la card es un path válido', () => {
    const sil = silhouetteOf(product);
    expect(sil.path.startsWith('M ')).toBe(true);
    expect(sil.path).not.toContain('NaN');
  });

  it('el encuadre no reserva aire para una manija inexistente', () => {
    const framing = thermoFramingMm(spec);
    expect(framing.maxRadiusMm).toBeCloseTo(spec.radiusMm, 6);
    expect(framing.centerYMm).toBeCloseTo(45, 6);
  });
});

describe('Mate Recto — paleta y materiales', () => {
  it('usa la paleta del prototipo y el Negro Mate como default', () => {
    expect(thermoPaletteFor(spec)).toBe(RECTO_PALETTE);
    expect(thermoPaletteFor(resolveThermoProduct(THERMO_MODEL_ID).thermo)).toBe(THERMO_PALETTE);
    expect(thermoDefaultBodyColor(spec)).toBe('#1C1C1E');
    expect(thermoPaletteFor(spec).map((c) => c.name)).toEqual([
      'Negro Mate',
      'Acero Inox',
      'Blanco Tiza',
      'Verde Militar',
      'Azul Marino',
      'Rosa Pastel',
      'Rojo Terracota',
      'Bordó / Vino',
    ]);
  });

  it('el acero se detecta como metálico aunque el acabado sea mate', () => {
    const steel = thermoBodyPbr('matte', '#D4D8DD', spec);
    expect(steel.metalness).toBeCloseTo(0.92, 2);
    expect(steel.color).toBe('#D4D8DD');
    const painted = thermoBodyPbr('matte', null, spec);
    expect(painted.color).toBe('#1C1C1E');
    expect(painted.metalness).toBeLessThan(0.3);
  });

  it('nombra el color del prototipo y quema claro sobre pintura / oscuro sobre acero', () => {
    expect(thermoColorName('#D4D8DD', spec)).toBe('Acero Inox');
    expect(thermoColorName('#1C1C1E', spec)).toBe('Negro Mate');
    expect(thermoLaserBurn('#D4D8DD', spec).color).toBe('#23272E');
    expect(thermoLaserBurn('#1C1C1E', spec).color).toBe('#C9CCCF');
  });
});

describe('Mate Recto — geometría procedural', () => {
  it('el cuerpo tiene base redondeada, pared recta y termina bajo el labio', () => {
    const body = buildThermoBodyGeometry(spec);
    body.computeBoundingBox();
    expect(body.boundingBox!.max.x).toBeCloseTo(spec.radiusMm, 2);
    expect(body.boundingBox!.min.y).toBeCloseTo(spec.baseBottomMm, 2);
    expect(body.boundingBox!.max.y).toBeCloseTo(spec.bodyTopMm, 2);
  });

  it('el labio de acero corona el cuerpo y el interior queda cóncavo', () => {
    const rim = buildThermoRimGeometry(spec);
    rim.computeBoundingBox();
    expect(rim.boundingBox!.min.y).toBeCloseTo(spec.bodyTopMm, 2);
    expect(rim.boundingBox!.max.y).toBeCloseTo(spec.totalHeightMm, 2);
    expect(rim.boundingBox!.max.x).toBeCloseTo(1.105 * 36, 1);

    const inner = buildThermoInnerGeometry(spec);
    inner.computeBoundingBox();
    expect(inner.boundingBox!.max.y).toBeCloseTo(86.76, 2);
    expect(inner.boundingBox!.max.x).toBeCloseTo(0.99 * 36, 2);
  });

  it('el disco de acero cierra la base', () => {
    const disc = buildThermoBaseDiscGeometry(spec);
    disc.computeBoundingBox();
    expect(disc.boundingBox!.max.x).toBeCloseTo(0.72 * 36, 2);
    expect(disc.boundingBox!.max.y).toBeCloseTo(0, 5);
    expect(disc.boundingBox!.min.y).toBeCloseTo(0, 5);
  });

  it('no tiene tapa, manija, collarín, zócalo, ranuras ni junta', () => {
    for (const build of [
      buildThermoBaseGeometry,
      buildThermoCollarGeometry,
      buildThermoLidGeometry,
      buildThermoHandleGeometry,
      buildThermoGrooveGeometry,
      buildThermoSeamGeometry,
    ]) {
      expect(positionCount(build(spec))).toBe(0);
    }
  });

  it('el cilindro de grabado envuelve el cuerpo a la altura segura', () => {
    const surface = thermoSurface(spec);
    const engrave = buildThermoEngravingGeometry(spec);
    engrave.computeBoundingBox();
    expect(engrave.boundingBox!.max.x).toBeCloseTo(spec.engraveRadiusMm, 2);
    /* La malla va centrada en Y=0; la escena la sube a `surface.centerYMm`. */
    expect(engrave.boundingBox!.max.y).toBeCloseTo(surface.heightMm / 2, 2);
    expect(engrave.boundingBox!.min.y).toBeCloseTo(-surface.heightMm / 2, 2);
    expect(surface.centerYMm + engrave.boundingBox!.max.y).toBeCloseTo(
      spec.engraveMaxYMm,
      2,
    );
    expect(surface.centerYMm + engrave.boundingBox!.min.y).toBeCloseTo(
      spec.engraveMinYMm,
      2,
    );
  });
});

describe('Mate Recto — persistencia y estado del editor', () => {
  it('sin escala persistida arranca en 65 %', () => {
    expect(normalizeState({ mateModel: RECTO_MATE_MODEL_ID }).design.scale).toBe(65);
    expect(
      normalizeState({ mateModel: RECTO_MATE_MODEL_ID, design: { rotation: 30 } }).design.scale,
    ).toBe(65);
  });

  it('clampea al rango del mate y conserva el paso 0.5 %', () => {
    expect(normalizeState({ mateModel: RECTO_MATE_MODEL_ID, design: { scale: 5 } }).design.scale).toBe(15);
    expect(
      normalizeState({ mateModel: RECTO_MATE_MODEL_ID, design: { scale: 150 } }).design.scale,
    ).toBe(100);
    expect(
      normalizeState({ mateModel: RECTO_MATE_MODEL_ID, design: { scale: 65.3 } }).design.scale,
    ).toBe(65.5);
  });

  it('el borrador de variantes usa el rango del mate recto', () => {
    const state = normalizeState({
      mateModel: RECTO_MATE_MODEL_ID,
      linkDraft: [
        { id: 'A', label: 'Frente', scalePct: 5, rotationDeg: 0, mirror: false, included: true },
      ],
    });
    expect(state.linkDraft[0]?.scalePct).toBe(15);
  });

  it('cambiar termo ⇄ mate recto parte del default de cada producto', () => {
    const before = useEditorStore.getState();
    try {
      useEditorStore.getState().setMateModel(RECTO_MATE_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(65);

      useEditorStore.getState().setDesignScale(5);
      expect(useEditorStore.getState().design.scale).toBe(15);

      useEditorStore.getState().setMateModel(THERMO_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(45);
      useEditorStore.getState().setMateModel(RECTO_MATE_MODEL_ID);
      expect(useEditorStore.getState().design.scale).toBe(65);
    } finally {
      useEditorStore.getState().restoreState(before, before.projectId);
    }
  });

  it('resolveProduct conoce el id y el fallback sigue siendo el mate', () => {
    expect(resolveProduct(RECTO_MATE_MODEL_ID).id).toBe(RECTO_MATE_MODEL_ID);
    expect(resolveProduct('mate-recto-2').family).toBe('mate');
  });
});

describe('Mate Recto — ficha y enlace', () => {
  it('la ficha imprime material, alto, diámetro y la posición clampeada', () => {
    const snap = captureFichaSnapshot({
      state: {
        mateModel: RECTO_MATE_MODEL_ID,
        extDiameter: null,
        intDiameter: null,
        bodyPreset: null,
        metalPreset: null,
        bodyColor: '#1C1C1E',
        virolaColor: null,
        design: { rotation: 180, scale: 65, mirror: false },
        thermo: { offsetYPct: 0, invert: false, finish: 'matte' },
      },
      designAssetPresent: true,
      designAspect: 1,
      hasProject: false,
      overflow: null,
      brand: testBrand(),
      nowMs: Date.UTC(2026, 10, 5, 18, 0, 0),
    });
    expect(snap.family).toBe('thermo');
    expect(snap.modeloEtiqueta).toBe('Mate Recto Térmico');
    expect(snap.thermo?.capacidadTitulo).toBe('Material');
    expect(snap.thermo?.capacidadEtiqueta).toBe('Acero Inoxidable');
    expect(snap.thermo?.altoEtiqueta).toBe('90.0 mm');
    expect(snap.thermo?.diametroEtiqueta).toBe('75.6 mm');
    expect(snap.escalaEtiqueta).toBe('65%');
    const angle = Number.parseFloat((snap.thermo?.posicionEtiqueta ?? '').split(' · ')[0] ?? '');
    expect(Number.isFinite(angle)).toBe(true);
    expect(Math.abs(angle)).toBeLessThanOrEqual(45);
  });

  it('el payload del link conserva el modelo recto y su escala 65 %', () => {
    const mateConfig: LinkMateConfigBlock = {
      model: RECTO_MATE_MODEL_ID,
      extDiameter: 75.6,
      intDiameter: 75.6,
      metal: 'alpaca',
      virolaColor: null,
      topFaceColor: null,
      cupMaterial: 'algarrobo',
      cupColor: '#1C1C1E',
      family: 'thermo',
      thermo: { offsetYPct: 10, invert: false, finish: 'matte' },
    };
    const payload = buildLinkPayload({
      linkId: 'recto1',
      nowMs: Date.UTC(2026, 0, 1),
      expiresMs: Date.UTC(2026, 0, 31),
      workshop: {
        name: 'Taller Recto',
        logoUrl: null,
        whatsapp: '5491100000000',
        instagram: null,
      },
      mateConfig,
      variants: [
        {
          id: 'A',
          label: 'Diseño actual',
          scalePct: 65,
          rotationDeg: 0,
          mirror: false,
        },
      ],
      assetUrl: 'https://cdn.example.com/link-assets/recto1/design.png',
    });
    expect(payload.mateConfig.family).toBe('thermo');
    expect(payload.variants[0]!.scale).toBeCloseTo(0.65, 3);

    const view = buildPublicView(payload);
    expect(view.mate.modelId).toBe(RECTO_MATE_MODEL_ID);
    expect(view.mate.family).toBe('thermo');
    expect(view.mate.extDiameter).toBeCloseTo(75.6, 2);
    expect(view.variants[0]!.scalePct).toBe(65);
  });
});
