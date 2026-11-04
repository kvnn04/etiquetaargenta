/* ============================================================================
 * ENCODADO DEL LOGO EN CLIENTE — spec registro §3-R4.
 * ----------------------------------------------------------------------------
 * Reglas garantizadas acá (el server vuelve a validar por bytes, no confía):
 *   · entrada PNG/JPG/SVG ≤ 2 MB (tamaño/mime inválidos ⇒ rechazo INLINE).
 *   · salida webp/png de lado ≤ 512 px y ≤ 150 KB (escalera de calidad/tamaño).
 *   · thumb cuadrado 144×144 px (headers retina 36 px @2x).
 *   · el ORIGINAL crudo jamás se persiste — solo los blobs encodados suben.
 * Cero dependencias: canvas nativo. (sharp llega con la posición 9.)
 * ============================================================================ */

export const LOGO_MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const LOGO_MAIN_MAX_SIDE = 512;
export const LOGO_MAIN_MAX_BYTES = 150 * 1024;
export const LOGO_THUMB_SIDE = 144;
export const LOGO_THUMB_MAX_BYTES = 40 * 1024;

export const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

export type LogoError =
  | 'format' // extensión no soportada
  | 'size' // >2 MB o no baja de las cotas de salida
  | 'decode' // archivo corrupto / no legible
  | 'svg-size' // SVG sin width/height declarados
  | 'encode'; // el browser no pudo encodar (raro)

export class LogoEncodeError extends Error {
  code: LogoError;
  constructor(code: LogoError, message: string) {
    super(message);
    this.code = code;
    this.name = 'LogoEncodeError';
  }
}

export interface EncodedLogo {
  main: Blob;
  thumb: Blob;
  /** Formato elegido: webp donde el browser soporta; si no, PNG (spec: "webp/png"). */
  mime: 'image/webp' | 'image/png';
}

export const LOGO_INLINE_MESSAGES: Record<LogoError, string> = {
  format: 'Formato no soportado: aceptamos PNG, JPG o SVG.',
  size: 'La imagen no alcanzó las cotas (≤512 px y ≤150 KB): probá con una más chica.',
  decode: 'No pudimos leer la imagen: probá otra vez con un archivo válido.',
  'svg-size': 'El SVG no declara tamaño (width/height o viewBox) — probá PNG o JPG.',
  encode: 'Tu navegador no pudo procesar la imagen — probá con Chrome o Firefox.',
};

/* -------------------------------------------------------------------------- */

let webpEncodingSupport: boolean | null = null;

function supportsWebpEncoding(): boolean {
  if (webpEncodingSupport !== null) return webpEncodingSupport;
  try {
    webpEncodingSupport = document
      .createElement('canvas')
      .toDataURL('image/webp')
      .startsWith('data:image/webp');
  } catch {
    webpEncodingSupport = false;
  }
  return webpEncodingSupport;
}

interface SourceSize {
  width: number;
  height: number;
}

function sourceSize(img: HTMLImageElement): SourceSize {
  return { width: img.naturalWidth, height: img.naturalHeight };
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new LogoEncodeError('decode', LOGO_INLINE_MESSAGES.decode));
      img.src = url;
    });
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      // SVG sin dimensiones intrínsecas: el browser no lo rasteriza bien.
      throw new LogoEncodeError('svg-size', LOGO_INLINE_MESSAGES['svg-size']);
    }
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new LogoEncodeError('encode', LOGO_INLINE_MESSAGES.encode))),
      mime,
      quality,
    );
  });
}

/** Dibuja a escala (contain), ya en las dimensiones del canvas. */
function drawScaled(img: HTMLImageElement, canvas: HTMLCanvasElement, targetSide: number) {
  const { width, height } = sourceSize(img);
  const scale = Math.min(1, targetSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

/** Recorte cuadrado al centro (thumb 144 — header retina 36 px @2x). */
function drawCenterSquare(img: HTMLImageElement, canvas: HTMLCanvasElement, side: number) {
  const { width, height } = sourceSize(img);
  const srcSide = Math.min(width, height);
  const sx = (width - srcSide) / 2;
  const sy = (height - srcSide) / 2;
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, side, side);
  ctx.drawImage(img, sx, sy, srcSide, srcSide, 0, 0, side, side);
}

const QUALITY_LADDER = [0.9, 0.78, 0.66, 0.55];

/**
 * Codifica el File crudo a { main ≤512 px ≤150 KB, thumb 144×144 cuadrado }.
 * Tira LogoEncodeError con código legible para el mensaje inline del panel.
 */
export async function encodeLogo(file: File): Promise<EncodedLogo> {
  if (!(LOGO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new LogoEncodeError('format', LOGO_INLINE_MESSAGES.format);
  }
  if (file.size > LOGO_MAX_INPUT_BYTES) {
    throw new LogoEncodeError('size', 'La imagen supera 2 MB — reducila e intentá de nuevo.');
  }

  const img = await loadImage(file);
  const mime: EncodedLogo['mime'] = supportsWebpEncoding() ? 'image/webp' : 'image/png';

  // Cota de salida: la spec es 150 KB indistinto del formato elegido.
  const maxBytesMain = LOGO_MAIN_MAX_BYTES;

  // --- main: escalera de tamaño (512 → 256) × calidad (0.9 → 0.55)
  let main: Blob | null = null;
  const sides = [LOGO_MAIN_MAX_SIDE, 448, 384, 320, 256];
  const canvas = document.createElement('canvas');
  for (const side of sides) {
    drawScaled(img, canvas, side);
    for (const quality of QUALITY_LADDER) {
      const blob = await toBlob(canvas, mime, quality);
      if (blob.size <= maxBytesMain) {
        main = blob;
        break;
      }
    }
    if (main) break;
  }
  if (!main) {
    throw new LogoEncodeError('size', LOGO_INLINE_MESSAGES.size);
  }

  // --- thumb 144×144 recorte cuadrado al centro
  const thumbCanvas = document.createElement('canvas');
  drawCenterSquare(img, thumbCanvas, LOGO_THUMB_SIDE);
  let thumb: Blob | null = null;
  for (const quality of QUALITY_LADDER) {
    const blob = await toBlob(thumbCanvas, mime, quality);
    if (blob.size <= LOGO_THUMB_MAX_BYTES) {
      thumb = blob;
      break;
    }
  }
  if (!thumb) {
    throw new LogoEncodeError('size', LOGO_INLINE_MESSAGES.size);
  }

  return { main, thumb, mime };
}
