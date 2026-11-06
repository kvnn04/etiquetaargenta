'use client';

import { X, ShieldCheck, Link2, FileDown, BadgeCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Modal Paywall (spec_autenticacion_y_modelo_freemium.md §4):
 * precio dinámico leído del backend, beneficios concretos y CTA único
 * hacia Mercado Pago. La pos 8 dejó encendida la seam de licencia real
 * (`/api/exports/ticket` — 402 abre ESTE modal); el Checkout Pro se conecta
 * en la posición 10 (spec_pagos) — el CTA sigue deshabilitado con
 * explicación honesta mientras tanto.
 */
export interface PriceInfo {
  amount: number;
  currency: string;
  updatedAt: string;
}

function formatArs(price: PriceInfo | null): string | null {
  if (!price) return null;
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: price.currency,
      maximumFractionDigits: 0,
    }).format(price.amount);
  } catch {
    return `${price.currency} ${price.amount}`;
  }
}

const BENEFITS = [
  { icon: ShieldCheck, text: 'Sin marca de agua en tus renders' },
  { icon: Link2, text: 'Links ilimitados para WhatsApp' },
  { icon: FileDown, text: 'Fichas en HD (PNG / PDF)' },
  { icon: BadgeCheck, text: 'Tu logo en la cabecera (white-label)' },
];

export default function PaywallModal({
  open,
  price,
  priceError,
  onClose,
}: {
  open: boolean;
  price: PriceInfo | null;
  priceError: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  const priceText = formatArs(price);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
    >
      <div className="thin-scroll relative w-full max-w-md rounded-2xl border border-gold/30 bg-panel-soft p-6 shadow-2xl shadow-black/60">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-[10px] uppercase tracking-[.24em] text-gold-soft">Plan PRO</p>
        <h2 id="paywall-title" className="mt-1 text-xl font-bold text-cream">
          ¡Llevá las ventas de tu taller al siguiente nivel!
        </h2>

        <ul className="mt-4 space-y-2.5">
          {BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-sm text-stone-300">
              <Icon className="h-4 w-4 shrink-0 text-emerald-400" />
              {text}
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-xl border border-gold/25 bg-black/30 p-4 text-center">
          {priceError ? (
            <p className="text-xs text-amber-300">
              Precio desde <span className="font-mono">pricing_config</span> no disponible —
              revisá SUPABASE_SERVICE_ROLE_KEY y la migración 0001.
            </p>
          ) : priceText ? (
            <>
              <div className="text-2xl font-bold text-cream">{priceText}</div>
              <div className="text-xs text-stone-500">por mes · ARS</div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs text-stone-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando precio…
            </div>
          )}
        </div>

        <Button variant="green" size="lg" className="mt-4 w-full" disabled title="Se activa al conectar Checkout Pro (posición 10)">
          Pagar Suscripción con Mercado Pago
        </Button>
        <p className="mt-1 text-center text-[11px] text-stone-500">
          (El Checkout Pro se conecta con la posición 10 del{' '}
          <span className="font-mono">orden_de_implementacion.md</span>.)
        </p>
        <p className="mt-3 text-center text-[10px] leading-relaxed text-stone-600">
          Cobro automático por tarjeta. Cancelable cuando quieras desde el Portal de Mercado Pago.
        </p>
      </div>
    </div>
  );
}
