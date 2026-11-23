import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import LegalFooter from '@/components/legal/legal-footer';

/* ============================================================================
 * LAYOUT PÚBLICO LEGAL — posición 12 (spec_paginas_legales.md §4)
 * ----------------------------------------------------------------------------
 * Sin login, sin paywall, sin middleware de sesión: /terminos, /privacidad,
 * /arrepentimiento, /baja y /baja/confirmar son públicas de verdad (R13.2).
 * Header simple ("Volver al simulador"), lectura ≤ 75 caracteres y footer con
 * los dos botones en lugar destacado.
 * ============================================================================ */

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#contenido-legal"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-gold/50 focus:bg-panel focus:px-4 focus:py-2 focus:text-sm focus:text-gold-soft"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-line bg-panel-soft/80">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/editor" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-gold/30 bg-white/5 font-bold text-gold-soft">
              M
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[.22em] text-gold-soft">
              MOCAP 3D
            </span>
          </Link>
          <Link
            href="/editor"
            className="inline-flex items-center gap-1.5 text-xs text-stone-400 transition hover:text-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Volver al simulador
          </Link>
        </div>
      </header>

      <main id="contenido-legal" className="mx-auto w-full max-w-4xl flex-1 px-5 py-9">
        {children}
      </main>

      <div className="mx-auto w-full max-w-4xl px-5 pb-2">
        <p className="flex items-start gap-2 rounded-xl border border-line bg-panel/60 px-3.5 py-3 text-[11px] leading-relaxed text-stone-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-soft" aria-hidden />
          <span>
            Estas páginas son públicas y no requieren cuenta. La atención al consumidor es
            electrónica, de lunes a viernes de 9:00 a 18:00 (hora de Argentina): un mínimo de 8
            horas por día hábil.
          </span>
        </p>
      </div>

      <LegalFooter variant="prominent" />
    </div>
  );
}
