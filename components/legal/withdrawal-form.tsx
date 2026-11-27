'use client';

/* ============================================================================
 * FORMULARIO DE ARREPENTIMIENTO — posición 12 (R13.3/R13.5 + §3.4)
 * ----------------------------------------------------------------------------
 * Público, sin login. Checkbox de declaración DESMARCADO. La fecha se valida
 * contra el calendario argentino y la ventana de 10 días; fuera de plazo la
 * solicitud se recibe igual (no se rechaza en la puerta).
 * ============================================================================ */

import { useState, type FormEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Field,
  FormError,
  Honeypot,
  LegalSuccess,
  legalInputClass,
  legalTextareaClass,
} from '@/components/legal/legal-form-ui';

interface SuccessState {
  code: string;
  emailSent: boolean;
  withinWindow: boolean;
  autoRefund: 'processed' | 'sync_pending' | 'failed' | 'scheduled' | 'not_applicable';
  autoRefundAmountArs: number | null;
  /** Motivo cuando la baja queda programada sin reembolso. */
  autoRefundReason:
    | 'full_window'
    | 'outside_window'
    | 'no_payment'
    | 'no_balance'
    | 'invalid_dates'
    | null;
  /** Fin del ciclo ya pago cuando la baja queda programada sin reembolso. */
  autoRefundPeriodEndMs: number | null;
}

const INITIAL = {
  fullName: '',
  email: '',
  purchaseDate: '',
  paymentId: '',
  message: '',
};

