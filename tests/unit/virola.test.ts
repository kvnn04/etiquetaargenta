import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  EDITOR_AUTO_SPIN_RPM,
  CLIENT_MODE_AUTO_SPIN_RPM,
  DEFAULT_GUIDES_STATE,
  extDiameterMinMm,
  extRangeFor,
  intDiameterMaxMm,
  intRangeFor,
  normalizeGuidesState,
  parseDiameterText,
  reconcileDiameters,
  rpmToRadPerSec,
  snapToStepMm,
  virolaMetrics,
  GUIDE_COLORS,
} from '@/lib/virola';
import { onVirolaDimensionsChanged, runDimensionsCascade } from '@/lib/virola/cascade';
import {
  BORDES_DASH_MM,
  CENTRO_DASH_MM,
  guideRadialAxisPoints,
  guideRadialAxisTicks,
  guideCirclePoints,
} from '@/three/guides';
import {
  buildVirolaTopGeometry,
  buildVirolaOuterWallGeometry,
  buildVirolaInnerWallGeometry,
} from '@/three/lathe-builder';
import { defaultSnapshot, normalizeState } from '@/lib/projects/persistence';
import { useEditorStore } from '@/lib/store/editor';

/* =====================================================================
 * SPEC tecncnica geométrica (posición 4) — R1/R2/R3/R5/R6/R7 + QA1/QA2
 * ===================================================================== */

beforeEach(() => {
  useEditorStore.getState().restoreState(defaultSnapshot(), null);
});

/* ------------------------------------------------------------------ */
/* R1 — restricciones duras + rangos dinámicos                        */
/* ------------------------------------------------------------------ */

