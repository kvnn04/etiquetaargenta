/* ============================================================================
 * TESTS POSICIÓN 9 — snapshot inmutable de la Ficha (ÚNICA FUENTE:
 * spec_detalle_del_modelo_en_ficha.md): R2 (formatos EXACTOS de tarjeta),
 * R3 (descriptores fijos, jamás auto-nombres), R5 (margen canónico via
 * marginSheetLine), R7 (hash estable EXCLUYENDO capturedAt) y R8 (fallbacks:
 * modelo desconocido ⇒ Camionero, datos inválidos ⇒ `—` con aviso en consola).
 * Ambiente node: todo el módulo es puro (sin canvas, sin three).
 * ============================================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureFichaSnapshot,
  currentOverflowCheck,
  formatDegCard,
  formatMmCard,
  formatModeloCard,
  formatPctCard,
  formatCuerpoCard,
  formatVirolaCard,
  hashFichaSnapshot,
  type FichaSnapshot,
} from '@/lib/quote/snapshot';
import { evaluateOverflow } from '@/lib/overflow';
import type { ResolvedBranding } from '@/lib/branding';
import type { InkEnvelope } from '@/lib/overflow';
import {
  BOTTLE_MODEL_ID,
  SPORT_BOTTLE_MODEL_ID,
  THERMO_MODEL_ID,
  resolveThermoProduct,
} from '@/lib/catalog';
import { clampThermoRotation } from '@/lib/thermo';

/* t0 fijo: 05-nov-2026 18:00 UTC — capturedAt determinista (el hash NO lo usa). */
const T0 = Date.UTC(2026, 10, 5, 18, 0, 0);

/** Marca de prueba completa (el modal pasa la de resolveBranding real). */
function testBrand(overrides: Partial<ResolvedBranding> = {}): ResolvedBranding {
  return {
    title: 'Etiqueta Argenta',
    initials: 'EA',
    logoThumbUrl: null,
    logoAllowed: false,
    instagramHandle: 'etiqueta.argenta',
    cta: { kind: 'whatsapp', href: 'https://wa.me/5491100000000' },
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof captureFichaSnapshot>[0]> = {}) {
  return {
    state: {
      mateModel: 'imperial',
      extDiameter: 123,
      intDiameter: 95,
      bodyPreset: 'algarrobo',
      metalPreset: 'alpaca',
      bodyColor: null,
      virolaColor: null,
      design: { rotation: 45.25, scale: 92.3, mirror: true },
    },
    designAssetPresent: true,
    hasProject: true,
    overflow: null,
    inkDegraded: false,
    brand: testBrand(),
    whatsappE164: '+5491100000000',
    observaciones: 'Grabar el nombre SOFI en el frente',
    nowMs: T0,
    ...overrides,
  } as Parameters<typeof captureFichaSnapshot>[0];
}

/* Envolvente de tinta al 100 % sintética (mm) — chapa imperial 123/95 ⇒
 * R_ext 61.5 / R_int 47.5. */
const ENVELOPE_FUERA: InkEnvelope = { inkMaxMm: 62.5, inkMinMm: 47.0 }; // desborde ambos lados
const ENVELOPE_SEGURO: InkEnvelope = { inkMaxMm: 60.0, inkMinMm: 48.5 }; // dentro del anillo

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = null;
});

describe('R2 — formatos EXACTOS de tarjeta', () => {
  it('mm: UN decimal SIEMPRE ("123.0 mm"); inválido ⇒ null (tarjeta `—`)', () => {
    expect(formatMmCard(123)).toBe('123.0 mm');
    expect(formatMmCard(123.26)).toBe('123.3 mm');
    expect(formatMmCard(0)).toBeNull();
    expect(formatMmCard(-4)).toBeNull();
    expect(formatMmCard(Number.NaN)).toBeNull();
    expect(formatMmCard(undefined)).toBeNull();
  });

  it('%: decimal SOLO si no es entero ("92%" / "92.5%"); basura ⇒ `—`', () => {
    expect(formatPctCard(92)).toBe('92%');
    expect(formatPctCard(92.3)).toBe('92.5%'); // normalizeScale ⇒ paso 0.5%
    expect(formatPctCard(70)).toBe('70%');
    expect(formatPctCard(Number.NaN)).toBe('—');
    expect(formatPctCard('92' as unknown as number)).toBe('—');
  });

  it('°: decimal SOLO si no es entero ("45°" / "45.5°"); envuelve ±360', () => {
    expect(formatDegCard(45)).toBe('45°');
    expect(formatDegCard(45.25)).toBe('45.5°');
    expect(formatDegCard(-90)).toBe('270°');
    expect(formatDegCard(Number.NaN)).toBe('—');
  });
});

