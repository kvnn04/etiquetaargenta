/* ============================================================================
 * TARJETA MEDIDAS DE LA VIROLA — spec_tecnica_geometrica §4
 * ----------------------------------------------------------------------------
 * Sección "Medidas y Geometría de Círculos" del panel (decisión del titular:
 * como TARJETA del panel apilado, no pestañas — 05-nov):
 *  · Inputs D_ext/D_int: paso 0.5, teclado ↑/↓, botones ±, sufijo mm, con
 *    debounce de 200 ms al tipear (R3) y commit inmediato en steppers/sliders.
 *  · Sliders (QA1) con extremos re-mapeados AL VUELO por los rangos dinámicos
 *    R1 — sin puntos muertos: nunca piden un valor que el par no permita.
 *  · Clamp con aviso inline ámbar (R1/§4): "El ancho mínimo de chapa es
 *    4.0 mm — ajustá el otro diámetro"; texto inválido restaura el último
 *    valor válido al perder foco (nunca un estado sin métricas).
 *  · Métricas auto-calculadas R2 (1 decimal, mm) sincronizadas con el estado.
 *  · Checkbox group de guías R5/R6 — persistido por proyecto (guidesState).
 * Todo el módulo es FREE (explícito en spec freemium: la edición de medidas
 * es parte de la demo) — no se consulta la matriz R2 acá.
 * ============================================================================ */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Minus, Plus } from 'lucide-react';
import { useEditorStore } from '@/lib/store/editor';
import {
  DIAMETER_STEP_MM,
  EXT_DIAMETER_RANGE_MM,
  GUIDE_COLORS,
  INT_DIAMETER_RANGE_MM,
  extRangeFor,
  intRangeFor,
  parseDiameterText,
  virolaMetrics,
  type ClampReason,
  type GuideKey,
} from '@/lib/virola';
import { runDimensionsCascade } from '@/lib/virola/cascade';
import { cn } from '@/lib/cn';

/** Debounce del casacade al tipear (R3: disparo *live* con debounce 200 ms). */
const TYPING_DEBOUNCE_MS = 200;

type FieldKey = 'ext' | 'int';

interface FieldWarning {
  field: FieldKey;
  reason: Exclude<ClampReason, null>;
}

