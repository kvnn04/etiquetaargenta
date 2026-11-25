'use client';

/* ============================================================================
 * FOOTER LEGAL — posición 12 (spec_paginas_legales.md §4 + R13.2/R13.12)
 * ----------------------------------------------------------------------------
 * Visible en /editor, /perfil, /v/[linkId] y las páginas legales. Los DOS
 * BOTONES (arrepentimiento y baja) son botones outlined de verdad, no texto
 * gris de 9 px, y se apilan en móvil sin scroll horizontal. Sin login, sin
 * submenús, sin letra chica que contradiga la ley.
 * Client-safe: solo importa rutas públicas (`lib/legal/links`).
 * ============================================================================ */

import Link from 'next/link';
import { ArrowLeftRight, FileText, Scale, ShieldCheck, UserMinus } from 'lucide-react';
import { LEGAL_LINKS } from '@/lib/legal/links';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'prominent' | 'compact';

export default function LegalFooter({
  variant = 'default',
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const prominent = variant === 'prominent';
  const compact = variant === 'compact';

  return (
    <footer
      aria-label="Información legal y derechos del consumidor"
      className={cn(
        'w-full border-t border-line/70 text-center',
        compact ? 'px-3 py-2.5' : prominent ? 'px-4 py-5' : 'px-4 py-4',
        className,
      )}
    >
      {prominent && (
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[.24em] text-gold-soft">
          Derechos del consumidor
        </p>
      )}

      <nav
        aria-label="Enlaces legales"
        className={cn(
          'mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2',
          compact ? 'text-[10px]' : 'text-[11px]',
        )}
      >
        <Link
          href={LEGAL_LINKS.terms}
          className="inline-flex items-center gap-1.5 text-stone-400 transition hover:text-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Términos y Condiciones
        </Link>
        <Link
          href={LEGAL_LINKS.privacy}
          className="inline-flex items-center gap-1.5 text-stone-400 transition hover:text-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Política de Privacidad
        </Link>
        <a
          href={LEGAL_LINKS.consumerDefense}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-stone-400 transition hover:text-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          <Scale className="h-3.5 w-3.5" aria-hidden />
          Defensa del Consumidor
        </a>
      </nav>

      <div
        className={cn(
          'mx-auto mt-3 flex max-w-2xl flex-wrap items-stretch justify-center gap-2',
          compact && 'mt-2',
        )}
      >
        <Link
          href={LEGAL_LINKS.withdrawal}
          className={cn(
            'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gold/45 bg-gold/10 px-3.5 py-2 font-bold uppercase tracking-wide text-gold-soft transition hover:border-gold/70 hover:bg-gold/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            compact ? 'text-[10px]' : 'text-[11px]',
          )}
        >
          <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />
          Botón de Arrepentimiento
        </Link>
        <Link
          href={LEGAL_LINKS.cancellation}
          className={cn(
            'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gold/45 bg-gold/10 px-3.5 py-2 font-bold uppercase tracking-wide text-gold-soft transition hover:border-gold/70 hover:bg-gold/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            compact ? 'text-[10px]' : 'text-[11px]',
          )}
        >
          <UserMinus className="h-4 w-4 shrink-0" aria-hidden />
          Botón de Baja de Servicio
        </Link>
      </div>

      {prominent && (
        <p className="mx-auto mt-3 max-w-xl text-[10px] leading-relaxed text-stone-500">
          Sin registro ni login para usarlos. Arrepentimiento: 10 días corridos. Baja: confirmación
          por email y acceso hasta el fin del ciclo ya pago. Respuesta en 24 h; derechos de datos en
          5 días hábiles.
        </p>
      )}
    </footer>
  );
}
