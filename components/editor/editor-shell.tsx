'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
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
import { resolveBranding } from '@/lib/branding';
import { resolveMateModel } from '@/lib/catalog';
import { overflowBannerText, type OverflowCheck } from '@/lib/overflow';
import { captureFichaSnapshot, currentOverflowCheck } from '@/lib/quote/snapshot';
import TopBar from '@/components/editor/top-bar';
import PaywallModal, { type PriceInfo } from '@/components/paywall/paywall-modal';
import QuoteModal from '@/components/quote/quote-modal';
import { runFotoHdExport } from '@/components/quote/foto-hd';
import PlanWatcher from '@/components/session/plan-watcher';
import ProductSelector from '@/components/studio/product-selector';
import DimensionsCard from '@/components/studio/dimensions-card';
import ColorPickerCard from '@/components/studio/color-picker-card';
import DesignCard from '@/components/studio/design-card';
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
  /** Pos 9 (R4): pie de la Ficha con CTA de WhatsApp. */
  whatsappE164: string | null;
  /** Pos 9 (R4): pie de la Ficha con el handle de Instagram. */
  instagramHandle: string | null;
}

/* Acciones pay-gated — pos 9: Foto HD y Ficha Técnica YA EXPORTAN (ticket R7
 * + confirmación de desborde). "Ficha" abre el modal #quoteModal para AMBOS
 * planes (FREE ve la grilla con candado: al exportar, el server responde 402
 * y abre el Paywall — jamás una decisión client-side). */
