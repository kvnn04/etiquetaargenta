'use client';

/* ============================================================================
 * TARJETA "CARGAR ARCHIVO / EDICIÓN DEL VECTOR" — posiciones 6–7
 * ÚNICA FUENTE: spec_rotacion_archivo_svg_png.md + spec_escala_y_alerta_de_desborde.md
 * (+ tono de quemado de spec_seleccion_de_color.md R4, pos 5).
 * ----------------------------------------------------------------------------
 * · Archivo: SVG/PNG rasterizado EN CLIENTE al canvas de trabajo 2048² (R8,
 *   contain + centrado) y guardado SOLO en el asset de sesión (el archivo NO
 *   viaja al jsonb todavía: la rotación/escala/espejo persisten; el ciclo de
 *   vida del archivo llega con variantes A/B/C y links pos 10).
 *   — SVG (calidad máxima): el vector se rasteriza SIEMPRE a la resolución
 *     FINAL vía envoltorio de 2048² (data-URI + preserveAspectRatio contain);
 *     sin él, un SVG con width/height chicos (o sin ellos — el estándar cae a
 *     300×150) nace rasterizado en su tamaño intrínseco y el agrandado del
 *     bitmap borroso es la pérdida de calidad clásica al subirlo a la virola.
 *     El grabado en vivo usa ese ráster a 2048² (antes 1024²): trazos finos
 *     y textos chicos dejan de verse escalonados al acercar la cámara.
 *     SIN refuerzo de alfa: el vector trae su anti-aliasing correcto.
 *   — PNG: contain + REFUERZO de trazos finos (técnica del prototipo Mate
 *     Studio, alfa ×1.8) para que los hairline no desaparezcan sobre el metal.
 *   Fallo de raster (archivo corrupto tras edición externa): se conserva la
 *   última textura válida y aviso inline (§6) — reintentar reactiva el diseño.
 * · R1 (pos 7): la CARGA congela la base del diseño en mm (baseSideMm = D_ext
 *   vigente: el contain-fit deja la envolvente tocando el anillo). El % de la
 *   sección C multiplica SOLO esa base: editar D_ext/D_int después NO
 *   re-escala el diseño, apenas re-chequea desborde (comportamiento
 *   predecible; el % tiene siempre el mismo significado).
 * · Rotación R3: único marco [0°, 360°) paso 0.5°; el campo numérico acepta
 *   `.` y `,` decimales, signo y sufijo °; normaliza por módulo en vivo
 *   (370°⇒10°, −90°⇒270°, 45.25°⇒45.5°) y texto/vacío RESTAURA el último
 *   válido — la escena jamás pierde la alineación.
 * · Espejo R2 (de spec_rotacion): inversión horizontal sobre el eje vertical
 *   central — tercera posición del pipeline canónico (Escala→Espejo→Rotación).
 * · Imán R4: atracción ±4° en el arrastre del slider; checkbox ON por defecto
 *   y SOLO DE DISPOSITIVO (§5: localStorage — nunca projects.state). Los 4
 *   presets (0° Frente / 90° Der / 180° Dorso / 270° Izq) fijan el ángulo
 *   EXACTO con imán ON u OFF.
 * · Reset: vuelve a 0° escalar conservando imán, escala y espejo (R7).
 * · Escala R8 (pos 7, sección C): % en [70, 110] paso 0.5% con campo
 *   numérico sincrónico y presets 85/90/100 (SIN "Máx"). El botón Auto de la
 *   spec (R7) quedó RETIRADO por decisión del titular (05-nov): la mayor
 *   escala segura la elige el tallerista con el slider/banner;
 *   `largestSafeScalePct` queda testeada en lib/overflow por si la reusan
 *   ficha/variantes (pos 9–10).
 * · Desborde R4/R5 (pos 7): la envolvente de tinta se mide AL CARGAR (máscara
 *   alfa 512² R4), el chequeo re-evalúa por cambio de escala/diametros/carga
 *   — JAMÁS por ángulo/espejo (invariancia polar R3). Banner con la redacción
 *   EXACTA de R5; guías afectadas pulsan rojo (en la escena). Tolerancia 0 mm
 *   estricta: NO existe "margen de seguridad".
 *   §6 modo degradado: si el chequeo falla, se cae a envolvente (bbox)
 *   conservadora con aviso "Detección aproximada" — alerta de más, nunca de
 *   menos.
 * · R6 (pos 7): la decisión de export con desborde (modal con desvío medido)
 *   se conectará cuando exista el export (pos 8/9); la línea de ficha
 *   ("Margen: seguro" / "con riesgo (excede X mm)") ya vive en lib/overflow.
 * · Sin candado: rotación, espejo, escala, presets, banner y confirmación son
 *   FREE (§6 permisos); el Modo Cliente no muestra controles (pos 10).
 * ============================================================================ */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileImage, ImagePlus, Magnet, RotateCcw, X, FlipHorizontal2 } from 'lucide-react';
