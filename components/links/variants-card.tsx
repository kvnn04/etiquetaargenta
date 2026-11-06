'use client';

import { RotateCw } from 'lucide-react';
import { useEditorStore } from '@/lib/store/editor';
import { LINK_LABEL_MAX, normalizeVariantLabel, type StoredVariantRow } from '@/lib/links/payload';

/**
 * TARJETA "Variantes del Enlace" — posición 10A (decisión del titular: vive
 * como tarjeta apilada del panel, el modal del link solo publica).
 * ----------------------------------------------------------------------------
 * Fuente: spec_ficha_comercial_interactiva_shareable_link.md §3-R4 (payload
 * con variants[] escalada/rotación/espejo por opcional) + decisión 10A: las
 * variantes son CONFIGS del mismo diseño cargado (rotación/escala/espejo +
 * label editable ≤40 — el diseño es UNO: la textura congelada es la misma).
 * El borrador persiste en projects.state.linkDraft: labels y configs del
 * taller sobreviven al recargar, listos para el próximo publish.
 * PUBLICAR sigue siendo PRO (402 server-side) — esta tarjeta es el borrador.
 */

const VARIANT_ROW_KEYS = ['A', 'B', 'C'] as const;

function emptyRowFor(id: 'A' | 'B' | 'C', index: number): StoredVariantRow {
  return {
    id,
    label: `Opción ${'ABC'[index]}: Grabado`,
    scalePct: 100,
    rotationDeg: 0,
    mirror: false,
    included: false,
  };
}

export default function VariantsCard() {
  const linkDraft = useEditorStore((s) => s.linkDraft);
  const setLinkDraft = useEditorStore((s) => s.setLinkDraft);
  const design = useEditorStore((s) => s.design);

  /** Upsert idempotente de la fila (el nuevo valor reemplaza por id). */
  const patchRow = (id: 'A' | 'B' | 'C', patch: Partial<StoredVariantRow>): void => {
    const existing = linkDraft.find((r) => r.id === id);
    const base: StoredVariantRow =
      existing ?? emptyRowFor(id, VARIANT_ROW_KEYS.indexOf(id));
    const next: StoredVariantRow = { ...base, ...patch };
    setLinkDraft(
      VARIANT_ROW_KEYS.map((key) =>
        key === id
          ? next
          : (linkDraft.find((r) => r.id === key) ?? emptyRowFor(key, VARIANT_ROW_KEYS.indexOf(key))),
      ),
    );
  };

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Variantes del Enlace
          </h3>
          <p className="mt-1 text-[10px] leading-relaxed text-stone-600">
            Hasta 3 versiones del <span className="font-mono">mismo diseño</span> (rotación, escala y
            espejo por opción) para el enlace comercial — se congelan al publicar (PRO).
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {VARIANT_ROW_KEYS.map((id, index) => {
          const row = linkDraft.find((r) => r.id === id) ?? emptyRowFor(id, index);
          return (
            <div
              key={id}
              className={`rounded-lg border p-2.5 ${
                row.included ? 'border-gold/40 bg-gold/5' : 'border-line bg-transparent opacity-70'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-[11px] font-bold text-stone-300">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-gold"
                    checked={row.included}
                    onChange={(e) => patchRow(id, { included: e.target.checked })}
                    aria-label={`Incluir Opción ${id}`}
                  />
                  Opción {id}
                </label>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-stone-500 hover:text-stone-300"
                  onClick={() =>
                    patchRow(id, {
                      scalePct: design.scale,
                      rotationDeg: design.rotation,
                      mirror: design.mirror,
                    })
                  }
                  title="Tomar la rotación/escala/espejo vigentes del diseño"
                >
                  <RotateCw className="size-3" />
                  Usar diseño actual
                </button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => patchRow(id, { label: normalizeVariantLabel(e.target.value) })}
                  maxLength={LINK_LABEL_MAX + 8} // el truncado elegante fija el tope real
                  placeholder={`Opción ${id}: …`}
                  className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-stone-200 outline-none focus:border-gold/50"
                  aria-label={`Etiqueta de la Opción ${id}`}
                />
                <label className="flex items-center gap-1 text-[10px] text-stone-500">
                  Escala
                  <input
                    type="number"
                    min={70}
                    max={110}
                    step={0.5}
                    value={row.scalePct}
                    onChange={(e) => patchRow(id, { scalePct: Number(e.target.value) })}
                    className="w-16 rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] text-stone-200 outline-none focus:border-gold/50"
                    aria-label={`Escala de la Opción ${id} (%)`}
                  />
                  %
                </label>
                <label className="flex items-center gap-1 text-[10px] text-stone-500">
                  Rot
                  <input
                    type="number"
                    min={0}
                    max={359.5}
                    step={0.5}
                    value={row.rotationDeg}
                    onChange={(e) => patchRow(id, { rotationDeg: Number(e.target.value) })}
                    className="w-16 rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] text-stone-200 outline-none focus:border-gold/50"
                    aria-label={`Rotación de la Opción ${id} (°)`}
                  />
                  °
                </label>
                <label
                  className="flex items-center gap-1 text-[10px] text-stone-500"
                  title="Espejo horizontal del grabado (pipeline pos 7)"
                >
                  <input
                    type="checkbox"
                    className="size-3 accent-gold"
                    checked={row.mirror}
                    onChange={(e) => patchRow(id, { mirror: e.target.checked })}
                    aria-label={`Espejo de la Opción ${id}`}
                  />
                  Espejo
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-right text-[9px] text-stone-600">
        {linkDraft.filter((r) => r.included).length}/3 incluidas · labels ≤ 40
      </p>
    </div>
  );
}