describe('R1 — regla dura de chapa y rangos dinámicos', () => {
  it('Dint^max = min(150, Dext − 8): QA1 con Dext=123 ⇒ límite real 115.0 (W=4.0)', () => {
    expect(intDiameterMaxMm(123)).toBe(115);
    expect(intRangeFor(123)).toEqual({ min: 50, max: 115 });
  });

  it('Dext^min = max(70, Dint + 8): con Dint=150 ⇒ 158.0 (§6)', () => {
    expect(extDiameterMinMm(150)).toBe(158);
    expect(extRangeFor(150)).toEqual({ min: 158, max: 180 });
  });

  it('§6: Dext=70 ⇒ Dint se limita a ≤ 62.0 (rango re-mapeado, sin puntos muertos)', () => {
    expect(intRangeFor(70)).toEqual({ min: 50, max: 62 });
  });

  it('los rangos re-mapeados nunca se invierten (todo Dext ejecutable tiene carril)', () => {
    for (let ext = 70; ext <= 180; ext += 0.5) {
      const r = intRangeFor(ext);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
    for (let int = 50; int <= 150; int += 0.5) {
      const r = extRangeFor(int);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
  });
});

describe('R1 — régene único de clamps (reconcileDiameters)', () => {
  it('QA1: intentar Dint=150 con Dext=123 se ACOTA a 115 y avisa chapa — el campo tocado manda', () => {
    const res = reconcileDiameters({ extDiameter: 123, intDiameter: 150 }, 'int');
    expect(res.intDiameter).toBe(115);
    expect(res.intAdjusted).toBe(true);
    expect(res.intReason).toBe('chapa'); // aviso inline: chapa mínima 4.0 mm
    expect(res.extAdjusted).toBe(false); // el otro diámetro NO se mueve
    expect(res.extDiameter).toBe(123);
    // W tras el clamp: (123−115)/2 = 4.0 mm exacto
    expect(virolaMetrics(res).bandWidthMm).toBe(4);
  });

  it('valores fuera del rango global ⇒ clamp con motivo "rango"', () => {
    expect(reconcileDiameters({ extDiameter: 60, intDiameter: 95 }, 'ext')).toMatchObject({
      extDiameter: 103, // Dint+8
      extReason: 'rango',
      intDiameter: 95,
      intAdjusted: false,
    });
    expect(reconcileDiameters({ extDiameter: 200, intDiameter: 95 }, 'ext')).toMatchObject({
      extDiameter: 180,
      extReason: 'rango',
    });
    expect(reconcileDiameters({ extDiameter: 123, intDiameter: 40 }, 'int')).toMatchObject({
      intDiameter: 50,
      intReason: 'rango',
    });
  });

  it('§6: tipear Dext=70 con Dint=95 ⇒ Dext exige ≥ 158/103 según el carril (clamp respeta R1)', () => {
    // Dint=95 ⇒ Dext^min = 103 (max(70, 95+8)); el tipeo se acota y avisa
    const res = reconcileDiameters({ extDiameter: 70, intDiameter: 95 }, 'ext');
    expect(res.extDiameter).toBe(103);
    expect(res.extReason).toBe('chapa');
    expect(res.intDiameter).toBe(95);
  });

  it('snap al múltiplo de 0.5 MÁS CERCANO antes de acotar (spec §6: 123.3 ⇒ 123.5)', () => {
    expect(snapToStepMm(123.3)).toBe(123.5);
    expect(snapToStepMm(123.7)).toBe(123.5);
    expect(snapToStepMm(62.1)).toBe(62);
  });

  it('texto inválido nunca entra al estado (parse del input, §6 "restaura el último válido")', () => {
    expect(parseDiameterText('123,5')).toBe(123.5);
    expect(parseDiameterText('123.5')).toBe(123.5);
    expect(parseDiameterText(' 123 ')).toBe(123);
    expect(parseDiameterText('abc')).toBeNull();
    expect(parseDiameterText('')).toBeNull();
    expect(parseDiameterText('12a3')).toBeNull();
    expect(parseDiameterText('1.2.3')).toBeNull();
  });

  it('idempotencia del régene: un estado ya reconciliado no se mueve', () => {
    const first = reconcileDiameters({ extDiameter: 130, intDiameter: 95 }, 'ext');
    const second = reconcileDiameters(first, undefined);
    expect(second.extDiameter).toBe(first.extDiameter);
    expect(second.intDiameter).toBe(first.intDiameter);
    expect(second.extAdjusted).toBe(false);
    expect(second.intAdjusted).toBe(false);
  });

  it('invariante R1 en todo el dominio: W = (Dext−Dint)/2 ≥ 4.0 mm jamás se infringe', () => {
    for (let ext = 70; ext <= 180; ext += 17.5) {
      for (let int = 40; int <= 260; int += 30) {
        const res = reconcileDiameters({ extDiameter: ext, intDiameter: int });
        const w = (res.extDiameter - res.intDiameter) / 2;
        expect(w).toBeGreaterThanOrEqual(4 - 1e-9);
        expect(res.intDiameter).toBeGreaterThanOrEqual(50);
        expect(res.extDiameter).toBeLessThanOrEqual(180);
      }
    }
  });

  it('estado ruidoso/corrupto al restaurar ⇒ defaults del §2 (nunca basura)', () => {
    const junk = reconcileDiameters({
      extDiameter: Number.NaN,
      intDiameter: Number.NaN,
    });
    expect(junk.extDiameter).toBe(123);
    expect(junk.intDiameter).toBe(95);
  });
});

/* ------------------------------------------------------------------ */
/* R2 — métricas auto-calculadas                                      */
/* ------------------------------------------------------------------ */

describe('R2 — métricas (1 decimal, mm)', () => {
  it('QA2: Dext 123→130 ⇒ Dcentro = 112.5 y W = 17.5', () => {
    expect(virolaMetrics({ extDiameter: 130, intDiameter: 95 })).toEqual({
      centerDiameterMm: 112.5,
      bandWidthMm: 17.5,
    });
  });

  it('defaults del §2 (123/95): Dcentro=109.0, W=14.0', () => {
    expect(virolaMetrics({ extDiameter: 123, intDiameter: 95 })).toEqual({
      centerDiameterMm: 109,
      bandWidthMm: 14,
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3 — cascada única virola.dimensionsChanged                        */
/* ------------------------------------------------------------------ */

describe('R3 — cascada única (evento + store + latencia QA2 ≤ 100 ms)', () => {
  it('corre la cascada completa (valida ⇒ set en store ⇒ emite) en un solo evento', () => {
    const events: Array<{ extDiameter: number; intDiameter: number }> = [];
    const off = onVirolaDimensionsChanged((e) => events.push({ ...e }));

    const res = runDimensionsCascade({ extDiameter: 130, intDiameter: 95 }, 'ext');

    expect(res.extDiameter).toBe(130);
    expect(res.intDiameter).toBe(95);
    expect(events).toEqual([{ extDiameter: 130, intDiameter: 95 }]);

    const s = useEditorStore.getState();
    expect(s.extDiameter).toBe(130);
    expect(s.intDiameter).toBe(95);
    expect(s.dirty).toBe(true); // (f) marca de guardado pendiente → autosave 2 s
    off();
  });

  it('setDiameters de la cascada es UN set: métricas/guías/re-anclaje derivan del mismo render', () => {
    let renders = 0;
    const unsub = useEditorStore.subscribe(() => {
      renders += 1;
    });
    runDimensionsCascade({ extDiameter: 135.5, intDiameter: 95 }, 'ext');
    expect(renders).toBe(1); // un solo evento de store
    unsub();
  });

  it('QA2: la cascada completa tarda < 100 ms (y aguanta 1.000 corridas seguidas)', () => {
    const listeners: Array<() => void> = [];
    for (let i = 0; i < 20; i++) listeners.push(onVirolaDimensionsChanged(() => undefined));

    try {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        runDimensionsCascade({ extDiameter: 123 + (i % 40) * 0.5, intDiameter: 95 }, 'ext');
      }
      const delta = performance.now() - t0;
      expect(delta).toBeLessThan(100); // 1.000 cascadas ⇒ una cascada ≤ 0.1 ms
    } finally {
      for (const off of listeners) off();
    }
  });

  it('el payload del evento es EXACTAMENTE { extDiameter, intDiameter } (§5)', () => {
    let seen: string[] | null = null;
    const off = onVirolaDimensionsChanged((e) => {
      seen = Object.keys(e);
    });
    runDimensionsCascade({ extDiameter: 123, intDiameter: 95 }, 'ext');
    off();
    expect(seen).toEqual(['extDiameter', 'intDiameter']);
  });

  afterEach(() => {
    // no contaminar otros describe: estado de vuelta a defaults
    useEditorStore.getState().restoreState(defaultSnapshot(), null);
  });
});

/* ------------------------------------------------------------------ */
/* R5 — tabla canónica de guías + anclar UV de la costura             */
/* ------------------------------------------------------------------ */

describe('R5 — catálogo visual de guías', () => {
  it('los 3 colores hex de la spec (bordes / central / ejes)', () => {
    expect(GUIDE_COLORS).toEqual({ bordes: '#4FC3F7', centro: '#FFC84A', ejes: '#FF7043' });
  });

  it('patrones de punteado 4-3 y 6-4 (mm, unidades de escena)', () => {
    expect(BORDES_DASH_MM).toEqual({ dashSize: 4, gapSize: 3 });
    expect(CENTRO_DASH_MM).toEqual({ dashSize: 6, gapSize: 4 });
  });

  it('anclaje R4: el círculo guía NACE en el UV 0° = la costura (phiStart compartido)', () => {
    const pts = guideCirclePoints(50, 100, 8);
    const p0 = pts[0]!;
    expect(p0.x).toBeCloseTo(0, 8); // sin(phiStart=π) = 0
    expect(p0.z).toBeCloseTo(-50, 8); // cos(π) = −1 → la costura queda al dorso
    expect(p0.y).toBe(100);

    // el eje opuesto (12h/6h "visto de frente") es radial coplanar y va hacia el frente (+Z)
    const axis = guideRadialAxisPoints(47.5, 61.5, 116, Math.PI);
    expect(axis[0]!.x).toBeCloseTo(0, 8);
    expect(axis[0]!.z).toBeCloseTo(47.5, 8); // borde interior al frente
    expect(axis[0]!.y).toBe(116);
    expect(axis[1]!.x).toBeCloseTo(0, 8);
    expect(axis[1]!.z).toBeCloseTo(61.5, 8); // borde exterior al frente
    expect(axis[1]!.y).toBe(116);
  });

  it('ticks de los ejes: segmentos transversales sobre la corona superior plana (pares inicio→fin)', () => {
    const ticks = guideRadialAxisTicks(47.5, 61.5, 116, 0, 3);
    expect(ticks).toHaveLength(6); // 3 pares
    for (let i = 0; i < ticks.length; i += 2) {
      const a = ticks[i]!;
      const b = ticks[i + 1]!;
      expect(Math.abs(b.x - a.x)).toBeCloseTo(1.6, 6); // longitud del tick transversal
      expect(b.y).toBeCloseTo(116, 8); // coplanar a la cota Y
      expect(a.y).toBeCloseTo(116, 8);
    }
  });

  it('R1 anatomía: buildVirolaTopGeometry genera corona anular plana con normales +Y', () => {
    const geo = buildVirolaTopGeometry(95, 123, 16);
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    expect(pos.count).toBeGreaterThan(0);
    // Todos los vértices están en el plano Y = 0 local
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(0, 6);
      expect(norm.getY(i)).toBeCloseTo(1, 6); // normal apuntando hacia arriba (+Y)
      const r = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2);
      expect(r).toBeGreaterThanOrEqual(47.5 - 1e-4);
      expect(r).toBeLessThanOrEqual(61.5 + 1e-4);
    }
  });

  it('R1 anatomía: faldón exterior y pared interior de virola se construyen correctamente', () => {
    const outer = buildVirolaOuterWallGeometry(123, 116, 100);
    const inner = buildVirolaInnerWallGeometry(95, 116, 106);
    expect(outer.getAttribute('position').count).toBeGreaterThan(0);
    expect(inner.getAttribute('position').count).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* R6 — persistencia del estado de guías (guidesState)                */
/* ------------------------------------------------------------------ */

describe('R6 — triada de guías persistida (true×3 en proyecto nuevo)', () => {
  it('defaults: bordes/centro/ejes = true', () => {
    expect(DEFAULT_GUIDES_STATE).toEqual({ bordes: true, centro: true, ejes: true });
    expect(defaultSnapshot().guidesState).toEqual({ bordes: true, centro: true, ejes: true });
  });

  it('jsonb ausente, parcial o corrupto ⇒ default true por guía, sin romper la carga', () => {
    expect(normalizeGuidesState(undefined)).toEqual({ bordes: true, centro: true, ejes: true });
    expect(normalizeGuidesState({ bordes: false })).toEqual({ bordes: false, centro: true, ejes: true });
    expect(normalizeGuidesState('basura')).toEqual({ bordes: true, centro: true, ejes: true });
    expect(normalizeGuidesState({ bordes: null, ejes: 'x' })).toEqual({
      bordes: true,
      centro: true,
      ejes: true,
    });
  });

  it('normalizeState persiste la triada y usa el régene R1 con los diámetros', () => {
    expect(normalizeState({ guidesState: { bordes: false, centro: false, ejes: false } }).guidesState).toEqual({
      bordes: false,
      centro: false,
      ejes: false,
    });
    expect(normalizeState({}).guidesState).toEqual({ bordes: true, centro: true, ejes: true });
    // diámetros imposibles guardados en el jsonb ⇒ clamps + defaults (nunca propagados)
    const fixed = normalizeState({ extDiameter: 3000, intDiameter: 95 });
    expect(fixed.extDiameter).toBe(180);
    expect(fixed.intDiameter).toBe(95);
    const tight = normalizeState({ extDiameter: 123, intDiameter: 118 });
    expect(tight.intDiameter).toBe(115); // chapa mínima 4.0 mm
  });
});

/* ------------------------------------------------------------------ */
/* R7 — auto-giro diferenciado por contexto (editor)                  */
/* ------------------------------------------------------------------ */

describe('R7 — auto-giro del editor (0.75 RPM)', () => {
  it('0.75 RPM ⇒ 4.5°/s (rad/s ≈ 0.0785)', () => {
    expect(EDITOR_AUTO_SPIN_RPM).toBe(0.75);
    expect(rpmToRadPerSec(EDITOR_AUTO_SPIN_RPM)).toBeCloseTo((4.5 * Math.PI) / 180, 12);
  });

  it('el Modo Cliente gira a 0.5 RPM (declarado; su consumo llega en pos 10)', () => {
    expect(CLIENT_MODE_AUTO_SPIN_RPM).toBe(0.5);
    expect(rpmToRadPerSec(CLIENT_MODE_AUTO_SPIN_RPM)).toBeCloseTo((3 * Math.PI) / 180, 12);
  });
});

/* ------------------------------------------------------------------ */
/* Store — acciones de la posición 4                                  */
/* ------------------------------------------------------------------ */

describe('store del editor (pos 4)', () => {
  it('setDiameters marca dirty (un solo evento para el autosave con (f))', () => {
    useEditorStore.getState().setDiameters({ extDiameter: 130, intDiameter: 95 });
    const s = useEditorStore.getState();
    expect(s.extDiameter).toBe(130);
    expect(s.dirty).toBe(true);
  });

  it('setGuidesState hace merge parcial de la triada y marca dirty (R6)', () => {
    useEditorStore.getState().setGuidesState({ centro: false });
    const s = useEditorStore.getState();
    expect(s.guidesState).toEqual({ bordes: true, centro: false, ejes: true });
    expect(s.dirty).toBe(true);
  });
});