describe('R3 — descriptores FIJOS de acabados (jamás auto-nombres)', () => {
  it('preset virola ⇒ su nombre propio; custom ⇒ `#HEX · Anodizado Personalizado`', () => {
    expect(formatVirolaCard('alpaca', null)).toBe('Alpaca / Plata');
    expect(formatVirolaCard('alpaca', '#2A2A2A')).toBe('#2A2A2A · Anodizado Personalizado');
  });

  it('preset cuerpo ⇒ su nombre propio; custom ⇒ `#HEX · Color Libre`', () => {
    expect(formatCuerpoCard('algarrobo', null)).toBe('Algarrobo / Madera');
    expect(formatCuerpoCard('algarrobo', '#e6c48e')).toBe('#E6C48E · Color Libre');
  });

  it('los descriptores NUNCA traen prefijo de zona ni auto-nombre "(Negro Mate)"', () => {
    for (const descriptor of [
      formatVirolaCard('alpaca', null),
      formatVirolaCard('alpaca', '#2A2A2A'),
      formatCuerpoCard('algarrobo', null),
      formatCuerpoCard('algarrobo', '#E6C48E'),
    ]) {
      expect(descriptor).not.toMatch(/^(Virola|Cuerpo):/);
      expect(descriptor).not.toMatch(/\(Negro Mate\)|\(Suela Claro\)/);
    }
  });

  it('preset desconocido ⇒ cae al default del catálogo (sin romper)', () => {
    expect(formatVirolaCard('desconocido', null)).toBe('Alpaca / Plata');
    expect(formatCuerpoCard('desconocido', null)).toBe('Algarrobo / Madera');
  });
});

describe('R2/R8 — tarjeta Modelo', () => {
  it('imperial ⇒ "Mate Imperial" EXACTO (QA2)', () => {
    expect(formatModeloCard('imperial')).toEqual({ etiqueta: 'Mate Imperial', modelId: 'imperial' });
  });

  it('modelo desconocido/ausente ⇒ "Mate Camionero" (R8)', () => {
    expect(formatModeloCard(null).etiqueta).toBe('Mate Camionero');
    expect(formatModeloCard('inventado').etiqueta).toBe('Mate Camionero');
  });
});

