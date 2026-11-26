'use client';

/* ============================================================================
 * CONFIRMACIÓN DE BAJA — posición 12 (R13.6 + §4 "Baja")
 * ----------------------------------------------------------------------------
 * La página NO confirma al abrirse: muestra el código y pide un click explícito
 * (evita que un escáner de email o un tercero cancele). El POST consume el
 * token de un solo uso; el servidor verifica que el email sea de la cuenta y
 * que el preapproval no sea ajeno antes de cancelar.
 * ============================================================================ */

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, ShieldAlert, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LEGAL_LINKS } from '@/lib/legal/links';
import { FormError } from '@/components/legal/legal-form-ui';

interface ConfirmState {
  code: string;
  status: string;
  periodEndMs: number | null;
  manual: boolean;
  alreadyConfirmed: boolean;
  message: string;
}

function formatMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'long',
  });
}

export default function BajaConfirm({
  token,
  code,
  emailMasked,
  expiresAtMs,
  expired,
  confirmed,
}: {
  token: string;
  code: string;
  emailMasked: string;
  expiresAtMs: number | null;
  expired: boolean;
  confirmed: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmState | null>(null);

  const expiresLabel = expiresAtMs
    ? new Date(expiresAtMs).toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/legal/baja/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            code?: string;
            status?: string;
            periodEndMs?: number | null;
            manual?: boolean;
            alreadyConfirmed?: boolean;
            message?: string;
          }
        | null;

      if ((response.ok || response.status === 202) && payload?.ok) {
        setResult({
          code: payload.code ?? code,
          status: payload.status ?? 'resuelta',
          periodEndMs: payload.periodEndMs ?? null,
          manual: Boolean(payload.manual),
          alreadyConfirmed: Boolean(payload.alreadyConfirmed),
          message: payload.message ?? 'Baja procesada.',
        });
        return;
      }
      setError(
        payload?.message ??
          (response.status === 410
            ? 'El link venció. Pedí uno nuevo desde el Botón de Baja.'
            : 'No pudimos confirmar la baja. Reintentá en un momento.'),
      );
    } catch {
      setError('No pudimos contactar el servidor. Revisá tu conexión y reintentá.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const periodEnd = formatMs(result.periodEndMs);
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-emerald-500/35 bg-emerald-950/20 p-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-emerald-300">
          <Check className="h-4 w-4" aria-hidden />
          {result.manual ? 'Baja en proceso' : 'Baja confirmada'}
        </p>
        <code className="mt-3 block rounded-lg border border-emerald-500/25 bg-black/30 px-3 py-2 font-mono text-sm text-cream">
          {result.code}
        </code>
        <p className="mt-3 text-sm leading-relaxed text-stone-200">{result.message}</p>
        {periodEnd && !result.manual && (
          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            Tu acceso PRO sigue hasta el <strong className="text-stone-200">{periodEnd}</strong>.
            Después vuelven los límites del plan FREE, conservando proyectos, assets y links.
          </p>
        )}
        {/* El caso manual ya viene explicado con precisión en `result.message`
            (reembolso procesado, rechazado o en curso). No se agrega un texto
            genérico que podría contradecirlo. */}
        <p className="mt-4 text-[11px] leading-relaxed text-stone-500">
          Guardá este código. Si necesitás revertir la baja, escribinos dentro de los 30 días.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/editor"
            className="inline-flex min-h-9 items-center rounded-lg border border-white/15 px-3 text-xs font-semibold text-stone-200 hover:border-gold/40 hover:text-gold-soft"
          >
            Volver al simulador
          </Link>
          <Link
            href={LEGAL_LINKS.privacy}
            className="inline-flex min-h-9 items-center rounded-lg border border-white/15 px-3 text-xs font-semibold text-stone-200 hover:border-gold/40 hover:text-gold-soft"
          >
            Política de Privacidad
          </Link>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div role="status" className="rounded-2xl border border-line bg-panel p-5">
        <p className="text-sm font-semibold text-cream">Esta solicitud ya estaba confirmada</p>
        <p className="mt-2 text-xs leading-relaxed text-stone-400">
          Código <span className="font-mono text-stone-200">{code}</span>. Si querés consultar el
          estado o revertir la baja, escribinos desde el canal publicado.
        </p>
        <Link href={LEGAL_LINKS.cancellation} className="mt-4 inline-block text-xs font-semibold text-gold-soft underline underline-offset-4">
          Ir al Botón de Baja
        </Link>
      </div>
    );
  }

  if (expired) {
    return (
      <div role="status" className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
          <ShieldAlert className="h-4 w-4" aria-hidden /> El link de confirmación venció
        </p>
        <p className="mt-2 text-xs leading-relaxed text-amber-100/90">
          Por seguridad, el link de la solicitud <span className="font-mono">{code}</span> dura 24
          horas. No se canceló nada. Pedí uno nuevo desde el Botón de Baja con el mismo email: se
          conserva el código.
        </p>
        <Link href={LEGAL_LINKS.cancellation} className="mt-4 inline-block text-xs font-semibold text-gold-soft underline underline-offset-4">
          Generar un link nuevo
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <p className="text-[10px] font-bold uppercase tracking-[.22em] text-gold-soft">
        Confirmación de baja
      </p>
      <h1 className="mt-1 text-xl font-bold text-cream">Confirmá la baja del servicio</h1>
      <p className="mt-2 text-xs leading-relaxed text-stone-400">
        Solicitud <span className="font-mono text-stone-200">{code}</span> para{' '}
        <span className="font-semibold text-stone-200">{emailMasked}</span>.
        {expiresLabel && (
          <>
            {' '}
            El link vence el <span className="text-stone-200">{expiresLabel}</span>.
          </>
        )}
      </p>

      <div className="mt-4 rounded-xl border border-gold/25 bg-gold/5 px-3.5 py-3 text-xs leading-relaxed text-stone-300">
        <p>
          Al confirmar, cancelamos el débito automático en Mercado Pago. <strong>Tu acceso sigue
          hasta el fin del ciclo ya pago</strong> y no se generan cobros posteriores.
        </p>
        <p className="mt-2 text-stone-500">
          Si no pediste esta baja, cerrá esta página: no se cancela nada.
        </p>
      </div>

      <div className="mt-4">
        <FormError message={error} />
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="mt-3 w-full sm:w-auto"
        disabled={busy}
        onClick={() => void confirm()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
        {busy ? 'Confirmando baja…' : 'Confirmar baja del servicio'}
      </Button>
      <p className="mt-3 text-[10px] leading-relaxed text-stone-600">
        Un solo uso. No pedimos tarjeta ni contraseña. Si el email no coincide con la cuenta, no
        cancelamos nada y te contactamos.
      </p>
    </div>
  );
}
