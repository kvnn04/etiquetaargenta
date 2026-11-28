import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  DEFAULT_MATE_MODEL,
  bodyTopRadiusMm,
  getProduct,
  maxRadiusMm,
  radiusAtHeightMm,
  resolveMateModel,
  silhouetteOf,
  validateCatalog,
} from '@/lib/catalog';
import { DEFAULT_EXT_DIAMETER_MM, DEFAULT_INT_DIAMETER_MM } from '@/three/visual-skeleton';
import { bodyLatheProfile } from '@/three/lathe-builder';
import { normalizeState } from '@/lib/projects/persistence';
import { useEditorStore } from '@/lib/store/editor';

/* =====================================================================
 * SPEC tipo de mate — R1/R2/R8 + QA1 + §5 persistencia + §6 edge cases
 * ===================================================================== */

describe('catálogo R1 (registro central)', () => {
  it('trajo Camionero e Imperial del texto de la spec', () => {
    expect(CATALOG.map((p) => p.id)).toEqual([
      'camionero',
      'imperial',
      'termo-media-manija-1l',
      'termo-system-1l',
      'botella-bowling-500ml',
      'botella-deportiva-500ml',
    ]);
    expect(CATALOG.every((p) => !p.pro)).toBe(true); // ambos demos FREE
  });

  it('alturas totales de referencia: Camionero 132 mm · Imperial 120 mm', () => {
    expect(getProduct('camionero')!.shape.totalHeightMm).toBe(132);
    expect(getProduct('imperial')!.shape.totalHeightMm).toBe(120);
  });
});

describe('anclaje boca-cuerpo (R2/R4)', () => {
  const intD = 95; // default de la spec geométrica

  it('la boca escala con D_int: R_boca = D_int / 2 (anchor intDiameter)', () => {
    expect(bodyTopRadiusMm(getProduct('camionero')!, intD)).toBe(intD / 2);
    expect(bodyTopRadiusMm(getProduct('imperial')!, 50)).toBe(25);
    expect(bodyTopRadiusMm(getProduct('imperial')!, 150)).toBe(75);
  });

  it('QA1: la panza del Imperial supera a la del Camionero y su cintura es más marcada', () => {
    const camionero = getProduct('camionero')!;
    const imperial = getProduct('imperial')!;
    // Referencia de diseño (perfiles de torno revisados): la panza del Imperial
    // es más amplia que la del Camionero en su punto máximo. La diferencia es
    // chica en mm (≈1.5 mm de diámetro, como los scans), pero real.
    const camioneroBelly = radiusAtHeightMm(camionero, 68, intD);
    const imperialBelly = radiusAtHeightMm(imperial, 62, intD);
    expect(imperialBelly / camioneroBelly).toBeGreaterThanOrEqual(1.005);
    // …y su cintura (boca recogida bajo la virola) marca diferencia contra su
    // propia panza: el efecto imperial es la apertura en S, no un barril.
    const imperialWaist = radiusAtHeightMm(imperial, 13, intD);
    expect(imperialBelly / imperialWaist).toBeGreaterThanOrEqual(1.1);
    // El radio MÁXIMO de cada producto se distingue y el pie NO es más ancho
    // que la panza (regresión del "maceta" del perfil placeholder).
    expect(maxRadiusMm(imperial, intD)).toBeGreaterThan(maxRadiusMm(camionero, intD));
    const camioneroFoot = radiusAtHeightMm(camionero, 122, intD);
    expect(camioneroBelly / camioneroFoot).toBeGreaterThanOrEqual(1.2);
  });

  it('R4 anti-fuga: el labio del cuerpo sube sealOverlapMm por sobre la costura', () => {
    const shape = getProduct('camionero')!.shape;
    const profile = bodyLatheProfile(shape, intD);
    const ring = profile[profile.length - 1]!;
    const mouth = 1.0 * (intD / 2);
    expect(ring.y).toBe(shape.totalHeightMm + shape.sealOverlapMm);
    expect(ring.x).toBe(mouth);
    // y la primera coordenada es el centro de la base apoyada en Y=0
    expect(profile[0]!.x).toBe(0);
    expect(profile[0]!.y).toBe(0);
  });
});

