/* ============================================================================
 * PERSISTENCIA DEL PROYECTO — spec_tipo_de_mate.md §5 (+ §6 offline)
 * ----------------------------------------------------------------------------
 * `projects.state` (jsonb, RLS own_projects — tabla de 0001):
 *   · restore: el proyecto con `updated_at` más reciente (last-write-wins).
 *   · autosave: upsert idempotente con debounce 2 s (el debounce vive en
 *     use-autosave.ts; acá solo el upsert).
 *   · corte de red: borrador local en localStorage con timestamp (sin cifrar:
 *     es la propia copia del estado, spec §6 banner "quedó en este
 *     dispositivo") y sincroniza al reconectar con backoff exponencial.
 * ============================================================================ */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditorStateSnapshot } from '@/lib/store/editor';
import { resolveMateModel, DEFAULT_MATE_MODEL, type MateModelId } from '@/lib/catalog';
import { DEFAULT_GUIDES_STATE, normalizeGuidesState, reconcileDiameters } from '@/lib/virola';
import { DEFAULT_EXT_DIAMETER_MM, DEFAULT_INT_DIAMETER_MM } from '@/three/visual-skeleton';
import {
  DEFAULT_METAL_PRESET,
  DEFAULT_BODY_PRESET,
  type MetalPresetId,
  type BodyPresetId,
} from '@/lib/color';
import { normalizeDesignState } from '@/lib/design';
import type { DesignSourceRef } from '@/lib/design';
import { normalizeVariantRows } from '@/lib/links/payload';

const DRAFT_KEY = 'mocap:project-draft';
/** DEV ONLY: draft aislado del bypass — al reactivar el auth no se mezcla
 * con el borrador real ni pisa el proyecto de Supabase (last-write-wins). */
export const DEV_DRAFT_KEY = 'mocap:project-draft-dev';

export interface LoadedProject {
  projectId: string | null;
  updatedAt: string | null;
  state: EditorStateSnapshot;
}

/** Proyecto ya resuelto SERVER-SIDE para el primer render del editor. */
export interface InitialProject {
  projectId: string;
  updatedAt: string;
  state: EditorStateSnapshot;
  /** Original persistido en `designs` (URL firmada) o null si no hay. */
  design: DesignSourceRef | null;
}

/** UUID canónico (projects.id) — un `?project=` inválido no toca la DB. */
export function isProjectId(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  );
}

/**
 * ¿El borrador local pisa el estado del server?
 * Regla estricta por proyecto: el draft SOLO aplica si pertenece al MISMO
 * proyecto y es más nuevo (last-write-wins §6). Un draft legacy sin
 * `projectId` no se aplica sobre un proyecto del server: mezclar estados de
 * proyectos distintos sería peor que perder ese borrador de borde.
 * Sin proyecto server (proyecto nuevo), solo aplica un draft también sin id.
 */
export function draftApplies(
  draft: LocalDraft | null,
  server: { projectId: string; updatedAt: string } | null,
): draft is LocalDraft {
  if (!draft) return false;
  if (server) {
    if (draft.projectId !== server.projectId) return false;
    const draftMs = Date.parse(draft.updatedAt);
    const serverMs = Date.parse(server.updatedAt);
    return !Number.isNaN(draftMs) && (Number.isNaN(serverMs) || draftMs > serverMs);
  }
  return draft.projectId === null;
}

/** Estado por defecto de proyecto nuevo (producto default = R1: Camionero). */
export function defaultSnapshot(): EditorStateSnapshot {
  return {
    mateModel: DEFAULT_MATE_MODEL,
    extDiameter: DEFAULT_EXT_DIAMETER_MM,
    intDiameter: DEFAULT_INT_DIAMETER_MM,
    guidesState: { ...DEFAULT_GUIDES_STATE },
    bodyPreset: DEFAULT_BODY_PRESET,
    metalPreset: DEFAULT_METAL_PRESET,
    bodyColor: null,
    virolaColor: null,
    recentColors: { body: [], virola: [] },
    // pos 6 (R8) + pos 7 (R8): sin design en el jsonb ⇒ 0° / 100% / espejo OFF
    design: { rotation: 0, scale: 100, mirror: false },
    // pos 10A: sin linkDraft en el jsonb ⇒ sin filas de variantes (borrador vacío)
    linkDraft: [],
  };
}

