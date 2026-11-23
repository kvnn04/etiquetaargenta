/* ============================================================================
 * LINKS LEGALES — posición 12 (spec_paginas_legales.md §4/§5)
 * ----------------------------------------------------------------------------
 * Módulo CLIENT-SAFE: solo rutas y URLs públicas. El footer legal se importa
 * desde componentes cliente (`auth-overlay`, `editor-shell`, `client-viewer`),
 * así que acá no se leen envs del servidor ni se importa nada de Node.
 * ============================================================================ */

export const LEGAL_LINKS = {
  terms: '/terminos',
  privacy: '/privacidad',
  privacyRights: '/privacidad#derechos',
  withdrawal: '/arrepentimiento',
  cancellation: '/baja',
  cancellationConfirm: '/baja/confirmar',
  /** Defensa del Consumidor (Disposición 954/2025, art. 6). */
  consumerDefense: 'https://www.argentina.gob.ar/economia/comercio/defensadelconsumidor',
  /** Autoridad de aplicación de la Ley 25.326. */
  aaip: 'https://www.argentina.gob.ar/aaip',
} as const;

/** Ruta pública del BOTÓN DE ARREPENTIMIENTO (R13.2). */
export function legalWithdrawalPath(): string {
  return LEGAL_LINKS.withdrawal;
}

/** Ruta pública del BOTÓN DE BAJA DE SERVICIO (R13.2). */
export function legalCancellationPath(): string {
  return LEGAL_LINKS.cancellation;
}

/** Link absoluto de confirmación de baja con token (R13.6). */
export function legalConfirmationPath(token: string): string {
  return `${LEGAL_LINKS.cancellationConfirm}?token=${encodeURIComponent(token)}`;
}
