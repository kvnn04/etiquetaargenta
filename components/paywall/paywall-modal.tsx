'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  X,
  ShieldCheck,
  Link2,
  FileDown,
  BadgeCheck,
  Loader2,
  MailCheck,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatArs } from '@/lib/payments/core';
import { LEGAL_LINKS } from '@/lib/legal/links';

/**
 * Modal Paywall (spec_autenticacion_y_modelo_freemium §4 + spec_pagos §4):
 * precio dinámico leído del backend, beneficios concretos y CTA único hacia
 * Mercado Pago. El checkout usa un PLAN de suscripción (spec_pagos_plan_mp.md):
 *   · CTA → POST /api/billing/checkout (gates server-side: sesión, email,
 *     precio, suscripción viva) → redirección al `init_point` del plan.
 *   · MP pide la cuenta de Mercado Pago del pagador en su checkout: no hace
 *     falta que coincida con el email de la cuenta del taller.
 *   · 409 EMAIL_NOT_VERIFIED ⇒ PASO INTERMEDIO inline (spec_pagos §4:
 *     "Confirmá tu email para continuar", token 24 h) con reenvío y
 *     re-verificación sin perder el flujo.
 *   · 409 SUSCRIPCION_VIVA ⇒ cerrar + router.refresh() (el webhook puede
 *     haber llegado tarde: "Activando…" honesto, no se duplican cargas).
 * Sin countdown ni urgencia artificial (R5 de dark patterns cerradas).
 */
export interface PriceInfo {
  amount: number;
  currency: string;
  updatedAt: string;
}

const BENEFITS = [
  { icon: ShieldCheck, text: 'Sin marca de agua en tus renders' },
  { icon: Link2, text: 'Links ilimitados para WhatsApp' },
  { icon: FileDown, text: 'Fichas en HD (PNG / PDF)' },
  { icon: BadgeCheck, text: 'Tu logo en la cabecera (white-label)' },
];

type CheckoutPhase = 'idle' | 'starting' | 'redirecting' | 'email' | 'already_active' | 'error';

const ERROR_BY_CODE: Record<string, string> = {
  PRECIO_NO_DISPONIBLE:
    'El precio del plan no está disponible en este momento — reintentá en un rato.',
  PAGOS_NO_CONFIGURADOS:
    'La caja de pagos aún no está configurada (faltan las credenciales de Mercado Pago).',
  MP_UNAVAILABLE: 'Mercado Pago no respondió — reintentá en unos minutos.',
  EVIDENCIA_NO_DISPONIBLE:
    'No pudimos registrar tu aceptación legal, así que no iniciamos el cobro. Reintentá en un rato.',
  LEGAL_NOT_ACCEPTED: 'Marcá la aceptación de los Términos y la Política de Privacidad para pagar.',
  LEGAL_VERSION_CHANGED:
    'Actualizamos los documentos legales. Cerrá este paso, revisá las versiones vigentes y volvé a aceptar.',
};

