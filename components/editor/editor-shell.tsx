'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
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
import ProductSelector from '@/components/studio/product-selector';
import DimensionsCard from '@/components/studio/dimensions-card';
import ColorPickerCard from '@/components/studio/color-picker-card';
import AutoGiroBar from '@/components/studio/auto-giro-bar';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { loadLatestProject, loadLocalDraft } from '@/lib/projects/persistence';
import { useProjectPersistence } from '@/lib/projects/use-autosave';
import { useEditorStore } from '@/lib/store/editor';
import { Button } from '@/components/ui/button';

/**
 * La escena se carga lazy y sin SSR (R3F/Canvas es client-only): así la shell
 * hidrata siempre, y el motor 3D (three ~600 kB) no entra en el HTML inicial.
 */
const StudioScene = dynamic(() => import('@/components/studio/studio-scene'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-center">
        <Box className="mx-auto h-8 w-8 animate-pulse text-gold-soft/70" />
        <p className="mt-3 text-xs text-stone-500">Cargando escena 3D…</p>
      </div>
    </div>
  ),
});

export interface ShellProfile {
  exists: boolean;
  baseName: string;
  /** Nombre comercial definido en el Perfil (posición 2). */
  brandName: string | null;
  plan: Plan;
  graceExpiresAt: string | null;
  /** URL firmada del thumb del logo (solo para el header del propio taller). */
  logoThumbUrl?: string | null;
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

/**
 * Chip de estado del autosave (spec §5: "al abrir el simulador se restaura el
 * último mateModel guardado" — muestra que no hay trabajo perdido).
 */
function SaveChip({ dirty, lastSavedAt }: { dirty: boolean; lastSavedAt: string | null }) {
  const label = dirty
    ? 'Guardando…'
    : lastSavedAt
      ? `Guardado ${new Date(lastSavedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
      : 'Sincronizado';
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        dirty ? 'border-gold/40 text-gold-soft' : 'border-emerald-500/30 text-emerald-400'
      }`}
    >
      {label}
    </span>
  );
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
  /* R7: estado del auto-giro — dispositivo solamente, NO se persiste. La
   * interacción sobre el lienzo (OrbitControls 'start') pausa el giro y queda
   * en pausa hasta que el tallerista lo reactive con el botón. */
  const [spinning, setSpinning] = useState(false);
  const pauseSpin = useCallback(() => setSpinning(false), []);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const mateModel = useEditorStore((s) => s.mateModel);
  const setMateModel = useEditorStore((s) => s.setMateModel);
  const dirty = useEditorStore((s) => s.dirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const offlineDraft = useEditorStore((s) => s.offlineDraft);

  /* Restore del proyecto más reciente (R1 Happy Path: "restaura su último
   * proyecto guardado… camionero por defecto si no existe estado"). El draft
   * local más nuevo que el backend manda (last-write-wins, §6) y se marca
   * dirty para que el autosave lo lleve al backend apenas pueda. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const server = await loadLatestProject(supabase);
      const draft = loadLocalDraft();
      if (!alive) return;
      const draftWins =
        draft && (!server?.updatedAt || Date.parse(draft.updatedAt) > Date.parse(server.updatedAt));
      if (draftWins && draft) {
        useEditorStore.getState().restoreState(draft.state, server?.projectId ?? null);
        useEditorStore.getState().markDirty();
      } else if (server) {
        useEditorStore.getState().restoreState(server.state, server.projectId);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  /* Autosave (debounce 2 s, last-write-wins, borrador offline con backoff). */
  useProjectPersistence(supabase);

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
        baseName={profile.brandName?.trim() || profile.baseName}
        logoThumbUrl={profile.logoThumbUrl}
        graceDaysLeft={profile.plan === 'pro_grace' ? graceDaysLeft(profile.graceExpiresAt) : null}
        priceText={priceText}
        onUnlockRequest={() => setPaywallOpen(true)}
      />

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_340px]">
        {/* Estudio 3D (posición 4: catálogo + medidas de virola + guías + auto-giro) */}
        <section className="relative min-h-[420px] overflow-hidden rounded-2xl border border-line lg:min-h-0">
          <StudioScene spinning={spinning} onUserInteracted={pauseSpin} />
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 backdrop-blur">
            Estudio 3D
          </div>
          {/* R7: barra flotante de la pestaña Estudio 3D — "Girar 360°"/"Pausar" */}
          <AutoGiroBar spinning={spinning} onToggle={() => setSpinning((v) => !v)} />
        </section>

        {/* Panel derecho */}
        <aside className="space-y-4">
          {!profile.exists && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              No existe fila en <span className="font-mono">public.users</span> (¿corrió el trigger{' '}
              <span className="font-mono">on_auth_user_created</span>?). Se usa plan <b>free</b> como fallback.
            </div>
          )}

          {/* PRIMERA tarjeta (§4 spec_tipo_de_mate): Configuración del Producto */}
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  Configuración del Producto
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-stone-600">
                  La virola conserva diámetros, guías y grabado al cambiar (R3 de{' '}
                  <span className="font-mono">spec_tipo_de_mate</span>).
                </p>
              </div>
              <SaveChip dirty={dirty} lastSavedAt={lastSavedAt} />
            </div>
            <div className="mt-3">
              <ProductSelector
                activeId={mateModel}
                plan={profile.plan}
                onSelect={setMateModel}
                onLockedSelect={() => setPaywallOpen(true)}
              />
            </div>
            {offlineDraft && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                Sin conexión: tus cambios quedaron guardados en este dispositivo — se sincronizan
                al reconectar.
              </p>
            )}
          </div>

          {/* SEGUNDA tarjeta (§4 spec_tecnica_geometrica): Medidas y Geometría */}
          <DimensionsCard />

          {/* TERCERA tarjeta (§5 spec_seleccion_de_color): Materiales y Acabados */}
          <ColorPickerCard />

          {actionHint && (
            <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-soft">
              {actionHint}
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
              El cliente solo <b>decora</b>: en posiciones 8–10 cada acción exige ticket server-side
              y un <span className="font-mono">402</span> abre este mismo Paywall (R7/R8).
            </p>
          </div>
        </aside>
      </main>

      <footer className="border-t border-line px-4 py-3 text-center text-[10px] leading-relaxed text-stone-600">
        Posición 5 del plan: sistema de color inteligente — cuerpo y virola #HEX (fuente única:{' '}
        <span className="font-mono">spec_seleccion_de_color.md</span>) · posición 4:{' '}
        <span className="font-mono">spec_tecnica_geometrica_guias_y_rotacion_360.md</span>
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
