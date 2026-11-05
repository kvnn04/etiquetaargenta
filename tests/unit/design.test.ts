/* ============================================================================
 * TESTS POSICIÓN 6 — Rotación del diseño (ÚNICA FUENTE:
 * spec_rotacion_archivo_svg_png.md). Ambiente node: las funciones de
 * DISPOSITIVO (localStorage) se testean por su núcleo puro + fallback.
 * ============================================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  angularDistance,
  applyMagnet,
  formatRotationLabel,
  loadSnapMagnetDefault,
  magnetSnappedPreset,
  MAGNET_THRESHOLD_DEG,
  normalizeDesignState,
  normalizeRotation,
  parseRotationInput,
  parseSnapMagnetStored,
  ROTATION_PRESETS,
  ROTATION_STEP_DEG,
  saveSnapMagnet,
  snapMagnetToStorage,
} from '@/lib/design';
import { useEditorStore, snapshotOf, type EditorStateSnapshot } from '@/lib/store/editor';
import { defaultSnapshot, normalizeState } from '@/lib/projects/persistence';

/** Asset de sesión de prueba (R8 pos 7: con la base mm congelada R1). */
function fakeAsset(): { canvas: HTMLCanvasElement; name: string; kind: 'svg' | 'png'; baseSideMm: number } {
  return { canvas: {} as HTMLCanvasElement, name: 'logo.svg', kind: 'svg', baseSideMm: 123 };
}

beforeEach(() => {
  useEditorStore.getState().restoreState(defaultSnapshot(), null);
});

/* ------------------------------------------------------------------ */
/* R3 — representación angular canónica                               */
/* ------------------------------------------------------------------ */

