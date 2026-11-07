'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  formatArs,
  formatDateAR,
  formatPricePerMonth,
  graceDaysLeft,
  MERCADOPAGO_PORTAL_URL,
  nextCycleDateMs,
  cycleAnchorDayOfStr,
  SUBSCRIPTION_STATUS_LABEL,
  type SubscriptionStatus,
} from '@/lib/payments/core';
import type { Plan } from '@/lib/permissions';

/* ==========================================================================
 * CENTRO DE SUSCRIPCIÓN — posición 10B (spec_pagos.md §4 + R4/R8/R9/R10)
 * --------------------------------------------------------------------------
 * Vista DENTRO del Panel de Perfil: plan vigente, precio CONGELADO con tag
 * "precio de tu alta" (grandfathering R4 visible), próxima fecha de cobro
 * (ancla R1, tz AR del core), historial con constancia MP (R6: la app guarda
 * receipt_url y lo expone — la factura ARCA la emite a mano el responsable) y
 * botón único del Portal de MP (R9: cancelar/tarjeta SOLO ahí; los botones
 * in-app lo abren y ya).
 * Banners por estado (§4): gracia con días restantes; cierre programado con
 * fecha exacta. Retorno de Checkout: success activo → 🎉; success sin
 * webhook aún → "Activando…" + re-verificar; failure/pending honestos.
 * Sin countdown de urgencia y sin dark patterns (R5) — solo datos reales.
 * ========================================================================== */

export interface SubscriptionView {
  /** Fila de subscriptions o inexistente; plan SIEMPRE viene de users.plan (gating). */
  status: SubscriptionStatus | 'sin_suscripcion';
  plan: Plan;
  priceFrozen: number | null; // null ⇒ sin ciclo R4 que mostrar
  currency: string;
  cycleAnchorDate: string | null; // 'YYYY-MM-DD' (DATE de Postgres)
  graceExpiresMs: number | null;
  periodEndMs: number | null;
  preapprovalId: string | null; // eco del id MP en el pie (contexto de soporte)
}

export interface PaymentRowView {
  id: string;
  amount: number;
  status: 'approved' | 'rejected';
  occurredMs: number;
  receiptUrl: string | null;
}

export type PagoBanner = 'success' | 'failure' | 'pending' | null;

interface BadgeStyle {
  className: string;
  label: string;
}

/* Badge por estado (colores del sistema: emerald ok, amber aviso, stone neutro). */
function badgeFor(view: SubscriptionView): BadgeStyle {
  if (view.status === 'activa' || view.plan === 'pro') {
    return { className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: SUBSCRIPTION_STATUS_LABEL.activa };
  }
  if (view.status === 'gracia' || view.plan === 'pro_grace') {
    return { className: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: SUBSCRIPTION_STATUS_LABEL.gracia };
  }
  if (view.status === 'programada_cierre') {
    return { className: 'bg-sky-500/15 text-sky-300 border-sky-500/30', label: SUBSCRIPTION_STATUS_LABEL.programada_cierre };
  }
  return { className: 'bg-white/5 text-stone-400 border-white/10', label: SUBSCRIPTION_STATUS_LABEL.inactiva };
}

