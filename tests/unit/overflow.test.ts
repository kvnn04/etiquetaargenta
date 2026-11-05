/* ============================================================================
 * TESTS POSICIÓN 7 — Escala fina + motor de desborde (ÚNICA FUENTE:
 * spec_escala_y_alerta_de_desborde.md). Ambiente node: las máscaras alfa se
 * INYECTAN sintéticas (geometría de píxel determinista) — el rasterizado real
 * de la máscara vive del lado del navegador (DesignCard.measureInkEnvelopeMm).
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  evaluateOverflow,
  evaluateOverflowBBox,
  formatScaleLabel,
  largestSafeScalePct,
  marginSheetLine,
  normalizeScale,
  OVERFLOW_SCAN_SIZE,
  overflowBannerText,
  parseScaleInput,
  scanInkEnvelope,
  SCALE_PRESETS,
  SCALE_RANGE,
  SCALE_STEP_PCT,
  type InkEnvelope,
} from '@/lib/overflow';

/** Escala fija de las máscaras sintéticas: 512 px ⇒ semicanvas 64 mm. */
const MM_PER_PX = 0.25;
const MASK_SIZE = OVERFLOW_SCAN_SIZE; // R4: 512×512

/** Radio polar (mm) del CENTRO del píxel (x, y) — misma fórmula del motor. */
function radiusMm(x: number, y: number): number {
  const dx = x + 0.5 - MASK_SIZE / 2;
  const dy = y + 0.5 - MASK_SIZE / 2;
  return Math.hypot(dx, dy) * MM_PER_PX;
}

/** Máscara sintética de un anillo radial [rMinMm, rMaxMm] (centro de píxel). */
function ringBandMask(rMinMm: number, rMaxMm: number) {
  const alphaAt = (x: number, y: number): number => {
    const r = radiusMm(x, y);
    return r >= rMinMm && r <= rMaxMm ? 255 : 0;
  };
  return { size: MASK_SIZE, alphaAt };
}

/** Máscara sintética de UN píxel (geometría determinista para medición exacta). */
function singlePixelMask(x: number, y: number) {
  const alphaAt = (px: number, py: number): number => (px === x && py === y ? 255 : 0);
  return { size: MASK_SIZE, alphaAt };
}

/**
 * QA2 — corona dentada: anillo completo + un diente pegado al borde exterior
 * que se extiende HACIA AFUERA hasta spikeMm (los dientes nacen en el anillo,
 * no flotan sobre el hueco).
 */
function crownMask(rMinMm: number, rMaxMm: number, spikeMm: number, spikeAngle = 0) {
  const alphaAt = (x: number, y: number): number => {
    const r = radiusMm(x, y);
    if (r >= rMinMm && r <= rMaxMm) return 255;
    const dx = x + 0.5 - MASK_SIZE / 2;
    const dy = y + 0.5 - MASK_SIZE / 2;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(angle - spikeAngle) < 0.02 && r > rMaxMm && r <= spikeMm) return 255;
    return 0;
  };
  return { size: MASK_SIZE, alphaAt };
}

/** QA2 — corona con muesca cóncava: un entrante que CRUZA R_int hacia adentro. */
function notchedMask(rMinMm: number, rMaxMm: number, dipMm: number, dipAngle = 0) {
  const alphaAt = (x: number, y: number): number => {
    const r = radiusMm(x, y);
    const dx = x + 0.5 - MASK_SIZE / 2;
    const dy = y + 0.5 - MASK_SIZE / 2;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(angle - dipAngle) < 0.02 && r >= dipMm && r <= rMaxMm) return 255;
    return r >= rMinMm && r <= rMaxMm ? 255 : 0;
  };
  return { size: MASK_SIZE, alphaAt };
}

/* -------------------------------------------------------------------------- */
/* R4 — escaneo polar exacto (α ≥ 128 ⇒ trazado)                               */
/* -------------------------------------------------------------------------- */

