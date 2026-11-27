/* ============================================================================
 * ESTADO DEL EDITOR — spec_tipo_de_mate.md §5 (shape de `projects.state`)
 * ----------------------------------------------------------------------------
 * MateStore (zustand): las posiciones 3–7 agregan SUS claves acá conforme
 * llegan (guías y edición de diámetros en 4, material en 5, diseño en 6,
 * escala y variantes en 7). La persistencia serializa TODO lo definido acá.
 *
 * claves pos 3:
 *   mateModel    id del catálogo (R7: el payload comercial lo consume).
 *
 * claves pos 4 (spec_tecnica_geometrica §5):
 *   extDiameter  D_ext editable en mm con 1 decimal (R1: clamp en el campo,
 *   intDiameter  jamás un error rojo; defaults 123.0/95.0 del §2).
 *   guidesState  triada de guías persistida (R6, default true×3). El estado
 *                del AUTO-GIRO es de dispositivo y NO se persiste (R6).
 *
 * claves pos 5 (spec_seleccion_de_color.md):
 *   bodyPreset   preset activo del cuerpo (R3: exclusividad mutua con bodyColor).
 *   metalPreset  preset activo de la virola (R3: exclusividad mutua con virolaColor).
 *   bodyColor    color libre del cuerpo en HEX; null ⇒ usa bodyPreset.
 *   virolaColor  color libre de la virola en HEX; null ⇒ usa metalPreset.
 *   recentColors colores recientes por zona (máx 6, deduplicados, prepend).
 *
 * claves pos 6 (spec_rotacion_archivo_svg_png.md):
 *   design       { rotation } en grados [0°, 360°) paso 0.5° (R3/R7). El estado
 *                del IMÁN es SOLO DE DISPOSITIVO (§5, localStorage — igual que
 *                el auto-giro: nunca viaja al jsonb). El archivo del diseño
 *                (designAsset) es de SESIÓN también: solo la ROTACIÓN persiste;
 *                el ciclo de vida del archivo llega con pos 7/10.
 *
 * claves pos 7 (spec_escala_y_alerta_de_desborde.md):
 *   design.scale escala fina del grabado: % [70, 110] paso 0.5% (R1/R8), que
 *                multiplica la base CONGELADA del fit inicial — editar
 *                D_ext/D_int después NO re-escala, solo re-chequea.
 *   design.mirror espejo horizontal del pipeline Escala→Espejo→Rotación
 *                (R2 de spec_rotacion...: obliga a pos 7 por su consumo).
 *   inkEnvelope  envolvente radial de tinta al 100% en mm — DERIVADA de sesión
 *                (se mide al cargar el asset); JAMÁS se persiste (R8: el
 *                estado de margen se re-calcula al abrir/evaluar).
 *   inkScanDegraded true ⇒ el raster del chequeo falló y todo lo derivado cae
 *                a modo envolvente conservador ("Detección aproximada").
 *
 * claves pos 10A (spec_ficha_comercial_interactiva_shareable_link §5):
 *   linkDraft    borrador de variantes del Enlace Comercial (≤3 filas A–C con
 *                label/escala/rotación/espejo + included): TODO lo definido
 *                persiste en projects.state para no redefinir al re-publicar.
 *                El PAYLOAD congelado es OTRO registro (tabla links); este
 *                draft NO viaja al payload — es el borrador del editor.
 * ============================================================================ */

import { create } from 'zustand';
import {
  DEFAULT_MATE_MODEL,
  isThermoProduct,
  resolveProduct,
  type MateModelId,
  type ThermoProduct,
} from '@/lib/catalog';
import { DEFAULT_GUIDES_STATE, type GuidesState } from '@/lib/virola';
import { DEFAULT_EXT_DIAMETER_MM, DEFAULT_INT_DIAMETER_MM } from '@/three/visual-skeleton';
import {
  DEFAULT_METAL_PRESET,
  DEFAULT_BODY_PRESET,
  type MetalPresetId,
  type BodyPresetId,
} from '@/lib/color';
import { normalizeRotation, DEFAULT_DESIGN_STATE, type DesignState, type DesignAsset } from '@/lib/design';
import { normalizeScale } from '@/lib/overflow';
import type { InkEnvelope } from '@/lib/overflow';
import {
  DEFAULT_THERMO_CONFIG,
  normalizeThermoConfig,
  normalizeThermoFinish,
  normalizeThermoOffset,
  normalizeThermoScale,
  type ThermoConfig,
  type ThermoFinish,
} from '@/lib/thermo';
import type { StoredVariantRow } from '@/lib/links/payload';

