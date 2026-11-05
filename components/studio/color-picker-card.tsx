'use client';

import { useRef, useState, useCallback } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import {
  METAL_PRESETS,
  BODY_PRESETS,
  COMMERCIAL_QUICK_COLORS,
  adaptiveLaserBurn,
  normalizeHex,
  type MetalPresetId,
  type BodyPresetId,
} from '@/lib/color';
import { useEditorStore } from '@/lib/store/editor';

/* ─────────────────────────── helpers ─────────────────────────── */

function isValidHex(raw: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(raw.trim());
}

/* ─────────────────────────── sub-components ─────────────────────────── */

interface SwatchProps {
  hex: string;
  title?: string;
  size?: number;
  onClick: () => void;
  active?: boolean;
}

function Swatch({ hex, title, size = 20, onClick, active = false }: SwatchProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        'rounded-full border border-white/20 transition-transform hover:scale-110 focus:outline-none',
        active ? 'ring-2 ring-gold ring-offset-1 ring-offset-panel' : '',
      ].join(' ')}
      style={{ width: size, height: size, backgroundColor: hex, flexShrink: 0 }}
    />
  );
}

interface HexInputProps {
  value: string;
  onChange: (hex: string) => void;
  onOpenPicker: () => void;
}

function HexInput({ value, onChange, onOpenPicker }: HexInputProps) {
  const [raw, setRaw] = useState(value);
  const [invalid, setInvalid] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setRaw(v);
    const withHash = v.startsWith('#') ? v : `#${v}`;
    if (isValidHex(withHash)) {
      setInvalid(false);
      onChange(withHash);
    } else {
      setInvalid(true);
    }
  };

  // Keep raw in sync when value changes externally
  const handleBlur = () => {
    if (!invalid) setRaw(value);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Colour dot — opens native picker */}
      <button
        type="button"
        title="Elegir color"
        onClick={onOpenPicker}
        className="w-7 h-7 rounded-md border border-line transition-transform hover:scale-110 focus:outline-none"
        style={{ backgroundColor: isValidHex(value) ? value : '#888' }}
      />
      <input
        type="text"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="#RRGGBB"
        maxLength={7}
        spellCheck={false}
        className={[
          'font-mono text-xs bg-transparent rounded px-2 py-1 w-28 border focus:outline-none focus:ring-1',
          invalid
            ? 'border-red-500 focus:ring-red-500 text-red-400'
            : 'border-line focus:ring-gold text-cream',
        ].join(' ')}
      />
    </div>
  );
}

/* ─────────────────────────── main component ─────────────────────────── */