describe('R4 — escaneo polar (tolerancia 0 mm estricta)', () => {
  it('un píxel a radio EXACTO: medición mm determinista', () => {
    // Geometría de píxel: el centro de (355, 255) queda a hypot(99.5, −0.5) px.
    const expected = Math.hypot(99.5, -0.5) * MM_PER_PX;
    const ink = scanInkEnvelope(singlePixelMask(355, 255), MM_PER_PX);
    expect(ink).not.toBeNull();
    expect(ink!.inkMaxMm).toBeCloseTo(expected, 9);
    expect(ink!.inkMinMm).toBeCloseTo(expected, 9);

    // Tolerancia 0 ESTRICTA: tocar el límite NO es desbordar (R4).
    expect(evaluateOverflow(ink!, expected, 10, 100).status).toBe('safe');
    expect(evaluateOverflow(ink!, expected, 10, 100).overflowOuter).toBe(false);
    const beyond = evaluateOverflow(ink!, expected - 0.001, 10, 100);
    expect(beyond.overflowOuter).toBe(true);
    expect(beyond.status).toBe('overflow');
  });

  it('máscara de anillo completo con margen: ⇒ Seguro (QA1 happy path)', () => {
    // Anillo [51.5, 57.5] contra carril (47.5, 61.5): margen por ambos lados.
    // La cuantización de píxel (±½ px = ±0.125 mm) es la cota del método: en el
    // navegador el AA del downsample 1024→512 da la precisión subpixel de QA2.
    const ink = scanInkEnvelope(ringBandMask(51.5, 57.5), MM_PER_PX);
    expect(ink).not.toBeNull();
    expect(ink!.inkMaxMm).toBeCloseTo(57.5, 0);
    expect(ink!.inkMinMm).toBeCloseTo(51.5, 0);
    const check = evaluateOverflow(ink!, 61.5, 47.5, 100);
    expect(check.status).toBe('safe');
    expect(check.overflowOuterMm).toBe(0);
    expect(check.overflowInnerMm).toBe(0);
  });

  it('corona dentada: un diente que CRUZA R_ext dispara aunque el anillo esté bien (QA2)', () => {
    const ink = scanInkEnvelope(crownMask(51.5, 57.5, 62.8), MM_PER_PX);
    expect(ink).not.toBeNull();
    expect(ink!.inkMaxMm).toBeGreaterThan(61.5); // el diente traspuso el anillo
    expect(ink!.inkMinMm).toBeGreaterThan(47.5); // el resto del anillo sigue bien
    const check = evaluateOverflow(ink!, 61.5, 47.5, 100);
    expect(check.status).toBe('overflow');
    expect(check.overflowInner).toBe(false);
    // Medición en mm; max de tinta ≈ 62.63 ⇒ redondeo R4 de ~1.1 mm.
    expect(check.overflowOuterMm).toBeGreaterThan(1.0);
    expect(check.overflowOuterMm).toBeLessThanOrEqual(1.3);
  });

  it('muesca cóncava: una punta que CRUZA R_int ⇒ DesbordeInterno (QA2)', () => {
    const ink = scanInkEnvelope(notchedMask(51.5, 57.5, 40), MM_PER_PX);
    expect(ink).not.toBeNull();
    expect(ink!.inkMinMm).toBeLessThan(47.5); // la punta entró al hueco
    expect(ink!.inkMaxMm).toBeLessThan(61.5); // por fuera sigue contenido
    const check = evaluateOverflow(ink!, 61.5, 47.5, 100);
    expect(check.status).toBe('overflow');
    expect(check.overflowOuter).toBe(false);
    expect(check.overflowInnerMm).toBeGreaterThan(7.0);
    expect(check.overflowInnerMm).toBeLessThanOrEqual(7.5);
  });

  it('solo α ≥ 128 cuenta como trazado (§6: la transparencia no es trazado)', () => {
    const underThreshold = {
      size: MASK_SIZE,
      alphaAt: (x: number, y: number): number => (x === 355 && y === 255 ? 127 : 0),
    };
    expect(scanInkEnvelope(underThreshold, MM_PER_PX)).toBeNull();
    const atThreshold = {
      size: MASK_SIZE,
      alphaAt: (x: number, y: number): number => (x === 355 && y === 255 ? 128 : 0),
    };
    expect(scanInkEnvelope(atThreshold, MM_PER_PX)).not.toBeNull();
  });

  it('sin trazado ⇒ envolvente nula (el motor no inventa estado)', () => {
    const empty = { size: MASK_SIZE, alphaAt: (): number => 0 };
    expect(scanInkEnvelope(empty, MM_PER_PX)).toBeNull();
  });

  it('QA2: el barrido del motor sobre la máscara 512² lista corre ≤ 25 ms', () => {
    // La máscara se PRE-COMPUTA como array de alfa (tal como la produce el
    // browser en getImageData): fuera del cronómetro queda solo la construcción
    // del asset; lo que se mide es el barrido del motor (QA2 de la spec).
    const mask = new Uint8ClampedArray(MASK_SIZE * MASK_SIZE);
    for (let y = 0; y < MASK_SIZE; y++) {
      for (let x = 0; x < MASK_SIZE; x++) {
        const r = radiusMm(x, y);
        if (r >= 51.5 && r <= 57.5) mask[y * MASK_SIZE + x] = 255;
      }
    }
    const reader = { size: MASK_SIZE, alphaAt: (x: number, y: number): number => mask[y * MASK_SIZE + x] };
    scanInkEnvelope(reader, MM_PER_PX); // primer barrido: calienta el JIT (estándar de benchmark)
    const t0 = performance.now();
    const ink = scanInkEnvelope(reader, MM_PER_PX);
    const elapsed = performance.now() - t0;
    expect(ink).not.toBeNull();
    expect(elapsed).toBeLessThan(25);
  });
});

