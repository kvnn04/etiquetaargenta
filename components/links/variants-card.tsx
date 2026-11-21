'use client';

import { Info } from 'lucide-react';

/**
 * TARJETA "Variantes del Enlace" — posición 10A (decisión del titular,
 * nov-2026): las variantes A/B/C están DESACTIVADAS.
 * ----------------------------------------------------------------------------
 * El Enlace Comercial publica UN SOLO diseño (el vigente del editor) con su
 * rotación, escala y espejo congelados. El payload y el visor siguen leyendo
 * links legacy con A/B/C: las versiones ya publicadas no se tocan.
 *
 * El borrador `projects.state.linkDraft` se conserva en la base para no perder
 * el trabajo del taller si la función se reactiva más adelante; esta tarjeta
 * ya no lo edita.
 */

export default function VariantsCard() {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-stone-500" />
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Variantes del Enlace
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-stone-300">
            Solo se puede enviar un diseño por ahora.
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-stone-600">
            El enlace publica el diseño actual con su rotación, escala y espejo. Las opciones
            A/B/C quedaron desactivadas; los enlaces viejos que ya las tienen siguen abriéndose
            igual.
          </p>
        </div>
      </div>
    </div>
  );
}
