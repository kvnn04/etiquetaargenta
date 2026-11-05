/* ============================================================================
 * SISTEMA DE COLOR INTELIGENTE — ÚNICA FUENTE: spec_seleccion_de_color.md
 * ----------------------------------------------------------------------------
 * R1 — Tabla PBR única de materiales (fuente de verdad de materiales):
 *   Algarrobo / Madera     textura preset (#5A3825)  m: 0.00  r: 0.72  Cuerpo
 *   Calabaza / Suela       textura preset (#A45D2B)  m: 0.00  r: 0.78  Cuerpo
 *   Cuero Negro            textura preset (#171311)  m: 0.00  r: 0.62  Cuerpo
 *   Cuerpo color libre     HEX del usuario           m: 0.00  r: 0.82  Cuerpo
 *   Alpaca / Plata         #D8DADC                   m: 0.90  r: 0.28  Virola (3 mallas)
 *   Acero Mate             #A9ABAD                   m: 0.85  r: 0.55  Virola (3 mallas)
 *   Bronce Cálido          #B08344                   m: 0.95  r: 0.35  Virola (3 mallas)
 *   Virola anodizada/color HEX del usuario           m: 0.10  r: 0.45  Virola (3 mallas)
 *
 * R2 — Cobertura integral de virola: tiñe las 3 mallas del grupo virola
 *      (corona superior, faldón exterior y pared interior de la boca).
 * R3 — Exclusividad mutua: preset ∨ color libre por zona.
 * R4 — Quemado adaptativo del grabado: L = 0.2126R + 0.7152G + 0.0722B.
 *      L >= 0.55 ⇒ tono quemado oscuro #2B2118 (opacidad 0.88).
 *      L < 0.55  ⇒ tono plateado #C9CCCF (opacidad 0.92).
 *      Presets metálicos ⇒ quemado oscuro estándar #2B2118.
 * ============================================================================ */

export type MetalPresetId = 'alpaca' | 'acero' | 'bronce';
export type BodyPresetId = 'algarrobo' | 'calabaza' | 'cuero_negro';

export interface PbrMaterialParams {
  color: string;
  metalness: number;
  roughness: number;
}

export interface MetalPresetConfig {
  id: MetalPresetId;
  label: string;
  pbr: PbrMaterialParams;
}

export interface BodyPresetConfig {
  id: BodyPresetId;
  label: string;
  pbr: PbrMaterialParams;
}

/* -------------------------------------------------------------------------- */
/* R1 — Tabla canónica de materiales PBR                                      */
/* -------------------------------------------------------------------------- */

export const METAL_PRESETS: Record<MetalPresetId, MetalPresetConfig> = {
  alpaca: {
    id: 'alpaca',
    label: 'Alpaca / Plata',
    pbr: { color: '#D8DADC', metalness: 0.9, roughness: 0.28 },
  },
  acero: {
    id: 'acero',
    label: 'Acero Mate',
    pbr: { color: '#A9ABAD', metalness: 0.85, roughness: 0.55 },
  },
  bronce: {
    id: 'bronce',
    label: 'Bronce Cálido',
    pbr: { color: '#B08344', metalness: 0.95, roughness: 0.35 },
  },
};

export const BODY_PRESETS: Record<BodyPresetId, BodyPresetConfig> = {
  algarrobo: {
    id: 'algarrobo',
    label: 'Algarrobo / Madera',
    pbr: { color: '#5A3825', metalness: 0.0, roughness: 0.72 },
  },
  calabaza: {
    id: 'calabaza',
    label: 'Calabaza / Suela',
    pbr: { color: '#A45D2B', metalness: 0.0, roughness: 0.78 },
  },
  cuero_negro: {
    id: 'cuero_negro',
    label: 'Cuero Negro',
    pbr: { color: '#171311', metalness: 0.0, roughness: 0.62 },
  },
};

export const DEFAULT_METAL_PRESET: MetalPresetId = 'alpaca';
export const DEFAULT_BODY_PRESET: BodyPresetId = 'algarrobo';

/** R1: virola anodizada/pintada con color libre */
export const ANODIZED_VIROLA_PBR = {
  metalness: 0.1,
  roughness: 0.45,
} as const;

/** R1: cuerpo con color libre */
export const FREE_BODY_PBR = {
  metalness: 0.0,
  roughness: 0.82,
} as const;

/* -------------------------------------------------------------------------- */
/* Paleta comercial de colores rápidos (1-clic)                               */
/* -------------------------------------------------------------------------- */

export interface QuickColor {
  name: string;
  hex: string;
}

export const COMMERCIAL_QUICK_COLORS: QuickColor[] = [
  { name: 'Negro Mate', hex: '#1A1A1A' },
  { name: 'Blanco Nieve', hex: '#F4F4F6' },
  { name: 'Pastel Suave', hex: '#E6C48E' },
  { name: 'Verde Militar', hex: '#3A4B3C' },
  { name: 'Azul Noche', hex: '#1E2D4A' },
  { name: 'Borravino', hex: '#581825' },
];

