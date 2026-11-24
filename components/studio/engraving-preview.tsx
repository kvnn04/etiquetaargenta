'use client';

/* ============================================================================
 * VISTA PREVIA DEL GRABADO — anillo real de la corona (posiciones 6–7)
 * ----------------------------------------------------------------------------
 * El editor muestra el mate en 3/4: la corona queda casi de canto y el diseño
 * se lee mal. Esta mini vista cenital dibuja EXACTAMENTE la banda que recibe
 * el láser (R_int → R_ext), con el mismo compositor canónico del 3D:
 *   · mismo pipeline ESCALA → ESPEJO → ROTACIÓN y mismo tinte de quemado;
 *   · misma máscara anular (el diseño no puede salir del anillo);
 *   · fondo de metal con el acabado vigente para juzgar contraste y lectura.
 * Es una vista de CONTROL, no un render 3D: no reemplaza la escena, la explica.
 * ============================================================================ */

import { useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '@/lib/store/editor';
import { adaptiveLaserBurn, hexToRgb01, resolveVirolaPbr } from '@/lib/color';
import { composeEngravingCanvas } from '@/lib/compose-engraving';
import { formatRotationLabel } from '@/lib/design';
import { formatScaleLabel } from '@/lib/overflow';

/** Tamaño CSS de la vista previa (el canvas se dibuja a 2× para pantallas HD). */
const PREVIEW_CSS_PX = 116;
const PREVIEW_DPR = 2;
const PREVIEW_PX = PREVIEW_CSS_PX * PREVIEW_DPR;

/** Mezcla un HEX con blanco/negro para el degradé del metal (sin CSS color-mix). */
function mixHex(hex: string, target: 'white' | 'black', amount: number): string {
  const { r, g, b } = hexToRgb01(hex);
  const t = target === 'white' ? 1 : 0;
  const mix = (v: number) => Math.round((v + (t - v) * amount) * 255);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export default function EngravingPreview() {
  const int = useEditorStore((s) => s.intDiameter);
  const ext = useEditorStore((s) => s.extDiameter);
  const metalPreset = useEditorStore((s) => s.metalPreset);
  const virolaColor = useEditorStore((s) => s.virolaColor);
  const rotation = useEditorStore((s) => s.design.rotation);
  const mirror = useEditorStore((s) => s.design.mirror);
  const scale = useEditorStore((s) => s.design.scale);
  const asset = useEditorStore((s) => s.designAsset);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const burn = useMemo(() => adaptiveLaserBurn(virolaColor), [virolaColor]);
  const metal = useMemo(
    () => resolveVirolaPbr(metalPreset, virolaColor).color,
    [metalPreset, virolaColor],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = PREVIEW_PX;
    const C = size / 2;
    // 1.5 px de margen para que el borde no se corte contra el canvas.
    const rOut = C - 1.5;
    const rIn = rOut * (int / ext);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Sombra suave: separa el anillo del panel sin dibujar un fondo cuadrado.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(C, C, rOut, 0, Math.PI * 2);
    ctx.arc(C, C, rIn, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
    ctx.fill();
    ctx.restore();

    // Metal del anillo: degradé diagonal con el color REAL del acabado vigente.
    const grad = ctx.createLinearGradient(C - rOut, C - rOut, C + rOut, C + rOut);
    grad.addColorStop(0, mixHex(metal, 'white', 0.38));
    grad.addColorStop(0.32, mixHex(metal, 'white', 0.08));
    grad.addColorStop(0.55, metal);
    grad.addColorStop(1, mixHex(metal, 'black', 0.42));
    ctx.beginPath();
    ctx.arc(C, C, rOut, 0, Math.PI * 2);
    ctx.arc(C, C, rIn, 0, Math.PI * 2, true);
    ctx.fillStyle = grad;
    ctx.fill();

    // Grabado: MISMO compositor que la escena (rotación, espejo, escala,
    // quemado adaptativo y máscara anular). Se recorta al anillo dibujado.
    if (asset) {
      const offscreen = offscreenRef.current ?? document.createElement('canvas');
      offscreenRef.current = offscreen;
      offscreen.width = size;
      offscreen.height = size;
      composeEngravingCanvas(
        offscreen,
        asset.canvas,
        rotation,
        mirror,
        scale,
        burn,
        int / 2,
        ext / 2,
      );
      ctx.save();
      ctx.beginPath();
      ctx.arc(C, C, rOut, 0, Math.PI * 2);
      ctx.arc(C, C, rIn, 0, Math.PI * 2, true);
      ctx.clip();
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();
    } else {
      // Sin diseño: centro del carril punteado (la zona que ocupará el láser).
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(C, C, (rIn + rOut) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Bordes de chapa: lectura inmediata de R_int y R_ext.
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.beginPath();
    ctx.arc(C, C, rOut - 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(C, C, rIn + 0.65, 0, Math.PI * 2);
    ctx.stroke();
  }, [asset, burn, ext, int, metal, mirror, rotation, scale]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-black/20 p-2.5">
      <canvas
        ref={canvasRef}
        width={PREVIEW_PX}
        height={PREVIEW_PX}
        style={{ width: PREVIEW_CSS_PX, height: PREVIEW_CSS_PX }}
        className="shrink-0"
        role="img"
        aria-label="Vista previa cenital del grabado sobre el anillo de la corona"
      />
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gold-soft">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
          Grabado láser
        </p>
        <p className="text-[10px] leading-relaxed text-stone-500">
          Anillo de la corona · Ø{Math.round(int)}–{Math.round(ext)} mm
        </p>
        {asset ? (
          <>
            <p className="truncate text-[10px] text-stone-400" title={asset.name}>
              {asset.name}
            </p>
            <p className="text-[10px] text-stone-600">
              {formatRotationLabel(rotation)} · {formatScaleLabel(scale)}
              {mirror ? ' · espejo' : ''}
            </p>
          </>
        ) : (
          <p className="text-[10px] leading-relaxed text-stone-600">
            Cargá un SVG o PNG para verlo acá y en el 3D.
          </p>
        )}
      </div>
    </div>
  );
}
