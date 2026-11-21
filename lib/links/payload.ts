/* ============================================================================
 * PAYLOAD DEL LINK — posición 10A (spec_ficha_comercial_interactiva_shareable_link.md §3-R4/§6)
 * ----------------------------------------------------------------------------
 * schemaVersion 2 EXACTO de la spec: workshop + mateConfig + variants[] con
 * assetUrl por variante, `scale` en FRACCIÓN (0–1.10 = % / 100 del editor) y
 * `rotation` en grados módulo 360 — mismos significados que las specs de
 * escala/rotación (cross-refs declaradas al pie de la spec).
 *
 * Decisiones cerradas con el titular (10A):
 *   · variantes = CONFIGS del mismo diseño (rotación/escala/espejo + label);
*     las 3 comparten `assetUrl` (una sola textura congelada por versión).
 *   · labels editables ≤ 40 chars con truncado elegante.
 *   · `cupMaterial` = id del preset del CUERPO del catálogo (igual criterio
 *     que `model` = id del catálogo) — el visor usa SU registro.
 * Este módulo es PURO (sin DB): el route valida y arma; los tests fijan
 * cada formato.
 * ============================================================================ */

export const LINK_SCHEMA_VERSION = 2;
export const LINK_LABEL_MAX = 40;
export const LINK_VARIANTS_MAX = 3;

import { normalizeRotation } from '@/lib/design';
import { normalizeScale } from '@/lib/overflow';

/** Id canónico de variante (R4: 'A' | 'B' | 'C'). */
export type LinkVariantId = 'A' | 'B' | 'C';
export const LINK_VARIANT_IDS: readonly LinkVariantId[] = ['A', 'B', 'C'];

export function isLinkVariantId(raw: unknown): raw is LinkVariantId {
  return raw === 'A' || raw === 'B' || raw === 'C';
}

/** Config que el editor manda al publicar (escala en % canónica pos 7). */
export interface LinkVariantDraft {
  id: LinkVariantId;
  label: string;
  /** % canónico [70..110] paso 0.5% — se serializa como fracción 0–1.10 (R4). */
  scalePct: number;
  /** Grados canónicos [0°, 360°) — se serializa módulo 360 (R4). */
  rotationDeg: number;
  mirror: boolean;
}

/**
 * R7 (10A — desviación ADITIVA documentada): estado de margen CONGELADO al
 * publicar, para que el editor lo muestre en su panel de versiones ("la
 * variante queda marcada internamente como con riesgo"). El CLIENTE del link
 * JAMÁS lo lee (su acordeón solo trae Modelo/Virola/Cuerpo, la spec §3-R7).
 * Es un campo opcional: los payloads que no lo traen son compatibles al 100%.
 */
export interface LinkVariantRisk {
  status: 'none' | 'safe' | 'overflow';
  /** Exceso máximo hacia afuera (mm, 1 decimal) — null si no aplica. */
  outsideMm: number | null;
  /** Atravesado máximo hacia el interior (mm, 1 decimal) — null si no aplica. */
  innerMm: number | null;
  /** §6 spec_escala: envolvente degradada ⇒ "Detección aproximada". */
  approx: boolean;
}

/** Bloque workshop del payload (R4) — branding ya resuelto por el SERVER. */
export interface LinkWorkshopBlock {
  name: string;
  logoUrl: string | null; // null ⇒ el visor cae a iniciales / "MI TALLER" (spec usuario)
  whatsapp: string | null; // E.164 SIN '+' (wa.me usa dígitos)
  instagram: string | null;
}

/** Bloque mateConfig del payload (R4). */
export interface LinkMateConfigBlock {
  model: string; // id del catálogo (R4: desconocido ⇒ fallback camionero en el visor)
  extDiameter: number;
  intDiameter: number;
  metal: string; // metalPreset del catálogo de color (pos 5)
  virolaColor: string | null; // null ⇒ el visor usa el preset (compat R6 pos 5)
  topFaceColor: string | null; // campo de compat con payload legacy (regla 1:1)
  cupMaterial: string; // bodyPreset del catálogo de color
  cupColor: string | null;
}

/** Variante SERIALIZADA (R4): fracción y módulo 360. */
export interface LinkVariantPayload {
  id: LinkVariantId;
  label: string;
  assetUrl: string;
  /** Fracción 0–1.10 (R4) — el visor la re-arbitra con sus contratos. */
  scale: number;
  /** Grados módulo 360 (R4). */
  rotation: number;
  mirror: boolean;
  /** R7 10A: márgenes congelados — solo la vista del editor lo consume. */
  risk: LinkVariantRisk | null;
}

/** payload completo (R4). */
export interface LinkPayload {
  schemaVersion: typeof LINK_SCHEMA_VERSION;
  linkId: string;
  createdAt: string; // ISO
  expiresAt: string; // ISO (+30 días, R5)
  workshop: LinkWorkshopBlock;
  mateConfig: LinkMateConfigBlock;
  variants: LinkVariantPayload[];
}

/* -------------------------------------------------------------------------- */
/* Normalizadores puros (el route los re-usa para validar lo que llega)        */
/* -------------------------------------------------------------------------- */

/**
 * Truncado elegante del label a LINK_LABEL_MAX (§6: "labels de hasta 40
 * caracteres, truncado elegante"): corta en el último espacio previo al límite
 * si existe (palabra jamás a mitades), sin elipsis en MVP (el slot es corto).
 */
