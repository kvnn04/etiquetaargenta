/* ============================================================================
 * SHAPE PÚBLICO DEL VISOR (Modo Cliente) — posición 10A
 * (spec_ficha_comercial_interactiva_shareable_link.md §3-R4/§6 + QA1)
 * ----------------------------------------------------------------------------
 * Server (page /v/[linkId]) lee la fila con SERVICE-ROLE y le PASA el jsonb
 * crudo a buildPublicView: un normalizador TOLERANTE (mismo criterio que
 * normalizeState de proyectos) que:
 *   · re-arbitra los contratos del payload con los ya cerrados — escalation
 *     por variante a % canónico [70..110] (fracción×100), rotación módulo
 *     360°, label ≤40 truncado elegante (normalizeVariantLabel);
 *   · desconocido/raro ⇒ defaults (model=camionero QA, diámetros 123/95);
 *   · legacy (schemaVersion ≤1 con textureDataUrl inline) ⇒ sintetiza UNA
 *     variante 'A' 1:1 (QA1: "payload legacy renderiza 1:1 con compat");
 *   · variante con assetUrl ausente ⇒ `healthy: false` — el visor la muestra
 *     deshabilitada ("Opción B no disponible") mientras A/C siguen operando.
 * PURO y sin IO: los tests unitarios pinna todo el contrato.
 * ============================================================================ */

import {
  isLegacyPayload,
  normalizeVariantLabel,
  isLinkVariantId,
  type LinkPayload,
  type LinkProductFamily,
  type LinkVariantId,
} from '@/lib/links/payload';
import { normalizeScale } from '@/lib/overflow';
import { normalizeRotation } from '@/lib/design';
import { isThermoProduct, resolveProduct, resolveMateModel, type ThermoSpec } from '@/lib/catalog';
import { normalizeThermoConfig, normalizeThermoScale, normalizeThermoScaleFor } from '@/lib/thermo';
import type { BodyPresetId, MetalPresetId } from '@/lib/color';

/* Diámetros de la spec geométrica (defaults si el jsonb trae basura). */
const DEFAULT_EXT_MM = 123;
const DEFAULT_INT_MM = 95;

/* Presets del catálogo de color — MISMA validación de persistence.ts (pos 5). */
const VALID_METAL_PRESETS: MetalPresetId[] = ['alpaca', 'acero', 'bronce'];
const VALID_BODY_PRESETS: BodyPresetId[] = ['algarrobo', 'calabaza', 'cuero_negro'];

export interface PublicVariantView {
  id: LinkVariantId;
  label: string;
  assetUrl: string;
  /** true si el payload trae assetUrl utilizable (el CLIENTE valida que la imagen cargue). */
  healthy: boolean;
  /** % canónico de la familia (mate [70..110] · termo [10..100]). */
  scalePct: number;
  /** Grados módulo 360 (re-arbitrados). */
  rotationDeg: number;
  mirror: boolean;
}

export interface PublicLinkView {
  linkId: string;
  workshop: {
    name: string;
    logoUrl: string | null;
    /** E.164 SIN '+' (solo dígitos) — whatsappApprovalHref lo consume. */
    whatsapp: string | null;
    instagram: string | null;
  };
  mate: {
    /** id del catálogo SIEMPRE válido (fallback camionero, QA/R4). */
    modelId: string;
    /** Familia del producto congelada en el payload (ausente ⇒ mate). */
    family: LinkProductFamily;
    extDiameter: number;
    intDiameter: number;
    metal: MetalPresetId;
    virolaColor: string | null;
    cupMaterial: BodyPresetId;
    cupColor: string | null;
    /** Estado propio del termo (null en mates). */
    thermo: { offsetYPct: number; invert: boolean; finish: 'matte' | 'satin' | 'brushed' } | null;
  };
  variants: PublicVariantView[];
}

function positiveMm(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function hexOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.startsWith('#')) return null;
  return v.toUpperCase();
}

