/* ============================================================================
 * CONFIGURACIÓN LEGAL — posición 12 (spec_paginas_legales.md §5)
 * ----------------------------------------------------------------------------
 * FUENTE ÚNICA de versiones, identidad del proveedor y metadatos de publicación.
 * La identidad sale de `LEGAL_ENTITY_*` / `LEGAL_*` (Q1/Q7 de la spec): no se
 * inventan razón social, CUIT ni domicilio. Si falta un dato, la página lo
 * declara de forma visible y la operación sigue (nunca un placeholder mudo).
 *
 * `LEGAL_VERSIONS` se pasa SERVER-SIDE al paywall para que el cliente no lea
 * envs no públicas. Un cambio material exige subir la versión (R13.13).
 * ============================================================================ */

import type { Metadata } from 'next';
import { LEGAL_LINKS } from './links';

export { LEGAL_LINKS };

export const LEGAL_VERSIONS = {
  terms: '1.0',
  privacy: '1.0',
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = ['terms', 'privacy'];

/** Fecha de vigencia/publicación de esta versión (R13.1/R13.16). */
export const LEGAL_LAST_UPDATED_ISO = '2026-11-23';
export const LEGAL_LAST_UPDATED_LABEL = '23 de noviembre de 2026';

/** Horario por defecto: atención electrónica ≥ 8 h/día hábil (R13.14). */
export const LEGAL_DEFAULT_HOURS = 'Lunes a viernes de 9:00 a 18:00 (hora de Argentina)';

export const LEGAL_ATTENTION_AREA = 'Atención al consumidor y protección de datos';

export const LEGAL_ENTITY = {
  name: process.env.LEGAL_ENTITY_NAME?.trim() || 'MOCAP 3D',
  legalName: process.env.LEGAL_ENTITY_LEGAL_NAME?.trim() || '',
  cuit: process.env.LEGAL_ENTITY_CUIT?.trim() || '',
  taxCondition: process.env.LEGAL_ENTITY_TAX_CONDITION?.trim() || '',
  address: process.env.LEGAL_ENTITY_ADDRESS?.trim() || '',
  email:
    process.env.LEGAL_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
    '',
  phone: process.env.LEGAL_PHONE?.trim() || '',
  whatsapp:
    process.env.LEGAL_WHATSAPP?.trim() ||
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.trim() ||
    '',
  hours: process.env.LEGAL_HOURS?.trim() || LEGAL_DEFAULT_HOURS,
} as const;

/** URL pública del sitio para canonical y links absolutos del email. */
export const LEGAL_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || '').replace(/\/+$/, '');

/**
 * Base absoluta de un link legal. En emails SIEMPRE se pasa el origin del
 * request como fallback: un link relativo no sirve fuera del navegador.
 */
export function legalSiteBase(fallbackOrigin: string): string {
  return (LEGAL_SITE_URL || fallbackOrigin).replace(/\/+$/, '');
}

/** Campos de identidad que faltan publicar (QA §7.8: sin placeholders). */
export function legalIdentityMissing(): string[] {
  const missing: string[] = [];
  if (!process.env.LEGAL_ENTITY_NAME?.trim() && !process.env.LEGAL_ENTITY_LEGAL_NAME?.trim()) {
    missing.push('razón social / nombre');
  }
  if (!LEGAL_ENTITY.cuit) missing.push('CUIT');
  if (!LEGAL_ENTITY.taxCondition) missing.push('condición fiscal');
  if (!LEGAL_ENTITY.address) missing.push('domicilio legal');
  if (!LEGAL_ENTITY.email) missing.push('email de contacto');
  return missing;
}

/** Metadata común de las páginas legales (R13.16: indexables y canónicas). */
export function legalMetadata(input: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  return {
    title: `${input.title} · Simulador Mates`,
    description: input.description,
    robots: input.noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    ...(LEGAL_SITE_URL
      ? { alternates: { canonical: `${LEGAL_SITE_URL}${input.path}` } }
      : {}),
  };
}

/** Texto de precio con impuestos incluidos (Q3). `null` = no inventar cifras. */
export function legalPriceLegend(priceLabel: string | null): string {
  return priceLabel
    ? `${priceLabel}, impuestos incluidos`
    : 'el precio vigente que se muestra antes de pagar, con impuestos incluidos';
}