import EngravingPreview from '@/components/studio/engraving-preview';
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
import {
  evaluateOverflow,
  evaluateOverflowBBox,
  formatScaleLabel,
  normalizeScale,
  overflowBannerText,
  parseScaleInput,
  scanInkEnvelope,
  SCALE_PRESETS,
  SCALE_RANGE,
  SCALE_STEP_PCT,
} from '@/lib/overflow';

const FILE_ACCEPT = 'image/svg+xml,image/png,.svg,.png'; // R8: SVG/PNG

/** R4 pos 5/§4: umbral visual "grave" del banner ámbar→rojo (nota anotada:
 *  la spec pide los dos tonos sin fijar el corte; 2 mm ≈ grabado deformado
 *  visible a simple vista sobre la chapa). */
const OVERFLOW_SEVERE_MM = 2;

/** Texto canónico del campo numérico (R3: sin signo raro, sin ceros extra). */
function fmtAngle(deg: number): string {
  return String(normalizeRotation(deg));
}

const WORK_SIZE = 2048; // R8: canvas de trabajo en vivo (Ficha HD: pos 9 2048²)

/** Carga un origen (data-URI / blob) en un <img> y resuelve al estar listo. */
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
  canvas.width = WORK_SIZE;
  canvas.height = WORK_SIZE;
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
 * clásica al subirlo a la virola. La URI interior va codificada, así que el
 * wrapper sigue siendo XML bien formado.
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

/**
 * R8: rasteriza el archivo EN CLIENTE al canvas de trabajo 2048² (contain,
 * centrado). El resultado vive SOLO en el asset de sesión — jamás se envía
 * al backend.
 * · SVG: rasteriza SIEMPRE a la resolución final vía el envoltorio de 2048²
 *   y SIN refuerzo de alfa — el vector ya trae su anti-aliasing correcto y
 *   el ×1.8 lo aterrona (bordes dentados).
 * · PNG: contain + REFUERZO de trazos finos (prototipo: alpha ×1.8 ⇒ los
 *   hairline no desaparecen sobre el metal).
 * SVG que falle por el wrapper (XML exótico, recursos externos…): se cae al
 * rasterizado clásico de bitmap — la carga jamás se bloquea; si ese camino
 * también falla, el caller conserva la última textura válida (§6).
 */
async function rasterizeDesignFile(file: File): Promise<HTMLCanvasElement> {
  if (kindOf(file) === 'svg') {
    try {
      const svgText = await file.text();
      if (!svgText.trim()) throw new Error('SVG vacío');
      const img = await loadImageElement(svgDataUri(svgWrapperForRaster(svgText, WORK_SIZE)));
      const { canvas, ctx } = makeWorkCanvas();
      ctx.drawImage(img, 0, 0, WORK_SIZE, WORK_SIZE);
      return canvas;
    } catch {
      /* §6 tolerante: sigue por el camino clásico. */
    }
  }
  return rasterizeBitmapFile(file);
}