describe('R1/R5 — captureFichaSnapshot: grilla congelada + margen canónico', () => {
  it('captura completa: banda auto (R2), etiquetas formateadas y hash f1:8hex', () => {
    const check = evaluateOverflow(ENVELOPE_FUERA, 61.5, 47.5, 100);
    const snap = captureFichaSnapshot(baseInput({ overflow: check }));

    expect(snap.modeloEtiqueta).toBe('Mate Imperial');
    expect(snap.productId).toBe('imperial');
    expect(formatMmCard(snap.extDiameterMm)).toBe('123.0 mm');
    expect(formatMmCard(snap.intDiameterMm)).toBe('95.0 mm');
    expect(snap.bandaMm).toBeCloseTo(14); // W = (Dext − Dint)/2 (solo snapshot)
    expect(formatMmCard(snap.bandaMm)).toBe('14.0 mm');

    expect(snap.escalaEtiqueta).toBe('92.5%');
    expect(snap.rotacionEtiqueta).toBe('45.5°');
    expect(snap.grabadoSinDiseno).toBe(false);
    expect(snap.hasDesign).toBe(true);
    expect(snap.hasProject).toBe(true);
    expect(snap.linkId).toBeNull(); // pos 10: PASSTHROUGH null hoy

    expect(snap.margenEstado).toBe('overflow');
    expect(snap.margenEtiqueta).toBe(
      // marginSheetLine() - prefijo "Margen: " — textu canónico de pos 7
      // (cada dirección lista su propia medición con el verbo "excede").
      'con riesgo (excede 1.0 mm por fuera / excede 0.5 mm hacia la boca)',
    );
    expect(snap.margenAproximado).toBe(false);
    expect(snap.hash).toMatch(/^f1:[0-9a-f]{8}$/);
    expect(hashFichaSnapshot(snap)).toBe(snap.hash);
  });

  it('margen SEGURO ⇒ "Seguro" con estado verde', () => {
    const snap = captureFichaSnapshot(
      baseInput({ overflow: evaluateOverflow(ENVELOPE_SEGURO, 61.5, 47.5, 100) }),
    );
    expect(snap.margenEstado).toBe('safe');
    expect(snap.margenEtiqueta).toBe('Seguro');
  });

  it('§6 modo envolvente (raster falló) ⇒ "Detección aproximada" en la ficha', () => {
    const snap = captureFichaSnapshot(
      baseInput({ overflow: evaluateOverflow(ENVELOPE_FUERA, 61.5, 47.5, 100), inkDegraded: true }),
    );
    expect(snap.margenAproximado).toBe(true);
    expect(snap.margenEstado).toBe('overflow');
  });

  it('R8: SIN diseño cargado ⇒ placeholders "—", sin margen y sin check', () => {
    const snap = captureFichaSnapshot(baseInput({ designAssetPresent: false }));
    expect(snap.grabadoSinDiseno).toBe(true);
    expect(snap.hasDesign).toBe(false);
    expect(snap.escalaEtiqueta).toBe('—');
    expect(snap.rotacionEtiqueta).toBe('—');
    expect(snap.margenEtiqueta).toBeNull();
    expect(snap.margenEstado).toBe('none');
    expect(snap.overflow).toBeNull();
    // Producto y Acabados imprimen igual (decisión del titular): no es error.
    expect(snap.modeloEtiqueta).toBe('Mate Imperial');
    expect(snap.virolaEtiqueta).toBe('Alpaca / Plata');
  });

  it('R8: dato inválido ⇒ null + WARN en consola (el modal jamás se rompe)', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snap = captureFichaSnapshot(
      baseInput({ state: { ...baseInput().state, extDiameter: Number.NaN } }),
    );
    expect(snap.extDiameterMm).toBeNull();
    expect(snap.bandaMm).toBeNull(); // sin D_ext ⇒ no hay banda derivable
    expect(warnSpy).toHaveBeenCalled();
  });

  it('R4: la marca va EXACTAMENTE como resolveBranding la resolvió', () => {
    const snap = captureFichaSnapshot(
      baseInput({
        brand: testBrand({ title: 'MOCAP 3D · MATE PERSONALIZADO', initials: 'MT', instagramHandle: null }),
        whatsappE164: null,
      }),
    );
    expect(snap.brand.title).toBe('MOCAP 3D · MATE PERSONALIZADO');
    expect(snap.brand.initials).toBe('MT');
    expect(snap.brand.logoThumbUrl).toBeNull();
    expect(snap.brand.instagramHandle).toBeNull(); // sin IG ⇒ pie removido
    expect(snap.brand.whatsappE164).toBeNull(); // sin WA ⇒ pie sin CTA claro
  });

  it('R5: observaciones se recortan a 280 y normalizan espacios al capturar', () => {
    const snap = captureFichaSnapshot(
      baseInput({ observaciones: `  ${'x'.repeat(320)}   ` }),
    );
    expect(snap.observaciones.length).toBe(280);
    expect(snap.observaciones).not.toMatch(/^\s|\s$/);
  });
});

describe('R1/R7 — hash del contenido: estable, corto, EXCLUYE capturedAt', () => {
  it('dos capturas del mismo contenido con reloj distinto ⇒ MISMO hash', () => {
    const a = captureFichaSnapshot(baseInput({ nowMs: T0 }));
    const b = captureFichaSnapshot(baseInput({ nowMs: T0 + 1234 }));
    expect(b.capturedAt).not.toBe(a.capturedAt);
    expect(b.hash).toBe(a.hash); // "Actualizar" sin cambios no invalida el ticket
  });

  it('un cambio de contenido (observación) ⇒ OTRO hash', () => {
    const a = captureFichaSnapshot(baseInput());
    const b = captureFichaSnapshot(baseInput({ observaciones: 'Otro texto' }));
    expect(b.hash).not.toBe(a.hash);
  });

  it('un cambio de marca (logo PRO) ⇒ OTRO hash (R4 impacta el output)', () => {
    const a = captureFichaSnapshot(baseInput());
    const b = captureFichaSnapshot(
      baseInput({ brand: testBrand({ logoThumbUrl: 'https://x/logo.png' }) }),
    );
    expect(b.hash).not.toBe(a.hash);
  });
});

describe('R5/R8 — currentOverflowCheck: LA derivación única del chequeo vigente', () => {
  const input = {
    hasDesignAsset: true,
    extDiameterMm: 123,
    intDiameterMm: 95,
    scalePct: 100,
  };

  it('sin asset ⇒ null (panel y ficha: nada que avisar)', () => {
    expect(currentOverflowCheck({ ...input, hasDesignAsset: false, inkEnvelope: null, inkScanDegraded: false, baseSideMm: 123 })).toBeNull();
  });

  it('con envolvente ⇒ EXACTAMENTE el escaneo polar de pos 7', () => {
    const derived = currentOverflowCheck({
      ...input,
      inkEnvelope: ENVELOPE_FUERA,
      inkScanDegraded: false,
      baseSideMm: 123,
    });
    expect(derived).toEqual(evaluateOverflow(ENVELOPE_FUERA, 61.5, 47.5, 100));
  });

  it('envelope null + degraded ⇒ modo bbox conservador (status overflow SIEMPRE)', () => {
    const derived = currentOverflowCheck({
      ...input,
      inkEnvelope: null,
      inkScanDegraded: true,
      baseSideMm: 123,
    });
    expect(derived?.status).toBe('overflow');
    expect(derived?.overflowInner).toBe(true);
  });

  it('asset sin envolvente y sin modo degradado ⇒ null (medición en curso)', () => {
    expect(
      currentOverflowCheck({ ...input, inkEnvelope: null, inkScanDegraded: false, baseSideMm: 123 }),
    ).toBeNull();
  });
});

