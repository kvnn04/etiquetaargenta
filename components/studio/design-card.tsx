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
import { FileImage, ImagePlus, Magnet, RotateCcw, X, FlipHorizontal2, MoveVertical } from 'lucide-react';
import EngravingPreview from '@/components/studio/engraving-preview';
import { useEditorStore } from '@/lib/store/editor';
import { isBottleGeometry, isMateThermoGeometry, isThermoProduct, resolveProduct } from '@/lib/catalog';
import {
  clampThermoRotation,
  evaluateThermoOverflow,
  formatThermoScaleLabel,
  normalizeThermoScaleFor,
  thermoAngleBounds,
  thermoContinuousAngle,
  thermoOverflowText,
  THERMO_OFFSET_STEP_PCT,
  THERMO_SCALE_STEP_PCT,
} from '@/lib/thermo';
import { thermoAssetAspect } from '@/lib/compose-thermo-engraving';
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
  SCALE_PRESETS,
  SCALE_RANGE,
  SCALE_STEP_PCT,
} from '@/lib/overflow';
import {
  designKindOf,
  measureInkEnvelopeMm,
  rasterizeDesignFile,
} from '@/lib/design-raster';

const FILE_ACCEPT = 'image/svg+xml,image/png,.svg,.png'; // R8: SVG/PNG

/** R4 pos 5/§4: umbral visual "grave" del banner ámbar→rojo (nota anotada:
 *  la spec pide los dos tonos sin fijar el corte; 2 mm ≈ grabado deformado
 *  visible a simple vista sobre la chapa). */
const OVERFLOW_SEVERE_MM = 2;

/** Texto canónico del campo numérico (R3: sin signo raro, sin ceros extra). */
function fmtAngle(deg: number): string {
  return String(normalizeRotation(deg));
}

