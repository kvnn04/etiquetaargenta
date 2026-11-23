'use client';

/* ============================================================================
 * FORMULARIO DE BAJA — posición 12 (R13.3/R13.6 + §3.4)
 * ----------------------------------------------------------------------------
 * Público, sin login. Este POST NO cancela: crea la solicitud y manda un link
 * de confirmación de 24 h. El acceso sigue hasta el fin del ciclo ya pago.
 * Checkbox de confirmación DESMARCADO; el Portal de MP se ofrece como vía
 * adicional, nunca como la única.
 * ============================================================================ */

import { useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, MailCheck, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MERCADOPAGO_PORTAL_URL } from '@/lib/payments/core';
import {
  Field,
  FormError,
  Honeypot,
  LegalSuccess,
  legalTextareaClass,
} from '@/components/legal/legal-form-ui';

interface SuccessState {
  code: string;
  emailSent: boolean;
  confirmExpiresAt: string | null;
  resent: boolean;
}

const INITIAL = {
  email: '',
  paymentId: '',
  preapprovalId: '',
  message: '',
};

export default function BajaForm({ contactEmail }: { contactEmail: string }) {
  const [form, setForm] = useState(INITIAL);
  const [confirmation, setConfirmation] = useState(false);
  const [website, setWebsite] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function update<K extends keyof typeof INITIAL>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function reset() {
    setForm(INITIAL);
    setConfirmation(false);
    setWebsite('');
    setFieldErrors({});
    setError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!confirmation) {
      setFieldErrors({ confirmation: 'Tenés que confirmar que querés dar de baja el servicio.' });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/legal/baja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, confirmation, website }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            code?: string;
            emailSent?: boolean;
            confirmExpiresAt?: string;
            resent?: boolean;
            message?: string;
            fields?: Record<string, string>;
          }
        | null;

      if (response.ok && payload?.ok && payload.code) {
        setSuccess({
          code: payload.code,
          emailSent: Boolean(payload.emailSent),
          confirmExpiresAt: payload.confirmExpiresAt ?? null,
          resent: Boolean(payload.resent),
        });
        return;
      }
      if (response.status === 400 && payload?.fields) {
        setFieldErrors(payload.fields);
        setError(payload.message ?? 'Revisá los campos marcados.');
        return;
      }
      setError(
        payload?.message ??
          (response.status === 429
            ? 'Ya recibimos una solicitud hace instantes. Esperá unos minutos.'
            : 'No pudimos registrar la solicitud. Reintentá en unos minutos.'),
      );
    } catch {
      setError('No pudimos contactar el servidor. Revisá tu conexión y reintentá.');
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    const expiresLabel = success.confirmExpiresAt
      ? new Date(success.confirmExpiresAt).toLocaleString('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : 'las próximas 24 horas';

    return (
      <LegalSuccess
        title={success.resent ? 'Link reenviado' : 'Solicitud de baja registrada'}
        code={success.code}
        emailSent={success.emailSent}
        contactEmail={contactEmail || undefined}
        onReset={reset}
      >
        <p className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-gold-soft">
          <MailCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          <strong>Todavía no cancelamos nada.</strong> Abrí el email que te enviamos y tocá
          &quot;Confirmar la baja&quot;. El link vence el <strong>{expiresLabel}</strong> y se puede
          usar una sola vez.
        </p>
        <p>
          Al confirmar, cancelamos el débito automático. Tu acceso sigue hasta el{' '}
          <strong>fin del ciclo ya pago</strong>; no se generan cobros posteriores.
        </p>
        <p>
          Si no te llega el email, revisá spam. Podés volver a este formulario después de 5 minutos
          para regenerar el link con el mismo código.
        </p>
        <p>
          También podés cancelar al instante desde el{' '}
          <a
            href={MERCADOPAGO_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gold-soft underline underline-offset-2"
          >
            Portal de Mercado Pago <ExternalLink className="inline h-3 w-3" aria-hidden />
          </a>
          . El Portal es una vía adicional, no la única.
        </p>
      </LegalSuccess>
    );
  }

  return (
    <form onSubmit={submit} className="relative space-y-4" noValidate>
      <Honeypot value={website} onChange={setWebsite} />

      <Field
        id="baja-email"
        label="Email con el que contrataste el servicio"
        hint="La confirmación se manda a este email. No revelamos si tiene cuenta."
        error={fieldErrors.email}
        required
      >
        <Input
          id="baja-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'baja-email-error' : undefined}
          maxLength={254}
          placeholder="tu@taller.com"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="baja-payment"
          label="Identificador de pago (opcional)"
          hint="Número de pago de Mercado Pago."
          error={fieldErrors.paymentId}
        >
          <Input
            id="baja-payment"
            name="paymentId"
            inputMode="numeric"
            value={form.paymentId}
            onChange={(e) => update('paymentId', e.target.value)}
            invalid={Boolean(fieldErrors.paymentId)}
            aria-describedby={fieldErrors.paymentId ? 'baja-payment-error' : undefined}
            maxLength={40}
            placeholder="Ej. 123456789"
          />
        </Field>

        <Field
          id="baja-preapproval"
          label="ID de suscripción (opcional)"
          hint="Si lo tenés a mano, ayuda a ubicar el débito."
          error={fieldErrors.preapprovalId}
        >
          <Input
            id="baja-preapproval"
            name="preapprovalId"
            value={form.preapprovalId}
            onChange={(e) => update('preapprovalId', e.target.value)}
            invalid={Boolean(fieldErrors.preapprovalId)}
            aria-describedby={fieldErrors.preapprovalId ? 'baja-preapproval-error' : undefined}
            maxLength={100}
            placeholder="Ej. 2c938084..."
          />
        </Field>
      </div>

      <Field
        id="baja-message"
        label="Motivo (opcional)"
        hint="No es obligatorio. No incluyas datos de tarjeta."
        error={fieldErrors.message}
      >
        <textarea
          id="baja-message"
          name="message"
          value={form.message}
          onChange={(e) => update('message', e.target.value)}
          maxLength={2000}
          aria-invalid={Boolean(fieldErrors.message)}
          aria-describedby={fieldErrors.message ? 'baja-message-error' : undefined}
          className={legalTextareaClass}
          placeholder="Contanos brevemente el motivo (opcional)"
        />
        <p className="mt-1 text-right text-[10px] text-stone-600">{form.message.length}/2000</p>
      </Field>

      <div>
        <label className="flex items-start gap-2.5 rounded-xl border border-line bg-black/20 px-3 py-3 text-xs leading-relaxed text-stone-300">
          <input
            type="checkbox"
            checked={confirmation}
            onChange={(e) => {
              setConfirmation(e.target.checked);
              if (fieldErrors.confirmation) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.confirmation;
                  return next;
                });
              }
            }}
            aria-invalid={Boolean(fieldErrors.confirmation)}
            aria-describedby={fieldErrors.confirmation ? 'baja-confirmation-error' : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#b88a4e]"
          />
          <span>
            Confirmo que quiero dar de baja el servicio y entiendo que la baja se ejecuta recién
            cuando abra el link de confirmación que me van a enviar por email.
          </span>
        </label>
        {fieldErrors.confirmation && (
          <p id="baja-confirmation-error" className="mt-1 text-[11px] text-red-300">
            {fieldErrors.confirmation}
          </p>
        )}
      </div>

      <FormError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
          {busy ? 'Registrando baja…' : 'Pedir baja del servicio'}
        </Button>
        <p className="text-[10px] leading-relaxed text-stone-500">
          Sin registro ni login. La baja no se ejecuta en este paso.
        </p>
      </div>
    </form>
  );
}
