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
 * ============================================================================ */

import { create } from 'zustand';
import { DEFAULT_MATE_MODEL, type MateModelId } from '@/lib/catalog';
import { DEFAULT_GUIDES_STATE, type GuidesState } from '@/lib/virola';
import { DEFAULT_EXT_DIAMETER_MM, DEFAULT_INT_DIAMETER_MM } from '@/three/visual-skeleton';
import {
  DEFAULT_METAL_PRESET,
  DEFAULT_BODY_PRESET,
  type MetalPresetId,
  type BodyPresetId,
} from '@/lib/color';

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
  projectId: null,
  dirty: false,
  lastSavedAt: null,
  offlineDraft: false,

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
      projectId,
      dirty: false,
      offlineDraft: false,
    })),

  setMateModel: (id) => set((prev) => ({ ...prev, mateModel: id, dirty: true })),

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
  };
}
