/* ============================================================================
 * MOTOR DE DESBORDE (CHORREO) — ÚNICA FUENTE: spec_escala_y_alerta_de_desborde.md
 * ----------------------------------------------------------------------------
 * R4 — Escaneo polar exacto: máscara alfa 512×512 (α ≥ 128 ⇒ trazado activo;
 *      la transparencia no es trazado §6), cada píxel activo comparado en
 *      coordenadas polares contra R_ext / R_int en mm. Tolerancia 0 mm ESTRICTA:
 *      el borde del anillo es límite duro (toqué ≠ desborde) — NO existe
 *      "margen de seguridad" adicional. Mediciones derivadas en mm (1 decimal):
 *      exceso máximo hacia afuera / atravesado máximo hacia adentro.
 * R3 — Invariancia polar: rotación y espejo preservan el radio por píxel
 *      respecto al centro del carril (son isometrías con pivote fijo), así que
 *      el evaluador se ejecuta por CAMBIO DE ESCALA, CAMBIO DE D_ext/D_int y
 *      CARGA/CAMBIO DE DISEÑO — cambiar ángulo/espejo NO re-escanea
 *      (optimización explícita, sin estado inválido).
 * R1 — Anclaje del 100 %: el ráster de trabajo (R8 pos 6: contain-fit
 *      centrado en 1024²) YA dimensiona el trazado para que su envolvente
 *      toque el anillo de la chapa (bbox ⇒ toca R_ext del producto vigente al
 *      cargar). Ese tamaño queda CONGELADO (el asset es un ráster fijo de
 *      sesión) y el 70 %–110 % paso 0.5 % opera como multiplicador sobre esa
 *      base. Editar D_ext/D_int DESPUÉS no re-escala el diseño: solo
 *      re-chequea desborde — el % tiene siempre el mismo significado.
 * R5 — Estados deterministas: Seguro (verde/neutro) / Desborde (banner con la
 *      redacción EXACTA de la spec: supera el límite de la chapa plana…).
 * R6 — Ficha: "Margen: seguro" / "Margen: con riesgo (excede X mm)" — sus
 *      consumidores (Ficha PNG/PDF pos 9) leen de las MISMAS funciones.
 * R7 — Auto: mayor escala segura ≤ 110 %. Como cada radio de trazado escala
 *      linealmente con s/100 (isometría homotética respecto del pivote), la
 *      bajada binaria de la spec tiene forma cerrada EXACTA sobre los dos
 *      escalares de la envolvente de tinta — misma respuesta, costo O(1).
 * R8 — Persistencia: `projects.state.design.scale` en % (70–110, legacy ⇒
 *      100). El estado de margen NO se persiste: es derivable re-ejecutando el
 *      motor (al recargar proyecto/link el chequeo corre al abrir).
 * §6 — Modo degradado: si el raster del chequeo falla, el chequeo cae a modo
 *      envolvente (bbox) marcado CONSERVADOR con aviso "Detección aproximada"
 *      — ante dudas el sistema alerta de más, nunca de menos.
 * ============================================================================ */

/** R4: lado de la máscara alfa del escaneo (px). */
export const OVERFLOW_SCAN_SIZE = 512;

/** R4: umbral de trazado activo sobre el canal alfa. */
export const OVERFLOW_ALPHA_THRESHOLD = 128;

/** R3/R8: rango y paso canónicos de la escala (% del desenie). */
export const SCALE_RANGE = { min: 70, max: 110 } as const;
export const SCALE_STEP_PCT = 0.5;

/** R7: presets de escala — SIN etiqueta "Máx" (el máximo real es 110 %). */
export interface ScalePreset {
  pct: number;
}

export const SCALE_PRESETS: readonly ScalePreset[] = [
  { pct: 85 },
  { pct: 90 },
  { pct: 100 },
];

/* -------------------------------------------------------------------------- */
/* R1/R8 — normalización de la escala (estado canónico único)                  */
/* -------------------------------------------------------------------------- */

/** Limpieza de floats (mismo convenio que cleanNumber en lib/virola). */
function cleanScale(v: number): number {
  return Number(v.toFixed(2));
}

/**
 * R8/§6: representación canónica de la escala — % en [70, 110] redondeado al
 * paso 0.5 % más cercano. Entrada no numérica ⇒ 100 % (R1: proyecto/link
 * antiguo sin `scale` ⇒ 100 %; la basura del jsonb nunca rompe la carga).
 */
export function normalizeScale(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 100;
  const clamped = Math.min(Math.max(raw, SCALE_RANGE.min), SCALE_RANGE.max);
  const stepped = Math.round(clamped / SCALE_STEP_PCT) * SCALE_STEP_PCT;
  return cleanScale(Math.min(Math.max(stepped, SCALE_RANGE.min), SCALE_RANGE.max));
}

/** Parser del campo numérico (§6: acepta `.` y `,` decimales; % opcional). */
export function parseScaleInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/%/g, '').replace(',', '.');
  if (cleaned === '' ) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