export default function DesignCard() {
  const mateModel = useEditorStore((s) => s.mateModel);
  const extDiameter = useEditorStore((s) => s.extDiameter);
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const rotation = useEditorStore((s) => s.design.rotation);
  const scale = useEditorStore((s) => s.design.scale);
  const mirror = useEditorStore((s) => s.design.mirror);
  const setDesignRotation = useEditorStore((s) => s.setDesignRotation);
  const setDesignScale = useEditorStore((s) => s.setDesignScale);
  const setDesignMirror = useEditorStore((s) => s.setDesignMirror);
  const thermoOffset = useEditorStore((s) => s.thermo.offsetYPct);
  const thermoInvert = useEditorStore((s) => s.thermo.invert);
  const setThermoOffset = useEditorStore((s) => s.setThermoOffset);
  const setThermoInvert = useEditorStore((s) => s.setThermoInvert);
  const designAsset = useEditorStore((s) => s.designAsset);
  const loadDesignAsset = useEditorStore((s) => s.loadDesignAsset);
  const inkEnvelope = useEditorStore((s) => s.inkEnvelope);
  const inkScanDegraded = useEditorStore((s) => s.inkScanDegraded);
  const setInkEnvelope = useEditorStore((s) => s.setInkEnvelope);
  const setInkScanDegraded = useEditorStore((s) => s.setInkScanDegraded);

  const product = useMemo(() => resolveProduct(mateModel), [mateModel]);
  const thermoProduct = isThermoProduct(product) ? product : null;
  const thermoSpec = thermoProduct?.thermo ?? null;
  const isBottle = thermoSpec ? isBottleGeometry(thermoSpec.geometry) : false;
  const isRecto = thermoSpec ? isMateThermoGeometry(thermoSpec.geometry) : false;
  const thermoNoun = isRecto ? 'el mate' : isBottle ? 'la botella' : 'el termo';
  const aspect = useMemo(() => thermoAssetAspect(designAsset?.canvas ?? null), [designAsset]);
  const angleBounds = useMemo(
    () => (thermoSpec ? thermoAngleBounds(thermoSpec, scale, aspect) : null),
    [thermoSpec, scale, aspect],
  );
  /* El slider del termo trabaja en el rango CONTINUO del arco libre (puede
   * cruzar 0°); el store conserva el canónico [0,360). */
  const continuousRotation = useMemo(
    () =>
      thermoSpec ? thermoContinuousAngle(thermoSpec, rotation, scale, aspect) : rotation,
    [thermoSpec, rotation, scale, aspect],
  );
  const angleLabel = thermoSpec
    ? String(Math.round(continuousRotation * 2) / 2)
    : fmtAngle(rotation);
  const scaleMin = thermoSpec?.minScalePct ?? SCALE_RANGE.min;
  const scaleMax = thermoSpec?.maxScalePct ?? SCALE_RANGE.max;
  const scaleStep = thermoSpec ? THERMO_SCALE_STEP_PCT : SCALE_STEP_PCT;
  const scaleLabel = thermoSpec ? formatThermoScaleLabel(scale) : formatScaleLabel(normalizeScale(scale));

  /* R4/§5: imán SOLO de dispositivo — se lee tras hidratar (el SSR no tiene
   * localStorage; default ON evita mismatch de hidratación). */
  const [snapMagnet, setSnapMagnet] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [angleText, setAngleText] = useState(fmtAngle(0));
  const [angleInvalid, setAngleInvalid] = useState(false);
  const [scaleText, setScaleText] = useState(String(scale));
  const [scaleInvalid, setScaleInvalid] = useState(false);
  const editingAngleRef = useRef(false);
  const editingScaleRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSnapMagnet(loadSnapMagnetDefault()), []);

  /* Slider/presets/escena pueden cambiar ángulo y escala: los campos siguen al
   * store MIENTRAS no se esté tipeando (espejo del patrón de HexInput). */
  useEffect(() => {
    if (!editingAngleRef.current) setAngleText(angleLabel);
  }, [angleLabel]);
  useEffect(() => {
    if (!editingScaleRef.current) setScaleText(String(scale));
  }, [scale]);

  /* Termo: al cambiar el aspecto del diseño o la escala, el arco libre se
   * recalcula; si el ángulo vigente ya no entra, se lleva al límite. */
  useEffect(() => {
    if (!thermoSpec) return;
    const clamped = clampThermoRotation(thermoSpec, rotation, scale, aspect);
    if (Math.abs(clamped - rotation) > 0.001) setDesignRotation(clamped);
  }, [thermoSpec, rotation, scale, aspect, setDesignRotation]);

  /* Un diseño cargado con el termo activo NO midió la envolvente del anillo
   * (el termo no la usa). Al volver a un mate se mide una vez: sin esto el
   * chequeo de margen quedaría en "midiendo" y el export no confirmaría. */
  useEffect(() => {
    if (thermoSpec || !designAsset || inkEnvelope || inkScanDegraded) return;
    try {
      setInkEnvelope(measureInkEnvelopeMm(designAsset.canvas, designAsset.baseSideMm));
      setInkScanDegraded(false);
    } catch {
      setInkEnvelope(null);
      setInkScanDegraded(true);
    }
  }, [
    thermoSpec,
    designAsset,
    inkEnvelope,
    inkScanDegraded,
    setInkEnvelope,
    setInkScanDegraded,
  ]);

  /* §3 flujo R4: slider con imán SOLO en el arrastre (±4°), paso 0.5°. En el
   * termo además se excluye el arco de la media manija. */
  function setRotationClamped(value: number): void {
    const next = thermoSpec
      ? clampThermoRotation(thermoSpec, value, scale, aspect)
      : normalizeRotation(value);
    setDesignRotation(next);
  }

  function handleSlider(value: number): void {
    setRotationClamped(thermoSpec ? normalizeRotation(value) : applyMagnet(normalizeRotation(value), snapMagnet));
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
    setRotationClamped(parsed); // normaliza/clampa — jamás rompe la escena
  }

  function commitAngleBlur(): void {
    editingAngleRef.current = false;
    setAngleInvalid(false);
    setAngleText(angleLabel);
  }

  /* R8 escala: mismo patrón WYSIWYG del ángulo — clamp por FAMILIA paso 0.5%. */
  function applyScale(value: number): void {
    const normalized = thermoSpec
      ? normalizeThermoScaleFor(thermoSpec, value)
      : normalizeScale(value);
    setDesignScale(normalized);
    if (thermoSpec) {
      // El ancho del diseño cambia con la escala: re-clamp del arco libre.
      setDesignRotation(clampThermoRotation(thermoSpec, rotation, normalized, aspect));
    }
  }

  function handleScaleTyping(text: string): void {
    editingScaleRef.current = true;
    setScaleText(text);
    const parsed = parseScaleInput(text);
    if (parsed === null) {
      setScaleInvalid(true);
      return;
    }
    setScaleInvalid(false);
    applyScale(parsed); // normaliza (clamp + paso 0.5%) — jamás fuera de rango
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
        kind: designKindOf(file),
        baseSideMm: extDiameter,
      };
      loadDesignAsset(asset);
      if (thermoSpec) {
        /* El termo no usa la envolvente polar del anillo: su margen sale del
         * recorte real del trazado + la zona lateral (lib/thermo). */
        setInkEnvelope(null);
        setInkScanDegraded(false);
      } else {
        try {
          setInkEnvelope(measureInkEnvelopeMm(canvas, asset.baseSideMm));
          setInkScanDegraded(false);
        } catch {
          // §6: raster del chequeo falló ⇒ modo envolvente conservador.
          setInkEnvelope(null);
          setInkScanDegraded(true);
        }
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
   * marcadores quedan neutros. En el termo los presets son los bordes y el
   * centro del arco libre (la manija no se puede tapar). */
  const snapped = thermoSpec ? null : magnetSnappedPreset(rotation, snapMagnet);
  const rotationPresets = thermoSpec && angleBounds
    ? [
        {
          angle: angleBounds.minDeg,
          label: isRecto ? 'Izquierda' : isBottle ? 'Borde Izq' : 'Borde Frente',
        },
        { angle: angleBounds.centerDeg, label: 'Centro' },
        {
          angle: angleBounds.maxDeg,
          label: isRecto ? 'Derecha' : isBottle ? 'Borde Der' : 'Borde Dorso',
        },
      ]
    : ROTATION_PRESETS;
  /* La botella no tiene manija: sus presets acompañan el frente fijo (el
   * default del prototipo es 72 %). El Mate Recto usa 50/65/100; los termos
   * conservan 25/45/70/100. */
  const scalePresets = thermoSpec
    ? isRecto
      ? [50, 65, 100]
      : isBottle
        ? [50, 72, 100]
        : [25, 45, 70, 100]
    : SCALE_PRESETS.map((p) => p.pct);

  /* ─────── R4/R5/R7 — chequeo, banner y Auto del margen ─────── */
  const rExtMm = extDiameter / 2;
  const rIntMm = intDiameter / 2;

  const check = useMemo(() => {
    if (!designAsset) return null;
    if (thermoSpec) {
      return evaluateThermoOverflow(thermoSpec, {
        scalePct: scale,
        offsetYPct: thermoOffset,
        aspect,
      });
    }
    if (inkEnvelope) return evaluateOverflow(inkEnvelope, rExtMm, rIntMm, scale);
    if (inkScanDegraded) { // §6: modo envolvente (bbox) conservador
      return evaluateOverflowBBox(designAsset.baseSideMm, scale, rExtMm, rIntMm);
    }
    return null; // medición en curso / asset sin trazado
  }, [designAsset, inkEnvelope, inkScanDegraded, rExtMm, rIntMm, scale, thermoSpec, thermoOffset, aspect]);

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

        {/* Vista cenital del anillo (solo mates): en el termo el grabado es
            lateral y se lee en la escena 3D. */}
        {!thermoSpec && <EngravingPreview />}

        {!designAsset && !fileError && (
          <p className="text-[10px] leading-relaxed text-stone-600">
            {thermoSpec
              ? `Sin diseño: el cuerpo sale liso. SVG o PNG con trazado; al cargar se ajusta a la zona lateral y se puede mover con el dedo sobre ${thermoNoun}.`
              : 'Sin diseño: la corona sale lisa. SVG o PNG con trazado tocando el anillo; al cargar se congela el 100 % (R1) y la vista previa es en vivo en el 3D y en el anillo de arriba.'}
          </p>
        )}
      </section>

      <hr className="border-line" />

      {/* ─────── SECCIÓN B — ALINEACIÓN Y ROTACIÓN DEL GRABADO (360°) ─────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
            {thermoSpec
              ? isRecto
                ? 'Posición Horizontal del Grabado'
                : 'Posición Angular del Grabado'
              : 'Rotación del Grabado (360°)'}
          </p>
          <span className="text-[9px] text-stone-600">
            {isRecto
              ? 'frente fijo de 90° (±45°)'
              : isBottle
                ? 'frente fijo de 114°'
                : thermoSpec
                  ? 'arco libre (sin manija)'
                  : 'paso 0.5° (R3)'}
          </span>
        </div>

        {/* Slider: mate 0–360 · termo sólo el arco libre que deja la manija */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={thermoSpec && angleBounds ? angleBounds.minDeg : 0}
            max={thermoSpec && angleBounds ? angleBounds.maxDeg : 360}
            step={0.5}
            value={thermoSpec ? continuousRotation : rotation}
            aria-label={
              isRecto
                ? 'Posición horizontal del grabado'
                : thermoSpec
                  ? 'Posición angular del grabado'
                  : 'Alineación y rotación del grabado'
            }
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
          {rotationPresets.map((preset) => {
            const active = thermoSpec
              ? Math.abs(continuousRotation - preset.angle) < 0.26
              : snapped !== null
                ? snapped === preset.angle
                : rotation === preset.angle;
            return (
              <button
                key={`${preset.angle}-${preset.label}`}
                type="button"
                onClick={() => setRotationClamped(preset.angle)}
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

        {/* Imán configurable R4 (±4°) — solo mates (el termo tiene arco propio) + reset */}
        <div className="flex items-center justify-between gap-2">
          {thermoSpec ? (
            <span className="text-[10px] text-stone-600">
              {isRecto
                ? 'El frente fijo de 90° (±45°) limita el grabado; el dorso queda libre.'
                : isBottle
                  ? 'El frente fijo de 114° limita el grabado; el dorso queda libre.'
                  : thermoSpec.geometry === 'system'
                    ? 'La manija táctica bloquea el costado derecho; el diseño se mueve dentro del arco libre.'
                    : 'La media manija bloquea el costado izquierdo; el diseño se mueve dentro del arco libre.'}
            </span>
          ) : (
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
          )}
          <button
            type="button"
            onClick={() => setRotationClamped(thermoSpec && angleBounds ? angleBounds.centerDeg : 0)}
            title="Vuelve al centro conservando escala y espejo"
            className="flex items-center gap-1 text-[10px] text-stone-500 transition hover:text-stone-300 focus:outline-none"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
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

        {/* Termo: la zona de grabado es lateral, no la corona ⇒ posición
            vertical libre dentro del cuerpo y negativo (invertido). */}
        {thermoSpec && (
          <div className="space-y-3 rounded-xl border border-line bg-black/20 p-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Posición Vertical
              </p>
              <span className="text-[9px] text-stone-600">-100 abajo · 100 arriba</span>
            </div>
            <div className="flex items-center gap-3">
              <MoveVertical className="h-3.5 w-3.5 shrink-0 text-stone-500" />
              <input
                type="range"
                min={-100}
                max={100}
                step={THERMO_OFFSET_STEP_PCT}
                value={thermoOffset}
                aria-label="Posición vertical del grabado"
                onChange={(e) => setThermoOffset(Number(e.target.value))}
                className="w-full accent-gold"
              />
              <span className="w-10 shrink-0 text-right font-mono text-[10px] text-stone-400">
                {thermoOffset > 0 ? `+${thermoOffset}` : thermoOffset}
              </span>
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-stone-300">
              <input
                type="checkbox"
                checked={thermoInvert}
                onChange={() => setThermoInvert(!thermoInvert)}
                className="accent-gold"
              />
              Grabado invertido (negativo)
              <span className="ml-auto text-[9px] text-stone-600">
                {thermoInvert ? 'fondo quemado' : 'trazo quemado'}
              </span>
            </label>
          </div>
        )}
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
          {!thermoSpec && inkScanDegraded && designAsset && (
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
            <span aria-live="polite">
              {thermoSpec ? thermoOverflowText(check, thermoSpec) : overflowBannerText(check)}
            </span>
          </p>
        )}

        <p className="text-[10px] leading-relaxed text-stone-600">
          {thermoSpec ? (
            <>
              El diseño se ajusta a la zona lateral del cuerpo y se mueve con el dedo sobre{' '}
              {thermoNoun}. La escala va de {thermoSpec.minScalePct}% a{' '}
              {thermoSpec.maxScalePct}% y el margen se recalcula al instante.
            </>
          ) : (
            <>
              El <span className="text-stone-400">100%</span> queda congelado al cargar el archivo
              (R1: la envolvente toca el anillo); editar medidas NO re-escala el diseño, solo
              re-chequea. La tolerancia del anillo es 0 mm estricta (R4).
            </>
          )}
        </p>

        {/* Slider de escala: mate 70–110 · termo 10–100 (R8) */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={scaleMin}
            max={scaleMax}
            step={scaleStep}
            value={scale}
            aria-label="Escala del grabado"
            onChange={(e) => applyScale(Number(e.target.value))}
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
            placeholder={thermoSpec ? String(thermoSpec.defaultScalePct) : '100'}
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
            {scaleInvalid ? 'restaura al salir' : `${scaleLabel} vigente`}
          </span>
        </div>

        {/* Presets de escala por producto (botella 50/72/100 · termo 25/45/70/100 · mate 85/90/100). */}
        <div className="flex flex-wrap items-center gap-1.5">
          {scalePresets.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyScale(pct)}
              title={`Fija la escala en ${pct}%`}
              className={[
                'rounded-lg border px-2 py-1.5 text-[11px] transition-all focus:outline-none',
                scale === pct
                  ? 'border-gold ring-2 ring-gold bg-gold/10 text-cream'
                  : 'border-line text-stone-400 hover:border-gold/50 hover:text-cream',
              ].join(' ')}
            >
              {pct}%
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
