'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Link2, LogOut, ShieldAlert, UserRound } from 'lucide-react';
import type { Plan } from '@/lib/permissions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * Top Bar por plan (spec_auth §4):
 * FREE → badge demo + botón verde "Desbloquear Plan PRO ({precio}/mes)".
 * PRO_GRACE → banner ámbar con días restantes (R7 dunning).
 * PRO → badge "PLAN PRO ✓" + menú de perfil (Perfil / Portal / Cerrar sesión).
 * Cerrar sesión SIEMPRE disponible: plan free/pro_grace lo accionan desde el
 * botón de la derecha (QA §7.1 no admite sesión sin salida).
 * Ícono de Perfil SIEMPRE disponible (posición 2 del spec de registro: acceso
 * al Panel desde la top bar; el header del taller MUESTRA su logo si cargó uno,
 * ya que el white-label de salidas es otra cosa — matriz R2).
 */
export default function TopBar({
  plan,
  baseName,
  logoThumbUrl,
  graceDaysLeft,
  priceText,
  demoUsed,
  onUnlockRequest,
}: {
  plan: Plan;
  baseName: string;
  logoThumbUrl?: string | null;
  graceDaysLeft: number | null;
  priceText: string | null;
  /** R3 (pos 8): slot del demo — se agota al cargar el primer diseño. */
  demoUsed: boolean;
  onUnlockRequest: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = baseName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'MT';

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    // QA §7.1: logout limpia local sin borrar proyectos server-side.
    router.replace('/auth');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-panel-soft/95 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {logoThumbUrl ? (
          <img
            src={logoThumbUrl}
            alt="Logo del taller"
            className="h-8 w-8 rounded-lg border border-gold/30 object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/30 bg-white/5 text-xs font-bold text-gold-soft">
            {initials || 'M'}
          </div>
        )}
        <div className="leading-tight">
          <div className="text-xs font-bold text-cream">{baseName}</div>
          <div className="text-[10px] text-stone-500">MOCAP 3D · Simulador</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {plan === 'free' && (
          <>
            <span className="hidden rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 sm:inline">
              🔒 PLAN DEMO ({demoUsed ? '1/1' : '0/1'} Uso)
            </span>
            <Button variant="green" size="sm" onClick={onUnlockRequest}>
              Desbloquear Plan PRO{priceText ? ` (${priceText}/mes)` : ''}
            </Button>
          </>
        )}

        {plan === 'pro_grace' && (
          <span className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5" />
            Problema de cobro — actualizá tu tarjeta
            {graceDaysLeft != null && ` (te quedan ${graceDaysLeft} ${graceDaysLeft === 1 ? 'día' : 'días'})`}
          </span>
        )}

        {plan === 'pro' && (
          <div className="relative">
            <Button
              size="sm"
              variant="subtleGold"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              PLAN PRO ✓
              <ChevronDown className="h-3 w-3" />
            </Button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-panel shadow-xl shadow-black/50"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-stone-300 hover:bg-white/5"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/perfil');
                  }}
                >
                  <UserRound className="h-3.5 w-3.5 text-stone-500" /> Perfil
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-stone-300 hover:bg-white/5"
                  onClick={() => setMenuOpen(false)}
                >
                  Gestión de suscripción
                  <span className="ml-auto text-[9px] text-stone-600">posición 10</span>
                </button>
                <div className="h-px bg-white/5" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-rose-300 hover:bg-white/5"
                >
                  <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        )}

        {plan !== 'pro' && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Mis enlaces"
          title="Mis enlaces comerciales"
          onClick={() => router.push('/enlaces')}
        >
          <Link2 className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Perfil"
          title="Perfil del taller"
          onClick={() => router.push('/perfil')}
        >
          <UserRound className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
