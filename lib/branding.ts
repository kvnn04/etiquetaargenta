/* ============================================================================
 * RESOLVER ÚNICO DE BRANDING — spec_especificaci_n_tecnica_datos_de_usuario_y
 * _registro.md §3-R3 (degradación progresiva).
 * ----------------------------------------------------------------------------
 * Ficha, visor de cliente, CTA de aprobación y modal de presupuesto CONSUMEN
 * esta librería (posiciones 6–10). Nunca la reimplementan: el fallback es
 * canónico y único.
 *
 * reglas clave:
 *  - Sin datos ⇒ neutralidad elegante (iniciales / "MOCAP 3D · MATE
 *    PERSONALIZADO"), nunca una exportación rota.
 *  - El logo cargado SOLO sale en outputs con plan PRO (white-label, matriz
 *    R2 de spec_auth). En el propio editor el taller siempre ve su logo.
 *  - Sin WhatsApp válido ⇒ CTA de código de aprobación (R5:
 *    APROBADA-{VARIANTE}-{LINKID}), jamás un wa.me inválido.
 *  - `location` jamás se imprime (R2: interna). Ni siquiera se devuelve.
 * ============================================================================ */

import { gate, type PlanOrNull } from '@/lib/permissions';

/** Nombre de plataforma cuando el taller no definió nada (R3). */
export const MOCAP_FALLBACK_TITLE = 'MOCAP 3D · MATE PERSONALIZADO';

/** Datos del taller tal como salen de public.users (vías legibles para el resolver). */
export interface BrandingProfile {
  /** Nombre de cuenta derivado (R1, siempre presente en la fila). */
  displayName?: string | null;
  /** Nombre comercial definido en el Perfil. */
  brandName?: string | null;
  logoUrl?: string | null;
  logoThumbUrl?: string | null;
  whatsappE164?: string | null;
  instagramHandle?: string | null;
}

export interface ResolvedBranding {
  /** Título a imprimir en outputs (encabezados de ficha, visor, CTA). */
  title: string;
  /** Iniciales para el escudo del fallback (máx 2 letras, SIEMPRE presentes). */
  initials: string;
  /** URL thumb preparada para <img> o null ⇒ dibujar escudo de iniciales. */
  logoThumbUrl: string | null;
  /** true ⇒ el logo del taller puede ir en ESTE output (matriz R2). */
  logoAllowed: boolean;
  /** Handle normalizado para etiqueta de la ficha; null ⇒ fila oculta (R3). */
  instagramHandle: string | null;
  /** CTA de aprobación según tenga o no WhatsApp (R3/R5). */
  cta: ApprovalCta;
}

export type ApprovalCta =
  | { kind: 'whatsapp'; href: string }
  | {
      kind: 'code';
      /** Ej: "APROBADA-B-3A8F9B" (R5). */
      code: string;
      /** Copy principal del botón (fijo por spec). */
      legend: string;
      /** Copy secundario. */
      helper: string;
    };

export const APPROVAL_LEGEND = 'Copiar código de aprobación';

/* -------------------------------------------------------------------------- */
/* Normalizadores (también los usa el formulario del Panel de Perfil)         */
/* -------------------------------------------------------------------------- */

/** Iniciales de título: "kevin firma" ⇒ "KF"; vacío/inutilizable ⇒ "MT". */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').split(/\s+/).filter((w) => /^[a-zA-Z]{1,}$/.test(w));
  if (words.length === 0) return 'MT';
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Instagram canónico: quita '@' y espacios, fuerza minúsculas; null si inválido (§6). */
export function normalizeInstagram(raw: string | null | undefined): string | null {
  const handle = (raw ?? '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

/** Solo dígitos — el input de WhatsApp filtra no-dígitos al pegar (§6). */
export function digitsOnly(raw: string): string {
  return (raw ?? '').replace(/[^0-9]/g, '');
}

/**
 * Construye E.164: prefijo país (ej. "54") + número local en dígitos.
 * Total con prefijo: 10–15 (§6). El prefijo REEMPLAZA un 0 inicial si lo hay
 * (convención AR). Devuelve null si no cumple la cota ⇒ usar CTA código (R5).
 */
export function toE164(prefix: string, localDigits: string): string | null {
  const country = digitsOnly(prefix);
  const local = digitsOnly(localDigits).replace(/^0+/, '');
  const total = country.length + local.length;
  if (country.length < 1 || country.length > 4) return null;
  if (total < 10 || total > 15) return null;
  return `+${country}${local}`;
}

/** Generador del código legible y único de la R5. linkId admite hex (3a8f9b). */
export function approvalCode(variant: string, linkId: string): string {
  const v = (variant || '').trim().toUpperCase().slice(0, 1) || 'B';
  const id = (linkId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || '000000';
  return `APROBADA-${v}-${id}`;
}

/** ¿E.164 razonable para wa.me? (solo dígitos con +, 10–15 totales). */
function isUsableWhatsapp(e164: string | null | undefined): e164 is string {
  return !!e164 && /^\+[0-9]{10,15}$/.test(e164);
}

/* -------------------------------------------------------------------------- */
/* Resolución canónica                                                        */
/* -------------------------------------------------------------------------- */

export function resolveBranding(
  profile: BrandingProfile,
  options: { plan?: PlanOrNull; linkId?: string; variant?: string },
): ResolvedBranding {
  const { plan = null } = options;

  const brandName = (profile.brandName ?? '').trim();
  const displayName = (profile.displayName ?? '').trim();
  // R3: nombre comercial → nombre de cuenta (R1) → fallback de plataforma.
  const title =
    brandName ||
    (displayName && displayName !== 'MI TALLER' ? displayName : '') ||
    MOCAP_FALLBACK_TITLE;
  const initials = initialsOf(brandName || displayName);

  // Logo: solo si el plan lo habilita y existe el archivo (lazy-check del
  // visor: si la URL se borra/caducó ⇒ fallback de iniciales, sin romper).
  const logoAllowed = gate('brand.output.white-label', plan);
  const logoThumbUrl = logoAllowed && profile.logoThumbUrl ? profile.logoThumbUrl : null;

  const instagramHandle = normalizeInstagram(profile.instagramHandle);

  const cta: ApprovalCta = isUsableWhatsapp(profile.whatsappE164)
    ? { kind: 'whatsapp', href: `https://wa.me/${profile.whatsappE164.slice(1)}` }
    : {
        kind: 'code',
        code: approvalCode(options.variant ?? 'B', options.linkId ?? '000000'),
        legend: APPROVAL_LEGEND,
        helper: 'Ponete en contacto con tu vendedor indicando que aprobaste la Opción B.',
      };

  return { title, initials, logoThumbUrl, logoAllowed, instagramHandle, cta };
}