export function normalizeVariantLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (clean.length <= LINK_LABEL_MAX) return clean;
  const cut = clean.slice(0, LINK_LABEL_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > LINK_LABEL_MAX * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/** % del editor ⇒ FRACCIÓN 0–1.10 (R4) con 3 decimales (0.925 exacto). */
export function scaleFractionFromPct(pct: unknown): number {
  const v = typeof pct === 'number' && Number.isFinite(pct) ? normalizeScale(pct) : 100;
  return Math.round((v / 100) * 1000) / 1000;
}

/** Deg del editor ⇒ módulo 360 canónico (R4; misma R3 de pos 6 paso 0.5°). */
export function rotationDegPayload(deg: unknown): number {
  return normalizeRotation(deg);
}

/**
 * ¿El draft es publicable? (§6: "al menos 1 variante con diseño y el mate
 * configurado; 3 variantes máximo"). Las configs llegan NORMALIZADAS — acá
 * solo se controla cantidad + ids válidos y sin duplicados.
 *
 * `max` permite que el publish actual exija UNA sola variante
 * (`PUBLISH_VARIANTS_MAX`) sin romper la validación legacy de A/B/C que usan
 * los payloads ya publicados.
 */
export function isPublishableDraft(
  variants: readonly LinkVariantDraft[],
  max: number = LINK_VARIANTS_MAX,
): boolean {
  if (variants.length < 1 || variants.length > max) return false;
  const ids = new Set(variants.map((v) => v.id));
  if (ids.size !== variants.length) return false;
  return variants.every((v) => isLinkVariantId(v.id) && v.label.trim().length > 0);
}

/**
 * Decisión del titular (nov-2026): por ahora el Enlace Comercial publica UN
 * SOLO diseño. El payload y el visor siguen leyendo links legacy con A/B/C.
 */
export const PUBLISH_VARIANTS_MAX = 1;
export const SINGLE_PUBLISH_VARIANT_LABEL = 'Diseño actual';

/** Variante única del publish: toma rotación/escala/espejo VIGENTES del editor. */
export function buildPublishVariant(design: {
  scale: number;
  rotation: number;
  mirror: boolean;
}): LinkVariantDraft {
  return {
    id: 'A',
    label: SINGLE_PUBLISH_VARIANT_LABEL,
    scalePct: normalizeScale(design.scale),
    rotationDeg: rotationDegPayload(design.rotation),
    mirror: Boolean(design.mirror),
  };
}

/** Armado puro del payload (R4). `assetUrl` ya lo subió el server. */
export function buildLinkPayload(input: {
  linkId: string;
  nowMs: number;
  expiresMs: number;
  workshop: LinkWorkshopBlock;
  mateConfig: LinkMateConfigBlock;
  variants: readonly LinkVariantDraft[];
  assetUrl: string;
  /** R7 10A: margen congelado por variante (el editor lo calcula por escala). */
  riskByVariant?: Partial<Record<LinkVariantId, LinkVariantRisk>>;
}): LinkPayload {
  return {
    schemaVersion: LINK_SCHEMA_VERSION,
    linkId: input.linkId,
    createdAt: new Date(input.nowMs).toISOString(),
    expiresAt: new Date(input.expiresMs).toISOString(),
    workshop: { ...input.workshop },
    mateConfig: { ...input.mateConfig },
    variants: input.variants.map((v) => ({
      id: v.id,
      label: normalizeVariantLabel(v.label),
      assetUrl: input.assetUrl,
      scale: scaleFractionFromPct(v.scalePct),
      rotation: rotationDegPayload(v.rotationDeg),
      mirror: v.mirror,
      risk: input.riskByVariant?.[v.id] ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Draft persistible del editor (projects.state.linkDraft)                     */
/* ---------------------------------------------------------------------------- */

/**
 * Fila del borrador de variantes que el PROJECT STATE persiste (decisión
 * 10A: labels y configs no se pierden al recargar). `included` controla si
 * esa fila va al publish (el payload solo recibe las incluidas). SOLO vive
 * en el jsonb del proyecto — jamás en el payload del link congelado.
 */
export interface StoredVariantRow extends LinkVariantDraft {
  included: boolean;
}

/**
 * Normalizador tolerante del jsonb (mismo criterio que normalizeState):
 * ≤3 filas, ids válidos y sin duplicados (primera ocurrencia gana), label
 * ≤40 con truncado elegante, escala/rotación a la canónica, `included`
 * booleano. Basura ⇒ fila ignorada; nada explota la carga del proyecto.
 */
export function normalizeVariantRows(raw: unknown): StoredVariantRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: StoredVariantRow[] = [];
  const seen = new Set<LinkVariantId>();
  for (const item of raw.slice(0, LINK_VARIANTS_MAX)) {
    const candidate = (item ?? {}) as Record<string, unknown>;
    if (!isLinkVariantId(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    rows.push({
      id: candidate.id as LinkVariantId,
      label: normalizeVariantLabel(candidate.label),
      scalePct: normalizeScale(candidate.scalePct), // % canónico [70..110]
      rotationDeg: rotationDegPayload(candidate.rotationDeg),
      mirror: Boolean(candidate.mirror),
      included: Boolean(candidate.included),
    });
  }
  return rows;
}

/** Variantes que van al publish (las incluidas, en orden A→C). */
export function includedRows(rows: readonly StoredVariantRow[]): StoredVariantRow['id'][] {
  return rows.filter((r) => r.included).map((r) => r.id);
}

/**
 * §3-R4 compat: un payload legado (schemaVersion ausente o 1) renderiza 1:1
 * (aceptando `textureDataUrl` inline). El visor decide con este helper.
 */
export function isLegacyPayload(raw: unknown): boolean {
  const v =
    raw !== null && typeof raw === 'object' ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  return v === undefined || v === 1;
}
