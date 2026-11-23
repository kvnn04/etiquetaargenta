'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Mail, RefreshCw } from 'lucide-react';
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
  type ClosureReason,
  type PaymentStatus,
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
  /** R11.4/R11.6: motivo del cierre cuando status = 'revocada'. */
  closureReason: ClosureReason | null;
}

export interface PaymentRowView {
  id: string;
  amount: number;
  status: PaymentStatus;
  /** R11.2: ARS devueltos acumulados (nunca supera `amount`). */
  refundedAmount: number;
  occurredMs: number;
  receiptUrl: string | null;
}

export type PagoBanner = 'success' | 'failure' | 'pending' | null;

/** Canales públicos de soporte (R12.7 / decisión 7 del Anexo A). */
export interface SupportChannels {
  email: string | null;
  whatsapp: string | null;
}

/**
 * R12.3: cooldown manual de 20 s. Se replica acá (constante de UI) para no
 * importar `lib/payments/sync.ts` — ese módulo es server-only (MP + service
 * role) y no debe entrar al bundle del cliente.
 */
const MANUAL_COOLDOWN_MS = 20_000;

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'found';
      receiptUrl: string | null;
      plan: Plan;
      status: SubscriptionStatus | null;
    }
  | { kind: 'empty' }
  | { kind: 'mp_down' }
  | { kind: 'error'; message: string };

interface BadgeStyle {
  className: string;
  label: string;
}