/** Camino clásico por URL de objeto (PNG y respaldo de SVG): contain + alfa ×1.8. */
async function rasterizeBitmapFile(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const { canvas, ctx } = makeWorkCanvas();
    const w = img.naturalWidth || img.width || WORK_SIZE;
    const h = img.naturalHeight || img.height || WORK_SIZE;
    const scale = Math.min(WORK_SIZE / w, WORK_SIZE / h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(img, (WORK_SIZE - dw) / 2, (WORK_SIZE - dh) / 2, dw, dh);

    // Refuerzo de trazos finos (técnica del prototipo): α>0 ⇒ ×1.8 (max 255),
    // silueta, posición y colores respetados — los píxeles con α=0 no se tocan.
    const imgData = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
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

/**
 * R4 (pos 7): mide la ENVOLVENTE DE TINTA al 100 % del asset recién cargado —
 * máscara alfa 512×512 (detalle R4) del Ráster base SIN máscara anular NI
 * tinte (mide el trazado tal como lo usaría el láser) y SIN rotación/espejo
 * (R3: isometrías con pivote fijo ⇒ radios preservados por definición).
 * Coste O(n) sobre 512² ⇒ ≤ 25 ms (QA2 con margen).
 * Retorna null si no hay trazo (α≥128) o si el kit de canvas no está.
 */
function measureInkEnvelopeMm(asset: HTMLCanvasElement, baseSideMm: number) {
  // El cached de work 2048² ⇒ downsample bilinear a la máscara 512² (R4).
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
  return scanInkEnvelope({ size: 512, alphaAt: (x, y) => data[(y * 512 + x) * 4 + 3] }, mmPerPx);
}

function kindOf(file: File): DesignAsset['kind'] {
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  return type === 'image/svg+xml' || name.endsWith('.svg') ? 'svg' : 'png';
}

export default function DesignCard() {
  const extDiameter = useEditorStore((s) => s.extDiameter);
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const rotation = useEditorStore((s) => s.design.rotation);
  const scale = useEditorStore((s) => s.design.scale);
  const mirror = useEditorStore((s) => s.design.mirror);
  const setDesignRotation = useEditorStore((s) => s.setDesignRotation);
  const setDesignScale = useEditorStore((s) => s.setDesignScale);
  const setDesignMirror = useEditorStore((s) => s.setDesignMirror);
  const designAsset = useEditorStore((s) => s.designAsset);
  const loadDesignAsset = useEditorStore((s) => s.loadDesignAsset);
  const inkEnvelope = useEditorStore((s) => s.inkEnvelope);
  const inkScanDegraded = useEditorStore((s) => s.inkScanDegraded);
  const setInkEnvelope = useEditorStore((s) => s.setInkEnvelope);
  const setInkScanDegraded = useEditorStore((s) => s.setInkScanDegraded);

  /* R4/§5: imán SOLO de dispositivo — se lee tras hidratar (el SSR no tiene
   * localStorage; default ON evita mismatch de hidratación). */
  const [snapMagnet, setSnapMagnet] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [angleText, setAngleText] = useState(fmtAngle(0));
  const [angleInvalid, setAngleInvalid] = useState(false);
  const [scaleText, setScaleText] = useState('100');
  const [scaleInvalid, setScaleInvalid] = useState(false);
  const editingAngleRef = useRef(false);
  const editingScaleRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSnapMagnet(loadSnapMagnetDefault()), []);

  /* Slider/presets/escena pueden cambiar ángulo y escala: los campos siguen al
   * store MIENTRAS no se esté tipeando (espejo del patrón de HexInput). */
  useEffect(() => {
    if (!editingAngleRef.current) setAngleText(fmtAngle(rotation));
  }, [rotation]);
  useEffect(() => {
    if (!editingScaleRef.current) setScaleText(String(scale));
  }, [scale]);

  /* §3 flujo R4: slider con imán SOLO en el arrastre (±4°), paso 0.5°. */
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

  /* R8 escala: mismo patrón WYSIWYG del ángulo — clamp [70,110] paso 0.5%. */
  function handleScaleTyping(text: string): void {
    editingScaleRef.current = true;
    setScaleText(text);
    const parsed = parseScaleInput(text);
    if (parsed === null) {
      setScaleInvalid(true);
      return;
    }
    setScaleInvalid(false);
    setDesignScale(parsed); // normaliza (clamp + paso 0.5%) — jamás fuera de rango
  }

  function commitScaleBlur(): void {
    editingScaleRef.current = false;
    setScaleInvalid(false);
    setScaleText(String(scale));
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
      // R1 (pos 7): la CARGA congela la base (mm): 100 % = trazado tocando el
      // anillo con el D_ext vigente; después solo re-chequea.
      const asset: DesignAsset = {
        canvas,
        name: file.name,
        kind: kindOf(file),
        baseSideMm: extDiameter,
      };
      loadDesignAsset(asset);
      try {
        setInkEnvelope(measureInkEnvelopeMm(canvas, asset.baseSideMm));
        setInkScanDegraded(false);
      } catch {
        // §6: raster del chequeo falló ⇒ modo envolvente conservador.
        setInkEnvelope(null);
        setInkScanDegraded(true);
      }
      setFileError(null);
    } catch {
      // §6: se conserva la última textura válida y aviso inline.
      setFileError(`No se pudo interpretar "${file.name}". Reintentá el archivo.`);
    } finally {
      setFileBusy(false);
      if (fileRef.current) fileRef.current.value = ''; // re-carga del mismo archivo
    }
  }

  function removeDesign(): void {
    loadDesignAsset(null);
    setInkEnvelope(null); // sin trazado: nada que medir para el motor
    setInkScanDegraded(false);
  }

  /* Feedback de imán (§4): el preset "enganchado" se marca; con imán OFF los
   * marcadores quedan neutros. */
  const snapped = magnetSnappedPreset(rotation, snapMagnet);

  /* ─────── R4/R5/R7 — chequeo, banner y Auto del margen ─────── */
  const rExtMm = extDiameter / 2;
  const rIntMm = intDiameter / 2;

  const check = useMemo(() => {
    if (!designAsset) return null;
    if (inkEnvelope) return evaluateOverflow(inkEnvelope, rExtMm, rIntMm, scale);
    if (inkScanDegraded) { // §6: modo envolvente (bbox) conservador
      return evaluateOverflowBBox(designAsset.baseSideMm, scale, rExtMm, rIntMm);
    }
    return null; // medición en curso / asset sin trazado
  }, [designAsset, inkEnvelope, inkScanDegraded, rExtMm, rIntMm, scale]);

  const overflowing = check?.status === 'overflow';
  const severe =
    overflowing &&
    ((check?.overflowOuterMm ?? 0) >= OVERFLOW_SEVERE_MM ||
      (check?.overflowInnerMm ?? 0) >= OVERFLOW_SEVERE_MM);

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
        Rotación, espejo y escala del grabado — FREE, sin candado (§6 de{' '}
        <span className="font-mono">spec_rotacion</span> y <span className="font-mono">spec_escala</span>).
        El archivo se usa en sesión; rotación, escala y espejo son lo que guarda el proyecto.
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
                onClick={removeDesign}
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

        {/* Vista cenital del anillo: la corona en el 3D queda casi de canto. */}
        <EngravingPreview />

        {!designAsset && !fileError && (
          <p className="text-[10px] leading-relaxed text-stone-600">
            Sin diseño: la corona sale lisa. SVG o PNG con trazado tocando el anillo; al cargar se
            congela el 100 % (R1) y la vista previa es en vivo en el 3D y en el anillo de arriba.
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

        {/* Imán configurable R4 (±4°) — estado de DISPOSITIVO (§5) + espejo + reset */}
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
            title="Vuelve a 0° conservando imán, escala y espejo (R7)"
            className="flex items-center gap-1 text-[10px] text-stone-500 transition hover:text-stone-300 focus:outline-none"
          >
            <RotateCcw className="h-3 w-3" />
            Reset 0°
          </button>
        </div>

        {/* Espejo horizontal R2 (spec_rotacion): pipeline Escala→Espejo→Rotación */}
        <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-stone-300">
          <input
            type="checkbox"
            checked={mirror}
            onChange={() => setDesignMirror(!mirror)}
            className="accent-gold"
          />
          <FlipHorizontal2 className={`h-3.5 w-3.5 ${mirror ? 'text-gold-soft' : 'text-stone-600'}`} />
          Espejo del grabado
          <span className="ml-auto text-[9px] text-stone-600">
            {mirror ? 'invertido sobre eje vertical' : 'normal (R2)'}
          </span>
        </label>
      </section>

      <hr className="border-line" />

      {/* ─────── SECCIÓN C — TAMAÑO / ESCALA DEL GRABADO (pos 7) ─────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Tamaño / Escala del Grabado
          </p>
          <span className="text-[9px] text-stone-600">paso 0.5% (R8)</span>
        </div>

        {/* Badge de estado de margen R5 (§4: junto al banner) */}
        <div className="flex items-center justify-between gap-2">
          {!check ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-stone-500">
              {designAsset ? 'midiendo trazado…' : 'sin diseño'}
            </span>
          ) : overflowing ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
              ⚠ Con riesgo de chorreo
            </span>
          ) : (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
              Dentro de zona segura
            </span>
          )}
          {inkScanDegraded && designAsset && (
            <span className="text-[9px] text-amber-300/80">Detección aproximada (§6)</span>
          )}
        </div>

        {/* Banner R5 — redacción EXACTA de la spec */}
        {overflowing && check && (
          <p
            className={[
              'flex gap-1.5 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed',
              severe
                ? 'border border-rose-500/50 bg-rose-500/10 text-rose-200'
                : 'border border-amber-500/40 bg-amber-500/10 text-amber-200',
            ].join(' ')}
          >
            <span>⚠️</span>
            <span aria-live="polite">{overflowBannerText(check)}</span>
          </p>
        )}

        <p className="text-[10px] leading-relaxed text-stone-600">
          El <span className="text-stone-400">100%</span> queda congelado al cargar el archivo (R1:
          la envolvente toca el anillo); editar medidas NO re-escala el diseño, solo re-chequea.
          La tolerancia del anillo es 0 mm estricta (R4).
        </p>

        {/* Slider 70–110 · paso 0.5% (R8) */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={SCALE_RANGE.min}
            max={SCALE_RANGE.max}
            step={SCALE_STEP_PCT}
            value={scale}
            aria-label="Escala del grabado"
            onChange={(e) => setDesignScale(Number(e.target.value))}
            className="w-full accent-gold"
          />
        </div>

        {/* Campo numérico adyacente con sufijo % — sincrónico bidireccional */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={scaleText}
            aria-label="Escala en porcentaje"
            onChange={(e) => handleScaleTyping(e.target.value)}
            onBlur={commitScaleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder="100"
            maxLength={7}
            spellCheck={false}
            className={[
              'h-8 w-[4.5rem] rounded-md border bg-black/30 px-2 text-right text-xs font-semibold outline-none transition focus:outline-none focus:ring-1',
              scaleInvalid
                ? 'border-amber-400/70 text-amber-100 focus:ring-amber-400/60'
                : 'border-white/10 text-stone-100 focus:border-gold/50 focus:ring-gold/40',
            ].join(' ')}
          />
          <span className="text-xs text-stone-500">%</span>
          <span className="flex-1 text-right text-[10px] text-stone-600">
            {scaleInvalid ? 'restaura al salir' : `${formatScaleLabel(normalizeScale(scale))} vigente`}
          </span>
        </div>

        {/* Presets de escala (sin "Máx": el máximo real es 110 %). El botón
            Auto de la spec R7 quedó RETIRADO por decisión del titular
            (05-nov): la mayor escala segura la elige el tallerista a ojo con
            el slider y el banner; `largestSafeScalePct` queda en lib/overflow
            (función testeada) por si la reusan ficha/variantes. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {SCALE_PRESETS.map((preset) => (
            <button
              key={preset.pct}
              type="button"
              onClick={() => setDesignScale(preset.pct)}
              title={`Fija la escala en ${preset.pct}%`}
              className={[
                'rounded-lg border px-2 py-1.5 text-[11px] transition-all focus:outline-none',
                scale === preset.pct
                  ? 'border-gold ring-2 ring-gold bg-gold/10 text-cream'
                  : 'border-line text-stone-400 hover:border-gold/50 hover:text-cream',
              ].join(' ')}
            >
              {preset.pct}%
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
