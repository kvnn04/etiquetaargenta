'use client';

/* ============================================================================
 * VETA DE MADERA — textura procedural compartida por cuerpo y ficha.
 * ----------------------------------------------------------------------------
 * El catálogo define el color PBR del cuerpo, pero un color plano se lee como
 * plástico. Esta textura en escala de grises (map + bump) multiplica el color
 * del preset: vetas verticales de torno, sin archivos externos ni CDN.
 * Se genera UNA vez por sesión y se comparte entre editor, visor y ficha.
 *
 * Reglas de realismo:
 *  · la veta corre en meridianos (u = constante), no en anillos;
 *  · sin nudos ni "ojos de tigre": en un mate torneado se leen como calcomanía;
 *  · contraste bajo (el color de la madera lo aporta el material);
 *  · PRNG con semilla fija para que editor, visor y ficha muestren la MISMA
 *    madera en cada sesión (y las capturas sean reproducibles).
 * ============================================================================ */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

let cached: CanvasTexture | null = null;

/** Mulberry32: PRNG chico y determinista (misma veta en todos los lienzos). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function woodGrainTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (cached) return cached;

  const rand = seededRandom(0x5eed_1234);
  const width = 512;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Base clara: el color real lo aporta el material (multiplicación).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Bandas tonales anchas: los cambios suaves de veta del tronco.
  for (let i = 0; i < 18; i++) {
    const x = rand() * width;
    const band = 10 + rand() * 34;
    const alpha = 0.012 + rand() * 0.03;
    const grad = ctx.createLinearGradient(x - band, 0, x + band, 0);
    grad.addColorStop(0, 'rgba(74, 45, 26, 0)');
    grad.addColorStop(0.5, `rgba(74, 45, 26, ${alpha})`);
    grad.addColorStop(1, 'rgba(74, 45, 26, 0)');
    ctx.fillStyle = grad;
    // Se dibuja también desplazada para que la costura UV no corte la banda.
    for (const offset of [-width, 0, width]) {
      ctx.fillRect(x - band + offset, 0, band * 2, height);
    }
  }

  // Vetas finas verticales: la dirección del torno (meridianos del lathe).
  for (let i = 0; i < 300; i++) {
    const baseX = rand() * width;
    const alpha = 0.01 + rand() * 0.032;
    const lineWidth = 0.4 + rand() * 1.2;
    const wobble = 0.8 + rand() * 3.2;
    const phase = rand() * Math.PI * 2;
    const frequency = 1 + Math.floor(rand() * 2);

    ctx.strokeStyle = `rgba(58, 34, 20, ${alpha})`;
    ctx.lineWidth = lineWidth;

    for (const offset of [-width, 0, width]) {
      ctx.beginPath();
      for (let y = 0; y <= height; y += 16) {
        const t = y / height;
        const x = baseX + offset + Math.sin(t * Math.PI * 2 * frequency + phase) * wobble;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Poros cortos y dispersos: rompen la uniformidad de las líneas largas.
  for (let i = 0; i < 220; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const len = 3 + rand() * 9;
    ctx.strokeStyle = `rgba(64, 38, 22, ${0.012 + rand() * 0.022})`;
    ctx.lineWidth = 0.5 + rand() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 1.2, y + len);
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  cached = texture;
  return texture;
}
