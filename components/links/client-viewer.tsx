'use client';

/* ============================================================================
 * MODO CLIENTE — UI del visor /v/[linkId] (posición 10A, §4 spec shareable)
 * ----------------------------------------------------------------------------
 * CEROS de la spec (§6: "jamás expone numeraciones, margen, escala ni
 * herramientas de edición — ni en UI ni en DOM"): sin sliders, sin cargadores
 * de archivos, sin guías, SIN el riesgo congelado (R7: el panel del editor
 * puede verlo; el cliente JAMÁS). Solo: marca del taller, escena 3D, selector
 * A/B/C, acordeón (Modelo/Virola mm/Cuerpo) y el CTA de aprobación.
 * Flujos:
 *   · Assets: se baja la textura (≤300 KB R3) una vez por URL única — las
 *     variantes comparten asset (configs del MISMO diseño); si una imagen
 *     falla, esa opción queda "no disponible" y las otras siguen (§6).
 *   · Crossfade ≤300 ms (spec §4): rAF que desvanece la capa anterior SOBRE
 *     la textura compuesta — malla/cámara/giro jamás se reinician (QA3).
 *   · Aprobar (R6): POST del evento ANTES de abrir WhatsApp; el texto nombra
 *     EXACTAMENTE la opción visible (label congelado del payload). Sin
 *     WhatsApp ⇒ código APROBADA-B-XXXXXX (spec usuario R5) copiable — el
 *     evento igual queda registrado.
 *   · POST con red rota: reintentos con backoff; con número el wa.me igual
 *     se abre (la garantía comercial es el chat, el registro es respaldo).
 * ============================================================================ */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Info, Loader2, MessageCircle, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicLinkView, PublicVariantView } from '@/lib/links/view-shape';
import type { LinkVariantId } from '@/lib/links/payload';
import { approvalCode, canonicalLinkUrl, whatsappApprovalHref } from '@/lib/links/states';
import { formatModeloCard, formatVirolaCard, formatCuerpoCard } from '@/lib/quote/snapshot';

/* La escena R3F NO puede SSR: lazy + client-only (mismo patrón de la shell). */
const ViewerScene = dynamic(() => import('@/components/links/viewer-scene'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="text-xs text-stone-500">Cargando escena…</p>
    </div>
  ),
});

/** Fade de la spec §4: "crossfade de textura ≤300 ms". */
const FADE_MS = 300;
/** Backoff de reintentos del POST de aprobación (§6: "con backoff"). */
const RETRY_DELAYS = [0, 800, 2400] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Baja la textura y la rasteriza contain-fit 1024² (R8 de pos 6) — el asset
 * es el ráster con la MISMA semántica que composeEngravingCanvas espera. */
async function rasterizeAsset(url: string): Promise<HTMLCanvasElement | null> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous'; // storage público: evita taint si debajo hay CDN
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('asset caído'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Contain-fit centrado (R8: el 100% ES la envolvente tocando el anillo)
    const side = Math.max(img.naturalWidth, img.naturalHeight) || 1024;
    const s = Math.min(1, 1024 / side);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, (1024 - w) / 2, (1024 - h) / 2, w, h);
    return canvas;
  } catch {
    return null; // variante "no disponible" (§6): las demás siguen operando
  }
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'MO'
  );
}

type ApprovalStatus = 'idle' | 'sending' | 'done' | 'novigente';

