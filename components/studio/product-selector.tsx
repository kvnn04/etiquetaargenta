'use client';

/* ============================================================================
 * SELECTOR DE PRODUCTO — spec_tipo_de_mate.md §4 (UI)
 * ----------------------------------------------------------------------------
 * Segmented Control (radio-cards, `role="radiogroup"`): silueta SVG de perfil
 * derivada del catálogo (sin mini-renders 3D) + label + bajada.
 * Solo-datos: un producto nuevo en CATALOG (lib/catalog.ts) aparece acá sin
 * tocar este componente.
 *
 * Camionero/Imperial (pro:false) son FREE ⇒ gancho de la demo. Un producto
 * futuro pro:true se ve atenuado con candado y su clic abre el Paywall
 * (R2 de spec_auth: nunca un toast de error).
 * ============================================================================ */

import { cn } from '@/lib/cn';
import { CATALOG, silhouetteOf } from '@/lib/catalog';
import { gate, type Capability, type Plan } from '@/lib/permissions';
import { Lock } from 'lucide-react';

export default function ProductSelector({
  activeId,
  plan,
  onSelect,
  onLockedSelect,
}: {
  activeId: string;
  plan: Plan;
  onSelect: (id: string) => void;
  onLockedSelect: () => void;
}) {
  return (
    <div role="radiogroup" aria-label="Modelo de mate" className="grid gap-2 sm:grid-cols-2">
      {CATALOG.map((product) => {
        const capability: Capability = product.pro ? 'product.pro.catalog' : 'editor.model';
        const locked = !gate(capability, plan);
        const active = product.id === activeId;
        const silhouette = silhouetteOf(product);

        return (
          <button
            key={product.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={locked}
            onClick={() => (locked ? onLockedSelect() : onSelect(product.id))}
            className={cn(
              'group flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition-colors duration-150',
              locked && 'cursor-not-allowed opacity-45',
              !active && !locked && 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5',
            )}
          >
            <svg
              viewBox={silhouette.viewBox}
              className={cn(
                'h-16 w-14 shrink-0 transition-colors duration-150',
                active ? 'text-gold-soft' : 'text-stone-500 group-hover:text-stone-400',
              )}
              aria-hidden="true"
            >
              <path
                d={silhouette.path}
                fill="currentColor"
                fillOpacity={active ? 0.18 : 0.08}
                stroke="currentColor"
                strokeWidth={1.5}
              />
            </svg>
            <span
              className={cn(
                'text-xs font-bold transition-colors duration-150',
                active ? 'text-gold-soft' : 'text-stone-300',
              )}
            >
              {product.label}
            </span>
            <span className="text-[10px] leading-tight text-stone-500">{product.description}</span>
            {locked && <Lock className="h-3 w-3 text-rose-400" aria-label="Requiere plan PRO" />}
          </button>
        );
      })}
    </div>
  );
}