/** metalPreset del payload ⇒ id VÁLIDO (basura ⇒ alpaca — defaults de pos 5). */
function metalPresetOf(v: unknown): MetalPresetId {
  return typeof v === 'string' && (VALID_METAL_PRESETS as string[]).includes(v)
    ? (v as MetalPresetId)
    : 'alpaca';
}

/** bodyPreset del payload ⇒ id VÁLIDO (basura ⇒ algarrobo). */
function bodyPresetOf(v: unknown): BodyPresetId {
  return typeof v === 'string' && (VALID_BODY_PRESETS as string[]).includes(v)
    ? (v as BodyPresetId)
    : 'algarrobo';
}

/** Fracción 0–1.10 del payload ⇒ % canónico del producto. Basura ⇒ default. */
function scalePctFromFraction(
  v: unknown,
  family: LinkProductFamily = 'mate',
  spec?: ThermoSpec | null,
): number {
  const valid = typeof v === 'number' && Number.isFinite(v);
  if (family === 'thermo') {
    // Sin escala en el payload ⇒ default del producto (termo 45 % · botella 72 %).
    return spec
      ? normalizeThermoScaleFor(spec, valid ? (v as number) * 100 : undefined)
      : normalizeThermoScale(valid ? (v as number) * 100 : undefined);
  }
  return normalizeScale(valid ? (v as number) * 100 : 100);
}

function normalizeWorkshop(raw: unknown): PublicLinkView['workshop'] {
  const w = (raw ?? {}) as {
    name?: unknown;
    logoUrl?: unknown;
    whatsapp?: unknown;
    instagram?: unknown;
  };
  return {
    name: typeof w.name === 'string' && w.name.trim().length > 0 ? w.name.trim() : 'MOCAP 3D',
    logoUrl: typeof w.logoUrl === 'string' && w.logoUrl.startsWith('http') ? w.logoUrl : null,
    whatsapp: typeof w.whatsapp === 'string' ? w.whatsapp.replace(/\D/g, '') || null : null,
    instagram: typeof w.instagram === 'string' && w.instagram.trim().length > 0 ? w.instagram.trim() : null,
  };
}

function buildVariant(
  id: LinkVariantId,
  candidate: { label?: unknown; assetUrl?: unknown; scale?: unknown; rotation?: unknown; mirror?: unknown },
  family: LinkProductFamily = 'mate',
  spec?: ThermoSpec | null,
): PublicVariantView {
  const assetUrl = typeof candidate.assetUrl === 'string' && /^https?:\/\//.test(candidate.assetUrl)
    ? candidate.assetUrl
    : '';
  return {
    id,
    label: normalizeVariantLabel(candidate.label) || `Opción ${id}`,
    assetUrl,
    healthy: assetUrl.length > 0,
    scalePct: scalePctFromFraction(candidate.scale, family, spec),
    rotationDeg: normalizeRotation(candidate.rotation),
    mirror: Boolean(candidate.mirror),
  };
}