export default function ClientViewer({ view }: { view: PublicLinkView }) {
  /* Assets: URL ⇒ canvas rasterizado (null = la carga FALLÓ,🐪 disponible). */
  const uniqueUrls = useMemo(
    () => Array.from(new Set(view.variants.map((v) => v.assetUrl).filter(Boolean))),
    [view.variants],
  );
  const [assets, setAssets] = useState<Map<string, HTMLCanvasElement | null>>(new Map());
  const [loading, setLoading] = useState(uniqueUrls.length > 0);

  useEffect(() => {
    let alive = true;
    if (uniqueUrls.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      // Por ENTRADA (y no Promise.all final): la primera opción activa aparece
      // apenas carga SU imagen (QA1 <2 s), las demás precargan detrás.
      await Promise.all(
        uniqueUrls.map(async (url) => {
          const canvas = await rasterizeAsset(url);
          if (alive) setAssets((prev) => new Map(prev).set(url, canvas));
        }),
      );
    })().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [uniqueUrls]);

  const canvasOf = useCallback(
    (variant: PublicVariantView | null): HTMLCanvasElement | null =>
      variant && variant.assetUrl ? (assets.get(variant.assetUrl) ?? null) : null,
    [assets],
  );

  const [activeId, setActiveId] = useState<LinkVariantId | null>(null);
  const [fade, setFade] = useState<{ id: LinkVariantId; alpha: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [hint, setHint] = useState(true);
  const [approval, setApproval] = useState<ApprovalStatus>('idle');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /* Primera variante del payload ANTES de conocer el canvas: en cuanto esté
   * disponible el asset la escena compone; si el asset falla, la variante se
   * deshabilita y el efecto de abajo manda al usuario a otra sana. */
  useEffect(() => {
    if (!activeId && view.variants.length > 0) {
      const first = view.variants.find((v) => v.healthy) ?? null;
      if (first) setActiveId(first.id);
    }
  }, [activeId, view.variants]);

  /* ── Swap con crossfade ≤300 ms (la malla, la cámara y el giro ni se enteran) */
  const switchTo = useCallback(
    (next: PublicVariantView) => {
      if (next.id === activeId || !canvasOf(next)) return;
      const fromVariant = view.variants.find((v) => v.id === activeId) ?? null;
      setActiveId(next.id);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const fromCanvas = canvasOf(fromVariant);
      if (fromVariant && fromCanvas) {
        const start = performance.now();
        setFade({ id: fromVariant.id, alpha: 1 });
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / FADE_MS);
          setFade({ id: fromVariant.id, alpha: 1 - t });
          if (t < 1) {
            rafRef.current = requestAnimationFrame(tick);
          } else {
            setFade(null);
            rafRef.current = null;
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setFade(null); // sin capa previa (arranque/carga fallida): swap directo
      }
    },
    [activeId, canvasOf, view.variants],
  );

  /* Si la variante ACTIVA quedó rota (asset caído) ⇒ autoswitch a una sana (§6). */
  useEffect(() => {
    if (!activeId || loading) return;
    const active = view.variants.find((v) => v.id === activeId);
    if (active && active.assetUrl && assets.get(active.assetUrl) === null) {
      const fallback = view.variants.find(
        (v) => v.id !== activeId && v.healthy && (assets.get(v.assetUrl) ?? null) !== null,
      );
      if (fallback) switchTo(fallback);
    }
  }, [assets, activeId, loading, view.variants, switchTo]);

  const activeVariant = useMemo(
    () => view.variants.find((v) => v.id === activeId) ?? null,
    [view.variants, activeId],
  );
  const fadeVariant = fade ? (view.variants.find((v) => v.id === fade.id) ?? null) : null;
  const anyAvailable = view.variants.some((v) => v.healthy && assets.get(v.assetUrl));

  /* ── Aprobación R6: registra ANTES de abrir WhatsApp ──────────────────── */
  const approve = useCallback(async (): Promise<void> => {
    if (approval === 'sending' || !activeVariant) return;
    setApproval('sending');
    setApprovalError(null);
    const variantId = activeVariant.id;
    let registered = false;
    let blocked = false;
    for (const delay of RETRY_DELAYS) {
      await sleep(delay);
      try {
        const res = await fetch(`/api/links/${view.linkId}/approvals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantId }),
        });
        if (res.ok) {
          registered = true;
          break;
        }
        if (res.status === 404 || res.status === 410) {
          // La propuesta dejó de existir o venció entre pantallas: ni registro
          // ni wa.me — el panel cambia a "ya no vigente" (honesto).
          blocked = true;
          break;
        }
      } catch {
        // red caída: el backoff reintenta
      }
    }

    if (blocked) {
      setApproval('novigente');
      return;
    }

    /* R6: el evento ya (o no) se registró; el CHAT es la garantía comercial —
     * con número sale SIEMPRE, registrado o no (§6 fallback). */
    const url = canonicalLinkUrl(view.linkId, window.location.origin);
    const href = whatsappApprovalHref(view.workshop.whatsapp, url, activeVariant.label);
    if (href) window.location.href = href;
    if (registered) {
      setApproval('done'); // con número salió wa.me; sin ⇒ panel del código copiable
    } else {
      setApprovalError(href
        ? 'No pudimos registrar tu aprobación (el sistema reintenta). El mensaje de WhatsApp igual se abrió.'
        : 'No pudimos registrar tu aprobación por ahora — reintentá con el botón.');
      setApproval('idle');
    }
  }, [approval, activeVariant, view.linkId, view.workshop.whatsapp]);

  const copyCode = useCallback(async () => {
    if (!activeVariant) return;
    const code = approvalCode(view.linkId, activeVariant.id);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }, [activeVariant, view.linkId]);

  /* Payload dañado O (assets cargados y NINGUNO sano) ⇒ página amable (§6). */
  if (view.variants.length === 0 || (!loading && !anyAvailable)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0b0d] px-6 text-center">
        <div className="max-w-sm space-y-3">
          <Info className="mx-auto size-8 text-gold-soft" />
          <h1 className="text-sm font-bold text-stone-100">Esta propuesta no está disponible</h1>
          <p className="text-xs leading-relaxed text-stone-400">
            El taller puede enviarte un enlace nuevo con las opciones vigentes.
          </p>
          {view.workshop.whatsapp && view.workshop.whatsapp.length >= 6 && (
            <a
              href={`https://wa.me/${view.workshop.whatsapp}`}
              target="_blank"
              rel="noreferrer"
              className="inline-block"
            >
              <Button variant="green" size="md">
                <MessageCircle className="size-4" />
                Contactar al taller
              </Button>
            </a>
          )}
        </div>
      </main>
    );
  }

  const modelo = formatModeloCard(view.mate.modelId);
  const virola = formatVirolaCard(view.mate.metal, view.mate.virolaColor);
  const cuerpo = formatCuerpoCard(view.mate.cupMaterial, view.mate.cupColor);
  const hasWhatsapp = Boolean(view.workshop.whatsapp && view.workshop.whatsapp.length >= 6);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#0b0b0d]">
      {/* ── Top bar glassmorphism (§4): logo + nombre + "Vista Previa Oficial" ── */}
      <header className="flex items-center gap-2.5 border-b border-white/10 bg-black/40 px-4 py-2.5 backdrop-blur">
        {view.workshop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.workshop.logoUrl} alt="" className="size-9 rounded-lg object-cover" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-lg bg-gold/20 text-[11px] font-bold text-gold-soft">
            {initialsOf(view.workshop.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-stone-100">{view.workshop.name}</p>
          <p className="text-[9px] font-bold uppercase tracking-widest text-gold-soft/80">
            Vista Previa Oficial
          </p>
        </div>
      </header>

      {/* ── Escena 3D (sin guías/medidas/marca; giro tenue pausable) ────────── */}
      <section className="relative min-h-0 flex-1">
        <ViewerScene
          view={view}
          layer={{ variant: activeVariant, asset: canvasOf(activeVariant), alpha: 1 }}
          fadeLayer={
            fade && fadeVariant
              ? { variant: fadeVariant, asset: canvasOf(fadeVariant), alpha: fade.alpha }
              : null
          }
          onUserInteracted={() => setHint(false)}
        />
        {hint && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-300 backdrop-blur">
            Arrastrá para girar 360°
          </div>
        )}
        {!canvasOf(activeVariant) && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[10px] text-stone-300 backdrop-blur">
            <Loader2 className="size-3 animate-spin" /> Cargando diseño…
          </div>
        )}
      </section>

      {/* ── Barra inferior: selector (solo si hay A/B/C) + acordeón + CTA ───── */}
      <section className="max-h-[45vh] space-y-2.5 overflow-y-auto border-t border-white/10 bg-black/40 px-4 pb-4 pt-3 backdrop-blur">
        {/* Selector plano de opciones: los links nuevos publican UNA sola. */}
        {view.variants.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {view.variants.map((v) => {
            const unloaded = Boolean(v.assetUrl && !assets.has(v.assetUrl));
            const failed = Boolean(v.assetUrl && assets.get(v.assetUrl) === null);
            const disabled = !v.healthy || failed || (loading && unloaded);
            const selected = v.id === activeId;
            return (
              <button
                key={v.id}
                type="button"
                disabled={disabled}
                onClick={() => switchTo(v)}
                aria-pressed={selected}
                className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                  selected
                    ? 'border-gold bg-gold/15 text-gold-soft'
                    : disabled
                      ? 'cursor-not-allowed border-white/10 text-stone-600'
                      : 'border-white/20 text-stone-300 hover:border-white/40'
                }`}
              >
                <span className="rounded-full border border-current px-1 text-[9px]">{v.id}</span>
                <span className="max-w-[9.5rem] truncate">
                  {failed ? `${v.label} (no disponible)` : v.label}
                </span>
              </button>
            );
            })}
          </div>
        )}

        {/* Acordeón de resumen: Modelo / Virola (mm) / Cuerpo — SOLO eso (R7) */}
        <div className="text-[11px]">
          {[
            { title: 'Modelo', body: modelo.etiqueta },
            {
              title: 'Virola (mm)',
              body: `${virola} · Ø ${view.mate.extDiameter} mm ext. / Ø ${view.mate.intDiameter} mm int.`,
            },
            { title: 'Cuerpo', body: cuerpo },
          ].map((row) => (
            <details key={row.title} className="group rounded-lg border border-white/10 bg-white/[0.04]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-bold text-stone-200 [&::-webkit-details-marker]:hidden">
                {row.title}
                <ChevronDown className="size-3.5 text-stone-500 transition-transform group-open:rotate-180" />
              </summary>
              <p className="border-t border-white/10 px-3 py-2 text-stone-400">{row.body}</p>
            </details>
          ))}
        </div>

        {/* CTA de cierre (R6): registra ANTES de abrir WhatsApp */}
        {approval === 'done' ? (
          hasWhatsapp ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
              <Check className="size-4" /> ¡Aprobación registrada — te abrimos WhatsApp!
            </div>
          ) : (
            <div className="space-y-1.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2">
              <p className="text-[11px] font-bold text-gold-soft">
                <Check className="mr-1 inline size-3.5" />
                ¡Aprobación registrada! Tu código:
              </p>
              <code className="block rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-center font-mono text-[12px] tracking-wide text-stone-100">
                {approvalCode(view.linkId, activeVariant?.id ?? 'A')}
              </code>
              <Button variant="outline" size="sm" className="w-full" onClick={() => void copyCode()}>
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                Copiar código de aprobación
              </Button>
              <p className="text-[10px] leading-relaxed text-stone-500">
                {view.variants.length === 1
                  ? 'Ponete en contacto con tu vendedor indicando que aprobaste este diseño.'
                  : `Ponete en contacto con tu vendedor indicando que aprobaste la Opción ${activeVariant?.id ?? 'A'}.`}
              </p>
            </div>
          )
        ) : (
          <div className="space-y-1.5">
            <Button
              variant="green"
              size="md"
              className="w-full justify-center"
              disabled={approval === 'sending' || !canvasOf(activeVariant)}
              onClick={() => void approve()}
            >
              {approval === 'sending' ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Registrando…
                </>
              ) : (
                <>
                  <MessageCircle className="size-4" />
                  {view.variants.length === 1
                    ? '¡Aprobar este diseño!'
                    : '¡Aprobar Opción Seleccionada!'}
                </>
              )}
            </Button>
            {approvalError && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                <Repeat className="mr-1 inline size-3" />
                {approvalError}
              </p>
            )}
            {approval === 'novigente' && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                Esta propuesta ya no está vigente — pedile al taller un enlace nuevo.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