/** "123.5" ⇒ "123,5" (es-AR, un decimal siempre — métricas R2). */
function fmtMm(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function warningMessage(w: FieldWarning): string {
  if (w.reason === 'chapa') return 'El ancho mínimo de chapa es 4.0 mm — ajustá el otro diámetro.';
  return w.field === 'ext'
    ? `El D_ext admite entre ${fmtMm(EXT_DIAMETER_RANGE_MM.min)} y ${fmtMm(EXT_DIAMETER_RANGE_MM.max)} mm.`
    : `El D_int admite entre ${fmtMm(INT_DIAMETER_RANGE_MM.min)} y ${fmtMm(INT_DIAMETER_RANGE_MM.max)} mm.`;
}

/** R5: tabla canónica → los checkboxes muestran el color de su guía. */
const GUIDE_CHECKBOXES: Array<{ key: GuideKey; label: string }> = [
  { key: 'bordes', label: 'Bordes de Chapa (Ext e Int)' },
  { key: 'centro', label: 'Línea Central de Posición' },
  { key: 'ejes', label: 'Ejes Simétricos (12h y 6h)' },
];

export default function DimensionsCard() {
  const ext = useEditorStore((s) => s.extDiameter);
  const int = useEditorStore((s) => s.intDiameter);
  const guidesState = useEditorStore((s) => s.guidesState);
  const setGuidesState = useEditorStore((s) => s.setGuidesState);

  /* Texto local de cada input: mientras el campo está enfocado, el usuario manda
   * (evita saltos de cursor); al perder foco se restaura/mirroring del store. */
  const [extText, setExtText] = useState(() => fmtMm(ext));
  const [intText, setIntText] = useState(() => fmtMm(int));
  const [focused, setFocused] = useState<FieldKey | null>(null);
  const [warning, setWarning] = useState<FieldWarning | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metrics = useMemo(() => virolaMetrics({ extDiameter: ext, intDiameter: int }), [ext, int]);
  const extRange = useMemo(() => extRangeFor(int), [int]);
  const intRange = useMemo(() => intRangeFor(ext), [ext]);

  /* Sincroniza el texto cuando cambia el store y el campo NO está en edición. */
  useEffect(() => {
    if (focused !== 'ext') setExtText(fmtMm(ext));
  }, [ext, focused]);
  useEffect(() => {
    if (focused !== 'int') setIntText(fmtMm(int));
  }, [int, focused]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function cancelPending(): void {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  /**
   * Commit de UN campo: parseo → cascada única (R3) → aviso inline si hubo
   * clamp. Con texto inválido NO toca el store ("nunca hay estado sin métricas").
   */
  function commitNow(field: FieldKey, text: string, { normalizeDisplay = false } = {}): void {
    const parsed = parseDiameterText(text);
    if (parsed === null) {
      if (normalizeDisplay) setExtText(fmtMm(ext)); // blur inválido ⇒ último válido (§6)
      return;
    }
    const input =
      field === 'ext'
        ? { extDiameter: parsed, intDiameter: int }
        : { extDiameter: ext, intDiameter: parsed };
    const res = runDimensionsCascade(input, field);
    cancelPending();

    const adjusted: { field: FieldKey; reason: Exclude<ClampReason, null> } | null = res.extAdjusted
      ? { field: 'ext', reason: res.extReason! }
      : res.intAdjusted
        ? { field: 'int', reason: res.intReason! }
        : null;
    setWarning(adjusted);

    if (normalizeDisplay) {
      const finalValue = field === 'ext' ? res.extDiameter : res.intDiameter;
      if (field === 'ext') setExtText(fmtMm(finalValue));
      else setIntText(fmtMm(finalValue));
    }
  }

  /** R3: al tipear, disparo *live* con debounce 200 ms. Texto basura cancela. */
  function handleTyping(field: FieldKey, text: string): void {
    cancelPending();
    if (field === 'ext') setExtText(text);
    else setIntText(text);
    if (parseDiameterText(text) === null) return; // §6: nunca hay estado sin métricas
    debounceRef.current = setTimeout(() => commitNow(field, text), TYPING_DEBOUNCE_MS);
  }

  /** Steppers ±0.5 y flechas de teclado: commit INMEDIATO (R3). */
  function step(field: FieldKey, delta: number): void {
    cancelPending();
    const input =
      field === 'ext'
        ? { extDiameter: ext + delta, intDiameter: int }
        : { extDiameter: ext, intDiameter: int + delta };
    const res = runDimensionsCascade(input, field);
    const adjusted = res.extAdjusted
      ? { field: 'ext' as const, reason: res.extReason! }
      : res.intAdjusted
        ? { field: 'int' as const, reason: res.intReason! }
        : null;
    setWarning(adjusted);
    const finalValue = field === 'ext' ? res.extDiameter : res.intDiameter;
    if (field === 'ext') setExtText(fmtMm(finalValue));
    else setIntText(fmtMm(finalValue));
  }

  /** Sliders (QA1: extremos re-mapeados al vuelo): commit inmediato, sin aviso
   * posible — el rango dinámico NO permite valores inválidos ("sin puntos muertos"). */
  function slide(field: FieldKey, value: number): void {
    cancelPending();
    runDimensionsCascade(
      field === 'ext'
        ? { extDiameter: value, intDiameter: int }
        : { extDiameter: ext, intDiameter: value },
      field,
    );
    if (focused !== field) setWarning(null);
  }

  const inputClass = (field: FieldKey) =>
    cn(
      'h-8 w-[4.5rem] rounded-md border bg-black/30 px-2 text-right text-xs font-semibold text-stone-100 outline-none transition',
      warning?.field === field
        ? 'border-amber-400/70 text-amber-100'
        : 'border-white/10 focus:border-gold/50',
    );

  const stepperClass =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 text-stone-300 transition hover:border-gold/40 hover:text-gold-soft disabled:opacity-40';

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
        Medidas de la Virola
      </h3>
      <p className="mt-1 text-[10px] leading-relaxed text-stone-600">
        Medidas y Geometría de Círculos — edición milimétrica FREE (R1 de{' '}
        <span className="font-mono">spec_tecnica_geometrica</span>).
      </p>

      {/* ---- D_ext ---- */}
      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="dia-ext" className="text-[11px] font-bold text-stone-300">
            D_ext · diámetro exterior
          </label>
          <span className="text-[9px] text-stone-600">
            mín {fmtMm(extRange.min)} · máx {fmtMm(extRange.max)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button type="button" className={stepperClass} aria-label="Restar 0,5 mm a D_ext" onClick={() => step('ext', -0.5)}>
            <Minus className="h-3 w-3" />
          </button>
          <input
            id="dia-ext"
            data-testid="dia-ext"
            className={inputClass('ext')}
            inputMode="decimal"
            autoComplete="off"
            aria-label="Diámetro exterior en milímetros"
            value={extText}
            onChange={(e) => handleTyping('ext', e.target.value)}
            onFocus={() => setFocused('ext')}
            onBlur={() => {
              setFocused(null);
              commitNow('ext', extText, { normalizeDisplay: true });
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                step('ext', +DIAMETER_STEP);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                step('ext', -DIAMETER_STEP);
              } else if (e.key === 'Enter') {
                commitNow('ext', extText, { normalizeDisplay: true });
              }
            }}
          />
          <button type="button" className={stepperClass} aria-label="Sumar 0,5 mm a D_ext" onClick={() => step('ext', +DIAMETER_STEP)}>
            <Plus className="h-3 w-3" />
          </button>
          <span className="text-[10px] text-stone-600">mm</span>
        </div>
        <input
          type="range"
          className="mt-2 w-full accent-gold"
          aria-label="Slider del diámetro exterior"
          min={extRange.min}
          max={extRange.max}
          step={DIAMETER_STEP}
          value={ext}
          onChange={(e) => slide('ext', Number(e.target.value))}
        />
        {warning?.field === 'ext' && <InlineWarning message={warningMessage(warning)} />}
      </div>

      {/* ---- D_int ---- */}
      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="dia-int" className="text-[11px] font-bold text-stone-300">
            D_int · diámetro de la boca
          </label>
          <span className="text-[9px] text-stone-600">
            mín {fmtMm(intRange.min)} · máx {fmtMm(intRange.max)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button type="button" className={stepperClass} aria-label="Restar 0,5 mm a D_int" onClick={() => step('int', -0.5)}>
            <Minus className="h-3 w-3" />
          </button>
          <input
            id="dia-int"
            data-testid="dia-int"
            className={inputClass('int')}
            inputMode="decimal"
            autoComplete="off"
            aria-label="Diámetro de la boca en milímetros"
            value={intText}
            onChange={(e) => handleTyping('int', e.target.value)}
            onFocus={() => setFocused('int')}
            onBlur={() => {
              setFocused(null);
              commitNow('int', intText, { normalizeDisplay: true });
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                step('int', +DIAMETER_STEP);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                step('int', -DIAMETER_STEP);
              } else if (e.key === 'Enter') {
                commitNow('int', intText, { normalizeDisplay: true });
              }
            }}
          />
          <button type="button" className={stepperClass} aria-label="Sumar 0,5 mm a D_int" onClick={() => step('int', +DIAMETER_STEP)}>
            <Plus className="h-3 w-3" />
          </button>
          <span className="text-[10px] text-stone-600">mm</span>
        </div>
        <input
          type="range"
          className="mt-2 w-full accent-gold"
          aria-label="Slider del diámetro de la boca"
          min={intRange.min}
          max={intRange.max}
          step={DIAMETER_STEP}
          value={int}
          onChange={(e) => slide('int', Number(e.target.value))}
        />
        {warning?.field === 'int' && <InlineWarning message={warningMessage(warning)} />}
      </div>

      {/* ---- Métricas auto-calculadas (R2) ---- */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gold/35 bg-gold/10 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gold-soft/90">
            Círculo Central de Grabado
          </p>
          <p className="mt-1 text-lg font-bold leading-none text-gold-soft" data-testid="metric-centro">
            {fmtMm(metrics.centerDiameterMm)}
            <span className="ml-1 text-[10px] font-medium text-gold-soft/70">mm</span>
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-stone-500">
            Ancho de chapa plana
          </p>
          <p className="mt-1 text-lg font-bold leading-none text-stone-200" data-testid="metric-banda">
            {fmtMm(metrics.bandWidthMm)}
            <span className="ml-1 text-[10px] font-medium text-stone-500">mm</span>
          </p>
        </div>
      </div>

      {/* ---- Checkbox group de guías (R5/R6) ---- */}
      <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
        <p className="text-[9px] font-bold uppercase tracking-wider text-stone-500">
          Guías de simetría
        </p>
        {GUIDE_CHECKBOXES.map(({ key, label }) => {
          const active = guidesState[key];
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={active}
              className="flex w-full select-none items-center gap-2 rounded-md px-1 py-1 text-left transition hover:bg-white/5"
              onClick={() => setGuidesState({ [key]: !active })}
            >
              <span
                className={cn(
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
                  active ? 'border-gold/60 bg-gold/20' : 'border-white/15 bg-black/30',
                )}
              >
                {active && <Check className="h-2.5 w-2.5 text-gold-soft" />}
              </span>
              <span
                className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/60"
                style={{ backgroundColor: GUIDE_COLORS[key] }}
              />
              <span className={cn('text-[11px]', active ? 'text-stone-300' : 'text-stone-500')}>
                {label}
              </span>
            </button>
          );
        })}
        <p className="px-1 text-[9px] leading-relaxed text-stone-600">
          Se guardan en el proyecto (R6) y <b>jamás</b> salen en exportes/links.
        </p>
      </div>
    </div>
  );
}

const DIAMETER_STEP = DIAMETER_STEP_MM; // R1: paso obligatorio (0.5) — un solo origen

function InlineWarning({ message }: { message: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
