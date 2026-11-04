/* ============================================================================
 * COMPLETITUD DEL PERFIL — spec registro §4 (5 campos × 20 %).
 * ----------------------------------------------------------------------------
 * El indicador "Perfil configurado al X %" se calcula en CLIENTE para el
 * snapshot de UI; ninguna regla de negocio depende de él (§5 Estado Frontend).
 * Los copys priorizan WhatsApp primero ("recibir aprobaciones directas").
 * ============================================================================ */

export type CompletenessField = 'logo' | 'whatsapp' | 'brandName' | 'instagram' | 'location';

export interface ProfileCompletenessInput {
  logoUrl: string | null | undefined;
  whatsappE164: string | null | undefined;
  brandName: string | null | undefined;
  instagramHandle: string | null | undefined;
  location: string | null | undefined;
}

const WEIGHT = 20;

export const COMPLETENESS_TOTAL = 100;

/** Fila vacía ⇒ campo sin completar (se evalúa tras trim). */
function filled(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

/**
 * Porcentaje redondeado a múltiplos de 20 (5 campos × 20 %).
 * qa §7.2: +20 % por cada campo completado.
 */
export function completionPct(profile: ProfileCompletenessInput): number {
  const done: Array<[CompletenessField, boolean]> = [
    ['logo', filled(profile.logoUrl)],
    ['whatsapp', filled(profile.whatsappE164)],
    ['brandName', filled(profile.brandName)],
    ['instagram', filled(profile.instagramHandle)],
    ['location', filled(profile.location)],
  ];
  return done.reduce((acc, [, ok]) => acc + (ok ? WEIGHT : 0), 0);
}

const SUGGESTIONS: Record<CompletenessField, string> = {
  whatsapp: 'Agregá tu WhatsApp para recibir aprobaciones directas.',
  logo: 'Subí tu logo para que tu marca aparezca en las fichas.',
  brandName: 'Definí el nombre comercial que se imprime en tus fichas.',
  instagram: 'Agregá tu Instagram para sumar credibilidad.',
  location: 'Completá tu ubicación (solo se ve en tu panel).',
};

/**
 * Copy dinámico del panel (spec §4): menciona SIEMPRE el porcentaje y agrega
 * la sugencia del campo faltante priorizado — WhatsApp primero (spec: "recibir
 * aprobaciones directas"), luego logo, nombre, Instagram y ubicación.
 */
export function completionCopy(profile: ProfileCompletenessInput): string {
  const pct = completionPct(profile);
  if (pct >= COMPLETENESS_TOTAL) {
    return 'Perfil al 100 % — tu marca se imprime completa en las fichas y enlaces.';
  }

  const suggestions: Array<CompletenessField> = ['whatsapp', 'logo', 'brandName', 'instagram', 'location'];
  const next = suggestions.find((field) => {
    switch (field) {
      case 'logo':
        return !filled(profile.logoUrl);
      case 'whatsapp':
        return !filled(profile.whatsappE164);
      case 'brandName':
        return !filled(profile.brandName);
      case 'instagram':
        return !filled(profile.instagramHandle);
      case 'location':
        return !filled(profile.location);
    }
  });

  return `Perfil al ${pct} % — así se imprimirá en tus fichas. ${next ? SUGGESTIONS[next] : ''}`;
}