/** Normaliza un jsonb del backend: claves faltantes ⇒ defaults; id raro ⇒ R8. */
export function normalizeState(raw: unknown): EditorStateSnapshot {
  const base = defaultSnapshot();
  if (typeof raw !== 'object' || raw === null) return base;
  const s = raw as Partial<EditorStateSnapshot>;
  const model = typeof s.mateModel === 'string' ? s.mateModel : null;
  // Pos 4 (R1): diámetros con medidas imposibles ⇒ defaults; luego el régene
  // único acota el par al dominio válido (chapa ≥ 4 mm) — jamás propaga basura.
  const extRaw = typeof s.extDiameter === 'number' && s.extDiameter > 0 ? s.extDiameter : base.extDiameter;
  const intRaw = typeof s.intDiameter === 'number' && s.intDiameter > 0 ? s.intDiameter : base.intDiameter;
  const reconciled = reconcileDiameters({ extDiameter: extRaw, intDiameter: intRaw });

  // Pos 5: validación de bodyPreset
  const VALID_BODY_PRESETS: BodyPresetId[] = ['algarrobo', 'calabaza', 'cuero_negro'];
  const bodyPreset: BodyPresetId =
    typeof s.bodyPreset === 'string' && VALID_BODY_PRESETS.includes(s.bodyPreset as BodyPresetId)
      ? (s.bodyPreset as BodyPresetId)
      : DEFAULT_BODY_PRESET;

  // Pos 5: validación de metalPreset
  const VALID_METAL_PRESETS: MetalPresetId[] = ['alpaca', 'acero', 'bronce'];
  const metalPreset: MetalPresetId =
    typeof s.metalPreset === 'string' && VALID_METAL_PRESETS.includes(s.metalPreset as MetalPresetId)
      ? (s.metalPreset as MetalPresetId)
      : DEFAULT_METAL_PRESET;

  // Pos 5: bodyColor — conservar si es string que empiece por '#', sino null
  const bodyColor: string | null =
    typeof s.bodyColor === 'string' && s.bodyColor.startsWith('#') ? s.bodyColor : null;

  // Pos 5: virolaColor — conservar si es string que empiece por '#', sino null
  // R6 legado: si virolaColor es null pero existe topFaceColor válido, usarlo
  let virolaColor: string | null =
    typeof s.virolaColor === 'string' && s.virolaColor.startsWith('#') ? s.virolaColor : null;
  if (virolaColor === null) {
    const legacy = (raw as Record<string, unknown>).topFaceColor;
    if (typeof legacy === 'string' && legacy.startsWith('#')) {
      virolaColor = legacy;
    }
  }

  // Pos 5: recentColors — conservar si es objeto con arrays válidos, sino vacío
  const rawRecent = s.recentColors;
  const recentColors: { body: string[]; virola: string[] } =
    rawRecent !== null &&
    typeof rawRecent === 'object' &&
    Array.isArray((rawRecent as { body?: unknown }).body) &&
    Array.isArray((rawRecent as { virola?: unknown }).virola)
      ? {
          body: (rawRecent as { body: unknown[] }).body.filter((c): c is string => typeof c === 'string'),
          virola: (rawRecent as { virola: unknown[] }).virola.filter((c): c is string => typeof c === 'string'),
        }
      : { body: [], virola: [] };

  // Pos 6 + 7: design.rotation/scale/mirror — rotación a la R3 (módulo 360°,
  // 0.5°), escala R8 de spec_escala ([70,110] paso 0.5%) y espejo bool; el
  // normalizador tolerante aplica defaults contractuales a los faltantes.
  const design = normalizeDesignState((raw as Record<string, unknown>).design);

  // Pos 10A: linkDraft (variantes del Enlace) — tolerante: ≤3 filas A–C,
  // ids únicos, labels ≤40 con truncado, escala/rotación canónicas.
  const linkDraft = normalizeVariantRows((raw as Record<string, unknown>).linkDraft);

  return {
    mateModel: resolveMateModel(model)?.id ?? base.mateModel as MateModelId,
    extDiameter: reconciled.extDiameter,
    intDiameter: reconciled.intDiameter,
    guidesState: normalizeGuidesState(s.guidesState), // R6: triada de guías (default true×3)
    bodyPreset,
    metalPreset,
    bodyColor,
    virolaColor,
    recentColors,
    design, // pos 6
    linkDraft, // pos 10A
  };
}

/** Levanta el proyecto más reciente del taller (RLS filtra por auth.uid). */
export async function loadLatestProject(supabase: SupabaseClient): Promise<LoadedProject | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, state, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    // Un fallo de API no bloquea la edición (§6): la escena opera offline.
    console.error('[projects] load:', error.message);
    return null;
  }
  const row = data?.[0];
  if (!row) return null;
  return { projectId: row.id as string, updatedAt: row.updated_at as string, state: normalizeState(row.state) };
}

/**
 * Upsert idempotente por (user_id, id): update si hay id, insert si no.
 * RLS own_projects lo cubre; el trigger projects_touch_updated setea updated_at.
 */
export async function saveProjectState(
  supabase: SupabaseClient,
  projectId: string | null,
  state: EditorStateSnapshot,
): Promise<{ ok: true; id: string; at: string } | { ok: false }> {
  try {
    if (projectId) {
      const { error } = await supabase.from('projects').update({ state }).eq('id', projectId);
      if (error) throw new Error(error.message);
      return { ok: true, id: projectId, at: new Date().toISOString() };
    }
    const { data, error } = await supabase
      .from('projects')
      .insert({ state })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: data.id as string, at: new Date().toISOString() };
  } catch (err) {
    console.error('[projects] save:', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Borrador local (§6: corte de internet durante el autosave)                  */
/* -------------------------------------------------------------------------- */

export interface LocalDraft {
  state: EditorStateSnapshot;
  updatedAt: string;
  /** Proyecto al que pertenece el snapshot; null en proyectos nuevos/bypass. */
  projectId: string | null;
}

export function saveLocalDraft(
  state: EditorStateSnapshot,
  key: string = DRAFT_KEY,
  projectId: string | null = null,
): void {
  try {
    const draft: LocalDraft = {
      state,
      updatedAt: new Date().toISOString(),
      projectId,
    };
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Sin storage (modo privado): se pierde el draft, la edición sigue.
  }
}

export function loadLocalDraft(key: string = DRAFT_KEY): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraft>;
    if (!parsed?.state || !parsed?.updatedAt) return null;
    return {
      state: normalizeState(parsed.state),
      updatedAt: parsed.updatedAt,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
    };
  } catch {
    return null;
  }
}

export function clearLocalDraft(key: string = DRAFT_KEY): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