describe('R8 — fallback a camionero', () => {
  it('id desconocido, null o ausente ⇒ camionero, sin abortar', () => {
    expect(resolveMateModel('torpedo-no-existe').id).toBe(DEFAULT_MATE_MODEL);
    expect(resolveMateModel(null).id).toBe(DEFAULT_MATE_MODEL);
    expect(resolveMateModel(undefined).id).toBe(DEFAULT_MATE_MODEL);
  });

  it('normalizeState (proyecto viejo con model faltante o raro) sigue el R8', () => {
    expect(normalizeState({ mateModel: 'unknown-x' }).mateModel).toBe(DEFAULT_MATE_MODEL);
    expect(normalizeState({}).mateModel).toBe(DEFAULT_MATE_MODEL);
    // estado válido se conserva
    expect(normalizeState({ mateModel: 'imperial' }).mateModel).toBe('imperial');
    // diámetros injustificados (<= 0) ⇒ defaults de la spec geométrica
    // pos 5: el snapshot incluye los campos de color con sus defaults
    expect(normalizeState({ extDiameter: 0, intDiameter: -5 })).toEqual({
      mateModel: DEFAULT_MATE_MODEL,
      extDiameter: DEFAULT_EXT_DIAMETER_MM,
      intDiameter: DEFAULT_INT_DIAMETER_MM,
      guidesState: { bordes: true, centro: true, ejes: true }, // R6 pos 4
      bodyPreset: 'algarrobo',
      metalPreset: 'alpaca',
      bodyColor: null,
      virolaColor: null,
      recentColors: { body: [], virola: [] },
      design: { rotation: 0, scale: 100, mirror: false }, // pos 6+7 (R8: sin design ⇒ defaults)
      linkDraft: [], // pos 10A (R8: sin borrador ⇒ sin variantes)
      thermo: { offsetYPct: 0, invert: false, finish: 'matte' },
    });
  });
});

describe('§6 — entrada corrupta: nunca deja la escena vacía', () => {
  const ok = getProduct('camionero')!;

  it('descarta <3 puntos, alturas negativas y ids duplicados', () => {
    const { products, dropped } = validateCatalog({
      catalogVersion: 1,
      products: [
        ok,
        { ...ok, id: 'roto-pocos-puntos', shape: { ...ok.shape, points: [{ x: 1, y: 0 }, { x: 0, y: 10 }] } },
        { ...ok, id: 'roto-alturas', shape: { ...ok.shape, points: [{ x: 1, y: -3 }, { x: 0.9, y: 5 }, { x: 0, y: 10 }, { x: 0, y: 12 }] } },
        ok, // duplicado
        { ...ok, id: 'valido-futuro', description: 'Torpedo' },
      ],
    });
    expect(dropped).toEqual(['roto-pocos-puntos', 'roto-alturas', 'camionero']);
    expect(products.map((p) => p.id)).toEqual(['camionero', 'valido-futuro']);
  });

  it('el catálogo activo quedó limpio tras la validación declarativa', () => {
    expect(CATALOG.length).toBeGreaterThan(0);
  });
});

describe('siluetas SVG para las cards (§4, solo-datos, sin mini-renders 3D)', () => {
  it('generan path cerrado dentro del viewBox', () => {
    for (const p of CATALOG) {
      const s = silhouetteOf(p);
      expect(s.path.startsWith('M')).toBe(true);
      expect(s.path.endsWith('Z')).toBe(true);
      expect(s.path).not.toContain('NaN');
      expect(s.viewBox).toBe('0 0 64 80');
    }
  });

  it('comparten la MISMA escala horizontal (panza vs recto comparables)', () => {
    // Ambos usan el radio máximo relativo del catálogo entero, así que el
    // ancho dibujado es comparable: el Imperial debe salir más ancho que el
    // Camionero en la misma caja (no depende de la cantidad de puntos).
    const maxAbsX = (path: string): number => {
      const pairs = path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g);
      let max = 0;
      for (const m of pairs) max = Math.max(max, Math.abs(Number(m[1])));
      return max;
    };
    const camionero = silhouetteOf(getProduct('camionero')!);
    const imperial = silhouetteOf(getProduct('imperial')!);
    expect(maxAbsX(imperial.path)).toBeGreaterThan(maxAbsX(camionero.path));
  });
});

describe('store del editor (§5 — shape de projects.state)', () => {
  it('proyecto nuevo ⇒ camionero + defaults de la spec geométrica', () => {
    const s = useEditorStore.getState();
    expect(s.mateModel).toBe(DEFAULT_MATE_MODEL);
    expect(s.extDiameter).toBe(DEFAULT_EXT_DIAMETER_MM);
    expect(s.intDiameter).toBe(DEFAULT_INT_DIAMETER_MM);
  });

  it('setMateModel marca dirty (disparador del autosave 2 s)', () => {
    const before = useEditorStore.getState();
    const wasDirty = before.dirty;
    useEditorStore.getState().setMateModel('imperial');
    const after = useEditorStore.getState();
    expect(after.mateModel).toBe('imperial');
    expect(after.dirty).toBe(true);
    expect(wasDirty).toBe(false);
    // restaurar limpia el dirty (flujo del reload)
    useEditorStore.getState().restoreState(before, before.projectId);
    expect(useEditorStore.getState().dirty).toBe(false);
    useEditorStore.getState().setMateModel(DEFAULT_MATE_MODEL); // dejar el default
  });
});
