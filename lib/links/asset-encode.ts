/* ============================================================================
 * RE-ENCODACIÓN DE ASSETS DEL ENLACE — client-only (posición 10A)
 * ÚNICA FUENTE: spec_ficha_comercial_interactiva_shareable_link.md §3-R3/§6
 * ----------------------------------------------------------------------------
 * R3: al publicar, las texturas se re-encodan (máx 1024², formato optimizado,
 * ≤300 KB por variante). El canvas del asset de sesión ya es 1024² contain-fit
 * (pos 6), así que el trabajo acá es: PNG (preserva el alpha para la máscara
 * anular) → si excede los 300 KB, re-escalo a 768² → 512² (la escalera baja
 * el peso SIN atajar por formatos con pérdida: el alpha del resize directo
 * PNG es el resultado más predecible para el mocap del visor).
 * El ORIGINAL persistido (decisión 10A: regenerar en sesiones futuras) es un
 * PNG SIN pérdida a resolución final del canvas — el snapshot de pos 6 ya
 * rasteriza SVG/PNG a su resolución FINAL, y una re-creación fiel de un SVG
 * original (vectores) excede el MVP (queda abierto para iter).
 * ============================================================================ */

/** Cota R3 EXACTA del enlace (igual al chequeo del route en POST /api/links). */
export const LINK_TEXTURE_MAX_BYTES = 300 * 1024;

/** Tope del bucket `designs` (migración 0004) — la referencia del ORIGINAL. */
export const LINK_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024;

export interface EncodedLinkAsset {
  base64: string; // SIN wrapper data-URL (el route lo tolera igual)
  mime: string;
  bytes: number;
  width: number;
  height: number;
}

function dataUrlToEncoded(dataUrl: string, width: number, height: number): EncodedLinkAsset | null {
  const marker = 'base64,';
  const idx = dataUrl.indexOf(marker);
  if (idx < 0) return null;
  const base64 = dataUrl.slice(idx + marker.length);
  const binaryLength = typeof atob === 'function' ? atob(base64).length : base64.length * 0.75;
  return {
    base64,
    mime: dataUrl.slice(5, idx - 1),
    bytes: binaryLength,
    width,
    height,
  };
}

/** Clona el canvas re-escalado a `side`² (contain no cambia: ya es cuadrado). */
function scaledCanvas(source: HTMLCanvasElement, side: number): HTMLCanvasElement {
  const target = document.createElement('canvas');
  target.width = side;
  target.height = side;
  const ctx = target.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, side, side);
  }
  return target;
}

/**
 * Textura del ENLACE: PNG con alpha dentro de los 300 KB (R3) escalando en
 * la escalera 1024/768/512. Null ⇒ todo excedió (el modal muestra el error
 * honesto: diseño demasiado denso — el taller simplifica el vector).
 */
export async function encodeLinkTexture(
  canvas: HTMLCanvasElement,
  maxBytes: number = LINK_TEXTURE_MAX_BYTES,
): Promise<EncodedLinkAsset | null> {
  const ladder = [Math.min(canvas.width || 1024, 1024), 768, 512];
  for (const side of ladder) {
    const target = side >= canvas.width ? canvas : scaledCanvas(canvas, side);
    const encoded = dataUrlToEncoded(target.toDataURL('image/png'), target.width, target.height);
    if (encoded && encoded.bytes <= maxBytes) return encoded;
  }
  return null;
}

/**
 * ORIGINAL persistido: PNG sin pérdida a resolución final
 * (≤10 MB del bucket `designs`). Un PNG 1024² queda MUY por debajo: la
 * cota sirve de defensa contra diseños futuros más grandes.
 */
export async function encodeOriginalFromCanvas(
  canvas: HTMLCanvasElement,
  maxBytes: number = LINK_ORIGINAL_MAX_BYTES,
): Promise<EncodedLinkAsset | null> {
  const encoded = dataUrlToEncoded(canvas.toDataURL('image/png'), canvas.width, canvas.height);
  if (!encoded || encoded.bytes > maxBytes) return null;
  return encoded;
}
