/* ============================================================================
 * GESTIÓN DE ENLACES — vista global del taller (búsqueda + filtros)
 * ----------------------------------------------------------------------------
 * Módulo PURO: recibe las filas ya resueltas por el server y decide qué se
 * muestra. No toca DB, red ni envs. La página `/enlaces` es la que consulta
 * `links` + `projects` + respuestas con la sesión del dueño.
 *
 * Reglas:
 *   · El estado visible reutiliza `linkEditionState` (R5/R14.10): rechazado >
 *     aprobado > vencido > por vencer > vigente.
 *   · La búsqueda es tolerante a mayúsculas/espacios y cubre linkId, proyecto,
 *     modelo, variante, decisión, observación y fechas.
 *   · El orden por defecto es el más reciente primero.
 * ============================================================================ */

import type { LinkVariantId } from '@/lib/links/payload';
import { formatLinkDate, type LinkDecision } from '@/lib/links/responses';
import { linkEditionState, type LinkEditionState } from '@/lib/links/states';

/** Fila que consume la página de gestión (camelCase, lista para la UI). */
export interface LinkManagementRow {
  linkId: string;
  projectId: string;
  projectTitle: string;
  version: number;
  createdAt: string;
  expiresAt: string;
  approvalsCount: number;
  lastApprovedVariant: string | null;
  decision: LinkDecision | null;
  decisionVariantId: LinkVariantId | null;
  decidedAt: string | null;
  observation: string | null;
  observedAt: string | null;
  /** Label legible del modelo de mate congelado en el payload. */
  mateModel: string | null;
  /** Label de la variante publicada (los links nuevos traen una sola). */
  variantLabel: string | null;
}

export type LinkManagementFilter =
  | 'todos'
  | 'vigente'
  | 'por_vencer'
  | 'vencido'
  | 'aprobado'
  | 'rechazado'
  | 'observacion';

export type LinkManagementSort = 'recientes' | 'vence_pronto' | 'proyecto';

export interface LinkManagementOptions {
  query: string;
  filter: LinkManagementFilter;
  sort: LinkManagementSort;
  nowMs: number;
}

/** Estado del badge de una fila (misma prioridad que el panel del editor). */
export function linkManagementState(
  row: Pick<
    LinkManagementRow,
    'expiresAt' | 'decision' | 'approvalsCount'
  >,
  nowMs: number,
): LinkEditionState {
  const expiresMs = Date.parse(row.expiresAt);
  const approved = row.decision === 'approved' || (!row.decision && row.approvalsCount > 0);
  return linkEditionState(
    {
      expiresAtMs: Number.isFinite(expiresMs) ? expiresMs : 0,
      approved,
      rejected: row.decision === 'rejected',
    },
    nowMs,
  );
}

/** ¿La fila entra con la búsqueda y el filtro actuales? */
export function linkManagementMatches(
  row: LinkManagementRow,
  options: Pick<LinkManagementOptions, 'query' | 'filter' | 'nowMs'>,
): boolean {
  const state = linkManagementState(row, options.nowMs);

  if (options.filter === 'observacion') {
    if (!row.observation) return false;
  } else if (options.filter !== 'todos' && state !== options.filter) {
    return false;
  }

  const query = options.query.trim().toLowerCase();
  if (!query) return true;

  const decisionText =
    row.decision === 'approved'
      ? 'aprobado aprobada'
      : row.decision === 'rejected'
        ? 'rechazado rechazada'
        : 'pendiente sin respuesta';

  const haystack = [
    row.linkId,
    row.projectId,
    row.projectTitle,
    row.mateModel,
    row.variantLabel,
    decisionText,
    row.observation,
    `v${row.version}`,
    `version ${row.version}`,
    formatLinkDate(row.createdAt),
    formatLinkDate(row.expiresAt),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

/** Filtra + ordena sin mutar la lista original (la usa la página cliente). */
export function filterAndSortLinks(
  rows: readonly LinkManagementRow[],
  options: LinkManagementOptions,
): LinkManagementRow[] {
  const result = rows.filter((row) => linkManagementMatches(row, options));

  switch (options.sort) {
    case 'vence_pronto':
      result.sort(
        (a, b) =>
          (Date.parse(a.expiresAt) || 0) - (Date.parse(b.expiresAt) || 0) ||
          a.linkId.localeCompare(b.linkId),
      );
      break;
    case 'proyecto':
      result.sort(
        (a, b) =>
          a.projectTitle.localeCompare(b.projectTitle, 'es') ||
          (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
          a.linkId.localeCompare(b.linkId),
      );
      break;
    default:
      result.sort(
        (a, b) =>
          (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
          a.linkId.localeCompare(b.linkId),
      );
  }

  return result;
}
