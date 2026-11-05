/* ============================================================================
 * ESTADO DEL EDITOR — spec_tipo_de_mate.md §5 (shape de `projects.state`)
 * ----------------------------------------------------------------------------
 * MateStore (zustand): las posiciones 3–7 agregan SUS claves acá conforme
 * llegan (diámetros editables en 4, material en 5, diseño en 6, escala y
 * variantes en 7). La persistencia serializa TODO lo definido acá.
 *
 * claves pos 3:
 *   mateModel    id del catálogo (R7: el payload comercial lo consume).
 *   extDiameter  mm de la virola (defaults de la spec geométrica; la edición
 *   intDiameter  de estos sigue en la posición "Medidas" — pos 4).
 * ============================================================================ */

import { create } from 'zustand';
import { DEFAULT_MATE_MODEL, type MateModelId } from '@/lib/catalog';
import { DEFAULT_EXT_DIAMETER_MM, DEFAULT_INT_DIAMETER_MM } from '@/three/visual-skeleton';

export interface EditorStateSnapshot {
  mateModel: MateModelId;
  extDiameter: number;
  intDiameter: number;
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
  projectId: null,
  dirty: false,
  lastSavedAt: null,
  offlineDraft: false,

  restoreState: (s, projectId) =>
    set((prev) => ({
      ...prev,
      ...s,
      projectId,
      dirty: false,
      offlineDraft: false,
    })),

  setMateModel: (id) => set((prev) => ({ ...prev, mateModel: id, dirty: true })),

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
  };
}