/** Versión 2 (contrato actual): usa las cláusulas tal cual están congeladas. */
function fromModernPayload(payload: LinkPayload): PublicLinkView {
  const mc = payload.mateConfig ?? ({} as Record<string, unknown>);
  const product = resolveProduct(typeof mc.model === 'string' ? mc.model : null);
  /* El MODELO del catálogo es la fuente de verdad: un payload manipulado no
   * puede declarar familia thermo con un modelo mate (ni al revés). */
  const family: LinkProductFamily = product.family;
  const thermo = isThermoProduct(product);

  const extDiameter = thermo
    ? Number((product.thermo.radiusMm * 2).toFixed(2))
    : positiveMm(mc.extDiameter, DEFAULT_EXT_MM);
  let intDiameter = thermo
    ? extDiameter
    : positiveMm(mc.intDiameter, DEFAULT_INT_MM);
  if (!thermo && intDiameter >= extDiameter) intDiameter = DEFAULT_INT_MM; // 1:1 geométrica R1

  const rawVariants = Array.isArray(payload.variants) ? payload.variants : [];
  const variants: PublicVariantView[] = [];
  const seen = new Set<LinkVariantId>();
  for (const item of rawVariants.slice(0, 3)) {
    const candidate = item as unknown as {
      id?: unknown;
      label?: unknown;
      assetUrl?: unknown;
      scale?: unknown;
      rotation?: unknown;
      mirror?: unknown;
    };
    if (!isLinkVariantId(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    variants.push(buildVariant(candidate.id, candidate, family, thermo ? product.thermo : null));
  }

  const thermoConfig = normalizeThermoConfig(mc.thermo);

  return {
    linkId: typeof payload.linkId === 'string' ? payload.linkId : '',
    workshop: normalizeWorkshop(payload.workshop),
    mate: {
      // R4/QA: desconocido ⇒ camionero (resolveProduct ya cae al fallback)
      modelId: product.id,
      family,
      extDiameter,
      intDiameter,
      metal: metalPresetOf(mc.metal),
      virolaColor: hexOrNull(mc.virolaColor),
      cupMaterial: bodyPresetOf(mc.cupMaterial),
      cupColor: hexOrNull(mc.cupColor),
      thermo: thermo ? { ...thermoConfig } : null,
    },
    variants,
  };
}

/* -------------------------------------------------------------------------- */
/* Compat legacy (schemaVersion ≤ 1, QA1: "renderiza 1:1")                     */
/* -------------------------------------------------------------------------- */

/**
 * Payload legado: UNA imagen inline (textureDataUrl) y config plana — la
 * estructura de la primera iteración de la ficha comercial. Se sintetiza
 * UNA variante 'A' con el contrato 1:1 (color compat / solo cara superior).
 */
type LegacyFields = {
  linkId?: unknown;
  mateModel?: unknown;
  extDiameter?: unknown;
  intDiameter?: unknown;
  metalPreset?: unknown;
  virolaColor?: unknown;
  bodyPreset?: unknown;
  bodyColor?: unknown;
  textureDataUrl?: unknown;
};

function fromLegacyPayload(raw: unknown): PublicLinkView {
  const legacy = (raw ?? {}) as LegacyFields;
  const extDiameter = positiveMm(legacy.extDiameter, DEFAULT_EXT_MM);
  let intDiameter = positiveMm(legacy.intDiameter, DEFAULT_INT_MM);
  if (intDiameter >= extDiameter) intDiameter = DEFAULT_INT_MM;

  const inline = typeof legacy.textureDataUrl === 'string' && legacy.textureDataUrl.startsWith('data:image/')
    ? legacy.textureDataUrl
    : '';

  return {
    linkId: typeof legacy.linkId === 'string' ? legacy.linkId : '',
    workshop: normalizeWorkshop(undefined), // legacy no congelaba branding
    mate: {
      modelId: resolveMateModel(typeof legacy.mateModel === 'string' ? legacy.mateModel : null).id,
      family: 'mate',
      extDiameter,
      intDiameter,
      metal: metalPresetOf(legacy.metalPreset),
      virolaColor: hexOrNull(legacy.virolaColor),
      cupMaterial: bodyPresetOf(legacy.bodyPreset),
      cupColor: hexOrNull(legacy.bodyColor),
      thermo: null,
    },
    variants: [
      {
        id: 'A',
        label: 'Opción A',
        // data: URL inline ⇒ el visor la consume directo (Image.src acepta data:).
        assetUrl: inline,
        healthy: inline.length > 0,
        scalePct: 100,
        rotationDeg: 0,
        mirror: false,
      },
    ],
  };
}

/**
 * jsonb crudo de la fila `links` ⇒ vista del visor. JAMÁS lanza: un registro
 * dañado produce una vista vacía (sin variantes ⇒ página "no disponible")
 * en vez de un 500 pelado.
 */
export function buildPublicView(raw: unknown): PublicLinkView {
  if (isLegacyPayload(raw)) return fromLegacyPayload(raw);
  const payload = raw as LinkPayload | null;
  if (!payload || typeof payload !== 'object') {
    return fromLegacyPayload(undefined);
  }
  return fromModernPayload(payload);
}