/** Recurso del diseño cargado en sesión (canvas rasterizado 2048², R8). */
export type { DesignAsset };

export interface EditorStateSnapshot {
  mateModel: MateModelId;
  extDiameter: number;
  intDiameter: number;
  guidesState: GuidesState;
  bodyPreset: BodyPresetId;
  metalPreset: MetalPresetId;
  bodyColor: string | null;    // null ⇒ usa preset
  virolaColor: string | null;  // null ⇒ usa preset
  recentColors: { body: string[]; virola: string[] };
  /** pos 6 (R3/R7): rotación del grabado en grados canónicos [0°, 360°). */
  design: DesignState;
  /**
   * Termo (familia thermo): estado propio del producto. Los mates ignoran
   * estas claves; rotación/escala/espejo siguen viviendo en `design`.
   */
  thermo: ThermoConfig;
  /**
   * pos 10A: borrador de Variantes del Enlace (A–C con included) — persiste
   * en projects.state (spec shareable-link §5: la configuración del link es
   * trabajo del editor, el payload fijo queda en la tabla `links`). El
   * normalizador del jsonb ya lo deja sano; acá viaja tal cual.
   */
  linkDraft: StoredVariantRow[];
}

export interface EditorStore extends EditorStateSnapshot {
  /** Proyecto server-side cargado (null ⇒ el primer autosave lo crea). */
  projectId: string | null;
  /** true ⇒ hay cambios sin persistir (el autosave los debe persistir). */
  dirty: boolean;
  /** Última persistencia confirmada (o null si nunca). */
  lastSavedAt: string | null;
  /** true ⇒ el autosave falló por red: el borrador vive en localStorage. */
  offlineDraft: boolean;
  /** pos 6: asset de diseño de la SESIÓN (nunca persistido; restore ⇒ null). */
  designAsset: DesignAsset | null;
  /**
   * pos 7: envolvente de tinta al 100 % (mm) — DERIVADA de sesión (la mide el
   * motor de desborde al cargar el asset). NO se persiste ni marca dirty
   * (R8: el estado de margen se recalcula siempre; jamás se confía en valores
   * guardados). null ⇒ sin diseño / medición no disponible todavía.
   */
  inkEnvelope: InkEnvelope | null;
  /**
   * pos 7 (§6): true ⇒ el raster del chequeo FALLÓ y todo lo derivado cae a
   * modo envolvente conservador ("Detección aproximada"). Derivado de sesión:
   * no se persiste ni marca dirty. restore ⇒ false.
   */
  inkScanDegraded: boolean;

