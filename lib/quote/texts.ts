/* ============================================================================
 * TEXTOS DE LA FICHA — ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md
 * ----------------------------------------------------------------------------
 * R5 — Observaciones acotadas: campo libre máx 280 caracteres; en el canvas se
 *      imprime en un MÁXIMO de 2 LÍNEAS con truncado elegante a `…`
 *      preservando palabras enteras. Campo opcional: sin texto ⇒ el bloque no
 *      se emite (sin bloques vacíos).
 * §5 — Nomenclatura de archivos: `{nombre-taller}-ficha-{model}-{aaaammdd}.png|
 *      .pdf` (ej. `etiqueta-argenta-ficha-mate-imperial-20261103.png`).
 *      Foto HD reusa el patrón: `{nombre-taller}-foto-{model}-{aaaammdd}.png`.
 * ----------------------------------------------------------------------------
 * Todo acá es PURO (tests + motor): la medición del texto se inyecta como
 * función (`measure`) para que el canvas use ctx.measureText y los tests
 * usen anchos sintéticos deterministas.
 * ============================================================================ */

/** R5: longitud máxima del campo libre de observaciones. */
export const OBSERVACIONES_MAX = 280;

/** R5: cantidad máxima de líneas que el canvas imprime de observaciones. */
export const OBSERVACIONES_MAX_LINES = 2;

/**
 * R5 — parte el texto en palabras respetando espacios (jamás parte una
 * palabra a mitad). Palabras más largas que la línea se imprimen enteras en
 * su propia línea (el driver del canvas puede recortar el glifo, pero NUNCA
 * se inventa un corte dentro de la palabra: el límite de ancho es del lienzo).
 */
export function observationsWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * R5 — envuelve palabras enteras en líneas de a lo sumo `maxLines` y cierra
 * con `…` cuando quedó texto fuera. La elipsis se AGREGA AL FINAL de la
 * última línea (conservando la palabra entera previa: jamás un corte a mitad
 * de palabra). Texto vacío ⇒ [].
 */
export function wrapObservations(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines: number = OBSERVACIONES_MAX_LINES,
): string[] {
  const words = observationsWords(text.trim());
  if (words.length === 0) return [];

  // 1ra pasada: sin elipsis — ¿entra todo?
  const plain = wrapAllWords(words, maxWidth, measure);
  if (plain.length <= maxLines) return plain;

  // 2da pasada: las primeras maxLines-1 líneas quedan completas, y la última
  // línea se compone palabra por palabra con presupuesto de ancho SOBRANTE
  // para el `…` (medición del propio glyph de elipsis).
  const ellipsis = '…';
  const head = plain.slice(0, maxLines - 1);

  // Presupuesto para la última línea: probaré agregando palabras de las
  // líneas cortadas hasta que el siguiente no entre dejando hueco para `…`.
  const remainingWords = plain.slice(maxLines - 1).flatMap((l) => observationsWords(l));
  let tail = '';
  const used: string[] = [];
  const ellW = measure(ellipsis);
  for (const word of remainingWords) {
    const candidate = tail ? `${tail} ${word}` : word;
    if (measure(candidate) + ellW <= maxWidth) {
      tail = candidate;
      used.push(word);
    } else break;
  }
  // Ninguna palabra entró ni siquiera sola (palabra ≥ ancho): se sube a la
  // primera palabra entera (el driver recorta el glifo en pantalla, R5).
  if (used.length === 0 && remainingWords.length > 0) {
    tail = remainingWords[0]!;
  }
  return [...head, `${tail}${ellipsis}`];
}

/** Envoltorio entero por palabras SIN elipsis (hasta agotar el texto). */
function wrapAllWords(
  words: string[],
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** R5: ¿el bloque de observaciones se emite? (sin texto ⇒ sin bloque). */
export function hasObservaciones(text: string | null | undefined): boolean {
  return (text ?? '').trim().length > 0;
}

/* -------------------------------------------------------------------------- */
/* §5 — nomenclatura de archivos                                              */
/* -------------------------------------------------------------------------- */

const SLUG_MAX = 40;

/**
 * Slug del nombre del taller para el nombre de archivo: minúsculas, sin
 * acentos, espacios/símbolos ⇒ `-`, colapsado de guiones, recortado a 40.
 * Vacío/inutilizable ⇒ `taller` (el archivo siempre tiene nombre usable).
 */
export function slugTaller(title: string | null | undefined): string {
  const base = (title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // acentos fuera (á→a)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return base || 'taller';
}

/** §5: `20261103` (aaaammdd) determinista desde un timestamp epoch ms. */
export function formatFileDate(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Id de producto seguro para el nombre de archivo (id del catálogo o fallback). */
function safeModelId(modelId: string | null | undefined): string {
  const id = (modelId ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return id || 'camionero';
}

/**
 * §5 — nombre completo del archivo de ficha:
 * `{nombre-taller}-ficha-mate-{model}-{aaaammdd}.png`.
 * (Ej: `etiqueta-argenta-ficha-mate-imperial-20261103.png`.)
 */
export function fichaFileName(input: {
  tallerTitle: string;
  modelId: string;
  capturedAtMs: number;
  kind: 'png' | 'pdf';
}): string {
  const core = `${slugTaller(input.tallerTitle)}-ficha-mate-${safeModelId(input.modelId)}-${formatFileDate(input.capturedAtMs)}`;
  return `${core}.${input.kind}`;
}

/** Foto HD (mismo patrón §5): `{nombre-taller}-foto-mate-{model}-{aaaammdd}.png`. */
export function fotoFileName(input: {
  tallerTitle: string;
  modelId: string;
  capturedAtMs: number;
}): string {
  return `${slugTaller(input.tallerTitle)}-foto-mate-${safeModelId(input.modelId)}-${formatFileDate(input.capturedAtMs)}.png`;
}
