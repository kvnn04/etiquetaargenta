'use client';

/* ============================================================================
 * MODAL #quoteModal — FICHA TÉCNICA (pos 9)
 * ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md
 * ----------------------------------------------------------------------------
 * R1 — Al abrir (o Actualizar) se captura un snapshot INMUTABLE: las ediciones
 *      detrás no lo tocan. Badge "Actualizado a las HH:MM" + botón Actualizar.
 * R2 — Grilla React de las MISMAS 9 tarjetas que imprime el motor (lib/quote/
 *      snapshot: únicos formatos — "123.0 mm", "92.5%", "45.5°", "—").
 * R3 — Descriptores fijos: la grilla imprime lo del snapshot (jamás auto-
 *      nombres de color).
 * R4 — Marca resuelta con resolveBranding único: escudo iniciales / logo PRO.
 * R5 — Observaciones: campo 280 + contador (session-scoped; sobrevive al
 *      cerrar/abrir el modal, JAMÁS va al jsonb); chip "sin capturar" cuando
 *      el texto difiere del snapshot impreso.
 * R6 — Export único: makeQuoteCanvas (PNG 2× lado mínimo 2160, ≤ 5 MB) y PDF
 *      A4 del MISMO PNG (pdf-lib). Confirmación de desborde EXACTA de
 *      spec_escala R5 antes de bajar cualquier artefacto.
 * R7 — Ticket server-side: ensure → verificar (y una re-emisión, R7). FREE
 *      recibe 402 ⇒ Paywall (server-authoritative: el candado es decoración).
 * R8 — Fallbacks honrados: "Sin diseño cargado" en Grabado, `—` en faltantes.
 * §5 — El snapshot no se persiste: vive en memoria modal hasta recargar.
 * El motor (three) se importa con import() dinámico: el chunk pesado queda
 * separado del HTML inicial (patrón pos 3).
 * ============================================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileDown, FileImage, Link2, Lock, RefreshCw, X, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { canonicalSiteOrigin } from '@/lib/http/origin';
import { gate, type Plan } from '@/lib/permissions';
import { resolveBranding } from '@/lib/branding';
import { useEditorStore } from '@/lib/store/editor';
import { isThermoProduct, resolveProduct } from '@/lib/catalog';
import { thermoAssetAspect } from '@/lib/compose-thermo-engraving';
import {
  captureFichaSnapshot,
  currentOverflowCheck,
  formatMmCard,
  type FichaMarginState,
  type FichaSnapshot,
} from '@/lib/quote/snapshot';
import { OBSERVACIONES_MAX } from '@/lib/quote/texts';
import { canonicalLinkUrl, whatsappShareHref } from '@/lib/links/states';
import { overflowBannerText } from '@/lib/overflow';
import {
  downloadBlob,
  ensureVerifiedTicket,
  EXPORT_ERR_RENDER,
  registerQaArtifact,
  QUOTE_MAX_BYTES,
} from '@/lib/quote/export-flow';

export interface QuoteModalProfile {
  /** Nombre comercial (posición 2) o null ⇒ cuenta/fallback (R4). */
  brandName: string | null;
  /** Nombre de cuenta derivado (R1, siempre presente). */
  baseName: string;
  /** Thumb del logo ya firmado (white-label resuelto en snapshot, no acá). */
  logoThumbUrl: string | null;
  /** E.164 del Perfil (pie con CTA WhatsApp, R4). */
  whatsappE164: string | null;
  /** Handle de Instagram del Perfil (pie, R4). */
  instagramHandle: string | null;
}

type ExportKind = 'png' | 'pdf';

/* -------------------------------------------------------------------------- */
/* Grilla espejo — MISMA información que imprime makeQuoteCanvas               */
/* -------------------------------------------------------------------------- */

function dash(v: string | null): string {
  return v ?? '—';
}

