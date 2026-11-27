/* ============================================================================
 * COMPOSITOR DEL GRABADO LATERAL DEL TERMO
 * ----------------------------------------------------------------------------
 * El prototipo dibuja el diseño en un canvas cilíndrico (2048 px de ancho) y lo
 * mapea sobre un cilindro. Acá se conserva ese contrato:
 *   · u = 0.5 es el FRENTE (+Z); x = ancho·(0.5 + ángulo/360).
 *   · El tamaño físico (mm) se reparte sobre el perímetro y el alto útil.
 *   · Espejo, invertido y tinte de quemado se aplican antes de proyectar.
 * La costura del cilindro queda al DORSO, así el diseño nunca se parte.
 * ============================================================================ */

import type { ThermoSpec } from '@/lib/catalog';
import {
  clampThermoRotation,
  normalizeThermoOffset,
  normalizeThermoScale,
  thermoDesignSizeMm,
  thermoSurface,
} from '@/lib/thermo';

export interface ThermoEngravingOptions {
  rotationDeg: number;
  scalePct: number;
  mirror: boolean;
  offsetYPct: number;
  invert: boolean;
}

interface TrimmedAsset {
  canvas: HTMLCanvasElement;
  aspect: number;
}

const trimCache = new WeakMap<HTMLCanvasElement, TrimmedAsset>();

/** Recorta el margen transparente del ráster 2048² y devuelve su aspecto real. */
export function trimThermoAsset(asset: HTMLCanvasElement): TrimmedAsset {
  const hit = trimCache.get(asset);
  if (hit) return hit;

  const w = asset.width;
  const h = asset.height;
  const ctx = asset.getContext('2d', { willReadFrequently: true });
  if (!ctx || w === 0 || h === 0) {
    const fallback = { canvas: asset, aspect: 1 };
    trimCache.set(asset, fallback);
    return fallback;
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor(Math.max(w, h) / 1024));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3]! < 8) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  } catch {
    const fallback = { canvas: asset, aspect: 1 };
    trimCache.set(asset, fallback);
    return fallback;
  }

  if (maxX < minX || maxY < minY) {
    const fallback = { canvas: asset, aspect: 1 };
    trimCache.set(asset, fallback);
    return fallback;
  }

  const pad = Math.max(2, Math.round(Math.max(w, h) * 0.005));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) {
    const fallback = { canvas: asset, aspect: 1 };
    trimCache.set(asset, fallback);
    return fallback;
  }
  octx.drawImage(asset, minX, minY, cw, ch, 0, 0, cw, ch);
  const trimmed = { canvas: out, aspect: cw / ch };
  trimCache.set(asset, trimmed);
  return trimmed;
}

/** Aspecto real del diseño (sin márgenes transparentes); sin asset ⇒ 1. */
export function thermoAssetAspect(asset: HTMLCanvasElement | null): number {
  return asset ? trimThermoAsset(asset).aspect : 1;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Compone el canvas cilíndrico completo. Devuelve true si dibujó algo.
 */
export function composeThermoEngravingCanvas(
  canvas: HTMLCanvasElement,
  asset: HTMLCanvasElement | null,
  options: ThermoEngravingOptions,
  spec: ThermoSpec,
  burn: { color: string },
): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!asset) return false;

  const trimmed = trimThermoAsset(asset);
  const surface = thermoSurface(spec);
  const size = thermoDesignSizeMm(spec, trimmed.aspect, options.scalePct);

  const drawW = (size.widthMm / surface.widthMm) * canvas.width;
  const drawH = (size.heightMm / surface.heightMm) * canvas.height;
  if (drawW <= 0 || drawH <= 0) return false;

  /* Última red de seguridad: aunque un payload viejo traiga un ángulo fuera
   * del arco libre, el grabado JAMÁS se dibuja sobre la media manija. */
  const angle = clampThermoRotation(spec, options.rotationDeg, options.scalePct, trimmed.aspect);
  const centerX = canvas.width * (0.5 + angle / 360);
  const slackMm = Math.max(0, (surface.heightMm - size.heightMm) / 2);
  const centerYmm =
    surface.centerYMm + (normalizeThermoOffset(options.offsetYPct) / 100) * slackMm;
  const centerY =
    ((surface.maxYMm - centerYmm) / Math.max(1, surface.heightMm)) * canvas.height;

  // Capa del diseño al tamaño físico: espejo + invertido + tinte.
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(drawW));
  layer.height = Math.max(1, Math.ceil(drawH));
  const lctx = layer.getContext('2d');
  if (!lctx) return false;
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';

  const drawAsset = () => {
    lctx.drawImage(trimmed.canvas, 0, 0, layer.width, layer.height);
  };

  if (options.invert) {
    const pad = Math.min(layer.width, layer.height) * 0.08;
    lctx.fillStyle = '#000';
    roundedRectPath(
      lctx,
      -pad,
      -pad,
      layer.width + pad * 2,
      layer.height + pad * 2,
      Math.min(layer.width, layer.height) * 0.08,
    );
    lctx.fill();
    lctx.globalCompositeOperation = 'destination-out';
    if (options.mirror) {
      lctx.save();
      lctx.translate(layer.width, 0);
      lctx.scale(-1, 1);
      drawAsset();
      lctx.restore();
    } else {
      drawAsset();
    }
    lctx.globalCompositeOperation = 'source-over';
  } else if (options.mirror) {
    lctx.save();
    lctx.translate(layer.width, 0);
    lctx.scale(-1, 1);
    drawAsset();
    lctx.restore();
  } else {
    drawAsset();
  }

  // Tinte único del quemado (conserva la silueta del trazado).
  lctx.globalCompositeOperation = 'source-in';
  lctx.fillStyle = burn.color;
  lctx.fillRect(0, 0, layer.width, layer.height);
  lctx.globalCompositeOperation = 'source-over';

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const x = centerX - layer.width / 2;
  const y = centerY - layer.height / 2;
  // Repite a izquierda/derecha para que el diseño cruce la costura sin cortes.
  for (const dx of [-canvas.width, 0, canvas.width]) {
    ctx.drawImage(layer, x + dx, y);
  }
  return true;
}

/** Resolución vertical del canvas cilíndrico para un ancho dado. */
export function thermoCanvasHeight(spec: ThermoSpec, widthPx: number): number {
  const surface = thermoSurface(spec);
  return Math.max(64, Math.round((widthPx * surface.heightMm) / surface.widthMm));
}

export { normalizeThermoScale };