export default function SubscriptionCard({
  sub,
  payments,
  pago,
  nowMs,
}: {
  sub: SubscriptionView | null;
  payments: PaymentRowView[];
  pago: PagoBanner;
  nowMs: number; // del server (evita hydration shift; PlanWatcher/refresh mantienen vigencia)
}) {
  const router = useRouter();
  const planPro = sub?.plan === 'pro';
  const planGrace = sub?.plan === 'pro_grace';
  const badge = sub ? badgeFor(sub) : { className: 'bg-white/5 text-stone-400 border-white/10', label: SUBSCRIPTION_STATUS_LABEL.inactiva };
  const anchorDay = sub?.cycleAnchorDate ? cycleAnchorDayOfStr(sub.cycleAnchorDate) : null;
  const nextChargeMs = !planPro && anchorDay ? nextCycleDateMs(anchorDay, nowMs) : null;
  const frozenText =
    sub?.priceFrozen != null ? formatPricePerMonth(sub.priceFrozen, sub.currency) : null;

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
            Plan PRO
          </h2>
          <p className="mt-1 text-[11px] text-stone-500">
            Tu ciclo de cobro: débito automático de tarjeta, cancelación desde el Portal.
          </p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      {/* -------------------------------------------------------------- */}
      {/* Retorno del Checkout Pro (§4): banner inline honesto            */}
      {/* -------------------------------------------------------------- */}
      {pago === 'success' && planPro && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-semibold text-emerald-300">
          ¡Plan PRO activo! 🎉 — todas tus pestañas ya están desbloqueadas.
        </p>
      )}
      {pago === 'success' && !planPro && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <span className="text-[12px] text-amber-200">
            Activando tu plan… el webhook de Mercado Pago sigue llegando <b>(Activando…)</b>.
          </span>
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>
            <RefreshCw className="h-3 w-3" /> Verifico de nuevo
          </Button>
        </div>
      )}
      {pago === 'failure' && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          El pago no se completó — podés reintentarlo desde el editor (candado 🔒) cuando quieras.
        </p>
      )}
      {pago === 'pending' && (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-stone-300">
          El pago quedó <b>en proceso</b>: si se aprueba, tu plan se activa solo (banner en todas
          las pestañas) y recibís la constancia por email.
        </p>
      )}

      {/* -------------------------------------------------------------- */}
      {/* Estado del ciclo (R8 gracia / R9 cierre programado / R4 alto)   */}
      {/* -------------------------------------------------------------- */}
      {statusMessage(sub, payments.length > 0, nowMs)}

      {frozenText && anchorDay && sub?.status !== 'sin_suscripcion' && (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
          <div className="rounded-lg bg-black/30 px-3 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-stone-500">Precio de tu alta</dt>
            <dd className="mt-0.5 font-semibold text-cream">
              {formatArs(sub?.priceFrozen ?? 0, sub?.currency ?? 'ARS')}
              <span className="text-stone-500"> / mes</span>
            </dd>
            <dd className="text-[10px] text-stone-500">congelado — no sube mientras sigas suscripto (R4)</dd>
          </div>
          <div className="rounded-lg bg-black/30 px-3 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-stone-500">
              {planPro || planGrace ? 'Próximo cobro' : 'Próxima fecha del ciclo'}
            </dt>
            <dd className="mt-0.5 font-semibold text-cream">
              {nextChargeMs ? formatDateAR(nextChargeMs) : '—'}
            </dd>
            <dd className="text-[10px] text-stone-500">
              débito el día <b>{anchorDay}</b> de cada mes
            </dd>
          </div>
        </dl>
      )}

      {planPro && sub?.status === 'programada_cierre' && sub.periodEndMs != null && (
        <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
          Cierre programado: tus candados vuelven el <b>{formatDateAR(sub.periodEndMs)}</b>. Sin
          cobros extra — podés reactivarte cuando quieras desde este centro.
        </p>
      )}
      {planGrace && sub?.graceExpiresMs != null && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-[11px] text-amber-200">
            <b>Cuenta regresiva:</b> {graceDaysLeft(sub.graceExpiresMs, nowMs)} día(s) de gracia
            restantes (vence {formatDateAR(sub.graceExpiresMs)}). Actualizá la tarjeta y tu PRO
            vuelve al instante.
          </p>
          <div className="mt-2">
            <PortalButton />
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- */}
      {/* Historial (privado por RLS) + constancia MP (R6)               */}
      {/* -------------------------------------------------------------- */}
      <h3 className="mt-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">
        Historial de pagos
      </h3>
      {payments.length === 0 ? (
        <p className="mt-2 text-[11px] text-stone-500">
          Todavía no hay cobros registrados. Tras cada débito aparece acá con su constancia
          (factura ARCA: la emite a mano el responsable del SaaS, R6).
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-stone-500">
              <tr className="border-b border-line/50">
                <th className="py-1.5 pr-3 font-medium">Fecha</th>
                <th className="py-1.5 pr-3 font-medium">Monto</th>
                <th className="py-1.5 pr-3 font-medium">Estado</th>
                <th className="py-1.5 font-medium">Constancia</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-line/30 text-stone-300">
                  <td className="py-1.5 pr-3 font-mono">{formatDateAR(p.occurredMs)}</td>
                  <td className="py-1.5 pr-3">{formatArs(p.amount) ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    {p.status === 'approved' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">aprobado</span>
                    ) : (
                      <span className="text-rose-300">rechazado</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    {p.receiptUrl ? (
                      <a
                        href={p.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-gold-soft underline"
                      >
                        <ExternalLink className="h-3 w-3" /> ver
                      </a>
                    ) : (
                      <span className="text-stone-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PortalButton />
        {planPro && (
          <p className="text-[10px] text-stone-500">
            {sub?.preapprovalId ? 'Suscripción MP ' + sub.preapprovalId.slice(-8) : null}
          </p>
        )}
      </div>
    </section>
  );
}

/** Mensaje del ciclo según el estado (banners §4: gracia/cierre/vacío). */
function statusMessage(sub: SubscriptionView | null, hasPayments: boolean, nowMs: number) {
  if (!sub || sub.status === 'inactiva' || sub.status === 'sin_suscripcion') {
    return (
      <p className="mt-3 text-[11px] text-stone-500">
        {hasPayments
          ? 'No hay suscripción activa: tus proyectos, assets y links siguen guardados — podés activar PRO cuando quieras al precio vigente (R4).'
          : 'Sin suscripción activa. Desbloqueá PRO desde el editor: tocá cualquier candado 🔒 y abrí el paywall.'}
      </p>
    );
  }
  if (sub.status === 'gracia' && sub.graceExpiresMs != null && nowMs >= sub.graceExpiresMs) {
    return (
      <p className="mt-3 text-[11px] text-amber-300">
        La ventana de gracia ya venció: cuando la reconciliación corra, los candados reaparecen y
        tu cuenta vuelve a FREE (proyectos, assets y links se conservan).
      </p>
    );
  }
  return null;
}

/** R9: el ÚNICO acceso a cancelar/actualizar tarjeta es el portal oficial. */
function PortalButton() {
  return (
    <a
      href={MERCADOPAGO_PORTAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')}
    >
      <ExternalLink className="h-3 w-3" /> Abrir Portal de Mercado Pago
    </a>
  );
}