export default function PaywallModal({
  open,
  price,
  priceError,
  legalVersions,
  onClose,
}: {
  open: boolean;
  price: PriceInfo | null;
  priceError: boolean;
  /** Posición 12: versiones SERVER-SIDE (nunca se leen envs en el cliente). */
  legalVersions: { terms: string; privacy: string };
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  /* R13.12: checkbox SIEMPRE vacío y nunca premarcado. */
  const [legalAccepted, setLegalAccepted] = useState(false);
  const router = useRouter();

  /* Reabrir limpio: cada intento de pago arranca desde idle y sin aceptación. */
  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setErrorMsg(null);
      setResendState('idle');
      setLegalAccepted(false);
    }
  }, [open]);

  const startCheckout = useCallback(async () => {
    if (!legalAccepted) {
      setErrorMsg(ERROR_BY_CODE.LEGAL_NOT_ACCEPTED ?? null);
      setPhase('error');
      return;
    }
    setPhase('starting');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalAccepted: true,
          termsVersion: legalVersions.terms,
          privacyVersion: legalVersions.privacy,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { initPoint?: string; error?: string }
        | null;

      if (res.ok) {
        if (body?.initPoint) {
          // Checkout Pro: salida del app — MP hospeda el alta de tarjeta.
          setPhase('redirecting');
          window.location.assign(body.initPoint);
          return;
        }
      }
      if (res.status === 409) {
        if (body?.error === 'EMAIL_NOT_VERIFIED') {
          setPhase('email'); // paso intermedio inline (§4)
          return;
        }
        if (body?.error === 'SUSCRIPCION_VIVA') {
          setPhase('already_active'); // webhook tarde o página vieja
          return;
        }
        if (body?.error === 'LEGAL_VERSION_CHANGED') {
          /* R13.13: la versión cambió ⇒ hay que volver a aceptar la nueva,
             nunca reutilizar el tilde de la versión anterior. */
          setLegalAccepted(false);
          setErrorMsg(ERROR_BY_CODE.LEGAL_VERSION_CHANGED ?? null);
          setPhase('error');
          router.refresh(); // trae las versiones vigentes del server
          return;
        }
        if (body?.error === 'LEGAL_NOT_ACCEPTED') {
          setLegalAccepted(false);
          setErrorMsg(ERROR_BY_CODE.LEGAL_NOT_ACCEPTED ?? null);
          setPhase('error');
          return;
        }
      }
      setErrorMsg(
        (body?.error && ERROR_BY_CODE[body.error]) ?? 'No pudimos iniciar el pago — reintentá.',
      );
      setPhase('error');
    } catch {
      setErrorMsg('No pudimos contactar la caja — revisá tu conexión y reintentá.');
      setPhase('error');
    }
  }, [legalAccepted, legalVersions, router]);

  const resendVerification = useCallback(async () => {
    setResendState('sending');
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      setResendState('failed');
      setErrorMsg('No encontramos el email de tu sesión — volvé a entrar y reintentá.');
      return;
    }
    // Token de 24 h (spec usuario R7). Con confirm OFF en Supabase el envío
    // real solo ocurre si la dirección quedó sin confirmar (QA: seed NULL).
    const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
    setResendState(error ? 'failed' : 'sent');
  }, []);

  if (!open) return null;
  const priceText = price ? formatArs(price.amount, price.currency) : null;

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

        {phase === 'email' ? (
          <div className="mt-4 rounded-xl border border-gold/25 bg-black/30 p-4">
            <div className="flex items-start gap-3">
              <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold-soft" />
              <div>
                <p className="text-sm font-semibold text-cream">Confirmá tu email para continuar</p>
                <p className="mt-1 text-xs text-stone-400">
                  Te manda un token de 24 h al email de tu taller. Confirmalo y volvé acá — el
                  flujo sigue donde quedó.
                </p>
              </div>
            </div>
            <Button
              variant="green"
              size="lg"
              className="mt-4 w-full"
              onClick={resendVerification}
              disabled={resendState === 'sending' || resendState === 'sent'}
            >
              {resendState === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
              {resendState === 'sent' ? 'Email enviado ✓' : <><Send className="h-4 w-4" /> Reenviar email de verificación</>}
            </Button>
            {resendState === 'failed' && (
              <p className="mt-2 text-center text-[11px] text-red-400">
                No se pudo reenviar — esperá un par de minutos y tocá de nuevo.
              </p>
            )}
            <Button variant="outline" className="mt-2 w-full" onClick={startCheckout}>
              Ya lo confirmé — verificar de nuevo
            </Button>
          </div>
        ) : phase === 'already_active' ? (
          <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4">
            <p className="text-sm font-semibold text-cream">Ya tenés una suscripción en curso</p>
            <p className="mt-1 text-xs text-stone-400">
              Si recién la activaste, esta vista puede estar desactualizada — refrescá el
              estado sin recargar todo.
            </p>
            <Button
              variant="green"
              className="mt-3 w-full"
              onClick={() => {
                onClose();
                router.refresh();
              }}
            >
              Actualizar estado
            </Button>
          </div>
        ) : (
          <>
            {/* R13.7/R13.12: aceptación EXPLÍCITA, sin premarcar. La evidencia
                versionada se guarda server-side antes de crear el cobro. */}
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-black/20 px-3 py-3 text-[11px] leading-relaxed text-stone-300">
              <input
                type="checkbox"
                checked={legalAccepted}
                onChange={(event) => {
                  setLegalAccepted(event.target.checked);
                  if (errorMsg && (phase === 'error' || phase === 'idle')) {
                    setErrorMsg(null);
                    setPhase('idle');
                  }
                }}
                aria-describedby="paywall-legal-detail"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#b88a4e]"
              />
              <span>
                Leí y acepto los{' '}
                <Link
                  href={LEGAL_LINKS.terms}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-gold-soft underline underline-offset-2 hover:text-gold"
                >
                  Términos y Condiciones
                </Link>{' '}
                (v{legalVersions.terms}) y la{' '}
                <Link
                  href={LEGAL_LINKS.privacy}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-gold-soft underline underline-offset-2 hover:text-gold"
                >
                  Política de Privacidad
                </Link>{' '}
                (v{legalVersions.privacy}) del Plan PRO.
              </span>
            </label>
            <p id="paywall-legal-detail" className="mt-2 text-center text-[10px] leading-relaxed text-stone-600">
              Suscripción mensual de renovación automática hasta que pidas la baja. Precio final en
              ARS con impuestos incluidos. Podés arrepentirte dentro de los 10 días corridos y dar de
              baja desde el{' '}
              <Link
                href={LEGAL_LINKS.cancellation}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-gold-soft"
              >
                Botón de Baja
              </Link>
              , sin login.
            </p>
            <p className="mt-1.5 text-center text-[10px] leading-relaxed text-stone-500">
              Podés pagar con cualquier cuenta de Mercado Pago, aunque su email sea distinto al
              de tu taller.
            </p>

            <Button
              variant="green"
              size="lg"
              className="mt-3 w-full"
              disabled={!priceText || !legalAccepted || phase === 'starting' || phase === 'redirecting'}
              onClick={startCheckout}
            >
              {phase === 'starting' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Abriendo Mercado Pago…
                </>
              )}
              {phase === 'redirecting' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Conectando con Mercado Pago…
                </>
              )}
              {(phase === 'idle' || phase === 'error') && <>Pagar Suscripción con Mercado Pago</>}
            </Button>
            {phase === 'error' && (
              <p
                role="alert"
                className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-red-400"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {errorMsg}
              </p>
            )}
            <p className="mt-3 text-center text-[10px] leading-relaxed text-stone-600">
              Cobro automático por tarjeta. Cancelable cuando quieras desde el Portal de Mercado
              Pago o desde el Botón de Baja de Servicio.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
