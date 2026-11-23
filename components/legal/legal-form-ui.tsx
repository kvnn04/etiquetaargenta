'use client';

/* ============================================================================
 * PIEZAS DE FORMULARIO LEGAL — posición 12
 * ----------------------------------------------------------------------------
 * Labels visibles, errores inline, foco visible, código copiable y estado de
 * éxito con `aria-live`. Sin checkboxes premarcados ni texto que oculte
 * derechos (R13.12/R13.16).
 * ============================================================================ */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export function Field({
  id,
  label,
  error,
  hint,
  required = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-stone-200">
        {label}
        {required && (
          <span className="ml-1 text-gold-soft" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && <p className="mt-0.5 text-[10px] leading-relaxed text-stone-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

/** Honeypot invisible: los humanos no lo ven; los bots lo completan. */
export function Honeypot({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
    >
      <label htmlFor="legal-website">No completar este campo</label>
      <input
        id="legal-website"
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Código copiado' : 'Copiar código'}
    </Button>
  );
}

export function LegalSuccess({
  title,
  code,
  emailSent,
  contactEmail,
  onReset,
  children,
}: {
  title: string;
  code: string;
  emailSent: boolean;
  contactEmail?: string;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-emerald-500/35 bg-emerald-950/20 p-5"
    >
      <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-300">{title}</p>
      <div className="mt-3 rounded-xl border border-emerald-500/25 bg-black/30 px-4 py-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-stone-500">Tu código de caso</p>
        <code className="mt-1 block break-all font-mono text-lg font-bold tracking-wide text-cream">
          {code}
        </code>
      </div>
      <div className="mt-3 flex justify-center">
        <CopyCode code={code} />
      </div>

      {!emailSent && (
        <p className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          No pudimos enviar el email automático en este momento. Guardá el código: la solicitud
          quedó registrada igual
          {contactEmail ? (
            <>
              {' '}
              y podés escribirnos a{' '}
              <a className="underline underline-offset-2" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
              .
            </>
          ) : (
            '.'
          )}
        </p>
      )}

      <div className="mt-4 space-y-2 text-xs leading-relaxed text-stone-300">{children}</div>

      <button
        type="button"
        onClick={onReset}
        className="mt-4 text-[11px] font-semibold text-gold-soft underline decoration-gold/40 underline-offset-4 hover:text-gold"
      >
        Hacer otra solicitud
      </button>
    </div>
  );
}

/** Input/select/textarea con los tokens visuales del proyecto. */
export const legalInputClass = cn(
  'h-10 w-full rounded-lg border bg-black/30 px-3 text-sm text-cream outline-none transition placeholder:text-stone-600',
  'border-white/10 focus:border-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60',
);

export const legalTextareaClass = cn(
  'min-h-24 w-full rounded-lg border bg-black/30 px-3 py-2 text-sm text-cream outline-none transition placeholder:text-stone-600',
  'border-white/10 focus:border-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60',
);

export const legalSelectClass = cn(
  'h-10 w-full rounded-lg border bg-black/30 px-3 text-sm text-cream outline-none transition',
  'border-white/10 focus:border-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60',
);
