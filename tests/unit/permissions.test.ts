import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_LABELS,
  FREE_CAPABILITIES,
  gate,
  isLockedFor,
  type Capability,
  type PlanOrNull,
} from '@/lib/permissions';

/** Donde vive esta regla (README §5: se cita, nunca se duplica). */
const SPEC_SOURCE = 'spec_autenticacion_y_modelo_freemium.md §3-R2';
const ALL: Capability[] = [...(Object.keys(CAPABILITY_LABELS) as Capability[])];

const PLANS: PlanOrNull[] = [null, 'free', 'pro', 'pro_grace'];

describe(`Matriz R2 (${SPEC_SOURCE})`, () => {
  it('los conjuntos FREE/PRO no se superponen y cubren todas las capacidades', () => {
    const free = new Set<string>(FREE_CAPABILITIES as readonly string[]);
    for (const cap of ALL) {
      if (free.has(cap)) {
        expect(gate(cap, 'free')).toBe(true);
      } else {
        expect(gate(cap, 'free')).toBe(false);
      }
    }
  });

  it('todo el editor es FREE (columna FREE ✔ de la matriz)', () => {
    for (const cap of FREE_CAPABILITIES) {
      expect(gate(cap, 'free')).toBe(true);
    }
  });

  it('las 5 capacidades PRO están bloqueadas en FREE (con candado decorativo)', () => {
    const proCaps = ALL.filter((cap) => !(FREE_CAPABILITIES as readonly string[]).includes(cap));
    expect(proCaps).toHaveLength(5);
    for (const cap of proCaps) {
      expect(gate(cap, 'free')).toBe(false);
      expect(isLockedFor(cap, 'free')).toBe(true);
    }
  });

  it('PRO y PRO_GRACE tienen la matriz completa (R7: la gracia conserva acceso)', () => {
    for (const cap of ALL) {
      expect(gate(cap, 'pro')).toBe(true);
      expect(gate(cap, 'pro_grace')).toBe(true);
    }
  });

  it('visitante (plan null) no obtiene nada: redirect al overlay', () => {
    for (const cap of ALL) {
      expect(gate(cap, null)).toBe(false);
    }
  });

  it('los candados 🔒 decoran solo capacidades PRO (client solo decora)', () => {
    for (const cap of FREE_CAPABILITIES) {
      expect(isLockedFor(cap, 'free')).toBe(false);
      expect(isLockedFor(cap, 'pro')).toBe(false);
    }
  });

  it('toda capacidad tiene label es para la UI', () => {
    for (const cap of ALL) {
      expect(CAPABILITY_LABELS[cap]).toBeTruthy();
    }
  });

  it('el catálogo de planes es exacto (respeta el check de la migración)', () => {
    for (const plan of PLANS) {
      if (plan === null) continue;
      expect(['free', 'pro', 'pro_grace']).toContain(plan);
    }
  });
});