export default function ColorPickerCard() {
  const {
    bodyPreset,
    metalPreset,
    bodyColor,
    virolaColor,
    recentColors,
    setBodyPreset,
    setMetalPreset,
    setBodyColor,
    setVirolaColor,
    addRecentColor,
  } = useEditorStore();

  /* Refs for hidden native <input type="color"> */
  const bodyPickerRef = useRef<HTMLInputElement>(null);
  const virolaPickerRef = useRef<HTMLInputElement>(null);

  /* ── Body: color-libre helpers ── */
  const handleBodyColorChange = useCallback(
    (hex: string) => {
      const norm = normalizeHex(hex);
      setBodyColor(norm);
      if (norm) addRecentColor('body', norm);
    },
    [setBodyColor, addRecentColor],
  );

  const handleBodyPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleBodyColorChange(e.target.value);
  };

  /* ── Virola: color-libre helpers ── */
  const handleVirolaColorChange = useCallback(
    (hex: string) => {
      const norm = normalizeHex(hex);
      setVirolaColor(norm);
      if (norm) addRecentColor('virola', norm);
    },
    [setVirolaColor, addRecentColor],
  );

  const handleVirolaPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleVirolaColorChange(e.target.value);
  };

  /* ── Laser burn indicator (R4) ── */
  const laserBurn = adaptiveLaserBurn(virolaColor ?? null);

  /* ── Derived display values ── */
  const bodyFreeColor = bodyColor ?? '#888888';
  const virolaFreeColor = virolaColor ?? '#888888';

  return (
    <div className="rounded-xl border border-line bg-panel p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-gold" />
        <h2 className="text-sm font-semibold text-cream tracking-wide">Materiales y Acabados</h2>
      </div>

      {/* ══════════════════ SECCIÓN A — CUERPO ══════════════════ */}
      <section className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Cuerpo del Mate</p>

        {/* A1 — Presets de madera */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(BODY_PRESETS) as BodyPresetId[]).map((id) => {
            const preset = BODY_PRESETS[id];
            const isActive = bodyColor === null && bodyPreset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBodyPreset(id)}
                className={[
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-all focus:outline-none',
                  isActive
                    ? 'border-gold ring-2 ring-gold bg-gold/10 text-cream'
                    : 'border-line text-stone-400 hover:border-gold/50 hover:text-cream',
                ].join(' ')}
              >
                <span
                  className="w-4 h-4 rounded-sm border border-white/20 inline-block shrink-0"
                  style={{ backgroundColor: preset.pbr.color }}
                />
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* A2 — Color libre */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-stone-500 uppercase tracking-wider">Color personalizado</p>
          <div className="flex items-center gap-3">
            {/* Hidden native color picker */}
            <input
              ref={bodyPickerRef}
              type="color"
              value={isValidHex(bodyFreeColor) ? bodyFreeColor : '#888888'}
              onChange={handleBodyPickerChange}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <HexInput
              value={bodyFreeColor}
              onChange={handleBodyColorChange}
              onOpenPicker={() => bodyPickerRef.current?.click()}
            />
            {bodyColor !== null && (
              <span className="text-[10px] text-gold">● activo</span>
            )}
          </div>
        </div>

        {/* A3 — Paleta rápida */}
        <div className="space-y-1">
          <p className="text-[10px] text-stone-500 uppercase tracking-wider">Colores rápidos</p>
          <div className="flex flex-wrap gap-1.5">
            {COMMERCIAL_QUICK_COLORS.map((c) => (
              <Swatch
                key={c.hex}
                hex={c.hex}
                title={c.name}
                onClick={() => {
                  setBodyColor(c.hex);
                  addRecentColor('body', c.hex);
                }}
                active={bodyColor === c.hex}
              />
            ))}
          </div>
        </div>

        {/* A4 — Recientes */}
        {recentColors?.body && recentColors.body.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-stone-500 uppercase tracking-wider">Recientes</p>
            <div className="flex flex-wrap gap-1.5">
              {recentColors.body.slice(0, 6).map((hex) => (
                <Swatch
                  key={hex}
                  hex={hex}
                  title={hex}
                  onClick={() => {
                    setBodyColor(hex);
                    addRecentColor('body', hex);
                  }}
                  active={bodyColor === hex}
                />
              ))}
            </div>
          </div>
        )}

        {/* A5 — Restaurar */}
        <button
          type="button"
          onClick={() => setBodyPreset('algarrobo')}
          className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-300 transition-colors focus:outline-none"
        >
          <RotateCcw className="w-3 h-3" />
          Restaurar Algarrobo
        </button>
      </section>

      <hr className="border-line my-4" />

      {/* ══════════════════ SECCIÓN B — VIROLA ══════════════════ */}
      <section className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Virola</p>

        {/* B1 — Presets metálicos */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(METAL_PRESETS) as MetalPresetId[]).map((id) => {
            const preset = METAL_PRESETS[id];
            const isActive = virolaColor === null && metalPreset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMetalPreset(id)}
                className={[
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-all focus:outline-none',
                  isActive
                    ? 'border-gold ring-2 ring-gold bg-gold/10 text-cream'
                    : 'border-line text-stone-400 hover:border-gold/50 hover:text-cream',
                ].join(' ')}
              >
                <span
                  className="w-4 h-4 rounded-sm border border-white/20 inline-block shrink-0"
                  style={{ backgroundColor: preset.pbr.color }}
                />
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* B2 — Color libre */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-stone-500 uppercase tracking-wider">Color personalizado</p>
          <div className="flex items-center gap-3">
            <input
              ref={virolaPickerRef}
              type="color"
              value={isValidHex(virolaFreeColor) ? virolaFreeColor : '#888888'}
              onChange={handleVirolaPickerChange}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <HexInput
              value={virolaFreeColor}
              onChange={handleVirolaColorChange}
              onOpenPicker={() => virolaPickerRef.current?.click()}
            />
            {virolaColor !== null && (
              <span className="text-[10px] text-gold">● activo</span>
            )}
          </div>
        </div>

        {/* B3 — Paleta rápida */}
        <div className="space-y-1">
          <p className="text-[10px] text-stone-500 uppercase tracking-wider">Colores rápidos</p>
          <div className="flex flex-wrap gap-1.5">
            {COMMERCIAL_QUICK_COLORS.map((c) => (
              <Swatch
                key={c.hex}
                hex={c.hex}
                title={c.name}
                onClick={() => {
                  setVirolaColor(c.hex);
                  addRecentColor('virola', c.hex);
                }}
                active={virolaColor === c.hex}
              />
            ))}
          </div>
        </div>

        {/* B4 — Recientes */}
        {recentColors?.virola && recentColors.virola.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-stone-500 uppercase tracking-wider">Recientes</p>
            <div className="flex flex-wrap gap-1.5">
              {recentColors.virola.slice(0, 6).map((hex) => (
                <Swatch
                  key={hex}
                  hex={hex}
                  title={hex}
                  onClick={() => {
                    setVirolaColor(hex);
                    addRecentColor('virola', hex);
                  }}
                  active={virolaColor === hex}
                />
              ))}
            </div>
          </div>
        )}

        {/* B5 — Restaurar */}
        <button
          type="button"
          onClick={() => setMetalPreset('alpaca')}
          className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-300 transition-colors focus:outline-none"
        >
          <RotateCcw className="w-3 h-3" />
          Restaurar Alpaca / Plata
        </button>

        {/* B6 — Indicador grabado láser adaptativo (R4) */}
        <div
          className="flex items-start gap-2 rounded-lg border border-line/60 bg-panel-soft px-3 py-2 mt-1"
        >
          <span
            className="mt-0.5 w-3 h-3 rounded-full shrink-0 border border-white/20"
            style={{ backgroundColor: laserBurn.color }}
          />
          <div>
            <p className="text-xs font-medium text-cream leading-tight">
              {laserBurn.mode === 'dark' ? '🔥 Quemado oscuro' : '✨ Destapado plateado'}
            </p>
            <p className="text-[10px] text-stone-500 mt-0.5 leading-snug">
              {laserBurn.mode === 'dark'
                ? 'El láser quema la superficie dejando un tono oscuro sobre la virola.'
                : 'El láser retira la capa de color, revelando el metal plateado subyacente.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
