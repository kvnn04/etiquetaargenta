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

const DRAFT_KEY = 'mocap:project-draft';

export interface LoadedProject {
  projectId: string | null;
  updatedAt: string | null;
  state: EditorStateSnapshot;
}

/** Estado por defecto de proyecto nuevo (producto default = R1: Camionero). */
export function defaultSnapshot(): EditorStateSnapshot {
  return {
    mateModel: DEFAULT_MATE_MODEL,
    extDiameter: DEFAULT_EXT_DIAMETER_MM,
    intDiameter: DEFAULT_INT_DIAMETER_MM,
    guidesState: { ...DEFAULT_GUIDES_STATE },
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
  return {
    mateModel: resolveMateModel(model)?.id ?? base.mateModel as MateModelId,
    extDiameter: reconciled.extDiameter,
    intDiameter: reconciled.intDiameter,
    guidesState: normalizeGuidesState(s.guidesState), // R6: triada de guías (default true×3)
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

interface LocalDraft {
  state: EditorStateSnapshot;
  updatedAt: string;
}

export function saveLocalDraft(state: EditorStateSnapshot): void {
  try {
    const draft: LocalDraft = { state, updatedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Sin storage (modo privado): se pierde el draft, la edición sigue.
  }
}

export function loadLocalDraft(): LocalDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraft;
    if (!parsed?.state || !parsed?.updatedAt) return null;
    return { state: normalizeState(parsed.state), updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

export function clearLocalDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* noop */
  }
}
