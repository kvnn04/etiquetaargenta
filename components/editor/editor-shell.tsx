'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  Camera,
  Check,
  FileDown,
  Link2,
  Lock,
} from 'lucide-react';
import {
  FREE_CAPABILITIES,
  PRO_ONLY_CAPABILITIES,
  CAPABILITY_LABELS,
  gate,
  type Capability,
  type Plan,
} from '@/lib/permissions';
import TopBar from '@/components/editor/top-bar';
import PaywallModal, { type PriceInfo } from '@/components/paywall/paywall-modal';
import PlanWatcher from '@/components/session/plan-watcher';
import { Button } from '@/components/ui/button';

export interface ShellProfile {
  exists: boolean;
  baseName: string;
  plan: Plan;
  graceExpiresAt: string | null;
}

/** Acciones pay-gated visibles para probar el gating (posiciones 8–10 las implementan). */
const GATED_ACTIONS: Array<{ cap: Capability; label: string; icon: typeof Camera; future: string }> = [
  { cap: 'export.hd', label: 'Foto HD', icon: Camera, future: '8' },
  { cap: 'export.hd', label: 'Ficha PNG / PDF', icon: FileDown, future: '9' },
  { cap: 'links.generate', label: 'Generar Enlace Comercial', icon: Link2, future: '10' },
];

function graceDaysLeft(graceExpiresAt: string | null): number | null {
  if (!graceExpiresAt) return null;
  const diff = Date.parse(graceExpiresAt) - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

export default function EditorShell({
  userId,
  profile,
}: {
  userId: string;
  profile: ShellProfile;
}) {
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [priceError, setPriceError] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [actionHint, setActionHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/config/pricing')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { amount: number; currency: string; updatedAt: string }) => {
        if (alive) setPrice({ amount: data.amount, currency: data.currency, updatedAt: data.updatedAt });
      })
      .catch(() => alive && setPriceError(true));
    return () => {
      alive = false;
    };
  }, []);

  const priceText = price
    ? new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: price.currency,
        maximumFractionDigits: 0,
      }).format(price.amount)
    : null;

  function handleGatedClick(cap: Capability, future: string) {
    if (gate(cap, profile.plan)) {
      setActionHint(`“${CAPABILITY_LABELS[cap]}” llega con la posición ${future} del plan de implementación.`);
    } else {
      // FREE: ningún error técnico — se abre el Paywall (§4 spec_auth).
      setPaywallOpen(true);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PlanWatcher userId={userId} />
      <TopBar
        plan={profile.plan}
        baseName={profile.baseName || 'MI TALLER'}
        graceDaysLeft={profile.plan === 'pro_grace' ? graceDaysLeft(profile.graceExpiresAt) : null}
        priceText={priceText}
        onUnlockRequest={() => setPaywallOpen(true)}
      />

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_340px]">
        {/* Placeholder de escena 3D (posiciones 3–7) */}
        <section className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-2xl border border-line">
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at 50% 40%, #292521 0%, #171719 45%, #090a0d 100%)' }}
          />
          <div className="relative z-10 max-w-md px-8 text-center">
            <Box className="mx-auto h-10 w-10 text-gold-soft/80" />
            <h2 className="mt-3 text-lg font-bold text-cream">Escena 3D</h2>
            <p className="mt-2 text-xs leading-relaxed text-stone-400">
              El motor del editor (catálogo Camionero ⇄ Imperial, virola milimétrica, guías y
              diseño SVG/PNG) se implementa en las posiciones 3–7 de{' '}
              <span className="font-mono">orden_de_implementacion.md</span>.
            </p>
            <p className="mt-3 text-[11px] text-stone-600">
              Esta página verifica el esqueleto: sesión, plan desde el server, gating de matriz R2
              y precio dinámico.
            </p>
          </div>
        </section>

        {/* Panel de estado del plan */}
        <aside className="space-y-4">
          {actionHint && (
            <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-soft">
              {actionHint}
            </div>
          )}

          {!profile.exists && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              No existe fila en <span className="font-mono">public.users</span> (¿corrió el trigger{' '}
              <span className="font-mono">on_auth_user_created</span>?). Se usa plan <b>free</b> como fallback.
            </div>
          )}

          <div className="rounded-xl border border-line bg-panel p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Matriz R2 · única fuente
            </h3>
            <ul className="mt-3 space-y-1.5">
              {FREE_CAPABILITIES.map((cap) => (
                <li key={cap} className="flex items-center gap-2 text-[11px] text-stone-300">
                  <Check
                    className={`h-3 w-3 ${gate(cap, profile.plan) ? 'text-emerald-400' : 'text-stone-600'}`}
                  />
                  {CAPABILITY_LABELS[cap]}
                </li>
              ))}
              {PRO_ONLY_CAPABILITIES.map((cap) => (
                <li
                  key={cap}
                  className={`flex items-center gap-2 text-[11px] ${
                    gate(cap, profile.plan) ? 'text-stone-300' : 'text-stone-500'
                  }`}
                >
                  {gate(cap, profile.plan) ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Lock className="h-3 w-3 text-rose-400" />
                  )}
                  {CAPABILITY_LABELS[cap]}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-line bg-panel p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Acciones pay-gated
            </h3>
            <div className="mt-3 space-y-2">
              {GATED_ACTIONS.map(({ cap, label, icon: Icon, future }) => {
                const unlocked = gate(cap, profile.plan);
                return (
                  <Button
                    key={label}
                    variant="outline"
                    size="md"
                    className="w-full justify-start"
                    onClick={() => handleGatedClick(cap, future)}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="flex-1 text-left text-xs">{label}</span>
                    {unlocked ? (
                      <span className="text-[9px] text-stone-600">pos. {future}</span>
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-rose-400" />
                    )}
                  </Button>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-stone-600">
              El client solo <b>decora</b>: en posiciones 8–10 cada acción exige ticket server-side
              y un <span className="font-mono">402</span> abre este mismo Paywall (R7/R8).
            </p>
          </div>
        </aside>
      </main>

      <footer className="border-t border-line px-4 py-3 text-center text-[10px] text-stone-600">
        Posición 1 del plan: esqueleto de Auth + matriz R2 + gating de UI · fuente única:{' '}
        <span className="font-mono">spec_autenticacion_y_modelo_freemium.md</span>
      </footer>

      <PaywallModal
        open={paywallOpen}
        price={price}
        priceError={priceError}
        onClose={() => setPaywallOpen(false)}
      />
    </div>
  );
}
