'use client';

/* ============================================================================
 * SELECTOR DE PRODUCTO — catálogo por FAMILIA/CATEGORÍA
 * ----------------------------------------------------------------------------
 * Radio-cards con silueta SVG (sin mini-renders 3D). El componente es
 * solo-datos: agrupa `CATALOG` por `PRODUCT_CATEGORIES` y muestra únicamente
 * las categorías con productos (las "Próximamente" quedan ocultas hasta que
 * exista una entrada real).
 *
 * Camionero/Imperial/Termo (pro:false) son FREE ⇒ gancho de la demo. Un
 * producto pro:true se ve atenuado con candado y su clic abre el Paywall.
 * ============================================================================ */

import { cn } from '@/lib/cn';
import { CATALOG, PRODUCT_CATEGORIES, silhouetteOf } from '@/lib/catalog';
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
  const groups = PRODUCT_CATEGORIES.map((category) => ({
    category,
    products: CATALOG.filter((product) => product.category === category.id),
  })).filter((group) => group.products.length > 0);

  return (
    <div role="radiogroup" aria-label="Producto" className="space-y-4">
      {groups.map(({ category, products }) => (
        <section key={category.id} aria-label={category.label}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
              {category.label}
            </h4>
            <span className="text-[9px] text-stone-600">{category.description}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((product) => {
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
                    active && 'border-gold bg-gold/10',
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
        </section>
      ))}
    </div>
  );
}