function FichaCard({
  title,
  value,
  state = 'plain',
  caption,
}: {
  title: string;
  value: string;
  state?: FichaMarginState | 'plain';
  caption?: string | null;
}) {
  const styleByState: Record<string, string> = {
    safe: 'border-emerald-500/40 bg-emerald-500/10',
    risk: 'border-amber-500/45 bg-amber-500/10',
    plain: 'border-gold/20 bg-black/20',
  };
  const inkByState: Record<string, string> = {
    safe: 'text-emerald-300',
    risk: 'text-amber-300',
    plain: 'text-stone-100',
  };
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${styleByState[state] ?? styleByState.plain}`}
      data-card={title}
    >
      <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{title}</p>
      <p
        className={`mt-1 text-[13px] font-semibold leading-tight ${inkByState[state] ?? inkByState.plain}`}
      >
        {value}
      </p>
      {caption ? <p className="mt-0.5 text-[9px] text-stone-500">{caption}</p> : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gold-soft">
        {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal ¡TODO server-authoritative: FREE entra y el candado es de UI!         */
/* -------------------------------------------------------------------------- */

export default function QuoteModal({
  open,
  onClose,
  plan,
  profile,
  onPaywallRequest,
  observaciones,
  onObservacionesChange,
  linkId,
  onGenerateLink,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  profile: QuoteModalProfile;
  onPaywallRequest: () => void;
  /** R5/§5: texto libre de sesión — vive en la shell, sobrevive a re-abrir. */
  observaciones: string;
  onObservacionesChange: (text: string) => void;
  /** Pos 10A: linkId del enlace VIGENTE del proyecto. La shell lo consulta
   * (GET /api/links, primera versión sin expirar) y acá queda ligado al
   * snapshot inmutable de la Ficha (input PASSTHROUGH dejado en pos 9). */
  linkId: string | null;
  /** Pos 10A: abre el modal del Enlace Comercial sobre la Ficha (misma capa). */
  onGenerateLink: () => void;
}) {
  const renderPlateRef = useRef<HTMLCanvasElement | null>(null);
  const obsRef = useRef(observaciones);
  obsRef.current = observaciones;
  const flashTimerRef = useRef<number | null>(null);

  const [snapshot, setSnapshot] = useState<FichaSnapshot | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderReady, setRenderReady] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [busyKind, setBusyKind] = useState<ExportKind | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ExportKind | null>(null);
  const [posHint, setPosHint] = useState<string | null>(null);

  /* ── R1: captura del snapshot (Abrir / Actualizar) ─────────────────────── */
  const captureNow = useCallback((): FichaSnapshot | null => {
    const s = useEditorStore.getState();
    const product = resolveProduct(s.mateModel);
    const brand = resolveBranding(
      {
        brandName: profile.brandName,
        displayName: profile.baseName,
        logoThumbUrl: profile.logoThumbUrl,
        instagramHandle: profile.instagramHandle,
      },
      { plan },
    );
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
        thermo: s.thermo,
      },
      designAssetPresent: s.designAsset != null,
      designAspect: thermoAssetAspect(s.designAsset?.canvas ?? null),
      hasProject: s.projectId != null,
      overflow: currentOverflowCheck({
        hasDesignAsset: s.designAsset != null,
        inkEnvelope: s.inkEnvelope,
        inkScanDegraded: s.inkScanDegraded,
        baseSideMm: s.designAsset?.baseSideMm ?? s.extDiameter,
        extDiameterMm: s.extDiameter,
        intDiameterMm: s.intDiameter,
        scalePct: s.design.scale,
        thermo: isThermoProduct(product)
          ? {
              spec: product.thermo,
              offsetYPct: s.thermo.offsetYPct,
              aspect: thermoAssetAspect(s.designAsset?.canvas ?? null),
            }
          : null,
      }),
      inkDegraded: s.inkScanDegraded,
      brand,
      whatsappE164: profile.whatsappE164,
      linkId, // pos 10A: el enlace comercial vigente queda ligado DNA del snapshot
      observaciones: obsRef.current,
    });
    setSnapshot(snap);
    setConfirmKind(null); // nuevo snapshot ⇒ confirma de nuevo ante desborde
    return snap;
  }, [plan, profile, linkId]);

  /* ── Apertura / Actualizar: snapshot + vista HD del render (import lazy) ── */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRenderUrl(null);
    setRenderReady(false);
    setFlash(null);
    setError(null);
    setConfirmKind(null);
    setPosHint(null);
    captureRef.current();
    void (async () => {
      const mod = await import('@/components/quote/ficha-render');
      if (!alive) return;
      const s = useEditorStore.getState();
      const view = mod.renderMateView({
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
        thermo: s.thermo,
        widthCss: 430,
        heightCss: 470,
      });
      if (!alive) return; // cerraron el modal durante el render ⇒ descartar
      renderPlateRef.current = view;
      setRenderReady(true);
      setRenderUrl(view ? view.toDataURL('image/png') : null);
    })();
    return () => {
      alive = false;
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, refreshTick]);

  /* captureRef: Actualizar SIEMPRE captura el obsText vigente sin que el
   * cambio de observaciones re-dispare el render HD (deps van por el tick). */
  const captureRef = useRef(captureNow);
  captureRef.current = captureNow;

  /* Pos 10A: la shell resuelve el enlace vigente async al abrir la Ficha. Si
   * llega DESPUÉS de la captura inicial, se recaptura el snapshot para que el
   * PDF y el botón «Enviar por WhatsApp» usen ese linkId (no re-renderiza el
   * plato: el 3D no depende del enlace). */
  const linkIdRef = useRef(linkId);
  useEffect(() => {
    if (linkIdRef.current === linkId) return;
    linkIdRef.current = linkId;
    if (open) captureRef.current();
  }, [linkId, open]);

  /* Limpieza del flash al desmontar. */
  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  function handleRefresh(): void {
    captureRef.current();
    setRefreshTick((t) => t + 1); // re-render HD del plato con el estado nuevo
  }

  /* ── R6/R7: el export completo con confirmación de desborde EXACTA ──────── */
  async function handleExport(kind: ExportKind): Promise<void> {
    const snap = snapshot;
    if (!snap || !renderReady || busyKind) return;

    // R5 de spec_escala (vía R6 spec_detalle): PRIEMA confirmación honesta.
    if (confirmKind !== kind && snap.overflow?.status === 'overflow') {
      setConfirmKind(kind);
      return;
    }
    setConfirmKind(null);
    setBusyKind(kind);
    setError(null);
    setFlash(null);

    try {
      // R7 — ticket firmado + contra-verificación (402 ⇒ Paywall, un attempt).
      const ticket = await ensureVerifiedTicket(snap.hash, {
        onPaywallRequest: onPaywallRequest,
        onError: setError,
      });
      if (!ticket) {
        setBusyKind(null);
        return;
      }

      const mod = await import('@/components/quote/ficha-render');
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await mod.makeQuoteCanvas({ snapshot: snap, renderCanvas: renderPlateRef.current });
      } catch {
        // R6: UN reintento del motor antes de avisar (pico transitorio de GPU).
        try {
          canvas = await mod.makeQuoteCanvas({
            snapshot: snap,
            renderCanvas: renderPlateRef.current,
          });
        } catch {
          canvas = null;
        }
      }
      if (!canvas) {
        setError(EXPORT_ERR_RENDER);
        setBusyKind(null);
        return;
      }

      // R6 — cota ≤ 5 MB: escalada de calidad del JPEG intermedio embebido.
      let blob = await mod.canvasToPngBlob(canvas);
      if (blob && blob.size > QUOTE_MAX_BYTES) {
        for (const quality of [0.8, 0.6, 0.45]) {
          const retry = await mod.makeQuoteCanvas({
            snapshot: snap,
            renderCanvas: renderPlateRef.current,
            jpegQuality: quality,
          });
          blob = (await mod.canvasToPngBlob(retry)) ?? blob;
          if (blob.size <= QUOTE_MAX_BYTES) break;
        }
      }
      if (!blob) {
        setError(EXPORT_ERR_RENDER);
        setBusyKind(null);
        return;
      }

      const fecha = mod.formatFichaDate(snap.capturedAt);
      const { fichaFileName } = await import('@/lib/quote/texts');
      const filename = fichaFileName({
        tallerTitle: snap.brand.title,
        modelId: snap.productId,
        capturedAtMs: snap.capturedAt,
        kind,
      });

      let finalBlob = blob;
      if (kind === 'pdf') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const pdfMod = await import('@/components/quote/ficha-pdf');
        // R6: el PDF es un envoltorio A4 del MISMO PNG (mismos bytes ≤ 5 MB).
        const pdfBytes = await pdfMod.buildFichaPdf(bytes, {
          tallerTitle: snap.brand.title,
          fecha,
          linkId: snap.linkId,
        });
        finalBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      }

      downloadBlob(finalBlob, filename);
      void registerQaArtifact(kind); // §7: registro QA (GET /api/exports)
      setFlash('Descargado ✓');
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(
        () => setFlash((f) => (f === 'Descargado ✓' ? null : f)),
        2600,
      );
    } catch {
      setError(EXPORT_ERR_RENDER);
    } finally {
      setBusyKind(null);
    }
  }

  /* ── Pos 10A: Enlace Comercial + envío por WhatsApp (wa.me) ─────────────── */
  function handleLinkAction(which: 'enlace' | 'envio'): void {
    if (!gate('links.generate', plan)) {
      onPaywallRequest();
      return;
    }
    if (which === 'enlace') {
      setPosHint(null);
      onGenerateLink(); // el modal del enlace se apila sobre la Ficha
      return;
    }
    if (!linkId) {
      setPosHint(
        'Todavía no hay un enlace vigente: publicá una versión y, al volver a la Ficha, «Enviar por WhatsApp» abrirá el chat con el mensaje listo.',
      );
      onGenerateLink(); // sin versión no hay nada que compartir: se publica primero
      return;
    }
    const url = canonicalLinkUrl(linkId, canonicalSiteOrigin(window.location.origin));
    setPosHint(null);
    /* El share NO lleva número: WhatsApp abre el selector y el taller elige al
     * cliente. El E.164 del Perfil es el destino de la aprobación (R6). */
    window.open(whatsappShareHref(url), '_blank', 'noopener,noreferrer');
  }

  if (!open) return null;

  const freeLocked = plan === 'free';
  const obsCanonical = observaciones.replace(/\s+/g, ' ').trim();
  const obsSinCapturar = snapshot ? obsCanonical !== snapshot.observaciones : false;
  const showConfirm = snapshot?.overflow?.status === 'overflow' && confirmKind !== null;

  return (
    <div
      id="quoteModal"
      role="dialog"
      aria-modal="true"
      aria-label="Ficha Técnica del Producto"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto my-6 w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        {/* ── Header: marca R4 + badge R1 + Actualizar ────────────────────── */}
        <div className="flex items-center gap-3 border-b border-line bg-black/30 px-5 py-4">
          {profile.logoThumbUrl && snapshot?.brand.logoThumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={snapshot.brand.logoThumbUrl}
              alt={snapshot.brand.title}
              className="h-11 w-11 rounded-xl border border-gold/30 object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/30 bg-white font-black text-gold">
              {(snapshot?.brand.initials ?? 'MT').slice(0, 2)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-stone-100">
              {snapshot?.brand.title ?? 'Ficha Técnica'}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gold-soft">
              Ficha Técnica de Producto
            </p>
          </div>
          {snapshot && (
            <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
              Actualizado a las{' '}
              {new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(
                new Date(snapshot.capturedAt),
              )}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={busyKind !== null}>
            <RefreshCw className={`h-3.5 w-3.5 ${busyKind === null ? '' : 'animate-spin'}`} />
            Actualizar
          </Button>
          <button
            type="button"
            aria-label="Cerrar ficha"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(100vh-160px)] overflow-y-auto px-5 py-5">
          {/* ── R1/R2: vista HD del render (sin guías, sin watermark) + R5 ──── */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,430px)_1fr]">
            <div>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12100C]">
                {renderUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={renderUrl} alt="Vista HD del mate para la ficha" className="block w-full" />
                ) : (
                  <div className="flex h-[380px] items-center justify-center">
                    <Camera className="h-6 w-6 animate-pulse text-gold-soft/70" />
                  </div>
                )}
              </div>
              <p className="mt-2 text-center text-[10px] text-stone-500">
                Vista del render HD — sin guías, sin marca de agua (la misma que se imprime)
              </p>
            </div>

            {/* Observaciones (R5): session-scoped + chip "sin capturar" */}
            <div className="rounded-xl border border-gold/20 bg-black/20 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Observaciones
                </h3>
                <span className="text-[10px] tabular-nums text-stone-500">
                  {observaciones.length}/{OBSERVACIONES_MAX}
                </span>
              </div>
              <textarea
                value={observaciones}
                maxLength={OBSERVACIONES_MAX}
                onChange={(e) => onObservacionesChange(e.target.value)}
                placeholder="Nombre, frase o pedido especial del cliente"
                rows={4}
                className="mt-2 w-full resize-none rounded-lg border border-line bg-black/30 px-3 py-2 text-xs leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-gold/50 focus:outline-none"
              />
              {obsSinCapturar && snapshot && (
                <p className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-200">
                  Observaciones sin capturar — pulsa <b>Actualizar</b> para imprimirlas en la
                  ficha.
                </p>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-stone-600">
                El snapshot fue congelado al abrir {snapshot ? '(hash ' + snapshot.hash + ')' : ''}
                . Las ediciones de la escena NO alteran la ficha (R1) hasta que pulses
                Actualizar.
              </p>
            </div>
          </div>

          {/* ── Grilla de las 9 tarjetas (R2 — MISMA data que el canvas) ───── */}
          {snapshot && (
            <div className="mt-6 space-y-4">
              <SectionLabel>Producto</SectionLabel>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <FichaCard title="Modelo" value={snapshot.modeloEtiqueta} />
                {snapshot.family === 'thermo' && snapshot.thermo ? (
                  <>
                    <FichaCard title="Capacidad" value={snapshot.thermo.capacidadEtiqueta} />
                    <FichaCard title="Altura Total" value={snapshot.thermo.altoEtiqueta} />
                    <FichaCard title="Diámetro del Cuerpo" value={snapshot.thermo.diametroEtiqueta} />
                  </>
                ) : (
                  <>
                    <FichaCard
                      title="Diámetro Exterior"
                      value={dash(formatMmCard(snapshot.extDiameterMm))}
                    />
                    <FichaCard
                      title="Diámetro Interior"
                      value={dash(formatMmCard(snapshot.intDiameterMm))}
                    />
                    <FichaCard title="Ancho de Banda" value={dash(formatMmCard(snapshot.bandaMm))} />
                  </>
                )}
              </div>

              <SectionLabel>Grabado</SectionLabel>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                {snapshot.grabadoSinDiseno ? (
                  <FichaCard title="Escala" value="Sin diseño cargado" />
                ) : (
                  <FichaCard title="Escala" value={snapshot.escalaEtiqueta} />
                )}
                {snapshot.grabadoSinDiseno ? (
                  <FichaCard
                    title={snapshot.family === 'thermo' ? 'Posición' : 'Rotación'}
                    value="Sin diseño cargado"
                  />
                ) : (
                  <FichaCard
                    title={snapshot.family === 'thermo' ? 'Posición' : 'Rotación'}
                    value={
                      snapshot.family === 'thermo'
                        ? (snapshot.thermo?.posicionEtiqueta ?? '—')
                        : snapshot.rotacionEtiqueta
                    }
                  />
                )}
                {snapshot.grabadoSinDiseno ? (
                  <FichaCard title="Margen" value="Sin diseño cargado" />
                ) : (
                  <FichaCard
                    title="Margen"
                    value={dash(snapshot.margenEtiqueta)}
                    state={snapshot.margenEstado}
                    caption={snapshot.margenAproximado ? 'Detección aproximada' : null}
                  />
                )}
              </div>

              <SectionLabel>Acabados</SectionLabel>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                <FichaCard
                  title={snapshot.family === 'thermo' ? 'Acabado' : 'Virola'}
                  value={
                    snapshot.family === 'thermo'
                      ? (snapshot.thermo?.acabadoEtiqueta ?? '—')
                      : snapshot.virolaEtiqueta
                  }
                />
                <FichaCard title="Color / Cuerpo" value={snapshot.cuerpoEtiqueta} />
              </div>
            </div>
          )}

          {/* ── R5 spec_escala: confirmación de desborde EXACTA ─────────────── */}
          {showConfirm && snapshot?.overflow && (
            <div className="mt-5 rounded-xl border border-amber-500/45 bg-amber-500/10 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-200">
                  {overflowBannerText(snapshot.overflow)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleExport(confirmKind!)} disabled={busyKind !== null}>
                  Exportar de todas formas
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Volver a ajustar
                </Button>
              </div>
            </div>
          )}

          {/* ── Pie del modal: export R6/R7 + links pos 10 + QA ─────────────── */}
          <div className="mt-6 space-y-3 border-t border-line pt-4">
            {error && (
              <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error}
              </p>
            )}
            {flash && (
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300">
                {flash}
              </p>
            )}
            {posHint && (
              <p className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-soft">
                {posHint}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleExport('png')}
                disabled={!renderReady || busyKind !== null}
              >
                {busyKind === 'png' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="h-4 w-4" />
                )}
                {busyKind === 'png' ? 'Generando PNG…' : 'Descargar Ficha (PNG)'}
                {freeLocked && <Lock className="h-3.5 w-3.5 text-rose-300" />}
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={() => void handleExport('pdf')}
                disabled={!renderReady || busyKind !== null}
              >
                {busyKind === 'pdf' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                {busyKind === 'pdf' ? 'Generando PDF…' : 'Descargar PDF (A4)'}
                {freeLocked && <Lock className="h-3.5 w-3.5 text-rose-300" />}
              </Button>
              <Button variant="ghost" size="md" onClick={() => handleLinkAction('enlace')}>
                <Link2 className="h-4 w-4" />
                Generar Enlace Comercial
              </Button>
              <Button variant="ghost" size="md" onClick={() => handleLinkAction('envio')}>
                Enviar por WhatsApp
              </Button>
              {!renderReady && (
                <span className="text-[10px] text-stone-500">Preparando la vista HD…</span>
              )}
            </div>

            <p className="text-[10px] leading-relaxed text-stone-600">
              {freeLocked
                ? 'Con plan FREE el intento de export llega al servidor: recibe 402 y el Paywall se abre acá mismo (R7 — el candado es decoración de UI, la decisión real la toma el server). '
                : 'El ticket de export (5 min, firmado y ligado al hash del snapshot) se emite y verifica server-side antes de adjuntar el archivo (R7). '}
              El registro QA del taller queda en <span className="font-mono">GET /api/exports</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