describe('R1/R8 — snapshot completo (recorrido del QA1 de la spec)', () => {
  it('todo el contenido del snapshot es DERIVABLE del estado vivo (§5: nada persistido)', () => {
    const snap: FichaSnapshot = captureFichaSnapshot(baseInput());
    expect(snap.capturedAt).toBe(T0);
    expect(snap.hasProject).toBe(true);
    expect(snap.hasDesign).toBe(true);
    expect(snap.observaciones).toBe('Grabar el nombre SOFI en el frente');
  });
});

describe('termo — la ficha etiqueta lo que realmente se dibuja', () => {
  const spec = resolveThermoProduct(THERMO_MODEL_ID).thermo;

  it('la posición usa el ángulo CLAMPEADO al arco libre (no el valor viejo)', () => {
    const snap = captureFichaSnapshot(
      baseInput({
        state: {
          mateModel: THERMO_MODEL_ID,
          extDiameter: null,
          intDiameter: null,
          bodyPreset: null,
          metalPreset: null,
          bodyColor: '#181A1F',
          virolaColor: null,
          design: { rotation: 300, scale: 100, mirror: false },
          thermo: { offsetYPct: 0, invert: false, finish: 'matte' },
        },
        designAspect: 1,
      }),
    );
    const dibujado = clampThermoRotation(spec, 300, 100, 1);
    expect(snap.family).toBe('thermo');
    expect(snap.thermo?.posicionEtiqueta).toBe(`${formatDegCard(dibujado)} · 0%`);
    expect(snap.escalaEtiqueta).toBe('100%');
  });

  it('la botella imprime su capacidad, medidas y escala default (72 %)', () => {
    const bottle = resolveThermoProduct(BOTTLE_MODEL_ID).thermo;
    const snap = captureFichaSnapshot(
      baseInput({
        state: {
          mateModel: BOTTLE_MODEL_ID,
          extDiameter: null,
          intDiameter: null,
          bodyPreset: null,
          metalPreset: null,
          bodyColor: '#181A1F',
          virolaColor: null,
          design: { rotation: 0, scale: 72, mirror: false },
          thermo: { offsetYPct: 0, invert: false, finish: 'matte' },
        },
        designAspect: 1,
      }),
    );
    expect(snap.family).toBe('thermo');
    expect(snap.modeloEtiqueta).toBe('Botella Térmica Bowling 500 ml');
    expect(snap.thermo?.capacidadEtiqueta).toBe('500 ml');
    expect(snap.thermo?.altoEtiqueta).toBe(formatMmCard(bottle.totalHeightMm));
    expect(snap.thermo?.diametroEtiqueta).toBe(formatMmCard(bottle.radiusMm * 2));
    expect(snap.escalaEtiqueta).toBe('72%');
  });

  it('la botella Deportiva imprime su propia etiqueta, capacidad y medidas', () => {
    const sport = resolveThermoProduct(SPORT_BOTTLE_MODEL_ID).thermo;
    const snap = captureFichaSnapshot(
      baseInput({
        state: {
          mateModel: SPORT_BOTTLE_MODEL_ID,
          extDiameter: null,
          intDiameter: null,
          bodyPreset: null,
          metalPreset: null,
          bodyColor: '#181A1F',
          virolaColor: null,
          design: { rotation: 0, scale: 72, mirror: false },
          thermo: { offsetYPct: 0, invert: false, finish: 'matte' },
        },
        designAspect: 1,
      }),
    );
    expect(snap.family).toBe('thermo');
    expect(snap.modeloEtiqueta).toBe('Botella Deportiva con Pico y Mosquetón 500 ml');
    expect(snap.thermo?.capacidadEtiqueta).toBe('500 ml');
    expect(snap.thermo?.altoEtiqueta).toBe(formatMmCard(sport.totalHeightMm));
    expect(snap.thermo?.diametroEtiqueta).toBe(formatMmCard(sport.radiusMm * 2));
    expect(snap.escalaEtiqueta).toBe('72%');
  });
});