type GatedActionKind = 'foto' | 'ficha' | 'link';
const GATED_ACTIONS: Array<{
  cap: Capability;
  label: string;
  icon: typeof Camera;
  action: GatedActionKind;
  future?: string;
}> = [
  { cap: 'export.hd', label: 'Foto HD', icon: Camera, action: 'foto' },
  { cap: 'export.hd', label: 'Ficha Técnica (PNG / PDF)', icon: FileDown, action: 'ficha' },
  {
    cap: 'links.generate',
    label: 'Generar Enlace Comercial',
    icon: Link2,
    action: 'link',
    future: '10',
  },
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

  /* ── Pos 9: Ficha Técnica (modal #quoteModal) + Foto HD ───────────────────
   * obsText: R5/§5 — el texto libre es de SESIÓN (memoria de la shell): si el
   * modal se cierra y re-abre, las observaciones sobreviven; JAMÁS viaja al
   * jsonb de projects. */
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [obsText, setObsText] = useState('');
  const [fotoBusy, setFotoBusy] = useState(false);
  /* R5 spec_escala: confirmación de desborde como mini-diálogo reutilizable
   * (mismos CTA "Exportar de todas formas" / "Volver a ajustar"). */
  const [overflowConfirm, setOverflowConfirm] = useState<OverflowCheck | null>(null);
  const overflowResolveRef = useRef<((ok: boolean) => void) | null>(null);

  const askOverflowConfirm = useCallback((check: OverflowCheck): Promise<boolean> => {
    return new Promise((resolve) => {
      overflowResolveRef.current = resolve;
      setOverflowConfirm(check);
    });
  }, []);

  const answerOverflowConfirm = useCallback((ok: boolean) => {
    setOverflowConfirm(null);
    overflowResolveRef.current?.(ok);
    overflowResolveRef.current = null;
  }, []);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const mateModel = useEditorStore((s) => s.mateModel);
  const setMateModel = useEditorStore((s) => s.setMateModel);
  const dirty = useEditorStore((s) => s.dirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const offlineDraft = useEditorStore((s) => s.offlineDraft);
  /* R3 (pos 8): el contador del demo se AGOTA al cargar el primer diseño — el
   * asset es de sesión (el upload real al Storage llega en pos 10), así que el
   * badge cuenta el asset EN MEMORIA: reemplazo libre dentro del mismo slot. */
  const designAsset = useEditorStore((s) => s.designAsset);
  const freeDemo = profile.plan === 'free';

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

  function handleGatedClick(entry: (typeof GATED_ACTIONS)[number]): void {
    /* Ficha Técnica (pos 9): ENTRA libre Y pro — la grilla es la vista previa
     * del snapshot y el access real lo decide el SERVER al pedir el ticket
     * (402 ⇒ Paywall, R7). */
    if (entry.action === 'ficha') {
      setActionHint(null);
      setQuoteOpen(true);
      return;
    }
    if (gate(entry.cap, profile.plan)) {
      if (entry.action === 'foto') {
        void handleFotoHd();
        return;
      }
      // Pos 10 (hoy): hint honesto, sin fingir funcionalidad.
      setActionHint(
        `“${CAPABILITY_LABELS[entry.cap]}” llega con la posición ${entry.future} del plan de implementación.`,
      );
      return;
    }
    // FREE: ningún error técnico — se abre el Paywall (§4 spec_auth).
    setPaywallOpen(true);
  }

  /* ── Pos 9: FOTO HD — ticket R7 + confirmación de desborde + descarga ───── */
  async function handleFotoHd(): Promise<void> {
    if (fotoBusy) return;
    setActionHint(null);
    const s = useEditorStore.getState();
    const brand = resolveBranding(
      {
        brandName: profile.brandName,
        displayName: profile.baseName,
        logoThumbUrl: profile.logoThumbUrl ?? null,
        instagramHandle: profile.instagramHandle,
      },
      { plan: profile.plan },
    );
    const check = currentOverflowCheck({
      hasDesignAsset: s.designAsset != null,
      inkEnvelope: s.inkEnvelope,
      inkScanDegraded: s.inkScanDegraded,
      baseSideMm: s.designAsset?.baseSideMm ?? s.extDiameter,
      extDiameterMm: s.extDiameter,
      intDiameterMm: s.intDiameter,
      scalePct: s.design.scale,
    });
    /* Hash ligado al contenido VIGENTE (R7): el mismo contrato de captura de
     * la ficha, sin observaciones (la foto no imprime texto). */
    const snap = captureFichaSnapshot({
      state: {
        mateModel: s.mateModel,
        extDiameter: s.extDiameter,
        intDiameter: s.intDiameter,
        bodyPreset: s.bodyPreset,
        metalPreset: s.metalPreset,
        bodyColor: s.bodyColor,
        virolaColor: s.virolaColor,
        design: s.design,
      },
      designAssetPresent: s.designAsset != null,
      hasProject: s.projectId != null,
      overflow: check,
      inkDegraded: s.inkScanDegraded,
      brand,
      whatsappE164: profile.whatsappE164,
    });

    setFotoBusy(true);
    try {
      const downloaded = await runFotoHdExport({
        view: {
          mateModel: s.mateModel,
          extDiameterMm: s.extDiameter,
          intDiameterMm: s.intDiameter,
          bodyPreset: s.bodyPreset,
          metalPreset: s.metalPreset,
          bodyColor: s.bodyColor,
          virolaColor: s.virolaColor,
          rotationDeg: s.design.rotation,
          mirror: s.design.mirror,
          scalePct: s.design.scale,
          designAsset: s.designAsset?.canvas ?? null,
        },
        check,
        snapshotHash: snap.hash,
        tallerTitle: brand.title,
        productId: resolveMateModel(s.mateModel).id,
        confirmOverflow: askOverflowConfirm,
        onPaywallRequest: () => setPaywallOpen(true),
        onError: (msg) => setActionHint(msg),
      });
      if (downloaded) setActionHint('Foto HD descargada ✓');
    } finally {
      setFotoBusy(false);
    }
  }

  /* R4 (pos 8): bloqueo de rutas DOM del lienzo SOLO en demo (la protección es
   * honesta: capturas del SO quedan cubiertas por la marca de agua cocida).
   * Blob URLs: NINGUNO se expone desde pos 8 — el asset vive como canvas en
   * memoria de sesión (sin URL descargable que arrastrar). */
  const blockFreeDownload = useCallback((e: React.SyntheticEvent) => e.preventDefault(), []);

  return (
    <div className="flex min-h-screen flex-col">
      <PlanWatcher userId={userId} />
      <TopBar
        plan={profile.plan}
        baseName={profile.brandName?.trim() || profile.baseName}
        logoThumbUrl={profile.logoThumbUrl}
        graceDaysLeft={profile.plan === 'pro_grace' ? graceDaysLeft(profile.graceExpiresAt) : null}
        priceText={priceText}
        demoUsed={designAsset != null}
        onUnlockRequest={() => setPaywallOpen(true)}
      />

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_340px]">
        {/* Estudio 3D (posiciones 4–7: catálogo + medidas + color + grabado con rotación/
            escala + guías + auto-giro + pulso de desborde) · pos 8 R4: en demo, bloqueo
            DOM del lienzo (contextmenu/arrastre) + watermark cocida (prop watermark). */}
        <section
          className={[
            'relative min-h-[420px] overflow-hidden rounded-2xl border border-line lg:min-h-0',
            freeDemo ? 'select-none' : '',
          ].join(' ')}
          onContextMenu={freeDemo ? blockFreeDownload : undefined}
          onDragStart={freeDemo ? blockFreeDownload : undefined}
        >
          <StudioScene spinning={spinning} onUserInteracted={pauseSpin} watermark={freeDemo} />
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

          {/* CUARTA tarjeta (§4 spec_rotacion + spec_escala): Cargar Archivo / Edición del Vector */}
          <DesignCard />

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
              {GATED_ACTIONS.map((entry) => {
                const unlocked = gate(entry.cap, profile.plan);
                return (
                  <Button
                    key={entry.label}
                    variant="outline"
                    size="md"
                    className="w-full justify-start"
                    disabled={fotoBusy && entry.action === 'foto'}
                    onClick={() => handleGatedClick(entry)}
                  >
                    <entry.icon className="h-4 w-4" />
                    <span className="flex-1 text-left text-xs">{entry.label}</span>
                    {unlocked ? (
                      entry.future ? (
                        <span className="text-[9px] text-stone-600">pos. {entry.future}</span>
                      ) : null
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-rose-400" />
                    )}
                  </Button>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-stone-600">
              Foto HD y Ficha Técnica YA EXPORTAN (pos 9): el ticket se emite y verifica en el
              servidor antes de adjuntar el archivo — una cuenta FREE recibe{' '}
              <span className="font-mono">402</span> y este mismo Paywall se abre (jamás un error
              crudo). El Enlace Comercial llega con la 10.
            </p>
          </div>
        </aside>
      </main>

      <footer className="border-t border-line px-4 py-3 text-center text-[10px] leading-relaxed text-stone-600">
        Posición 9 del plan: Ficha Técnica (snapshot inmutable · grilla de 9 tarjetas · PNG HD 2160 ·
        PDF A4 · Foto HD — fuente única:{' '}
        <span className="font-mono">spec_detalle_del_modelo_en_ficha.md</span>) · posición 8:{' '}
        <span className="font-mono">spec_autenticacion_y_modelo_freemium.md</span> · posición 7:{' '}
        <span className="font-mono">spec_escala_y_alerta_de_desborde.md</span> · posición 6:{' '}
        <span className="font-mono">spec_rotacion_archivo_svg_png.md</span> · posición 5:{' '}
        <span className="font-mono">spec_seleccion_de_color.md</span>
      </footer>

      <PaywallModal
        open={paywallOpen}
        price={price}
        priceError={priceError}
        onClose={() => setPaywallOpen(false)}
      />

      {/* R5 spec_escala (pos 9): mini-diálogo de confirmación EXACTa ante desborde
          para la Foto HD — los CTA son los de la spec ("Exportar de todas formas" /
          "Volver a ajustar"); en Ficha Técnica el panel vive DENTRO del modal. */}
      {overflowConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar export con desborde"
          onClick={(e) => {
            if (e.target === e.currentTarget) answerOverflowConfirm(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-amber-500/45 bg-panel p-5 shadow-2xl">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200">
                {overflowBannerText(overflowConfirm)}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => answerOverflowConfirm(true)}>
                Exportar de todas formas
              </Button>
              <Button variant="ghost" size="sm" onClick={() => answerOverflowConfirm(false)}>
                Volver a ajustar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pos 9: modal #quoteModal — snapshot inmutable + grilla + export.
          Las observaciones viven en la shell (sesión): sobreviven re-abrir. */}
      <QuoteModal
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        plan={profile.plan}
        profile={{
          brandName: profile.brandName,
          baseName: profile.baseName,
          logoThumbUrl: profile.logoThumbUrl ?? null,
          whatsappE164: profile.whatsappE164,
          instagramHandle: profile.instagramHandle,
        }}
        onPaywallRequest={() => setPaywallOpen(true)}
        observaciones={obsText}
        onObservacionesChange={setObsText}
      />
    </div>
  );
}
