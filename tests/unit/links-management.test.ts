import { describe, expect, it } from 'vitest';
import {
  filterAndSortLinks,
  linkManagementMatches,
  linkManagementState,
  type LinkManagementRow,
} from '@/lib/links/management';

/* =====================================================================
 * Gestión global de enlaces: la vista reutiliza la prioridad de estados
 * R5/R14.10 (rechazado > aprobado > vencido > por vencer > vigente) y
 * suma búsqueda tolerante + orden estable. Módulo PURO: sin DB ni red.
 * ===================================================================== */

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0); // 25-nov-2026 12:00 UTC
const DAY = 86_400_000;

function row(overrides: Partial<LinkManagementRow> = {}): LinkManagementRow {
  return {
    linkId: 'abc123',
    projectId: '11111111-2222-3333-4444-555555555555',
    projectTitle: 'Mate camionero',
    version: 1,
    createdAt: new Date(NOW - DAY).toISOString(),
    expiresAt: new Date(NOW + 10 * DAY).toISOString(),
    approvalsCount: 0,
    lastApprovedVariant: null,
    decision: null,
    decisionVariantId: null,
    decidedAt: null,
    observation: null,
    observedAt: null,
    mateModel: 'Camionero',
    variantLabel: 'Diseño actual',
    ...overrides,
  };
}

describe('linkManagementState (prioridad R5/R14.10)', () => {
  it('rechazado gana sobre aprobado, vencido y aprobaciones legacy', () => {
    expect(
      linkManagementState(
        {
          expiresAt: new Date(NOW - DAY).toISOString(),
          decision: 'rejected',
          approvalsCount: 3,
        },
        NOW,
      ),
    ).toBe('rechazado');
  });

  it('aprobado gana sobre vencido', () => {
    expect(
      linkManagementState(
        {
          expiresAt: new Date(NOW - DAY).toISOString(),
          decision: 'approved',
          approvalsCount: 0,
        },
        NOW,
      ),
    ).toBe('aprobado');
  });

  it('una aprobación legacy sin fila de respuesta cuenta como aprobado', () => {
    expect(
      linkManagementState(
        { expiresAt: new Date(NOW + DAY).toISOString(), decision: null, approvalsCount: 1 },
        NOW,
      ),
    ).toBe('aprobado');
  });

  it('sin decisión: vencido, por vencer (≤5 días) o vigente', () => {
    expect(
      linkManagementState(
        { expiresAt: new Date(NOW - 1).toISOString(), decision: null, approvalsCount: 0 },
        NOW,
      ),
    ).toBe('vencido');
    expect(
      linkManagementState(
        { expiresAt: new Date(NOW + 3 * DAY).toISOString(), decision: null, approvalsCount: 0 },
        NOW,
      ),
    ).toBe('por_vencer');
    expect(
      linkManagementState(
        { expiresAt: new Date(NOW + 10 * DAY).toISOString(), decision: null, approvalsCount: 0 },
        NOW,
      ),
    ).toBe('vigente');
  });

  it('fecha inválida no rompe: se trata como vencida', () => {
    expect(
      linkManagementState(
        { expiresAt: 'no-es-fecha', decision: null, approvalsCount: 0 },
        NOW,
      ),
    ).toBe('vencido');
  });
});

describe('linkManagementMatches (búsqueda + filtros)', () => {
  const base = row();

  it('sin query ni filtro, todo entra', () => {
    expect(linkManagementMatches(base, { query: '', filter: 'todos', nowMs: NOW })).toBe(true);
  });

  it('busca por linkId sin importar mayúsculas ni espacios', () => {
    expect(linkManagementMatches(base, { query: ' ABC123 ', filter: 'todos', nowMs: NOW })).toBe(
      true,
    );
  });

  it('busca por proyecto, modelo, variante y versión', () => {
    for (const query of ['camionero', 'diseño actual', 'v1']) {
      expect(linkManagementMatches(base, { query, filter: 'todos', nowMs: NOW })).toBe(true);
    }
  });

  it('busca por observación y por texto de decisión', () => {
    const rejected = row({
      decision: 'rejected',
      observation: 'Prefiero el grabado más chico',
      observedAt: new Date(NOW).toISOString(),
      decidedAt: new Date(NOW).toISOString(),
    });
    expect(
      linkManagementMatches(rejected, { query: 'grabado más chico', filter: 'todos', nowMs: NOW }),
    ).toBe(true);
    expect(
      linkManagementMatches(rejected, { query: 'rechazado', filter: 'todos', nowMs: NOW }),
    ).toBe(true);
  });

  it('el filtro por estado respeta la prioridad y descarta el resto', () => {
    const expired = row({ expiresAt: new Date(NOW - DAY).toISOString() });
    expect(linkManagementMatches(base, { query: '', filter: 'vigente', nowMs: NOW })).toBe(true);
    expect(linkManagementMatches(expired, { query: '', filter: 'vigente', nowMs: NOW })).toBe(false);
    expect(linkManagementMatches(expired, { query: '', filter: 'vencido', nowMs: NOW })).toBe(true);
  });

  it('el filtro "observacion" solo muestra filas con texto', () => {
    const withObservation = row({
      observation: 'Cambiar el color',
      observedAt: new Date(NOW).toISOString(),
    });
    expect(
      linkManagementMatches(withObservation, { query: '', filter: 'observacion', nowMs: NOW }),
    ).toBe(true);
    expect(linkManagementMatches(base, { query: '', filter: 'observacion', nowMs: NOW })).toBe(
      false,
    );
  });
});

describe('filterAndSortLinks (orden estable, sin mutar)', () => {
  const newest = row({
    linkId: 'newest',
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 30 * DAY).toISOString(),
    projectTitle: 'Zeta',
  });
  const oldest = row({
    linkId: 'oldest',
    createdAt: new Date(NOW - 10 * DAY).toISOString(),
    expiresAt: new Date(NOW + 2 * DAY).toISOString(),
    projectTitle: 'Alfa',
  });
  const middle = row({
    linkId: 'middle',
    createdAt: new Date(NOW - 5 * DAY).toISOString(),
    expiresAt: new Date(NOW + 20 * DAY).toISOString(),
    projectTitle: 'Beta',
  });
  const source = [oldest, newest, middle];

  it('ordena por más reciente por defecto', () => {
    const result = filterAndSortLinks(source, {
      query: '',
      filter: 'todos',
      sort: 'recientes',
      nowMs: NOW,
    });
    expect(result.map((r) => r.linkId)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('ordena por vencimiento más próximo', () => {
    const result = filterAndSortLinks(source, {
      query: '',
      filter: 'todos',
      sort: 'vence_pronto',
      nowMs: NOW,
    });
    expect(result.map((r) => r.linkId)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('ordena por proyecto (locale es) y desempata por fecha', () => {
    const result = filterAndSortLinks(source, {
      query: '',
      filter: 'todos',
      sort: 'proyecto',
      nowMs: NOW,
    });
    expect(result.map((r) => r.projectTitle)).toEqual(['Alfa', 'Beta', 'Zeta']);
  });

  it('no muta el arreglo original', () => {
    const before = source.map((r) => r.linkId);
    filterAndSortLinks(source, {
      query: '',
      filter: 'todos',
      sort: 'proyecto',
      nowMs: NOW,
    });
    expect(source.map((r) => r.linkId)).toEqual(before);
  });
});
