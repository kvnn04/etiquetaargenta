'use client';

/* ============================================================================
 * MATERIALES Y ACABADOS DEL TERMO
 * ----------------------------------------------------------------------------
 * El termo no usa la virola de los mates: el cuerpo es pintado (o acero) y el
 * acabado define el PBR. Reusa `bodyColor` del store para el color pintado y
 * `thermo.finish` para mate/satinado/metálico. La paleta y los nombres salen
 * de lib/thermo (misma fuente que la escena y la ficha).
 * ============================================================================ */

import { useEffect, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import {
  THERMO_DEFAULT_BODY_COLOR,
  THERMO_FINISH_OPTIONS,
  THERMO_PALETTE,
  normalizeThermoFinish,
  thermoColorName,
  thermoFinishLabel,
} from '@/lib/thermo';
import { normalizeHex } from '@/lib/color';
import { useEditorStore } from '@/lib/store/editor';

function Swatch({
  hex,
  title,
  active,
  onClick,
}: {
  hex: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={[
        'h-7 w-7 rounded-full border transition-all focus:outline-none',
        active ? 'border-gold ring-2 ring-gold/60' : 'border-white/15 hover:border-white/40',
      ].join(' ')}
      style={{ backgroundColor: hex }}
    />
  );
}

export default function ThermoColorCard() {
  const bodyColor = useEditorStore((s) => s.bodyColor);
  const finish = useEditorStore((s) => s.thermo.finish);
  const setBodyColor = useEditorStore((s) => s.setBodyColor);
  const setThermoFinish = useEditorStore((s) => s.setThermoFinish);
  const addRecentColor = useEditorStore((s) => s.addRecentColor);
  const recent = useEditorStore((s) => s.recentColors.body);

  const currentHex = normalizeHex(bodyColor ?? '') ?? THERMO_DEFAULT_BODY_COLOR;
  const [hexText, setHexText] = useState(currentHex);

  useEffect(() => setHexText(currentHex), [currentHex]);

  function commitHex(raw: string): void {
    const norm = normalizeHex(raw);
    if (!norm) {
      setHexText(currentHex);
      return;
    }
    setBodyColor(norm);
    addRecentColor('body', norm);
    setHexText(norm);
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-gold" />
        <h2 className="text-sm font-semibold tracking-wide text-cream">Materiales y Acabados</h2>
      </div>
      <p className="text-[10px] leading-relaxed text-stone-600">
        Color del cuerpo pintado y acabado del producto. El acero inoxidable se aplica siempre con
        acabado metálico, sin importar la opción elegida.
      </p>

      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Color del cuerpo</p>
        <div className="flex flex-wrap gap-2">
          {THERMO_PALETTE.map((color) => (
            <Swatch
              key={color.hex}
              hex={color.hex}
              title={`${color.name} · ${color.hex}`}
              active={currentHex.toUpperCase() === color.hex.toUpperCase()}
              onClick={() => {
                setBodyColor(color.hex);
                addRecentColor('body', color.hex);
              }}
            />
          ))}
        </div>
        {recent.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-stone-600">
              Recientes
            </p>
            <div className="flex flex-wrap gap-2">
              {recent.map((hex) => (
                <Swatch
                  key={hex}
                  hex={hex}
                  title={hex}
                  active={currentHex.toUpperCase() === hex.toUpperCase()}
                  onClick={() => setBodyColor(hex)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <span
            className="h-8 w-8 shrink-0 rounded-lg border border-white/15"
            style={{ backgroundColor: currentHex }}
            aria-hidden="true"
          />
          <input
            type="text"
            value={hexText}
            aria-label="Color del cuerpo en hexadecimal"
            spellCheck={false}
            maxLength={7}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="h-8 w-28 rounded-md border border-white/10 bg-black/30 px-2 font-mono text-xs text-stone-100 outline-none transition focus:border-gold/50 focus:ring-1 focus:ring-gold/40"
          />
          <span className="text-[10px] text-stone-500">{thermoColorName(currentHex)}</span>
          <button
            type="button"
            title="Volver al Negro Mate del producto"
            onClick={() => {
              setBodyColor(THERMO_DEFAULT_BODY_COLOR);
              addRecentColor('body', THERMO_DEFAULT_BODY_COLOR);
            }}
            className="ml-auto flex items-center gap-1 text-[10px] text-stone-500 transition hover:text-stone-300 focus:outline-none"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </section>

      <hr className="border-line" />

      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Acabado</p>
        <div className="grid grid-cols-3 gap-1.5">
          {THERMO_FINISH_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={finish === option.id}
              onClick={() => setThermoFinish(normalizeThermoFinish(option.id))}
              className={[
                'rounded-lg border px-2 py-2 text-[11px] transition-all focus:outline-none',
                finish === option.id
                  ? 'border-gold bg-gold/10 text-cream ring-2 ring-gold'
                  : 'border-line text-stone-400 hover:border-gold/50 hover:text-cream',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-stone-600">
          Acabado vigente: <span className="text-stone-300">{thermoFinishLabel(finish)}</span>.
        </p>
      </section>
    </div>
  );
}