describe('R3 — normalizeRotation (módulo + paso 0.5°)', () => {
  it('aplica módulo 360 y redondeo al medio grado más cercano (ejemplos de la spec)', () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(45.25)).toBe(45.5); // empate medio grado ⇒ hacia arriba
    expect(normalizeRotation(45.24)).toBe(45);
    expect(normalizeRotation(45.26)).toBe(45.5);
    expect(normalizeRotation(485)).toBe(125);
  });

  it('§6: 360.0° exacto ⇒ 0°; envolvente por abajo también normaliza', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(719.5)).toBe(359.5);
    expect(normalizeRotation(-0.5)).toBe(359.5);
    expect(normalizeRotation(400.5 + 360)).toBe(40.5); // round-trip QA1: +360 ≡ 0
  });

  it('entrada no numérica ⇒ 0° — la escena jamás pierde la alineación (§6)', () => {
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
    expect(normalizeRotation('45')).toBe(0); // el texto se parsea en UI (parseRotationInput)
    expect(normalizeRotation(null)).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
  });

  it('el resultado SIEMPRE vive en [0°, 360°) y es múltiplo de 0.5°', () => {
    for (let d = -15; d <= 75.01; d += 0.25) {
      const r = normalizeRotation(d);
      expect(r % ROTATION_STEP_DEG).toBe(0);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
});

describe('§6 — campo numérico (parseRotationInput)', () => {
  it('acepta `.`, `,` decimales, signo y sufijo °', () => {
    expect(parseRotationInput('45.5')).toBe(45.5);
    expect(parseRotationInput('45,5')).toBe(45.5);
    expect(parseRotationInput('-90')).toBe(-90);
    expect(parseRotationInput('+15')).toBe(15);
    expect(parseRotationInput('45°')).toBe(45);
    expect(parseRotationInput('5.')).toBe(5); // tipeo en curso
    expect(parseRotationInput('.5')).toBe(0.5);
    expect(parseRotationInput(' 90 ')).toBe(90);
  });

  it('entrada basura ⇒ null (el UI restaura el último válido al salir)', () => {
    expect(parseRotationInput('')).toBeNull();
    expect(parseRotationInput('abc')).toBeNull();
    expect(parseRotationInput('5-3')).toBeNull();
    expect(parseRotationInput('-')).toBeNull();
    expect(parseRotationInput('+' )).toBeNull();
  });

  it('combinación real de tipeo: ",25" parsea y normaliza a 45.5°', () => {
    const parsed = parseRotationInput('45,25');
    expect(parsed).not.toBeNull();
    expect(normalizeRotation(parsed)).toBe(45.5);
  });
});

/* ------------------------------------------------------------------ */
/* R4 — imán configurable en los presets                              */
/* ------------------------------------------------------------------ */

describe('R4 — presets + imán (±4°)', () => {
  it('tabla canónica de presets (R1/R4): 0° Frente · 90° Der · 180° Dorso · 270° Izq', () => {
    expect(ROTATION_PRESETS.map((p) => p.angle)).toEqual([0, 90, 180, 270]);
    expect(ROTATION_PRESETS.map((p) => p.label)).toEqual([
      '0° Frente',
      '90° Der',
      '180° Dorso',
      '270° Izq',
    ]);
    expect(MAGNET_THRESHOLD_DEG).toBe(4);
    expect(ROTATION_STEP_DEG).toBe(0.5);
  });

  it('imán ON: engancha a ±4° INCLUSIVO (incluida la envolvente 360 ⇒ 0)', () => {
    expect(applyMagnet(2, true)).toBe(0);
    expect(applyMagnet(88, true)).toBe(90);
    expect(applyMagnet(94, true)).toBe(90); // 4° de distancia: límite inclusivo
    expect(applyMagnet(94.5, true)).toBe(94.5); // 4.5° ⇒ ya NO engancha
    expect(applyMagnet(268, true)).toBe(270);
    expect(applyMagnet(356, true)).toBe(0); // wrap
    expect(magnetSnappedPreset(88.1, true)).toBe(90);
    expect(magnetSnappedPreset(94.1, true)).toBeNull(); // 4.1° ⇒ fuera del radio
  });

  it('imán OFF: 100 % continuo — 17.5° se fija EXACTO (QA3) y los ticks quedan neutros', () => {
    expect(applyMagnet(2, false)).toBe(2);
    expect(applyMagnet(17.5, false)).toBe(17.5);
    expect(applyMagnet(88, false)).toBe(88);
    expect(applyMagnet(356, false)).toBe(356);
    expect(magnetSnappedPreset(0, false)).toBeNull();
    expect(magnetSnappedPreset(90, false)).toBeNull();
  });

  it('fuera de ±4° el imán NO arrastra ni con ON', () => {
    expect(applyMagnet(5.5, true)).toBe(5.5);
    expect(applyMagnet(96, true)).toBe(96);
  });

  it('flujo completo del slider (orden canónico de UI): normalizar ⇒ imán', () => {
    expect(applyMagnet(normalizeRotation(359.5), true)).toBe(0); // envolvente
    expect(applyMagnet(normalizeRotation(370.2), true)).toBe(10); // lejos de presets
    expect(applyMagnet(normalizeRotation(98.75), true)).toBe(99); // 99 está a 9 de 90 ⇒ no engancha
  });

  it('distancia angular con envolvente (utilidad del imán)', () => {
    expect(angularDistance(350, 0)).toBe(10);
    expect(angularDistance(10, 350)).toBe(20); // 10 y 350 están a 20° entre sí
    expect(angularDistance(180, 0)).toBe(180);
  });
});

/* ------------------------------------------------------------------ */
/* R7 — nota de ficha y ajuste provisional del carril                 */
/* ------------------------------------------------------------------ */

describe('R7 — formato "Rotación: 45° / 45.5°"', () => {
  it('un decimal SOLO si no es entero', () => {
    expect(formatRotationLabel(45)).toBe('45°');
    expect(formatRotationLabel(45.5)).toBe('45.5°');
    expect(formatRotationLabel(370)).toBe('10°');
    expect(formatRotationLabel(-90)).toBe('270°');
  });
});

/* ------------------------------------------------------------------ */
/* §5/R7/R8 — persistencia en projects.state                          */
/* ------------------------------------------------------------------ */

describe('design en projects.state (§5)', () => {
  it('default: { rotation: 0, scale: 100, mirror: false } — proyecto viejo sin design ⇒ defaults (R8)', () => {
    expect(defaultSnapshot().design).toEqual({ rotation: 0, scale: 100, mirror: false });
    expect(normalizeState({}).design).toEqual({ rotation: 0, scale: 100, mirror: false });
    expect(normalizeState(null).design).toEqual({ rotation: 0, scale: 100, mirror: false });
  });

  it('normalizeDesignState tolera basura del jsonb y nunca rompe el rango', () => {
    expect(normalizeDesignState({ rotation: 370 }).rotation).toBe(10);
    expect(normalizeDesignState({ rotation: 'x' }).rotation).toBe(0);
    expect(normalizeDesignState({ rotation: null }).rotation).toBe(0);
    expect(normalizeDesignState('basura')).toEqual({ rotation: 0, scale: 100, mirror: false });
    expect(normalizeDesignState(Array(3))).toEqual({ rotation: 0, scale: 100, mirror: false });
  });

  it('normalizeState aplica R3 completo al valor guardado', () => {
    expect(normalizeState({ design: { rotation: -47.75 } }).design).toEqual({
      rotation: 312.5,
      scale: 100,
      mirror: false,
    });
  });

  it('proyecto pos-6 (solo rotation) ⇒ escala 100% y espejo OFF (R8 pos 7)', () => {
    const pos6 = normalizeState({ design: { rotation: 45.5 } });
    expect(pos6.design).toEqual({ rotation: 45.5, scale: 100, mirror: false });
  });

  it('escala fuera de rango / con basura ⇒ clamp al extremo + paso 0.5% (§6)', () => {
    expect(normalizeState({ design: { scale: 115 } }).design.scale).toBe(110);
    expect(normalizeState({ design: { scale: 65 } }).design.scale).toBe(70);
    expect(normalizeState({ design: { scale: 92.25 } }).design.scale).toBe(92.5);
    expect(normalizeState({ design: { scale: 'x' } }).design.scale).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Store — acciones de la posición 6                                  */
/* ------------------------------------------------------------------ */

describe('store del editor (pos 6 + 7)', () => {
  it('setDesignRotation normaliza por módulo y marca dirty (R7: pendiente de guardado)', () => {
    useEditorStore.getState().setDesignRotation(370.2);
    const s = useEditorStore.getState();
    expect(s.design.rotation).toBe(10);
    expect(s.dirty).toBe(true);
  });

  it('setDesignScale normaliza al rango [70,110] paso 0.5% y marca dirty (R8)', () => {
    useEditorStore.getState().setDesignScale(115); // clamp al extremo (§6)
    expect(useEditorStore.getState().design.scale).toBe(110);
    expect(useEditorStore.getState().dirty).toBe(true);
    useEditorStore.getState().setDesignScale(92.25); // paso 0.5%: redondea a 92.5
    expect(useEditorStore.getState().design.scale).toBe(92.5);
    useEditorStore.getState().restoreState(defaultSnapshot(), null);
  });

  it('setDesignMirror alterna el espejo del pipeline (R2) y marca dirty', () => {
    useEditorStore.getState().setDesignMirror(true);
    expect(useEditorStore.getState().design.mirror).toBe(true);
    expect(useEditorStore.getState().dirty).toBe(true);
    useEditorStore.getState().restoreState(defaultSnapshot(), null);
    expect(useEditorStore.getState().design.mirror).toBe(false);
  });

  it('snapshotOf incluye design (rotación + escala + espejo) y JAMÁS el asset de sesión', () => {
    useEditorStore.getState().setDesignRotation(45.5);
    useEditorStore.getState().setDesignScale(92.5);
    useEditorStore.getState().setDesignMirror(true);
    const snap = snapshotOf(useEditorStore.getState());
    expect(snap.design).toEqual({ rotation: 45.5, scale: 92.5, mirror: true });
    expect('designAsset' in snap).toBe(false);
  });

  it('asset de sesión: se carga sin marcar dirty y restoreState lo limpia (§5)', () => {
    const dirtyBefore = useEditorStore.getState().dirty;
    const fake = fakeAsset();
    useEditorStore.getState().loadDesignAsset(fake);
    expect(useEditorStore.getState().designAsset).toBe(fake);
    expect(useEditorStore.getState().dirty).toBe(dirtyBefore); // no es contractual
    useEditorStore.getState().restoreState(defaultSnapshot(), null);
    expect(useEditorStore.getState().designAsset).toBeNull();
  });

  it('envolvente de tinta: derivada de sesión, sin dirty; restore la limpia (R8)', () => {
    useEditorStore.getState().setInkEnvelope({ inkMaxMm: 61, inkMinMm: 48 });
    expect(useEditorStore.getState().inkEnvelope).toEqual({ inkMaxMm: 61, inkMinMm: 48 });
    expect(useEditorStore.getState().dirty).toBe(false);
    useEditorStore.getState().restoreState(defaultSnapshot(), null);
    expect(useEditorStore.getState().inkEnvelope).toBeNull();
    expect(useEditorStore.getState().inkScanDegraded).toBe(false);
  });

  it('restoreState con snapshot legacy (sin design) ⇒ design por defecto', () => {
    // legacy pos-6: el jsonb viejo trae `design` ausente o parcial — el
    // normalizador debe completar con los defaults contractuales (R8).
    const legacy = { ...defaultSnapshot(), design: undefined } as unknown as EditorStateSnapshot;
    useEditorStore.getState().restoreState(legacy, null);
    expect(useEditorStore.getState().design.rotation).toBe(0);
    expect(useEditorStore.getState().design.scale).toBe(100);
    expect(useEditorStore.getState().design.mirror).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §5 — imán SOLO DE DISPOSITIVO (localStorage; nunca jsonb)          */
/* ------------------------------------------------------------------ */

describe('imán por dispositivo (§5: localStorage — nunca en projects.state)', () => {
  it('parsers puros: falta ⇒ ON (R4 default); "0"/"false" ⇒ OFF; cualquier otra cosa ⇒ ON', () => {
    expect(parseSnapMagnetStored(null)).toBe(true);
    expect(parseSnapMagnetStored('0')).toBe(false);
    expect(parseSnapMagnetStored('false')).toBe(false);
    expect(parseSnapMagnetStored('1')).toBe(true);
    expect(parseSnapMagnetStored('verdad')).toBe(true);
    expect(snapMagnetToStorage(true)).toBe('1');
    expect(snapMagnetToStorage(false)).toBe('0');
  });

  it('sin storage (node/modo privado): fallback ON y saveSnapMagnet no rompe', () => {
    expect(loadSnapMagnetDefault()).toBe(true);
    expect(() => saveSnapMagnet(false)).not.toThrow();
    expect(loadSnapMagnetDefault()).toBe(true); // sin storage ⇒ sigue el default
  });
});