/* Badge por estado (colores del sistema: emerald ok, amber aviso, rose/rojo disputa). */
function badgeFor(view: SubscriptionView): BadgeStyle {
  if (view.status === 'revocada') {
    if (view.closureReason === 'chargeback') {
      return {
        className: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        label: 'CONTRACARGO',
      };
    }
    if (view.closureReason === 'refund') {
      return {
        className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        label: 'REEMBOLSADO',
      };
    }
    return {
      className: 'bg-white/5 text-stone-400 border-white/10',
      label: 'CERRADA',
    };
  }
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

/** Badge de una fila del historial (R11.2: el estado del dinero es explícito). */
function paymentBadge(status: PaymentStatus): BadgeStyle {
  switch (status) {
    case 'approved':
      return { className: 'text-emerald-400', label: 'aprobado' };
    case 'rejected':
      return { className: 'text-rose-300', label: 'rechazado' };
    case 'refunded':
      return { className: 'text-amber-300', label: 'REEMBOLSADO' };
    case 'partially_refunded':
      return { className: 'text-amber-300', label: 'REEMBOLSO PARCIAL' };
    case 'charged_back':
      return { className: 'text-rose-300', label: 'CONTRACARGO' };
  }
}

export default function SubscriptionCard({
  sub,
  payments,
  pago,
  nowMs,
  lastSyncedAtMs,
  accountEmail,
  support,
}: {
  sub: SubscriptionView | null;
  payments: PaymentRowView[];
  pago: PagoBanner;
  nowMs: number; // del server (evita hydration shift; PlanWatcher/refresh mantienen vigencia)
  lastSyncedAtMs: number | null;
  accountEmail: string | null;
  support: SupportChannels;
}) {
  const router = useRouter();
  const planPro = sub?.plan === 'pro';
  const planGrace = sub?.plan === 'pro_grace';
  const badge = sub ? badgeFor(sub) : { className: 'bg-white/5 text-stone-400 border-white/10', label: SUBSCRIPTION_STATUS_LABEL.inactiva };
  const anchorDay = sub?.cycleAnchorDate ? cycleAnchorDayOfStr(sub.cycleAnchorDate) : null;
  const nextChargeMs = !planPro && anchorDay ? nextCycleDateMs(anchorDay, nowMs) : null;
  const frozenText =
    sub?.priceFrozen != null ? formatPricePerMonth(sub.priceFrozen, sub.currency) : null;
  /* Solo el pago que FINANCIA el ciclo vigente importa para el aviso parcial
   * (un parcial de un ciclo pasado queda en el historial, sin banner). */
  const fundingPayment = payments.find(
    (p) => p.status === 'approved' || p.status === 'partially_refunded',
  );
  const partialRefund = planPro && fundingPayment?.status === 'partially_refunded';

  /* ------------------------------------------------------------------ */
  /* "Verifico de nuevo" REAL (R12.2/R12.3 + §3.5/§4)                    */
  /* ------------------------------------------------------------------ */
  const [verify, setVerify] = useState<VerifyState>({ kind: 'idle' });
  const [failedChecks, setFailedChecks] = useState(0);
  const [clockMs, setClockMs] = useState(nowMs);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(() =>
    lastSyncedAtMs != null ? lastSyncedAtMs + MANUAL_COOLDOWN_MS : null,
  );

  useEffect(() => {
    if (cooldownUntilMs == null) return;
    const tick = () => {
      const current = Date.now();
      setClockMs(current);
      if (current >= cooldownUntilMs) setCooldownUntilMs(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntilMs]);

  // El server pudo sincronizar on-read después del montaje: el lease manda.
  useEffect(() => {
    if (lastSyncedAtMs == null) return;
    const until = lastSyncedAtMs + MANUAL_COOLDOWN_MS;
    if (until <= Date.now()) return;
    setCooldownUntilMs((prev) => (prev == null || until > prev ? until : prev));
  }, [lastSyncedAtMs]);

  const cooldownSeconds =
    cooldownUntilMs != null && cooldownUntilMs > clockMs
      ? Math.max(1, Math.ceil((cooldownUntilMs - clockMs) / 1000))
      : 0;

  async function verifyNow() {
    if (verify.kind === 'checking' || cooldownSeconds > 0) return;
    setVerify({ kind: 'checking' });

    try {
      const res = await fetch('/api/billing/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sin body: el user_id sale SIEMPRE de la sesión (R12.1/§6).
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        plan?: Plan;
        status?: SubscriptionStatus | null;
        applied?: number;
        repaired?: number;
        receiptUrl?: string | null;
        retryAfterSeconds?: number;
      } | null;

      if (res.status === 429) {
        const seconds = Math.max(1, Number(data?.retryAfterSeconds ?? MANUAL_COOLDOWN_MS / 1000));
        setCooldownUntilMs(Date.now() + seconds * 1000);
        setVerify({ kind: 'idle' });
        return;
      }
      if (res.status === 401) {
        setVerify({
          kind: 'error',
          message: 'Tu sesión venció. Recargá la página para verificar de nuevo.',
        });
        return;
      }
      if (res.status === 409) {
        setVerify({
          kind: 'error',
          message: 'Tu cuenta no está disponible para verificar el pago.',
        });
        return;
      }
      if (res.status === 503) {
        setVerify({
          kind: 'error',
          message: 'Los pagos no están configurados en este entorno.',
        });
        return;
      }
      if (!res.ok) {
        setFailedChecks((n) => n + 1);
        setVerify({ kind: 'mp_down' });
        return;
      }

      // El servidor ya mutó si encontró el pago: solo refrescamos el render.
      // `found` no promete PRO: un rechazo puede dejar el ciclo en gracia.
      const touched = Number(data?.applied ?? 0) + Number(data?.repaired ?? 0) > 0;
      if (data?.plan === 'pro' || touched) {
        setVerify({
          kind: 'found',
          receiptUrl: data?.receiptUrl ?? null,
          plan: data?.plan ?? 'free',
          status: data?.status ?? null,
        });
        setCooldownUntilMs(Date.now() + MANUAL_COOLDOWN_MS);
        setFailedChecks(0);
        router.refresh();
        return;
      }

      setFailedChecks((n) => n + 1);
      setVerify({ kind: 'empty' });
      const retry = Number(data?.retryAfterSeconds ?? MANUAL_COOLDOWN_MS / 1000);
      setCooldownUntilMs(Date.now() + Math.max(1, retry) * 1000);
    } catch {
      setFailedChecks((n) => n + 1);
      setVerify({ kind: 'mp_down' });
    }
  }

  const showSupport = !planPro && failedChecks >= 2;

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

      {/* Posición 13 (R11.5/Q2): parcial no baja el plan. */}
      {partialRefund && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          Registramos un reembolso parcial. Tu plan sigue activo hasta el fin del ciclo.
        </p>
      )}

      {/* -------------------------------------------------------------- */}
      {/* Verificación REAL contra MP (R12.2–R12.5 + §4)                 */}
      {/* Visible SIEMPRE que no haya PRO, con o sin ?pago= (decisión).  */}
      {/* -------------------------------------------------------------- */}
      {(!planPro || verify.kind === 'found') && (
        <div
          aria-live="polite"
          className={cn(
            'mt-3 rounded-lg border px-3 py-2',
            verify.kind === 'found' && verify.plan === 'pro'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : verify.kind === 'found' ||
                  verify.kind === 'empty' ||
                  verify.kind === 'mp_down'
                ? 'border-amber-500/30 bg-amber-500/10'
                : verify.kind === 'error'
                  ? 'border-rose-500/30 bg-rose-500/10'
                  : 'border-white/10 bg-black/30',
          )}
        >
          <p
            className={cn(
              'text-[12px]',
              verify.kind === 'found' && verify.plan === 'pro'
                ? 'text-emerald-200'
                : verify.kind === 'error'
                  ? 'text-rose-200'
                  : verify.kind === 'found' ||
                      verify.kind === 'empty' ||
                      verify.kind === 'mp_down'
                    ? 'text-amber-200'
                    : 'text-stone-300',
            )}
          >
            {verify.kind === 'found'
              ? verify.plan === 'pro'
                ? '¡Listo! Encontramos tu pago y activamos PRO.'
                : `Encontramos tu pago. Tu ciclo quedó en ${
                    verify.status ? SUBSCRIPTION_STATUS_LABEL[verify.status] : 'un estado no activo'
                  }.`
              : verify.kind === 'empty'
                ? 'Todavía no vemos el pago. Puede demorar unos minutos.'
                : verify.kind === 'mp_down'
                  ? 'Mercado Pago no responde en este momento.'
                  : verify.kind === 'error'
                    ? verify.message
                    : pago === 'success'
                      ? 'Estamos verificando tu pago con Mercado Pago…'
                      : '¿Ya pagaste y todavía no ves PRO? Verificá tu pago con Mercado Pago.'}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!planPro && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void verifyNow()}
                disabled={verify.kind === 'checking' || cooldownSeconds > 0}
                aria-busy={verify.kind === 'checking'}
              >
                <RefreshCw
                  className={cn('h-3 w-3', verify.kind === 'checking' && 'animate-spin')}
                />
                {verify.kind === 'checking'
                  ? 'Consultando Mercado Pago…'
                  : cooldownSeconds > 0
                    ? `Verifico de nuevo en ${cooldownSeconds} s`
                    : 'Verifico de nuevo'}
              </Button>
            )}

            {verify.kind === 'found' && verify.receiptUrl && (
              <a
                href={verify.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-gold-soft underline"
              >
                <ExternalLink className="h-3 w-3" /> Ver constancia
              </a>
            )}
          </div>

          {showSupport && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {support.email ? (
                <a
                  href={supportMailto(support.email, accountEmail)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')}
                >
                  <Mail className="h-3 w-3" /> Contactar soporte
                </a>
              ) : null}
              {support.whatsapp ? (
                <a
                  href={supportWhatsapp(support.whatsapp, accountEmail)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')}
                >
                  <ExternalLink className="h-3 w-3" /> WhatsApp
                </a>
              ) : null}
              {!support.email && !support.whatsapp && (
                <span className="text-[10px] text-stone-500">
                  Soporte: configurá NEXT_PUBLIC_SUPPORT_EMAIL / NEXT_PUBLIC_SUPPORT_WHATSAPP.
                </span>
              )}
              <span className="text-[10px] text-stone-500">Respondemos en menos de 24 h.</span>
            </div>
          )}

          {lastSyncedAtMs != null && (
            <p className="mt-1 text-[10px] text-stone-500">
              Última verificación: {formatDateAR(lastSyncedAtMs) ?? '—'}
            </p>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- */}
      {/* Estado del ciclo (R8 gracia / R9 cierre programado / R4 alto)   */}
      {/* -------------------------------------------------------------- */}
      {statusMessage(sub, payments.length > 0, nowMs)}

      {/* Posición 13: acciones de la revocación (R11.4/R11.6/§4). */}
      {sub?.status === 'revocada' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sub.closureReason === 'chargeback' ? (
            <>
              {support.email ? (
                <a
                  href={supportMailto(support.email, accountEmail)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')}
                >
                  <Mail className="h-3 w-3" /> Contactar soporte
                </a>
              ) : null}
              <PortalButton />
            </>
          ) : (
            <a
              href="/editor?paywall=1"
              className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'w-fit')}
            >
              Reactivar PRO
            </a>
          )}
        </div>
      )}

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
              {payments.map((p) => {
                const badgeRow = paymentBadge(p.status);
                const refunded =
                  p.status === 'refunded' || p.status === 'partially_refunded';
                return (
                  <tr key={p.id} className="border-b border-line/30 text-stone-300">
                    <td className="py-1.5 pr-3 font-mono">{formatDateAR(p.occurredMs)}</td>
                    <td className="py-1.5 pr-3">
                      <div>{formatArs(p.amount) ?? '—'}</div>
                      {refunded && p.refundedAmount > 0 && (
                        <div className="text-[10px] text-amber-300">
                          devuelto {formatArs(p.refundedAmount) ?? '—'}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={badgeRow.className}>{badgeRow.label}</span>
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
                );
              })}
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
  if (sub?.status === 'revocada') {
    if (sub.closureReason === 'chargeback') {
      return (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          Se inició un contracargo sobre tu pago. El acceso PRO está suspendido mientras se
          resuelve. Tus proyectos, assets y links siguen guardados.
        </p>
      );
    }
    if (sub.closureReason === 'refund') {
      return (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          Reembolsamos tu último pago. El plan PRO quedó inactivo; tus proyectos y links siguen
          guardados.
        </p>
      );
    }
    return (
      <p className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-stone-300">
        Tu suscripción quedó cerrada. Tus proyectos, assets y links siguen guardados: podés
        reactivar PRO cuando quieras con un checkout nuevo.
      </p>
    );
  }
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

/**
 * Soporte (decisión 7): el mensaje lleva la cuenta y el contexto, NUNCA datos
 * de tarjeta. El `mp_payment_id` no está en la fila que ve el cliente; el
 * email de la cuenta alcanza para que soporte cruce el pago.
 */
function supportMailto(email: string, accountEmail: string | null): string {
  const subject = encodeURIComponent('Ayuda con mi pago — Simulador Mates');
  const body = encodeURIComponent(
    'Hola, necesito ayuda con mi pago.\n\n' +
      `Cuenta: ${accountEmail ?? '—'}\n` +
      'Ya verifiqué dos veces y todavía no veo el plan PRO.\n\n' +
      'Por favor revisen el pago en Mercado Pago.',
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function supportWhatsapp(raw: string, accountEmail: string | null): string {
  const digits = raw.replace(/\D/g, '');
  const text = encodeURIComponent(
    `Hola, necesito ayuda con mi pago. Cuenta: ${accountEmail ?? '—'}. ` +
      'Ya verifiqué dos veces y todavía no veo el plan PRO.',
  );
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
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
