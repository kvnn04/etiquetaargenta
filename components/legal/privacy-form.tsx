'use client';

/* ============================================================================
 * FORMULARIO DE DERECHOS DE DATOS — posición 12 (R13.10 + §3.4)
 * ----------------------------------------------------------------------------
 * Público, sin login. Código PRIV-… y respuesta en 5 días hábiles. Si el
 * derecho es supresión, se usa el flujo de cuenta existente (30 días de
 * restauración); este formulario NO borra nada por sí solo.
 * ============================================================================ */

import { useState, type FormEvent } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Field,
  FormError,
  Honeypot,
  LegalSuccess,
  legalSelectClass,
  legalTextareaClass,
} from '@/components/legal/legal-form-ui';

const RIGHTS = [
  { value: 'acceso', label: 'Acceso a mis datos' },
  { value: 'rectificacion', label: 'Rectificación / actualización' },
  { value: 'supresion', label: 'Supresión (borrado)' },
  { value: 'oposicion', label: 'Oposición a un tratamiento' },
] as const;

type Right = (typeof RIGHTS)[number]['value'];

interface SuccessState {
  code: string;
  emailSent: boolean;
  dataRight: Right;
}

const INITIAL = {
  email: '',
  dataRight: '' as Right | '',
  message: '',
};

export default function PrivacyForm({ contactEmail }: { contactEmail: string }) {
  const [form, setForm] = useState(INITIAL);
  const [website, setWebsite] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function update<K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) {
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
    setWebsite('');
    setFieldErrors({});
    setError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    setBusy(true);
    try {
      const response = await fetch('/api/legal/privacidad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, website }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            code?: string;
            emailSent?: boolean;
            message?: string;
            fields?: Record<string, string>;
          }
        | null;

      if (response.ok && payload?.ok && payload.code && form.dataRight) {
        setSuccess({
          code: payload.code,
          emailSent: Boolean(payload.emailSent),
          dataRight: form.dataRight,
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
    return (
      <LegalSuccess
        title="Solicitud de datos registrada"
        code={success.code}
        emailSent={success.emailSent}
        contactEmail={contactEmail || undefined}
        onReset={reset}
      >
        <p>
          Respondemos dentro de <strong>5 días hábiles</strong> al email informado. Si necesitamos
          verificar tu identidad, te lo vamos a pedir por ese mismo canal.
        </p>
        {success.dataRight === 'supresion' ? (
          <p>
            Si corresponde el borrado de la cuenta, se aplica el flujo de eliminación con 30 días de
            restauración. La evidencia legal que la ley obliga a conservar se mantiene por separado.
          </p>
        ) : (
          <p>
            Podés consultar el detalle de tus derechos en esta misma política y reclamar ante la
            AAIP si la respuesta no te conforma.
          </p>
        )}
      </LegalSuccess>
    );
  }

  return (
    <form onSubmit={submit} className="relative space-y-4" noValidate>
      <Honeypot value={website} onChange={setWebsite} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="priv-email" label="Email" error={fieldErrors.email} required>
          <Input
            id="priv-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'priv-email-error' : undefined}
            maxLength={254}
            placeholder="tu@taller.com"
          />
        </Field>

        <Field id="priv-right" label="Derecho que querés ejercer" error={fieldErrors.dataRight} required>
          <select
            id="priv-right"
            name="dataRight"
            value={form.dataRight}
            onChange={(e) => update('dataRight', e.target.value as Right | '')}
            aria-invalid={Boolean(fieldErrors.dataRight)}
            aria-describedby={fieldErrors.dataRight ? 'priv-right-error' : undefined}
            className={legalSelectClass}
          >
            <option value="">Elegí una opción</option>
            {RIGHTS.map((right) => (
              <option key={right.value} value={right.value}>
                {right.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        id="priv-message"
        label="Detalle del pedido"
        hint="Contanos qué dato necesitás acceder, corregir o suprimir. Máximo 2.000 caracteres."
        error={fieldErrors.message}
        required
      >
        <textarea
          id="priv-message"
          name="message"
          value={form.message}
          onChange={(e) => update('message', e.target.value)}
          maxLength={2000}
          aria-invalid={Boolean(fieldErrors.message)}
          aria-describedby={fieldErrors.message ? 'priv-message-error' : undefined}
          className={legalTextareaClass}
          placeholder="Ej. Quiero acceder a los datos asociados a mi cuenta y saber con quién se comparten."
        />
        <p className="mt-1 text-right text-[10px] text-stone-600">{form.message.length}/2000</p>
      </Field>

      <FormError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {busy ? 'Registrando pedido…' : 'Enviar solicitud de datos'}
        </Button>
        <p className="text-[10px] leading-relaxed text-stone-500">
          Sin login. Respuesta en 5 días hábiles.
        </p>
      </div>
    </form>
  );
}