/** R7/§4: "92%" / "92.5%" — un decimal SOLO si no es entero. */
export function formatScaleLabel(pct: number): string {
  const norm = normalizeScale(pct);
  return Number.isInteger(norm) ? `${norm}%` : `${norm.toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/* R4/R1 — envolvente de tinta al 100 % (medida UNA vez por carga de diseño)   */
/* -------------------------------------------------------------------------- */

/**
 * Envolvente radial de la tinta al 100 %, en mm — los DOS escalares
 * de los que TODO el motor deriva (isometrías + homotecia del pivote: la
 * rotación y el espejo no cambian estos radios; la escala los multiplica).
 * Se mide UNA VEZ al cargar el asset (spec §3: los cambios de ángulo/escala
 * re-evalúan, jamás re-renderizan la medición).
 */
export interface InkEnvelope {
  /** Radio máximo de tinta (mm) al 100 % — contra R_ext (Desborde externo). */
  inkMaxMm: number;
  /** Radio mínimo de tinta (mm) al 100 % — contra R_int (Desborde interno). */
  inkMinMm: number;
}

/**
 * R4 — Escaneo polar EXACTO de una máscara alfa cuadrada (el consumidor con
 * canvas compone el ráster del diseño a `size`² y llama esto; los tests
 * de unidad inyectan máscaras sintéticas). `mmPerPx` convierte la distancia
 * al centro de cada píxel a mm del carril.
 *
 * Devuelve la envolvente de tinta al 100 % y las banderas de desborde de la
 * ESE medición con la base escaneada. Solo cuenta α ≥ threshold (R4).
 */
export function scanInkEnvelope(
  mask: { size: number; alphaAt(x: number, y: number): number },
  mmPerPx: number,
): InkEnvelope | null {
  const { size, alphaAt } = mask;
  const half = size / 2;
  // R4 literal: barrer TODOS los píxeles activos (α ≥ umbral) y registrar el
  // radio polar máximo/mínimo respecto del centro (límite duro del anillo).
  let max = -1;
  let min = Infinity;
  let hasInk = false;
  for (let y = 0; y < size; y++) {
    const dy = y + 0.5 - half;
    for (let x = 0; x < size; x++) {
      if (alphaAt(x, y) < OVERFLOW_ALPHA_THRESHOLD) continue;
      const dx = x + 0.5 - half;
      const rMm = Math.hypot(dx, dy) * mmPerPx;
      hasInk = true;
      if (rMm > max) max = rMm;
      if (rMm < min) min = rMm;
    }
  }
  if (!hasInk) return null; // sin trazado ⇒ sin envolvente (campo nulo)
  return { inkMaxMm: max, inkMinMm: min };
}

/* -------------------------------------------------------------------------- */
/* Evaluación por estado (escala vigente) — los 3 disparadores re-evalúan      */
/* -------------------------------------------------------------------------- */

export type MarginStatus = 'safe' | 'overflow';

export interface OverflowCheck {
  /** R5: estado determinista del margen. */
  status: MarginStatus;
  /** R4: ∃ píxel con r > R_ext (estricto, tolerancia 0 mm). */
  overflowOuter: boolean;
  /** R4: ∃ píxel con r < R_int (estricto, tolerancia 0 mm). */
  overflowInner: boolean;
  /** R4: exceso máximo hacia afuera (mm, 1 decimal) — 0 si no desborda. */
  overflowOuterMm: number;
  /** R4: atravesado máximo hacia adentro (mm, 1 decimal) — 0 si no desborda. */
  overflowInnerMm: number;
}

function round1(v: number): number {
  return Number(v.toFixed(1));
}

/**
 * R2/R3/R4 — evaluación de la envolvente con la escala vigente: cada radio de
 * tinta escala linealmente con s/100 (homotecia del pivote X:50% Y:50%), así
 * que la comparación polar R4 se reproduce EXACTA de la envolvente al 100 % —
 * el chequeo re-ejecuta por cambio de escala (QA2 ≤ 25 ms: es O(1) contra los
 * dos escalares) y por cambio de D_ext/D_int (nuevos R_ext/R_int) — jamás por
 * ángulo/espejo (invariancia polar R3).
 */
export function evaluateOverflow(
  ink: InkEnvelope,
  rExtMm: number,
  rIntMm: number,
  scalePct: number,
): OverflowCheck {
  const k = normalizeScale(scalePct) / 100;
  const rMax = ink.inkMaxMm * k;
  const rMin = ink.inkMinMm * k;
  const overflowOuter = rMax > rExtMm; // estricto: tocar NO es desbordar (R4)
  const overflowInner = rMin < rIntMm;
  return {
    status: overflowOuter || overflowInner ? 'overflow' : 'safe',
    overflowOuter,
    overflowInner,
    overflowOuterMm: overflowOuter ? round1(rMax - rExtMm) : 0,
    overflowInnerMm: overflowInner ? round1(rIntMm - rMin) : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* §6 — MODO DEGRADADO: chequeo envolvente (bbox) CONSERVADOR                  */
/* -------------------------------------------------------------------------- */

/**
 * §6: si el raster del chequeo falla, el chequeo cae a modo envolvente: compara
 * la SEMIDIAGONAL del bbox dibujado (peor caso: esquinas con tinta) contra
 * R_ext, y reporta desborde interno SIEMPRE (el bbox toca el centro ⇒ la
 * "duda" se resuelve avisando de más — nunca de menos). El consumidor muestra
 * el aviso inline "Detección aproximada".
 */
export function evaluateOverflowBBox(
  baseSideMm: number,
  scalePct: number,
  rExtMm: number,
  rIntMm: number,
): OverflowCheck {
  const k = normalizeScale(scalePct) / 100;
  const halfDiag = (baseSideMm * Math.SQRT2 * k) / 2;
  const overflowOuter = halfDiag > rExtMm;
  return {
    status: 'overflow', // conservador: también D_int queda en duda
    overflowOuter,
    overflowInner: true, // bbox toca el centro ⇒ ante dudas, alerta de más
    overflowOuterMm: overflowOuter ? round1(halfDiag - rExtMm) : 0,
    overflowInnerMm: round1(Math.max(0, rIntMm)), // innegociable en modo bbox
  };
}

/* -------------------------------------------------------------------------- */
/* R7 — Auto: mayor escala segura ≤ 110 % (forma cerrada EXACTA, costo O(1))  */
/* -------------------------------------------------------------------------- */

/** Ancla a la grilla de 0.5 % (R1: el paso es contractual). */
function floorStep(v: number): number {
  return cleanScale(Math.floor(v / SCALE_STEP_PCT) * SCALE_STEP_PCT);
}

function ceilStep(v: number): number {
  return cleanScale(Math.ceil(v / SCALE_STEP_PCT) * SCALE_STEP_PCT);
}

/**
 * R7: la mayor escala de la grilla 70–110 sin desborde (tolerancia 0), o null
 * si NINGUNA escala del rango es segura (el botón Auto NO cambia la escala y
 * el banner sigue visible). Equivalente exacto de la bajada binaria de la
 * spec: outer exige s ≤ 100·R_ext/inkMax ⇒ candidato = floor₀.₅(min(110, s·));
 * inner exige s ≥ 100·R_int/inkMin ⇒ se coteja antes de aplicar.
 */
export function largestSafeScalePct(
  ink: InkEnvelope,
  rExtMm: number,
  rIntMm: number,
): number | null {
  if (ink.inkMaxMm <= 0 || ink.inkMinMm <= 0) return null;
  // outer: s ≤ 100·R_ext / inkMax (estricto ⇒ borde exacto permitido)
  const sOut = (100 * rExtMm) / ink.inkMaxMm;
  const candidate = Math.min(SCALE_RANGE.max, floorStep(sOut));
  if (candidate < SCALE_RANGE.min) return null;
  // inner: s ≥ 100·R_int / inkMin (estricto ⇒ borde exacto permitido)
  const sIn = (100 * rIntMm) / ink.inkMinMm;
  if (candidate >= ceilStep(sIn)) return candidate;
  return null; // ninguna escala del rango sirve: NO tocar la escala activa
}

/* -------------------------------------------------------------------------- */
/* R5/R6 — TEXTOS CANÓNICOS (banner + ficha)                                   */
/* -------------------------------------------------------------------------- */

/**
 * R5 — redacción EXACTA del banner (con mediciones en mm, 1 decimal). Los mm
 * mencionados provienen de evaluateOverflow (o del modo degradado, marcado
 * aparte con "Detección aproximada").
 */
export function overflowBannerText(check: OverflowCheck): string {
  const parts: string[] = [];
  if (check.overflowOuter) parts.push(`Excede ${check.overflowOuterMm.toFixed(1)} mm por fuera`);
  if (check.overflowInner) {
    // Redacción R5 literal: "Excede X mm por fuera / Y mm hacia la boca" —
    // el verbo va UNA vez: si solo desborda por adentro lo cargamos acá.
    parts.push(
      check.overflowOuter
        ? `${check.overflowInnerMm.toFixed(1)} mm hacia la boca`
        : `Excede ${check.overflowInnerMm.toFixed(1)} mm hacia la boca`,
    );
  }
  return (
    'El diseño supera el límite de la chapa plana. Riesgo de grabado deformado o ' +
    `chorreado en la pared de la virola. ${parts.join(' / ')}.`
  );
}

/**
 * R6 — línea de ficha: "Margen: con riesgo (excede X mm)" cuando exportó con
 * desborde confirmado; lista las direcciones. "Margen: seguro" si estaba
 * limpio (consumidores: Ficha PNG/PDF pos 9 — el flag de historial llega con
 * las posiciones 8–10).
 */
export function marginSheetLine(check: OverflowCheck): string {
  if (check.status === 'safe') return 'Margen: seguro';
  const parts: string[] = [];
  if (check.overflowOuter) parts.push(`excede ${check.overflowOuterMm.toFixed(1)} mm por fuera`);
  if (check.overflowInner) parts.push(`excede ${check.overflowInnerMm.toFixed(1)} mm hacia la boca`);
  return `Margen: con riesgo (${parts.join(' / ')})`;
}