export default function WithdrawalForm({ contactEmail }: { contactEmail: string }) {
  const [form, setForm] = useState(INITIAL);
  const [declaration, setDeclaration] = useState(false);
  const [website, setWebsite] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

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
    setDeclaration(false);
    setWebsite('');
    setFieldErrors({});
    setError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!declaration) {
      setFieldErrors({ declaration: 'Tenés que declarar que la solicitud se hace dentro del plazo legal.' });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/legal/arrepentimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          declaration,
          website,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            code?: string;
            emailSent?: boolean;
            withinWindow?: boolean;
            autoRefund?: 'processed' | 'sync_pending' | 'failed' | 'scheduled' | 'not_applicable';
            autoRefundAmountArs?: number | null;
            autoRefundReason?:
              | 'full_window'
              | 'outside_window'
              | 'no_payment'
              | 'no_balance'
              | 'invalid_dates'
              | null;
            autoRefundPeriodEndMs?: number | null;
            message?: string;
            error?: string;
            fields?: Record<string, string>;
          }
        | null;

      if (response.ok && payload?.ok && payload.code) {
        setSuccess({
          code: payload.code,
          emailSent: Boolean(payload.emailSent),
          withinWindow: Boolean(payload.withinWindow),
          autoRefund: payload.autoRefund ?? 'not_applicable',
          autoRefundAmountArs:
            typeof payload.autoRefundAmountArs === 'number'
              ? payload.autoRefundAmountArs
              : null,
          autoRefundReason: payload.autoRefundReason ?? null,
          autoRefundPeriodEndMs:
            typeof payload.autoRefundPeriodEndMs === 'number'
              ? payload.autoRefundPeriodEndMs
              : null,
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
    const refundText =
      success.autoRefundAmountArs != null
        ? new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(success.autoRefundAmountArs)
        : null;
    const periodEndText =
      success.autoRefundPeriodEndMs != null
        ? new Date(success.autoRefundPeriodEndMs).toLocaleDateString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
          })
        : null;
    return (
      <LegalSuccess
        title={
          success.autoRefund === 'processed' || success.autoRefund === 'sync_pending'
            ? 'Arrepentimiento ejecutado'
            : success.autoRefund === 'scheduled'
              ? 'Baja programada'
              : 'Solicitud registrada'
        }
        code={success.code}
        emailSent={success.emailSent}
        contactEmail={contactEmail || undefined}
        onReset={reset}
      >
        {success.autoRefund === 'processed' ? (
          <>
            <p>
              Tu pago estaba dentro de los <strong>10 días corridos</strong> del arrepentimiento
              (Ley 24.240 art. 34 y Disposición 954/2025). Reembolsamos{' '}
              <strong>{refundText ?? 'el total del ciclo'}</strong> por el mismo medio de pago y
              dimos de baja el plan PRO <strong>ahora</strong>.
            </p>
            <p>
              La acreditación final depende de Mercado Pago y del banco emisor. Tus proyectos,
              assets y links se conservan.
            </p>
          </>
        ) : success.autoRefund === 'sync_pending' ? (
          <>
            <p>
              Tu pago estaba dentro de los <strong>10 días corridos</strong> y procesamos el
              reembolso de <strong>{refundText ?? 'el total del ciclo'}</strong> por el mismo medio
              de pago. Estamos terminando de actualizar el estado de tu plan; si no se refleja en
              unos minutos, te contactamos.
            </p>
            <p>
              La acreditación final depende de Mercado Pago y del banco emisor. Tus proyectos,
              assets y links se conservan.
            </p>
          </>
        ) : success.autoRefund === 'failed' ? (
          <>
            <p>
              Registramos tu arrepentimiento y cancelamos la renovación. Mercado Pago no aceptó el
              reembolso en este intento: lo reintentamos y te contactamos. Tu PRO sigue hasta el
              fin del ciclo ya pago.
            </p>
            <p>Tus proyectos, assets y links se conservan.</p>
          </>
        ) : success.autoRefund === 'scheduled' ? (
          <>
            <p>
              {success.autoRefundReason === 'no_payment'
                ? 'No encontramos un pago aprobado a tu nombre'
                : success.autoRefundReason === 'no_balance'
                  ? 'El pago ya fue devuelto en su totalidad'
                  : success.autoRefundReason === 'invalid_dates'
                    ? 'No pudimos verificar la fecha del pago'
                    : 'La fecha de tu pago queda fuera de los 10 días corridos del arrepentimiento'}
              , así que no corresponde un nuevo reembolso. Cancelamos el débito automático y no se
              generan más cobros.
            </p>
            <p>
              Tu acceso PRO sigue hasta{' '}
              <strong>{periodEndText ?? 'el fin del ciclo ya pago'}</strong> y después tu cuenta
              vuelve a FREE. Tus proyectos, assets y links se conservan.
            </p>
          </>
        ) : (
          <>
            <p>
              {success.withinWindow
                ? 'La solicitud queda dentro de los 10 días corridos del arrepentimiento (Ley 24.240 art. 34 y Disposición 954/2025).'
                : 'La fecha informada queda fuera de los 10 días corridos. La revisamos igual y te respondemos con una decisión fundada.'}
            </p>
            <p>
              En un plazo máximo de <strong>24 horas</strong> te confirmamos el encuadre y el
              resultado. Cuando corresponde, el reintegro se hace por el mismo medio de pago, por el
              <strong>100 % del último pago</strong>, y la acreditación final depende de Mercado Pago
              y del banco emisor.
            </p>
            <p>
              Si no corresponde reembolso, la baja opera al final del ciclo ya pago. Tus proyectos,
              assets y links se conservan.
            </p>
          </>
        )}
      </LegalSuccess>
    );
  }

  return (
    <form onSubmit={submit} className="relative space-y-4" noValidate>
      <Honeypot value={website} onChange={setWebsite} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="arr-name" label="Nombre y apellido" error={fieldErrors.fullName} required>
          <Input
            id="arr-name"
            name="fullName"
            autoComplete="name"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            invalid={Boolean(fieldErrors.fullName)}
            aria-describedby={fieldErrors.fullName ? 'arr-name-error' : undefined}
            maxLength={120}
            placeholder="Como figura en la compra"
          />
        </Field>

        <Field id="arr-email" label="Email de la compra" error={fieldErrors.email} required>
          <Input
            id="arr-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'arr-email-error' : undefined}
            maxLength={254}
            placeholder="tu@taller.com"
          />
        </Field>

        <Field
          id="arr-date"
          label="Fecha de compra o alta"
          hint="La fecha del primer cobro o del alta del plan."
          error={fieldErrors.purchaseDate}
          required
        >
          <input
            id="arr-date"
            name="purchaseDate"
            type="date"
            max={today}
            value={form.purchaseDate}
            onChange={(e) => update('purchaseDate', e.target.value)}
            aria-invalid={Boolean(fieldErrors.purchaseDate)}
            aria-describedby={fieldErrors.purchaseDate ? 'arr-date-error' : undefined}
            className={legalInputClass}
          />
        </Field>

        <Field
          id="arr-payment"
          label="Identificador de pago o suscripción (opcional)"
          hint="Número de pago de Mercado Pago o ID de preapproval."
          error={fieldErrors.paymentId}
        >
          <Input
            id="arr-payment"
            name="paymentId"
            inputMode="numeric"
            value={form.paymentId}
            onChange={(e) => update('paymentId', e.target.value)}
            invalid={Boolean(fieldErrors.paymentId)}
            aria-describedby={fieldErrors.paymentId ? 'arr-payment-error' : undefined}
            maxLength={40}
            placeholder="Ej. 123456789"
          />
        </Field>
      </div>

      <Field
        id="arr-message"
        label="Motivo (opcional)"
        hint="No es obligatorio. No incluyas datos de tarjeta."
        error={fieldErrors.message}
      >
        <textarea
          id="arr-message"
          name="message"
          value={form.message}
          onChange={(e) => update('message', e.target.value)}
          maxLength={2000}
          aria-invalid={Boolean(fieldErrors.message)}
          aria-describedby={fieldErrors.message ? 'arr-message-error' : undefined}
          className={legalTextareaClass}
          placeholder="Contanos brevemente qué pasó (opcional)"
        />
        <p className="mt-1 text-right text-[10px] text-stone-600">{form.message.length}/2000</p>
      </Field>

      <div>
        <label className="flex items-start gap-2.5 rounded-xl border border-line bg-black/20 px-3 py-3 text-xs leading-relaxed text-stone-300">
          <input
            type="checkbox"
            checked={declaration}
            onChange={(e) => {
              setDeclaration(e.target.checked);
              if (fieldErrors.declaration) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.declaration;
                  return next;
                });
              }
            }}
            aria-invalid={Boolean(fieldErrors.declaration)}
            aria-describedby={fieldErrors.declaration ? 'arr-declaration-error' : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#b88a4e]"
          />
          <span>
            Declaro que esta solicitud se hace dentro de los <strong>10 días corridos</strong> desde
            la celebración del contrato o la entrega, y que la información es correcta.
          </span>
        </label>
        {fieldErrors.declaration && (
          <p id="arr-declaration-error" className="mt-1 text-[11px] text-red-300">
            {fieldErrors.declaration}
          </p>
        )}
      </div>

      <FormError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? 'Registrando solicitud…' : 'Enviar solicitud de arrepentimiento'}
        </Button>
        <p className="text-[10px] leading-relaxed text-stone-500">
          Sin registro ni login. Recibís un código y un acuse por email.
        </p>
      </div>
    </form>
  );
}
