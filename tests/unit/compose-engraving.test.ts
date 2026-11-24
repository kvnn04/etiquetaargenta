import { describe, expect, it, vi } from 'vitest';
import { composeEngravingCanvas, composeEngravingHeightCanvas } from '@/lib/compose-engraving';

interface FakeContext {
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillStyle: string;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
}

function fakeCanvas(width: number): { canvas: HTMLCanvasElement; ctx: FakeContext } {
  const ctx: FakeContext = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };
  const canvas = {
    width,
    height: width,
    getContext: vi.fn(() => ctx),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}

describe('composeEngravingCanvas — re-proyección HD (R8)', () => {
  it('escala el ráster de trabajo 1024² al canvas 2048² de la Ficha', () => {
    const { canvas, ctx } = fakeCanvas(2048);
    const asset = { width: 1024, height: 1024 } as HTMLCanvasElement;

    composeEngravingCanvas(canvas, asset, 0, false, 100, { color: '#000000' }, 40, 45);

    /* Regresión: `drawImage(asset, 0, 0)` dejaba el grabado en un cuadrante;
     * la máscara anular lo recortaba a una astilla y el diseño no se veía. */
    expect(ctx.drawImage).toHaveBeenCalledWith(asset, 0, 0, 2048, 2048);
  });
});

describe('composeEngravingHeightCanvas — relieve de marca láser', () => {
  it('deriva el bumpMap del canvas de color y deja una base plana detrás', () => {
    const { canvas, ctx } = fakeCanvas(2048);
    const color = { width: 2048, height: 2048 } as HTMLCanvasElement;

    composeEngravingHeightCanvas(canvas, color);

    /* El alfa del grabado se copia tal cual (misma transformación ya aplicada
     * por composeEngravingCanvas); después se pinta la altura del trazo y,
     * por destination-over, la superficie metálica continua. */
    expect(ctx.drawImage).toHaveBeenCalledWith(color, 0, 0, 2048, 2048);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });
});
