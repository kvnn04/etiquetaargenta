'use client';

/* ============================================================================
 * TARJETA "CARGAR ARCHIVO / EDICIÓN DEL VECTOR" — posición 6
 * ÚNICA FUENTE: spec_rotacion_archivo_svg_png.md (+ tono de quemado de
 * spec_seleccion_de_color.md R4, pos 5).
 * ----------------------------------------------------------------------------
 * · Archivo: SVG/PNG rasterizado EN CLIENTE al canvas de trabajo 1024² (R8,
 *   contain + centrado) y guardado SOLO en el asset de sesión (el archivo NO
 *   viaja al jsonb todavía: la rotación persiste; el ciclo de vida del
 *   archivo llega con variantes pos 7 / links pos 10).
 *   Fallo de raster (archivo corrupto tras edición externa): se conserva la
 *   última textura válida y aviso inline (§6) — reintentar reactiva el diseño.
 * · Rotación R3: único marco [0°, 360°) paso 0.5°; el campo numérico acepta
 *   `.` y `,` decimales, signo y sufijo °; normaliza por módulo en vivo
 *   (370°⇒10°, −90°⇒270°, 45.25°⇒45.5°) y texto/vacío RESTAURA el último
 *   válido — la escena jamás pierde la alineación.
 * · Imán R4: atracción ±4° en el arrastre del slider; checkbox ON por defecto
 *   y SOLO DE DISPOSITIVO (§5: localStorage — nunca projects.state). Los 4
 *   presets (0° Frente / 90° Der / 180° Dorso / 270° Izq) fijan el ángulo
 *   EXACTO con imán ON u OFF.
 * · Reset: vuelve a 0° escalar conservando imán (y con pos 7: escala/espejo).
 * · AJUSTE PROVISIONAL pos 6 (nota, no contrato): mientras no exista el motor
 *   de escala/chorreo (pos 7), el diseño se inscribe en el círculo del carril
 *   — NINGÚN ángulo desborda, así que el re-chequeo R6 no tiene gancho aún y
 *   no aparece el banner de desborde jamás en esta posición.
 * · Sin candado: la rotación es edición de vector — FREE y PRO (§6 permisos);
 *   el Modo Cliente no muestra controles (llega con pos 10).
 * ============================================================================ */