  /** Restaura desde el backend (o del draft local más reciente). */
  restoreState: (s: EditorStateSnapshot, projectId: string | null) => void;
  /** Cambia el producto activo (R1: swap instantáneo, sin morph). */
  setMateModel: (id: MateModelId) => void;
  /**
   * R3: UN solo evento de medidas — un set con ambos valores ⇒ un render,
   * con métricas (b), guías (c) y re-anclaje del cuerpo (d) derivando acá.
   */
  setDiameters: (d: { extDiameter: number; intDiameter: number }) => void;
  /** R6: cambia la triada de guías (checkboxes) y marca dirty. */
  setGuidesState: (patch: Partial<GuidesState>) => void;
  /** R3: Selecciona preset de cuerpo y limpia color libre (exclusividad mutua). */
  setBodyPreset: (id: BodyPresetId) => void;
  /** R3: Selecciona preset de virola y limpia color libre (exclusividad mutua). */
  setMetalPreset: (id: MetalPresetId) => void;
  /** Establece color libre del cuerpo (null ⇒ vuelve al preset activo). */
  setBodyColor: (hex: string | null) => void;
  /** Establece color libre de la virola (null ⇒ vuelve al preset activo). */
  setVirolaColor: (hex: string | null) => void;
  /** Agrega un color reciente a la zona indicada (prepend, dedup, máx 6). */
  addRecentColor: (zone: 'body' | 'virola', hex: string) => void;
  /** pos 6: setea la rotación canónica del grabado (R3: normaliza por módulo). */
  setDesignRotation: (angleDeg: number) => void;
  /** pos 7: setea la escala canónica del grabado (% R8: normaliza [70,110] 0.5%). */
  setDesignScale: (scalePct: number) => void;
  /** pos 7: alterna el espejo horizontal (R2 spec_rotacion: pipeline central). */
  setDesignMirror: (on: boolean) => void;
  /** Termo: posición vertical del centro del grabado (-100 abajo … 100 arriba). */
  setThermoOffset: (pct: number) => void;
  /** Termo: grabado invertido (negative space). */
  setThermoInvert: (on: boolean) => void;
  /** Termo: acabado del cuerpo pintado. */
  setThermoFinish: (finish: ThermoFinish) => void;
  /**
   * pos 6: carga/limpia (null) el archivo de diseño en SESIÓN — el asset NO
   * se persiste ni marca dirty: no cambia nada del estado contractual.
   */
  loadDesignAsset: (asset: DesignAsset | null) => void;
  /** pos 7: publica la envolvente de tinta medida (derivado de sesión; sin dirty). */
  setInkEnvelope: (ink: InkEnvelope | null) => void;
  /** pos 7 (§6): publica el modo degradado del chequeo (envolvente conservador). */
  setInkScanDegraded: (on: boolean) => void;
  /**
   * pos 10A: reemplaza el borrador de variantes del Enlace (la tarjeta lo
   * manda entero — rows normalizadas desde la propia tarjeta). Marca dirty:
   * es estado contractual del proyecto.
   */
  setLinkDraft: (rows: StoredVariantRow[]) => void;
  /** Marca dirty de otro flujo (ej. restore desde draft local más nuevo). */
  markDirty: () => void;
  /** Confirmado de guardar (lo llama el autosave). */
  markSaved: (at: string, projectId: string | null) => void;
  markOfflineDraft: (on: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  mateModel: DEFAULT_MATE_MODEL,
  extDiameter: DEFAULT_EXT_DIAMETER_MM,
  intDiameter: DEFAULT_INT_DIAMETER_MM,
  guidesState: { ...DEFAULT_GUIDES_STATE },
  bodyPreset: DEFAULT_BODY_PRESET,
  metalPreset: DEFAULT_METAL_PRESET,
  bodyColor: null,
  virolaColor: null,
  recentColors: { body: [], virola: [] },
  design: { ...DEFAULT_DESIGN_STATE },
  thermo: { ...DEFAULT_THERMO_CONFIG },
  linkDraft: [],
  projectId: null,
  dirty: false,
  lastSavedAt: null,
  offlineDraft: false,
  designAsset: null,
  inkEnvelope: null,
  inkScanDegraded: false,

  restoreState: (s, projectId) =>
    set((prev) => ({
      ...prev,
      ...s,
      guidesState: s.guidesState ?? { ...DEFAULT_GUIDES_STATE },
      bodyPreset: s.bodyPreset ?? DEFAULT_BODY_PRESET,
      metalPreset: s.metalPreset ?? DEFAULT_METAL_PRESET,
      bodyColor: s.bodyColor ?? null,
      virolaColor: s.virolaColor ?? null,
      recentColors: s.recentColors ?? { body: [], virola: [] },
      design: s.design ?? { ...DEFAULT_DESIGN_STATE },
      thermo: normalizeThermoConfig((s as { thermo?: unknown }).thermo),
      // pos 10A: el draft de variantes llegó normalizado desde el jsonb.
      linkDraft: s.linkDraft ?? [],
      projectId,
      dirty: false,
      offlineDraft: false,
      // pos 6: el archivo del diseño es de sesión — al restaurar NO revivimos
      // la imagen (la rotación sí persiste; el asset se re-carga a mano).
      designAsset: null,
      // pos 7 (R8): el estado de margen NO se persiste — se recalcula al abrir.
      inkEnvelope: null,
      inkScanDegraded: false,
    })),

  setMateModel: (id) =>
    set((prev) => {
      const next = resolveProduct(id);
      const wasThermo = isThermoProduct(resolveProduct(prev.mateModel));
      const isThermo = isThermoProduct(next);
      // Escala por familia: los rangos NO son compatibles (mate 70–110,
      // termo 10–100). Al cruzar de familia se parte del default de la nueva.
      const scale =
        isThermo && !wasThermo
          ? next.thermo.defaultScalePct
          : !isThermo && wasThermo
            ? DEFAULT_DESIGN_STATE.scale
            : prev.design.scale;
      return {
        ...prev,
        mateModel: next.id,
        design: {
          ...prev.design,
          scale: isThermo ? normalizeThermoScale(scale) : normalizeScale(scale),
        },
        dirty: true,
      };
    }),

  setDiameters: (d) =>
    set((prev) => ({ ...prev, extDiameter: d.extDiameter, intDiameter: d.intDiameter, dirty: true })),

  setGuidesState: (patch) =>
    set((prev) => ({ ...prev, guidesState: { ...prev.guidesState, ...patch }, dirty: true })),

  // R3: exclusividad mutua — seleccionar preset limpia el color libre
  setBodyPreset: (id) => set((prev) => ({ ...prev, bodyPreset: id, bodyColor: null, dirty: true })),

  // R3: exclusividad mutua — seleccionar preset limpia el color libre
  setMetalPreset: (id) => set((prev) => ({ ...prev, metalPreset: id, virolaColor: null, dirty: true })),

  setBodyColor: (hex) => set((prev) => ({ ...prev, bodyColor: hex, dirty: true })),

  setVirolaColor: (hex) => set((prev) => ({ ...prev, virolaColor: hex, dirty: true })),

  addRecentColor: (zone, hex) =>
    set((prev) => {
      const existing = prev.recentColors[zone];
      // Prepend y deduplicar; máx 6 entradas
      const deduped = [hex, ...existing.filter((c) => c !== hex)].slice(0, 6);
      return {
        ...prev,
        recentColors: { ...prev.recentColors, [zone]: deduped },
        dirty: true,
      };
    }),

  markDirty: () => set((prev) => ({ ...prev, dirty: true })),

  // pos 6 (R3): guardar SIEMPRE la representación canónica [0°, 360°) —
  // setDiameters-pattern: UN evento ⇒ un render del engranador.
  setDesignRotation: (angleDeg) =>
    set((prev) => ({
      ...prev,
      design: { ...prev.design, rotation: normalizeRotation(angleDeg) },
      dirty: true,
    })),

  // pos 7 (R8): SIEMPRE la representación canónica de la FAMILIA vigente
  // (mate [70,110] · termo [10,100]) paso 0.5%.
  setDesignScale: (scalePct) =>
    set((prev) => {
      const product = resolveProduct(prev.mateModel);
      const scale = isThermoProduct(product)
        ? normalizeThermoScale(scalePct)
        : normalizeScale(scalePct);
      return {
        ...prev,
        design: { ...prev.design, scale },
        dirty: true,
      };
    }),

  // pos 7 (R2 de spec_rotacion): el espejo es parte del pipeline canónico.
  setDesignMirror: (on) =>
    set((prev) => ({ ...prev, design: { ...prev.design, mirror: on }, dirty: true })),

  // Termo: estado propio del producto (persiste en projects.state.thermo).
  setThermoOffset: (pct) =>
    set((prev) => ({
      ...prev,
      thermo: { ...prev.thermo, offsetYPct: normalizeThermoOffset(pct) },
      dirty: true,
    })),

  setThermoInvert: (on) =>
    set((prev) => ({ ...prev, thermo: { ...prev.thermo, invert: on }, dirty: true })),

  setThermoFinish: (finish) =>
    set((prev) => ({
      ...prev,
      thermo: { ...prev.thermo, finish: normalizeThermoFinish(finish) },
      dirty: true,
    })),

  // pos 6: el asset no es contractual — no marca dirty (el autosave dedupea
  // por payload igual; esto evita autosaves con payload idéntico).
  loadDesignAsset: (asset) => set((prev) => ({ ...prev, designAsset: asset })),

  // pos 7: la envolvente es derivada de sesión — jamás persistida (R8 §5),
  // por eso tampoco marca dirty: el autosave no ve un cambio contractual.
  setInkEnvelope: (ink) => set((prev) => ({ ...prev, inkEnvelope: ink })),
  // pos 7 (§6): modo degradado del chequeo — derivado de sesión, sin dirty.
  setInkScanDegraded: (on) => set((prev) => ({ ...prev, inkScanDegraded: on })),

  // pos 10A: el borrador de variantes SÍ es estado del proyecto (dirty).
  setLinkDraft: (rows) => set((prev) => ({ ...prev, linkDraft: rows, dirty: true })),

  markSaved: (at, projectId) => set((prev) => ({ ...prev, dirty: false, lastSavedAt: at, projectId })),
  markOfflineDraft: (on) => set((prev) => ({ ...prev, offlineDraft: on })),
}));

/** Snapshot serializable para `projects.state` (posiciones suman sus claves). */
export function snapshotOf(store: EditorStore): EditorStateSnapshot {
  return {
    mateModel: store.mateModel,
    extDiameter: store.extDiameter,
    intDiameter: store.intDiameter,
    guidesState: { ...store.guidesState },
    bodyPreset: store.bodyPreset,
    metalPreset: store.metalPreset,
    bodyColor: store.bodyColor,
    virolaColor: store.virolaColor,
    recentColors: {
      body: [...store.recentColors.body],
      virola: [...store.recentColors.virola],
    },
    design: { ...store.design },
    thermo: { ...store.thermo },
    linkDraft: store.linkDraft.map((r) => ({ ...r })),
  };
}