/* -------------------------------------------------------------------------- */
/* R2/R3 — evaluación según escala (homotecia lineal + estricta)               */
/* -------------------------------------------------------------------------- */

describe('R2/R3 — evaluateOverflow: cada radio escala con s/100', () => {
  it('escalar AGRANDA el margen interior pero aprieta el exterior (y viceversa)', () => {
    const ink: InkEnvelope = { inkMaxMm: 55, inkMinMm: 50 };
    // 110 %: 60.5 < 61.5 y 55 > 47.5 ⇒ sigue seguro (QA1 sin desborde espurio).
    expect(evaluateOverflow(ink, 61.5, 47.5, 110).status).toBe('safe');
    // Diseño más ancho al tope: 57 × 1.1 = 62.7 ⇒ excede 1.2 mm (round1).
    const wide: InkEnvelope = { inkMaxMm: 57, inkMinMm: 50 };
    const at110 = evaluateOverflow(wide, 61.5, 47.5, 110);
    expect(at110.status).toBe('overflow');
    expect(at110.overflowOuter).toBe(true);
    expect(at110.overflowInner).toBe(false);
    expect(at110.overflowOuterMm).toBe(1.2);
  });

  it('tocar el límite NO es desbordar — un pi más ⇒ overflow de 0.6 mm (R4 estricto)', () => {
    const touching: InkEnvelope = { inkMaxMm: 61.5, inkMinMm: 47.5 };
    expect(evaluateOverflow(touching, 61.5, 47.5, 100).status).toBe('safe');
    // 61.5 × 1.01 = 62.115 ⇒ exceso 0.615 ⇒ redondeo R4 a 0.6 mm.
    const at101 = evaluateOverflow(touching, 61.5, 47.5, 101);
    expect(at101.status).toBe('overflow');
    expect(at101.overflowOuterMm).toBe(0.6);
  });

  it('el máximo 110 % no es carta blanca: la envolvente decide (R4: tolerancia 0)', () => {
    const comfortable: InkEnvelope = { inkMaxMm: 54, inkMinMm: 52 };
    expect(evaluateOverflow(comfortable, 61.5, 47.5, 105).status).toBe('safe');
    expect(evaluateOverflow(comfortable, 61.5, 47.5, 110).status).toBe('safe');
  });

  it('encoger TAMBIÉN puede desbordar (hacia la boca): la tinta entra al hueco', () => {
    const nearCenter: InkEnvelope = { inkMaxMm: 55, inkMinMm: 48 };
    const at70 = evaluateOverflow(nearCenter, 61.5, 47.5, 70);
    expect(at70.overflowOuter).toBe(false); // 55 × 0.7 = 38.5 ≪ 61.5
    expect(at70.overflowInner).toBe(true); // 48 × 0.7 = 33.6 < 47.5
    expect(at70.overflowInnerMm).toBe(13.9); // round1(47.5 − 33.6)
    expect(at70.status).toBe('overflow');
  });

  it('la escala admite valores NO-canónicos: la evaluación normaliza (R8)', () => {
    // 92.25 ⇒ 92.5 exacto (R8): el chequeo no distingue tipeo de estado.
    const safeInk: InkEnvelope = { inkMaxMm: 60, inkMinMm: 53 };
    expect(evaluateOverflow(safeInk, 61.5, 47.5, 92.25).status).toBe('safe');
    expect(evaluateOverflow(safeInk, 61.5, 47.5, 92.25).status).toBe(
      evaluateOverflow(safeInk, 61.5, 47.5, 92.5).status,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* §6 — modo degradado: chequeo por bbox CONSERVADOR                           */
/* -------------------------------------------------------------------------- */

describe('§6 — modo degradado (envolvente por bbox, alerta de más)', () => {
  it('semidiagonal del bbox contra R_ext; el interior queda EN DUDA ⇒ avisa', () => {
    const check = evaluateOverflowBBox(123, 100, 61.5, 47.5);
    expect(check.status).toBe('overflow'); // conservador sin excepciones
    expect(check.overflowOuter).toBe(true);
    expect(check.overflowInner).toBe(true);
    // 86.9703 − 61.5 = 25.4703 ⇒ redondeo R4 a 25.5 mm.
    expect(check.overflowOuterMm).toBe(25.5);
    expect(check.overflowInnerMm).toBe(47.5);
  });

  it('con escala 70% el bbox entra por fuera, pero el status sigue en desborde', () => {
    const check = evaluateOverflowBBox(123, 70, 61.5, 47.5);
    expect(check.overflowOuter).toBe(false);
    expect(check.overflowInner).toBe(true); // ante dudas, alerta de más (§6)
    expect(check.status).toBe('overflow');
  });
});

/* -------------------------------------------------------------------------- */
/* R7 — Auto: mayor escala segura ≤ 110 % (forma cerrada de la bajada binaria) */
/* -------------------------------------------------------------------------- */

describe('R7 — Auto (mayor escala segura ≤ 110 %)', () => {
  it('anillo tocando el anillo (fixture QA1): Auto queda en 100 %', () => {
    expect(largestSafeScalePct({ inkMaxMm: 61.5, inkMinMm: 47.5 }, 61.5, 47.5)).toBe(100);
  });

  it('diseño con margen holgado: Auto sube al TOPE 110 %', () => {
    expect(largestSafeScalePct({ inkMaxMm: 50, inkMinMm: 50 }, 61.5, 47.5)).toBe(110);
  });

  it('el 92.5 % es la mayor escala segura (QA1: grilla 0.5 % respetada)', () => {
    // Datum elegido con la forma cerrada: outer exige s ≤ 100·61.5/66.2 =
    // 92.90 ⇒ floor₀.₅ = 92.5; inner exige s ≥ 100·47.5/51.4 = 92.41 ⇒
    // ceil₀.₅ = 92.5. La banda [92.5, 92.5] cosa EXACTA del paso 0.5 %.
    expect(largestSafeScalePct({ inkMaxMm: 66.2, inkMinMm: 51.4 }, 61.5, 47.5)).toBe(92.5);
  });

  it('dip estructural: NINGUNA escala del rango sirve ⇒ null (no tocar la escala)', () => {
    // sOut = 111.8 pero sIn = 118.75: por afuera hay lugar y por adentro no —
    // el botón Auto NO cambia la escala y el banner sigue visible.
    expect(largestSafeScalePct({ inkMaxMm: 55, inkMinMm: 40 }, 61.5, 47.5)).toBeNull();
  });

  it('envolvente degenerada ⇒ null', () => {
    expect(largestSafeScalePct({ inkMaxMm: 0, inkMinMm: 0 }, 61.5, 47.5)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* R8/§4 — normalización de la escala y presentación                           */
/* -------------------------------------------------------------------------- */

describe('R8 — normalizeScale / parseScaleInput / formatScaleLabel', () => {
  it('clamp duro [70, 110] con paso 0.5% (§6: acotar con aviso, jamás error rojo)', () => {
    expect(normalizeScale(115)).toBe(110);
    expect(normalizeScale(65)).toBe(70);
    expect(normalizeScale(-20)).toBe(70);
    expect(normalizeScale(1e6)).toBe(110);
    expect(normalizeScale(92)).toBe(92);
    expect(normalizeScale(92.25)).toBe(92.5);
    expect(normalizeScale(92.74)).toBe(92.5);
    expect(normalizeScale(92.76)).toBe(93);
  });

  it('entrada no numérica ⇒ 100 % (proyecto/link antiguo sin scale ⇒ 100 %, R8)', () => {
    expect(normalizeScale(null)).toBe(100);
    expect(normalizeScale(undefined)).toBe(100);
    expect(normalizeScale('95')).toBe(100); // los strings se parsean vía parseScaleInput
    expect(normalizeScale(NaN)).toBe(100);
    expect(normalizeScale(Infinity)).toBe(100);
  });

  it('QA1: 92.5% es alcanzable por slider (paso 0.5) y por teclado (92,5 / 92%)', () => {
    expect(normalizeScale(92.5)).toBe(92.5);
    expect(parseScaleInput('92,5')).toBe(92.5);
    expect(parseScaleInput('92%')).toBe(92);
    expect(parseScaleInput(' 87.25 ')).toBe(87.25);
    expect(parseScaleInput('5.')).toBe(5); // tipeo en curso ("5." precede al decimal)
    expect(parseScaleInput('')).toBeNull();
    expect(parseScaleInput('92.5%extra')).toBeNull();
    expect(parseScaleInput('abc')).toBeNull();
  });

  it('formato §4/R7: "92%" / "92.5%" — un decimal SOLO si no es entero', () => {
    expect(formatScaleLabel(92)).toBe('92%');
    expect(formatScaleLabel(92.5)).toBe('92.5%');
    expect(formatScaleLabel(115)).toBe('110%'); // normaliza antes de imprimir
    expect(formatScaleLabel(65)).toBe('70%');
  });

  it('R7: presets [85, 90, 100] SIN etiqueta "Máx" (el máximo real es 110)', () => {
    expect(SCALE_PRESETS.map((p) => p.pct)).toEqual([85, 90, 100]);
    expect(SCALE_RANGE).toEqual({ min: 70, max: 110 });
    expect(SCALE_STEP_PCT).toBe(0.5);
    expect(OVERFLOW_SCAN_SIZE).toBe(512);
  });
});

/* -------------------------------------------------------------------------- */
/* R5/R6 — textos canónicos del banner y de la ficha                           */
/* -------------------------------------------------------------------------- */

describe('R5/R6 — redacción EXACTA del banner y de la línea de ficha', () => {
  it('banner con ambas mediciones (formato especificado por R5)', () => {
    const both = {
      status: 'overflow' as const,
      overflowOuter: true,
      overflowInner: true,
      overflowOuterMm: 1.2,
      overflowInnerMm: 3,
    };
    expect(overflowBannerText(both)).toBe(
      'El diseño supera el límite de la chapa plana. Riesgo de grabado deformado o ' +
        'chorreado en la pared de la virola. Excede 1.2 mm por fuera / 3.0 mm hacia la boca.',
    );
  });

  it('banner con solo desborde interno y solo externo (el verbo va UNA vez)', () => {
    const inner = {
      status: 'overflow' as const,
      overflowOuter: false,
      overflowInner: true,
      overflowOuterMm: 0,
      overflowInnerMm: 2.5,
    };
    expect(overflowBannerText(inner)).toBe(
      'El diseño supera el límite de la chapa plana. Riesgo de grabado deformado o ' +
        'chorreado en la pared de la virola. Excede 2.5 mm hacia la boca.',
    );
    const outer = { ...inner, overflowOuter: true, overflowInner: false, overflowOuterMm: 0.4 };
    expect(overflowBannerText(outer)).toBe(
      'El diseño supera el límite de la chapa plana. Riesgo de grabado deformado o ' +
        'chorreado en la pared de la virola. Excede 0.4 mm por fuera.',
    );
  });

  it('línea de ficha R6: "Margen: seguro" y "con riesgo (excede X mm)"', () => {
    const safe = {
      status: 'safe' as const,
      overflowOuter: false,
      overflowInner: false,
      overflowOuterMm: 0,
      overflowInnerMm: 0,
    };
    expect(marginSheetLine(safe)).toBe('Margen: seguro');
    const risk = {
      status: 'overflow' as const,
      overflowOuter: true,
      overflowInner: false,
      overflowOuterMm: 1.2,
      overflowInnerMm: 0,
    };
    expect(marginSheetLine(risk)).toBe('Margen: con riesgo (excede 1.2 mm por fuera)');
  });
});
