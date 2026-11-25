import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  defaultSnapshot,
  draftApplies,
  isProjectId,
  type LocalDraft,
} from '@/lib/projects/persistence';
import { loadProjectDesignSource } from '@/lib/projects/design-source';

/* =====================================================================
 * Acceso a proyectos desde «Mis enlaces»:
 *   · ?project= solo acepta UUID (nunca toca la DB con basura);
 *   · el draft local jamás se mezcla entre proyectos distintos;
 *   · el diseño persistido se firma SOLO para el proyecto del dueño.
 * ===================================================================== */

const PROJECT_A = '0b41da31-968b-47ac-b090-f2df933ab7f5';
const PROJECT_B = 'dea78811-7b1f-4228-a38b-9e0009c444bf';

function draft(overrides: Partial<LocalDraft> = {}): LocalDraft {
  return {
    state: defaultSnapshot(),
    updatedAt: '2026-11-25T12:00:00.000Z',
    projectId: PROJECT_A,
    ...overrides,
  };
}

describe('isProjectId', () => {
  it('acepta UUIDs canónicos', () => {
    expect(isProjectId(PROJECT_A)).toBe(true);
    expect(isProjectId(PROJECT_A.toUpperCase())).toBe(true);
  });

  it('rechaza basura, arrays y SQL/path injection', () => {
    for (const raw of ['', 'abc', '1; drop table projects', `${PROJECT_A}/x`, [PROJECT_A], null]) {
      expect(isProjectId(raw)).toBe(false);
    }
  });
});

describe('draftApplies (aislamiento por proyecto)', () => {
  it('aplica solo el draft del MISMO proyecto y más nuevo', () => {
    expect(
      draftApplies(draft(), { projectId: PROJECT_A, updatedAt: '2026-11-25T11:00:00.000Z' }),
    ).toBe(true);
  });

  it('descarta un draft más viejo o igual al server', () => {
    const server = { projectId: PROJECT_A, updatedAt: '2026-11-25T12:00:00.000Z' };
    expect(draftApplies(draft(), server)).toBe(false);
    expect(
      draftApplies(draft({ updatedAt: '2026-11-25T11:59:59.000Z' }), server),
    ).toBe(false);
  });

  it('NUNCA aplica el draft de otro proyecto, aunque sea más nuevo', () => {
    expect(
      draftApplies(draft({ projectId: PROJECT_B }), {
        projectId: PROJECT_A,
        updatedAt: '2026-11-20T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('un draft legacy sin projectId no pisa un proyecto del server', () => {
    expect(
      draftApplies(draft({ projectId: null }), {
        projectId: PROJECT_A,
        updatedAt: '2026-11-20T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('sin proyecto server solo aplica el draft de proyecto nuevo (sin id)', () => {
    expect(draftApplies(draft({ projectId: null }), null)).toBe(true);
    expect(draftApplies(draft({ projectId: PROJECT_A }), null)).toBe(false);
  });

  it('fechas inválidas no rompen: no aplica', () => {
    expect(
      draftApplies(draft({ updatedAt: 'no-es-fecha' }), {
        projectId: PROJECT_A,
        updatedAt: '2026-11-20T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});

function fakeService(
  entries: Array<{ name: string; updated_at?: string }>,
  options?: {
    listError?: string;
    signError?: string;
    owned?: boolean;
    ownershipError?: string;
  },
): { service: SupabaseClient; sign: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> } {
  const sign = vi.fn(async (path: string, ttl: number) => {
    if (options?.signError) return { data: null, error: { message: options.signError } };
    return { data: { signedUrl: `https://storage.test/${path}?ttl=${ttl}` }, error: null };
  });
  const list = vi.fn(async () =>
    options?.listError
      ? { data: null, error: { message: options.listError } }
      : { data: entries, error: null },
  );
  const service = {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          options?.ownershipError
            ? { data: null, error: { message: options.ownershipError } }
            : {
                data: options?.owned === false ? null : { id: PROJECT_A },
                error: null,
              },
      };
      return builder;
    },
    storage: {
      from: () => ({
        list,
        createSignedUrl: sign,
      }),
    },
  } as unknown as SupabaseClient;
  return { service, sign, list };
}

describe('loadProjectDesignSource', () => {
  it('elige el archivo del proyecto pedido y firma SOLO ese path', async () => {
    const { service, sign } = fakeService([
      { name: `${PROJECT_B}.png`, updated_at: '2026-11-25T10:00:00.000Z' },
      { name: `${PROJECT_A}.png`, updated_at: '2026-11-25T11:00:00.000Z' },
    ]);

    const result = await loadProjectDesignSource(service, {
      userId: 'user-1',
      projectId: PROJECT_A,
      baseSideMm: 123,
      name: 'Mi grabado',
    });

    expect(result).toEqual({
      url: `https://storage.test/user-1/${PROJECT_A}.png?ttl=600`,
      name: 'Mi grabado',
      kind: 'png',
      baseSideMm: 123,
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(`user-1/${PROJECT_A}.png`, 600);
  });

  it('si hay restos de varios mime, gana el más reciente', async () => {
    const { service } = fakeService([
      { name: `${PROJECT_A}.svg`, updated_at: '2026-11-20T00:00:00.000Z' },
      { name: `${PROJECT_A}.png`, updated_at: '2026-11-25T00:00:00.000Z' },
    ]);
    const result = await loadProjectDesignSource(service, {
      userId: 'user-1',
      projectId: PROJECT_A,
      baseSideMm: 123,
    });
    expect(result?.kind).toBe('png');
    expect(result?.name).toBe('Diseño guardado');
  });

  it('sin archivo del proyecto ⇒ null (fail-soft, el editor abre igual)', async () => {
    const { service, sign } = fakeService([
      { name: `${PROJECT_B}.png`, updated_at: '2026-11-25T00:00:00.000Z' },
    ]);
    const result = await loadProjectDesignSource(service, {
      userId: 'user-1',
      projectId: PROJECT_A,
      baseSideMm: 123,
    });
    expect(result).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('proyecto ajeno ⇒ null y NO toca Storage (doble verificación de dueño)', async () => {
    const { service, sign, list } = fakeService([{ name: `${PROJECT_A}.png` }], {
      owned: false,
    });
    const result = await loadProjectDesignSource(service, {
      userId: 'otro-user',
      projectId: PROJECT_A,
      baseSideMm: 123,
    });
    expect(result).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('error al verificar dueño ⇒ null sin firmar nada', async () => {
    const { service, sign } = fakeService([{ name: `${PROJECT_A}.png` }], {
      ownershipError: 'boom',
    });
    expect(
      await loadProjectDesignSource(service, {
        userId: 'user-1',
        projectId: PROJECT_A,
        baseSideMm: 123,
      }),
    ).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('errores de Storage/firma ⇒ null sin tirar el render', async () => {
    const listFail = fakeService([], { listError: 'boom' });
    expect(
      await loadProjectDesignSource(listFail.service, {
        userId: 'user-1',
        projectId: PROJECT_A,
        baseSideMm: 123,
      }),
    ).toBeNull();

    const signFail = fakeService([{ name: `${PROJECT_A}.png` }], { signError: 'boom' });
    expect(
      await loadProjectDesignSource(signFail.service, {
        userId: 'user-1',
        projectId: PROJECT_A,
        baseSideMm: 123,
      }),
    ).toBeNull();
  });
});
