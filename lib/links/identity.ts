/* ============================================================================
 * IDENTIDAD DEL LINK — posición 10A (spec_ficha_comercial_interactiva_shareable_link.md §3-R2)
 * ----------------------------------------------------------------------------
 * R2 EXACTO de la spec:
 *   · `linkId` de 6 caracteres, alfabeto `[a-z0-9]` (canónico en minúsculas,
 *     consultas sin distinción de mayúsculas).
 *   · Generación aleatoria con reintentos ante colisión (el loop vive acá con
 *     el predicado inyectable: route_handler async, módulo puro testeable).
 *   · URL canónica `{base}/v/{linkId}` (R2: `simulador.com/v/{linkId}` — la
 *     base la resuelve el server con el origin del request que acomode).
 * El DB defiende el formato con CHECK `^[a-z0-9]{6}$` (migración 0004): acá
 * está la primera y última línea de defensa lógica.
 * ============================================================================ */

/** Largo EXACTO del identificador (R2). */
export const LINK_ID_LENGTH = 6;

/** Alfabeto canónico [a-z0-9] (36 símbolos — R2, minúsculas). */
export const LINK_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Patrón canónico de un linkId emitido (R2; igual al CHECK de la migración 0004). */
export const LINK_ID_PATTERN = /^[a-z0-9]{6}$/;

/** Ruta pública del Modo Cliente (R2: `/v/{linkId}`). */
export const PUBLIC_LINK_PATH = '/v';

/**
 * Normaliza un linkId escrito/reputado a la forma canónica (R2: consultas
 * sin distinción de mayúsculas). Devuelve null si tras normalizar no queda un
 * id del alfabeto/largo EXACTO (jamás inventar una forma parcial).
 */
export function canonicalizeLinkId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  // Eliminar decoraciones de URL pegada ('/v/3a8f9b', 'simulador.com/v/3a8f9b')
  const tail = lower.split('/v/').pop() ?? '';
  const candidate = tail.replace(/[?&].*$/, '').trim();
  return LINK_ID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Genera un linkId aleatorio EXACTO de 6 chars [a-z0-9]. `rand` inyectable
 * (Math.random en runtime; tests usan un generador determinista).
 */
export function generateLinkId(rand: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < LINK_ID_LENGTH; i += 1) {
    id += LINK_ALPHABET[Math.floor(rand() * LINK_ALPHABET.length) % LINK_ALPHABET.length];
  }
  return id;
}

/**
 * R2: generación con REINTENTOS de colisión — el predicado `isTaken` (que
 * consulta el DB) decide por cada candidata. `attempts` default 8: con 36⁶ ≈
 * 2.17 mil millones de combinaciones, una expansión hasta 8 intentos baja la
 * probabilidad de agotamiento a un nivel irrelevante sin loop infinito.
 */
export async function generateUniqueLinkId(
  isTaken: (candidate: string) => Promise<boolean>,
  rand: () => number = Math.random,
  attempts = 8,
): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = generateLinkId(rand);
    // eslint-disable-next-line no-await-in-loop -- la colisión exige decidir por id
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error('LINK_ID_COLLISION');
}
