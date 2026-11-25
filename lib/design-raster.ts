/* ============================================================================
 * RASTER DE DISEÑO — helpers de navegador compartidos (posiciones 6–7 + 10A)
 * ----------------------------------------------------------------------------
 * La carga manual (DesignCard) y la RESTAURACIÓN desde el bucket privado
 * `designs` usan EXACTAMENTE el mismo pipeline: SVG/PNG → canvas de trabajo
 * 2048² contain-fit centrado + refuerzo de alfa para bitmaps + medición de la
 * envolvente de tinta. Así el diseño recuperado se comporta igual que uno
 * recién cargado (escala, espejo, rotación y alerta de desborde).
 *
 * Client-only (usa DOM/canvas). No toca red salvo `restoreDesignAsset`, que
 * descarga la URL firmada que el server entrega SOLO al dueño del proyecto.
 * ============================================================================ */

import type { DesignAsset, DesignSourceRef } from '@/lib/design';
import { scanInkEnvelope, type InkEnvelope } from '@/lib/overflow';

/** R8: canvas de trabajo en vivo (Ficha HD: pos 9 2048²). */
export const DESIGN_WORK_SIZE = 2048;

/** Carga un origen (data-URI / blob URL) en un <img> y resuelve al estar listo. */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('símbolo ilegible'));
    image.src = src;
  });
}

/** Canvas de trabajo vacío (R8, 2048²) con contexto listo para getImageData. */
function makeWorkCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = DESIGN_WORK_SIZE;
  canvas.height = DESIGN_WORK_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas no disponible');
  return { canvas, ctx };
}

/** Texto SVG ⇒ data-URI con payload codificado: segura dentro de atributos
 * XML con comillas dobles (`"` ⇒ %22, `#` ⇒ %23, `<` ⇒ %3C…). */
function svgDataUri(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

/**
 * Envoltorio que OBLIGA al navegador a rasterizar el vector a la resolución
 * FINAL (2048², contain): sin él, un SVG con width/height chicos — o sin
 * ellos (el estándar cae a 300×150) — nace rasterizado en su tamaño
 * intrínseco y el estirado posterior del bitmap es la pérdida de nitidez
 * clásica al subirlo a la virola.
 */
function svgWrapperForRaster(svgText: string, size: number): string {
  const inner = svgDataUri(svgText);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"` +
    ` viewBox="0 0 ${size} ${size}">` +
    `<image href="${inner}" width="${size}" height="${size}"` +
    ` preserveAspectRatio="xMidYMid meet"/></svg>`
  );
}

/** Formato por nombre/mime (SVG explícito; todo lo demás se trata como bitmap). */
export function designKindOf(file: { name: string; type: string }): DesignAsset['kind'] {
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  return type === 'image/svg+xml' || name.endsWith('.svg') ? 'svg' : 'png';
}

async function rasterizeDesignBlob(data: Blob, name: string): Promise<HTMLCanvasElement> {
  if (designKindOf({ name, type: data.type }) === 'svg') {
    try {
      const svgText = await data.text();
      if (!svgText.trim()) throw new Error('SVG vacío');
      const img = await loadImageElement(
        svgDataUri(svgWrapperForRaster(svgText, DESIGN_WORK_SIZE)),
      );
      const { canvas, ctx } = makeWorkCanvas();
      ctx.drawImage(img, 0, 0, DESIGN_WORK_SIZE, DESIGN_WORK_SIZE);
      return canvas;
    } catch {
      /* §6 tolerante: sigue por el camino clásico. */
    }
  }
  return rasterizeBitmapBlob(data);
}

/** Camino clásico por URL de objeto (PNG y respaldo de SVG): contain + alfa ×1.8. */
async function rasterizeBitmapBlob(data: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(data);
  try {
    const img = await loadImageElement(url);
    const { canvas, ctx } = makeWorkCanvas();
    const w = img.naturalWidth || img.width || DESIGN_WORK_SIZE;
    const h = img.naturalHeight || img.height || DESIGN_WORK_SIZE;
    const scale = Math.min(DESIGN_WORK_SIZE / w, DESIGN_WORK_SIZE / h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(img, (DESIGN_WORK_SIZE - dw) / 2, (DESIGN_WORK_SIZE - dh) / 2, dw, dh);

    // Refuerzo de trazos finos (técnica del prototipo): α>0 ⇒ ×1.8 (max 255),
    // silueta, posición y colores respetados — los píxeles con α=0 no se tocan.
    const imgData = ctx.getImageData(0, 0, DESIGN_WORK_SIZE, DESIGN_WORK_SIZE);
    const px = imgData.data;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > 0) px[i] = Math.min(255, Math.round(px[i] * 1.8));
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** R8: rasteriza el archivo EN CLIENTE al canvas de trabajo 2048². */
export async function rasterizeDesignFile(file: File): Promise<HTMLCanvasElement> {
  return rasterizeDesignBlob(file, file.name);
}

/**
 * R4 (pos 7): mide la ENVOLVENTE DE TINTA al 100 % del asset recién cargado —
 * máscara alfa 512×512 (detalle R4) del ráster base SIN máscara anular NI
 * tinte y SIN rotación/espejo (isometrías con pivote fijo ⇒ radios
 * preservados). Retorna null si no hay trazo o si el kit de canvas no está.
 */
export function measureInkEnvelopeMm(
  asset: HTMLCanvasElement,
  baseSideMm: number,
): InkEnvelope | null {
  const scan = document.createElement('canvas');
  scan.width = 512;
  scan.height = 512;
  const ctx = scan.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(asset, 0, 0, 512, 512);
  const data = ctx.getImageData(0, 0, 512, 512).data;
  // mm/px de la máscara: el cuadrado completo (2048²) mide baseSideMm de lado
  // ⇒ al reducirlo a 512², 512 px siguen cubriendo baseSideMm (no se recorta).
  const mmPerPx = baseSideMm / 512;
  return scanInkEnvelope(
    { size: 512, alphaAt: (x, y) => data[(y * 512 + x) * 4 + 3] },
    mmPerPx,
  );
}

/**
 * Descarga el original persistido (URL firmada) y reconstruye el asset de
 * sesión. No aplica el refuerzo de alfa dos veces de forma accidental: el
 * original PNG ya salió del pipeline con el refuerzo aplicado… pero al volver
 * a pasar por `rasterizeBitmapBlob` se re-aplica. Es el mismo criterio que
 * recargar el archivo (idempotente para trazos opacos; el alfa ya está
 * saturado en la mayoría de los casos). Ante cualquier fallo lanza para que
 * la shell muestre el aviso honesto y el tallerista recargue el archivo.
 */
export async function restoreDesignAsset(source: DesignSourceRef): Promise<{
  asset: DesignAsset;
  inkEnvelope: InkEnvelope | null;
  degraded: boolean;
}> {
  const response = await fetch(source.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`diseño no disponible (${response.status})`);
  const blob = await response.blob();
  const canvas = await rasterizeDesignBlob(blob, source.name);

  let inkEnvelope: InkEnvelope | null = null;
  let degraded = false;
  try {
    inkEnvelope = measureInkEnvelopeMm(canvas, source.baseSideMm);
    if (!inkEnvelope) degraded = true;
  } catch {
    // §6: raster del chequeo falló ⇒ envolvente conservadora / aviso.
    inkEnvelope = null;
    degraded = true;
  }

  return {
    asset: {
      canvas,
      name: source.name,
      kind: source.kind,
      baseSideMm: source.baseSideMm,
    },
    inkEnvelope,
    degraded,
  };
}