/* -------------------------------------------------------------------------- */
/* Validaciones y normalización HEX (§6)                                      */
/* -------------------------------------------------------------------------- */

const HEX_REGEX = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * Normaliza un string HEX:
 * - Acepta con o sin '#'
 * - Expande atajo de 3 dígitos (#F53 ⇒ #FF5533)
 * - Retorna '#RRGGBB' en mayúsculas o null si no es válido.
 */
export function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(HEX_REGEX);
  if (!match) return null;

  let hex = match[1]!;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${hex.toUpperCase()}`;
}

/** Descompone un HEX normalizado a componentes flotantes R, G, B en [0, 1]. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHex(hex) ?? '#FFFFFF';
  const num = parseInt(norm.slice(1), 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

/* -------------------------------------------------------------------------- */
/* R4 — Quemado adaptativo del grabado láser                                   */
/* -------------------------------------------------------------------------- */

/**
 * Luminancia relativa según estándar ITU-R BT.709 (R4 de la spec):
 * L = 0.2126R + 0.7152G + 0.0722B  (R, G, B en [0, 1])
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb01(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export type LaserBurnMode = 'dark' | 'silver';

export interface LaserBurnParams {
  mode: LaserBurnMode;
  color: string;
  opacity: number;
  label: string;
}

export const LASER_BURN_DARK: LaserBurnParams = {
  mode: 'dark',
  color: '#2B2118',
  opacity: 0.88,
  label: 'Quemado oscuro',
};

export const LASER_BURN_SILVER: LaserBurnParams = {
  mode: 'silver',
  color: '#C9CCCF',
  opacity: 0.92,
  label: 'Destapado plateado',
};

export const LUMINANCE_THRESHOLD = 0.55;

/**
 * R4: Calcula el modo de quemado adaptativo para el grabado sobre la virola.
 * - Con preset metálico (virolaColor === null): quemado oscuro estándar.
 * - Con color custom: si L >= 0.55 ⇒ tono oscuro #2B2118; si L < 0.55 ⇒ tono plateado #C9CCCF.
 */
export function adaptiveLaserBurn(virolaColor: string | null): LaserBurnParams {
  if (virolaColor === null) {
    return { ...LASER_BURN_DARK };
  }
  const lum = relativeLuminance(virolaColor);
  return lum >= LUMINANCE_THRESHOLD ? { ...LASER_BURN_DARK } : { ...LASER_BURN_SILVER };
}

/* -------------------------------------------------------------------------- */
/* Parámetros finales PBR para la escena                                      */
/* -------------------------------------------------------------------------- */

/** R1/R2: Resuelve los parámetros PBR activos de la virola (las 3 mallas). */
export function resolveVirolaPbr(
  presetId: MetalPresetId,
  customColor: string | null,
): PbrMaterialParams {
  const validHex = customColor ? normalizeHex(customColor) : null;
  if (validHex) {
    return {
      color: validHex,
      metalness: ANODIZED_VIROLA_PBR.metalness,
      roughness: ANODIZED_VIROLA_PBR.roughness,
    };
  }
  const preset = METAL_PRESETS[presetId] ?? METAL_PRESETS[DEFAULT_METAL_PRESET];
  return { ...preset.pbr };
}

/** R1: Resuelve los parámetros PBR activos del cuerpo del mate. */
export function resolveBodyPbr(
  presetId: BodyPresetId,
  customColor: string | null,
): PbrMaterialParams {
  const validHex = customColor ? normalizeHex(customColor) : null;
  if (validHex) {
    return {
      color: validHex,
      metalness: FREE_BODY_PBR.metalness,
      roughness: FREE_BODY_PBR.roughness,
    };
  }
  const preset = BODY_PRESETS[presetId] ?? BODY_PRESETS[DEFAULT_BODY_PRESET];
  return { ...preset.pbr };
}

/* -------------------------------------------------------------------------- */
/* R5 — Contrato de descriptores para Ficha Técnica                           */
/* -------------------------------------------------------------------------- */

/**
 * Formatea el descriptor canónico exigido por R5 para la Ficha y Cotizaciones:
 * - Custom virola: "Virola: #2A2A2A · Anodizado Personalizado"
 * - Preset virola: "Virola: Alpaca / Plata"
 * - Custom cuerpo: "Cuerpo: #E6C48E · Color Libre"
 * - Preset cuerpo: "Cuerpo: Algarrobo / Madera"
 */
export function formatColorDescriptor(
  zone: 'virola' | 'body',
  presetId: string,
  customColor: string | null,
): string {
  const norm = customColor ? normalizeHex(customColor) : null;
  if (zone === 'virola') {
    if (norm) return `Virola: ${norm} · Anodizado Personalizado`;
    const label = METAL_PRESETS[presetId as MetalPresetId]?.label ?? METAL_PRESETS.alpaca.label;
    return `Virola: ${label}`;
  }
  if (norm) return `Cuerpo: ${norm} · Color Libre`;
  const label = BODY_PRESETS[presetId as BodyPresetId]?.label ?? BODY_PRESETS.algarrobo.label;
  return `Cuerpo: ${label}`;
}