import { useEffect, useRef, useState } from 'react';
import { FileImage, ImagePlus, Magnet, RotateCcw, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store/editor';
import {
  applyMagnet,
  loadSnapMagnetDefault,
  magnetSnappedPreset,
  normalizeRotation,
  parseRotationInput,
  ROTATION_PRESETS,
  saveSnapMagnet,
  type DesignAsset,
} from '@/lib/design';

const FILE_ACCEPT = 'image/svg+xml,image/png,.svg,.png'; // R8: SVG/PNG

/** Texto canónico del campo numérico (R3: sin signo raro, sin ceros extra). */
function fmtAngle(deg: number): string {
  return String(normalizeRotation(deg));
}

/**
 * R8: rasteriza el archivo EN CLIENTE al canvas de trabajo 1024² (contain,
 * centrado). El SVG se rasteriza con la vectorización nativa del navegador
 * (sin interpolación visible a este tamaño); el PNG pasa tal cual. El resultado
 * vive SOLO en el asset de sesión — jamás se envía al backend en pos 6.
 */
async function rasterizeDesignFile(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('símbolo ilegible'));
      image.src = url;
    });
    const size = 1024; // R8: canvas de trabajo en vivo (Ficha HD: pos 9 ≥2048²)
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas no disponible');
    const w = img.naturalWidth || img.width || size;
    const h = img.naturalHeight || img.height || size;
    const scale = Math.min(size / w, size / h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function kindOf(file: File): DesignAsset['kind'] {
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  return type === 'image/svg+xml' || name.endsWith('.svg') ? 'svg' : 'png';
}

export default function DesignCard() {
  const rotation = useEditorStore((s) => s.design.rotation);
  const setDesignRotation = useEditorStore((s) => s.setDesignRotation);
  const designAsset = useEditorStore((s) => s.designAsset);
  const loadDesignAsset = useEditorStore((s) => s.loadDesignAsset);

  /* R4/§5: imán SOLO de dispositivo — se lee tras hidratar (el SSR no tiene
   * localStorage; false/true temprano evita mismatch de hidratación). */
  const [snapMagnet, setSnapMagnet] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [angleText, setAngleText] = useState(fmtAngle(0));
  const [angleInvalid, setAngleInvalid] = useState(false);
  const editingAngleRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSnapMagnet(loadSnapMagnetDefault()), []);

  /* Slider/presets/escena pueden cambiar el ángulo: el campo numérico sigue
   * al store MIENTRAS no se esté tipeando (espejo del patrón de HexInput). */
  useEffect(() => {
    if (!editingAngleRef.current) setAngleText(fmtAngle(rotation));
  }, [rotation]);

  /* §3 flujo R4: slider con imán SOLO en el arrastre (±4°), paso 0.5. */
  function handleSlider(value: number): void {
    setDesignRotation(applyMagnet(normalizeRotation(value), snapMagnet));
  }

  /* §6: al tipear, WYSIWYG de lo válido; el basura no toca el store y al salir
   * (blur/Enter) el campo RESTAURA el último ángulo válido. */
  function handleAngleTyping(text: string): void {
    editingAngleRef.current = true;
    setAngleText(text);
    const parsed = parseRotationInput(text);
    if (parsed === null) {
      setAngleInvalid(true);
      return;
    }
    setAngleInvalid(false);
    setDesignRotation(parsed); // normaliza por módulo — jamás rompe la escena
  }

  function commitAngleBlur(): void {
    editingAngleRef.current = false;
    setAngleInvalid(false);
    setAngleText(fmtAngle(rotation));
  }

  function toggleMagnet(): void {
    const next = !snapMagnet;
    setSnapMagnet(next);
    saveSnapMagnet(next); // dispositivo solamente (§5)
  }

  async function handleFile(file: File | null): Promise<void> {
    if (!file) return;
    setFileBusy(true);
    try {
      const canvas = await rasterizeDesignFile(file);
      const asset: DesignAsset = { canvas, name: file.name, kind: kindOf(file) };
      loadDesignAsset(asset);
      setFileError(null);
    } catch {
      // §6: se conserva la última textura válida y aviso inline.
      setFileError(`No se pudo interpretar "${file.name}". Reintentá el archivo.`);
    } finally {
      setFileBusy(false);
      if (fileRef.current) fileRef.current.value = ''; // re-carga del mismo archivo
    }
  }

  /* Feedback de imán (§4): el preset "enganchado" se marca; con imán OFF los
   * marcadores quedan neutros. */
  const snapped = magnetSnappedPreset(rotation, snapMagnet);

  return (
    <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileImage className="w-4 h-4 text-gold" />
        <h2 className="text-sm font-semibold text-cream tracking-wide">
          Cargar Archivo / Edición del Vector
        </h2>
      </div>
      <p className="text-[10px] leading-relaxed text-stone-600">
        Rotación del grabado 360° — FREE, sin candado (R1 de{' '}
        <span className="font-mono">spec_rotacion_archivo_svg_png</span>). El archivo se usa en
        sesión; la <span className="text-stone-400">rotación</span> es lo que guarda el proyecto.
      </p>

      {/* ─────────────── SECCIÓN A — ARCHIVO ─────────────── */}
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Archivo</p>

        <input
          ref={fileRef}
          type="file"
          accept={FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={fileBusy}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-xs text-stone-300 transition-all hover:border-gold/50 hover:text-cream disabled:opacity-40 focus:outline-none"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {fileBusy ? 'Procesando…' : 'Cargar Archivo'}
          </button>
          {designAsset && (
            <span className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-stone-300">
              <span className="max-w-[9.5rem] truncate text-cream" title={designAsset.name}>
                {designAsset.name}
              </span>
              <span className="uppercase tracking-wider text-stone-500">{designAsset.kind}</span>
              <button
                type="button"
                title="Quitar diseño"
                onClick={() => loadDesignAsset(null)}
                className="text-stone-500 transition hover:text-rose-300 focus:outline-none"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>

        {fileError && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
            {fileError} El último diseño válido sigue grabado (§6).
          </p>
        )}

        {!designAsset && !fileError && (
          <p className="text-[10px] text-stone-600">
            Sin diseño: la corona sale lisa. SVG o PNG; la vista previa del grabado es en vivo en
            el 3D.
          </p>
        )}
      </section>

      <hr className="border-line" />

      {/* ─────── SECCIÓN B — ALINEACIÓN Y ROTACIÓN DEL GRABADO (360°) ─────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Rotación del Grabado (360°)
          </p>
          <span className="text-[9px] text-stone-600">paso 0.5° (R3)</span>
        </div>

        {/* Slider 0–360 · paso 0.5 (R4) con imán aplicado en el arrastre */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={360}
            step={0.5}
            value={rotation}
            aria-label="Alineación y rotación del grabado"
            onChange={(e) => handleSlider(Number(e.target.value))}
            className="w-full accent-gold"
          />
        </div>

        {/* Campo numérico adyacente con sufijo ° — sincrónico bidireccional */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={angleText}
            aria-label="Rotación en grados"
            onChange={(e) => handleAngleTyping(e.target.value)}
            onBlur={commitAngleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder="0"
            maxLength={8}
            spellCheck={false}
            className={[
              'h-8 w-[4.5rem] rounded-md border bg-black/30 px-2 text-right text-xs font-semibold outline-none transition focus:outline-none focus:ring-1',
              angleInvalid
                ? 'border-amber-400/70 text-amber-100 focus:ring-amber-400/60'
                : 'border-white/10 text-stone-100 focus:border-gold/50 focus:ring-gold/40',
            ].join(' ')}
          />
          <span className="text-xs text-stone-500">°</span>
          <span className="flex-1 text-right text-[10px] text-stone-600">
            {snapped !== null ? 'imán enganchado' : angleInvalid ? 'restaura al salir' : 'continuo 0.5°'}
          </span>
        </div>

        {/* 4 presets R4 — fijan EXACTO con imán ON u OFF */}
        <div className="flex flex-wrap gap-1.5">
          {ROTATION_PRESETS.map((preset) => {
            const active = snapped !== null ? snapped === preset.angle : rotation === preset.angle;
            return (
              <button
                key={preset.angle}
                type="button"
                onClick={() => setDesignRotation(preset.angle)}
                title={`Fija exactamente ${preset.angle}°`}
                className={[
                  'rounded-lg border px-2 py-1.5 text-[11px] transition-all focus:outline-none',
                  active
                    ? 'border-gold ring-2 ring-gold bg-gold/10 text-cream'
                    : 'border-line text-stone-400 hover:border-gold/50 hover:text-cream',
                ].join(' ')}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Imán configurable R4 (±4°) — estado de DISPOSITIVO (§5) + reset */}
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-stone-300">
            <input
              type="checkbox"
              checked={snapMagnet}
              onChange={toggleMagnet}
              className="accent-gold"
            />
            <Magnet className={`h-3.5 w-3.5 ${snapMagnet ? 'text-gold-soft' : 'text-stone-600'}`} />
            Imán en 0°/90°/180°/270°
          </label>
          <button
            type="button"
            onClick={() => setDesignRotation(0)}
            title="Vuelve a 0° conservando el imán (y escala/espejo con pos 7)"
            className="flex items-center gap-1 text-[10px] text-stone-500 transition hover:text-stone-300 focus:outline-none"
          >
            <RotateCcw className="h-3 w-3" />
            Reset 0°
          </button>
        </div>
      </section>
    </div>
  );
}
