'use client';

/* ============================================================================
 * MODO CLIENTE — UI del visor /v/[linkId] (posición 10A + 14)
 * ----------------------------------------------------------------------------
 * CEROS de la spec (§6: "jamás expone numeraciones, margen, escala ni
 * herramientas de edición — ni en UI ni en DOM"): sin sliders, sin cargadores
 * de archivos, sin guías, SIN el riesgo congelado (R7: el panel del editor
 * puede verlo; el cliente JAMÁS). Solo: marca del taller, escena 3D, selector
 * A/B/C, acordeón (Modelo/Virola mm/Cuerpo) y las acciones de cierre.
 *
 * Posición 14 (spec_decision_y_observaciones_del_cliente.md):
 *   · UNA decisión inmutable por link: aprobar o rechazar (R14.1/R14.8);
 *   · UNA observación 1..280 code points, sola o como motivo del rechazo
 *     (R14.3/R14.4);
 *   · dos canales: email al taller o WhatsApp pre-armado (R14.5);
 *   · persistir ANTES de abrir WhatsApp; si el email falla, la fila queda y
 *     se ofrece WhatsApp/panel como respaldo (R14.6);
 *   · links legacy con `link_approvals`: se muestran aprobados y no admiten
 *     una decisión nueva; la observación sigue disponible una vez (R14.13).
 * ============================================================================ */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Info,
  Loader2,
  MessageCircle,
  MessageSquare,
  Repeat,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { canonicalSiteOrigin } from '@/lib/http/origin';
import { isThermoProduct, resolveProduct } from '@/lib/catalog';
import { normalizeThermoConfig, thermoColorName, thermoFinishLabel } from '@/lib/thermo';
import type { PublicLinkView, PublicVariantView } from '@/lib/links/view-shape';
import { isLinkVariantId, type LinkVariantId } from '@/lib/links/payload';
import { approvalCode, canonicalLinkUrl, whatsappApprovalHref } from '@/lib/links/states';
import {
  EMPTY_LINK_RESPONSE,
  OBSERVATION_MAX,
  channelLabel,
  emailStatusLabel,
  formatLinkDate,
  isLinkChannel,
  isLinkDecision,
  normalizeObservation,
  observationLength,
  whatsappObservationHref,
  whatsappRejectionHref,
  type LinkChannel,
  type PublicLinkResponse,
} from '@/lib/links/responses';
import { formatModeloCard, formatVirolaCard, formatCuerpoCard, formatMmCard } from '@/lib/quote/snapshot';

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
/** Backoff de reintentos de las acciones del link (§6: "con backoff"). */
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

/* -------------------------------------------------------------------------- */
/* Contratos locales de la respuesta (camelCase del API §6)                    */
/* -------------------------------------------------------------------------- */

interface LinkActionBody {
  ok?: boolean;
  error?: string;
  reason?: string;
  already?: boolean;
  legacy?: boolean;
  decision?: unknown;
  decisionVariantId?: unknown;
  decidedAt?: unknown;
  decisionChannel?: unknown;
  observation?: unknown;
  observedAt?: unknown;
  observationChannel?: unknown;
  emailSent?: boolean;
  emailError?: string;
  whatsappHref?: string;
}

/** Fusiona el body del API con el estado actual sin perder campos previos. */
function mergeResponse(
  prev: PublicLinkResponse | null,
  body: LinkActionBody,
  kind: 'decision' | 'observation',
): PublicLinkResponse {
  const next: PublicLinkResponse = { ...(prev ?? EMPTY_LINK_RESPONSE) };
  if (isLinkDecision(body.decision)) next.decision = body.decision;
  if (isLinkVariantId(body.decisionVariantId)) next.decisionVariantId = body.decisionVariantId;
  if (typeof body.decidedAt === 'string') next.decidedAt = body.decidedAt;
  if (isLinkChannel(body.decisionChannel)) next.decisionChannel = body.decisionChannel;
  if (typeof body.observation === 'string' && body.observation.trim().length > 0) {
    next.observation = body.observation;
  }
  if (typeof body.observedAt === 'string') next.observedAt = body.observedAt;
  if (isLinkChannel(body.observationChannel)) next.observationChannel = body.observationChannel;

  const now = new Date().toISOString();
  if (kind === 'decision' && next.decisionChannel === 'email') {
    if (body.emailSent === true) {
      next.decisionEmailSentAt = now;
      next.decisionEmailError = null;
      /* El email del rechazo cubre también el motivo si nació en el mismo acto. */
      if (next.observationChannel === 'email') {
        next.observationEmailSentAt = now;
        next.observationEmailError = null;
      }
    } else if (body.emailSent === false) {
      const note = body.emailError ?? 'email-failed';
      next.decisionEmailError = note;
      if (next.observationChannel === 'email') next.observationEmailError = note;
    }
  }
  if (kind === 'observation' && next.observationChannel === 'email') {
    if (body.emailSent === true) {
      next.observationEmailSentAt = now;
      next.observationEmailError = null;
    } else if (body.emailSent === false) {
      next.observationEmailError = body.emailError ?? 'email-failed';
    }
  }
  return next;
}

/** POST con backoff SOLO para red/5xx; los 4xx son decisiones del server. */
async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; data: LinkActionBody | null } | null> {
  let last: { status: number; data: LinkActionBody | null } | null = null;
  for (const delay of RETRY_DELAYS) {
    await sleep(delay);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as LinkActionBody | null;
      last = { status: res.status, data };
      if (res.status < 500) return last;
    } catch {
      // red caída: el backoff reintenta
    }
  }
  return last;
}

/** Foco al primer error (spec §4.1 Accesibilidad); no-op fuera del navegador. */
function focusById(id: string): void {
  if (typeof document === 'undefined') return;
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function observationErrorText(reason: 'not_string' | 'empty' | 'too_long'): string {
  return reason === 'too_long'
    ? `La observación supera los ${OBSERVATION_MAX} caracteres.`
    : 'Escribí una observación (1 a 280 caracteres).';
}

function emailFailureText(
  kind: 'decision' | 'observation',
  code: string | undefined,
  hasWhatsapp: boolean,
): string {
  const what = kind === 'decision' ? 'La decisión' : 'La observación';
  const saved = `${what} quedó guardada`;
  const reason =
    code === 'workshop-email-missing'
      ? ', pero el taller no tiene email configurado.'
      : code === 'env-no-configurado'
        ? ', pero el email no está configurado.'
        : ', pero el email no salió.';
  return hasWhatsapp
    ? `${saved}${reason} Probá por WhatsApp.`
    : `${saved}${reason} Quedó guardada en el panel del taller.`;
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p
      aria-live="polite"
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200"
    >
      <Repeat className="mr-1 inline size-3" />
      {children}
    </p>
  );
}

function EmailStatus({
  channel,
  sentAt,
  error,
}: {
  channel: LinkChannel | null;
  sentAt: string | null;
  error: string | null;
}) {
  const label = emailStatusLabel(channel, sentAt, error);
  return label ? <span> · {label}</span> : null;
}

/* -------------------------------------------------------------------------- */
/* Componente                                                                 */
/* -------------------------------------------------------------------------- */

export default function ClientViewer({
  view,
  initialResponse,
  legacyApproval,
}: {
  view: PublicLinkView;
  initialResponse: PublicLinkResponse | null;
  legacyApproval: { variantId: string; approvedAt: string } | null;
}) {
  /* Assets: URL ⇒ canvas rasterizado (null = la carga FALLÓ, no disponible). */
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
  const [copied, setCopied] = useState(false);

  /* ── Posición 14: decisión + observación ───────────────────────────────── */
  const [response, setResponse] = useState<PublicLinkResponse | null>(initialResponse);
  const [legacy, setLegacy] = useState<{ variantId: string; approvedAt: string } | null>(
    legacyApproval,
  );
  const [decisionStatus, setDecisionStatus] = useState<'idle' | 'sending' | 'novigente'>('idle');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectText, setRejectText] = useState('');
  const [observationOpen, setObservationOpen] = useState(false);
  const [observationText, setObservationText] = useState('');
  const [observationStatus, setObservationStatus] = useState<'idle' | 'sending'>('idle');
  const [observationError, setObservationError] = useState<string | null>(null);

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

  /* ── Derivados de la respuesta (R14) ───────────────────────────────────── */
  const decision = response?.decision ?? (legacy ? 'approved' : null);
  const decisionVariantId = response?.decisionVariantId ?? legacy?.variantId ?? null;
  const decisionAt = response?.decidedAt ?? legacy?.approvedAt ?? null;
  const observation = response?.observation ?? null;
  const observationAt = response?.observedAt ?? null;
  const observationChannel = response?.observationChannel ?? null;
  const observationEmailSentAt = response?.observationEmailSentAt ?? null;
  const observationEmailError = response?.observationEmailError ?? null;
  const decisionChannel = response?.decisionChannel ?? null;
  const decisionEmailSentAt = response?.decisionEmailSentAt ?? null;
  const decisionEmailError = response?.decisionEmailError ?? null;
  const isApproved = decision === 'approved';
  const isRejected = decision === 'rejected';
  const isLegacyOnly = Boolean(legacy) && !response?.decision;
  const decided = Boolean(decision);
  const hasWhatsapp = Boolean(view.workshop.whatsapp && view.workshop.whatsapp.length >= 6);
  const targetVariantId =
    activeVariant?.id ?? view.variants[0]?.id ?? decisionVariantId ?? null;
  const approvedVariant = view.variants.find((v) => v.id === decisionVariantId) ?? null;
  /* Label congelado del payload (R6): nunca el id interno. En publicaciones de
   * una sola opción el label ya es "Diseño actual" y no lleva "Opción". */
  const approvedLabel =
    approvedVariant?.label ?? (decisionVariantId ? `Opción ${decisionVariantId}` : '');
  const decisionCardLabel = approvedVariant
    ? view.variants.length === 1
      ? approvedVariant.label
      : /^opci[oó]n\b/i.test(approvedVariant.label)
        ? approvedVariant.label
        : `Opción ${approvedVariant.label}`
    : approvedLabel;
  const rejectLength = observationLength(rejectText);
  const observationLengthNow = observationLength(observationText);
  const rejectTooLong = rejectLength > OBSERVATION_MAX;
  const observationTooLong = observationLengthNow > OBSERVATION_MAX;

  /* ── Aprobación R6/R14: registra ANTES de abrir WhatsApp ───────────────── */
  const submitDecision = useCallback(
    async (
      nextDecision: 'approved' | 'rejected',
      channel: LinkChannel | null,
      observationToSend: string | null,
      variantId: LinkVariantId,
    ): Promise<void> => {
      if (decisionStatus === 'sending') return;
      setDecisionStatus('sending');
      setDecisionError(null);
      setObservationError(null);

      const res = await postJson(`/api/links/${view.linkId}/decision`, {
        decision: nextDecision,
        variantId,
        ...(observationToSend ? { observation: observationToSend } : {}),
        ...(channel ? { channel } : {}),
      });

      if (!res) {
        setDecisionStatus('idle');
        setDecisionError('No pudimos conectar con el taller. Reintentá en un momento.');
        return;
      }

      if (res.status === 200) {
        setDecisionStatus('idle');
        setResponse((prev) => mergeResponse(prev, res.data ?? {}, 'decision'));
        setRejectOpen(false);
        setRejectText('');
        if (res.data?.emailSent === false) {
          setDecisionError(emailFailureText('decision', res.data.emailError, hasWhatsapp));
        }
        /* WhatsApp: solo se abre solo cuando el canal ELEGIDO es WhatsApp o
         * cuando la aprobación usa el CTA de siempre. Un email fallido deja
         * un botón de respaldo, no un salto inesperado. */
        if (
          res.data?.whatsappHref &&
          (nextDecision === 'approved' || channel === 'whatsapp')
        ) {
          window.location.href = res.data.whatsappHref;
        }
        return;
      }

      setDecisionStatus('idle');

      if (res.status === 410) {
        setDecisionStatus('novigente');
        return;
      }
      if (res.status === 404) {
        setDecisionError('Esta propuesta ya no existe — pedile al taller un enlace nuevo.');
        return;
      }
      if (res.status === 409 && res.data?.error === 'DECISION_TAKEN') {
        setDecisionError('Ya registramos tu decisión en este enlace.');
        if (res.data.legacy && typeof res.data.decisionVariantId === 'string') {
          setLegacy({
            variantId: res.data.decisionVariantId,
            approvedAt:
              typeof res.data.decidedAt === 'string'
                ? res.data.decidedAt
                : new Date().toISOString(),
          });
        } else if (isLinkDecision(res.data.decision)) {
          setResponse((prev) => mergeResponse(prev, res.data ?? {}, 'decision'));
        }
        return;
      }
      if (res.status === 409 && res.data?.error === 'OBSERVATION_TAKEN') {
        setDecisionError('Ya registramos una observación en este enlace.');
        setResponse((prev) => mergeResponse(prev, res.data ?? {}, 'decision'));
        return;
      }
      if (res.status === 400 && res.data?.error === 'WHATSAPP_UNAVAILABLE') {
        setDecisionError('El taller no tiene WhatsApp configurado. Probá por email.');
        return;
      }
      if (res.status === 400) {
        setDecisionError('Revisá el texto de la observación (1 a 280 caracteres).');
        return;
      }
      setDecisionError('No pudimos registrar la acción. Reintentá.');
    },
    [decisionStatus, view.linkId],
  );

  const approve = useCallback(async (): Promise<void> => {
    if (!targetVariantId) {
      setDecisionError('El diseño todavía no está listo para aprobar.');
      return;
    }
    await submitDecision('approved', null, null, targetVariantId);
  }, [submitDecision, targetVariantId]);

  const reject = useCallback(
    async (channel: LinkChannel): Promise<void> => {
      if (!targetVariantId) return;
      let motive: string | null = null;
      if (!observation) {
        const normalized = normalizeObservation(rejectText);
        if (!normalized.ok) {
          setDecisionError(observationErrorText(normalized.reason));
          focusById('reject-observation');
          return;
        }
        motive = normalized.text;
      }
      await submitDecision('rejected', channel, motive, targetVariantId);
    },
    [observation, rejectText, submitDecision, targetVariantId],
  );

  const sendObservation = useCallback(
    async (channel: LinkChannel): Promise<void> => {
      if (observationStatus === 'sending') return;
      const normalized = normalizeObservation(observationText);
      if (!normalized.ok) {
        setObservationOpen(true);
        setObservationError(observationErrorText(normalized.reason));
        focusById('link-observation');
        return;
      }

      setObservationStatus('sending');
      setObservationError(null);
      const res = await postJson(`/api/links/${view.linkId}/observations`, {
        message: normalized.text,
        channel,
      });

      if (!res) {
        setObservationStatus('idle');
        setObservationError('No pudimos conectar con el taller. Reintentá en un momento.');
        return;
      }

      if (res.status === 200) {
        setObservationStatus('idle');
        setResponse((prev) => mergeResponse(prev, res.data ?? {}, 'observation'));
        setObservationText('');
        setObservationOpen(false);
        if (res.data?.emailSent === false) {
          setObservationError(
            emailFailureText('observation', res.data.emailError, hasWhatsapp),
          );
        }
        if (channel === 'whatsapp' && res.data?.whatsappHref) {
          window.location.href = res.data.whatsappHref;
        }
        return;
      }

      setObservationStatus('idle');

      if (res.status === 410) {
        setDecisionStatus('novigente');
        setObservationError('Esta propuesta ya no está vigente.');
        return;
      }
      if (res.status === 404) {
        setObservationError('Esta propuesta ya no existe — pedile al taller un enlace nuevo.');
        return;
      }
      if (res.status === 409 && res.data?.error === 'OBSERVATION_TAKEN') {
        setObservationOpen(false);
        setObservationError('Ya registramos una observación en este enlace.');
        setResponse((prev) => mergeResponse(prev, res.data ?? {}, 'observation'));
        return;
      }
      if (res.status === 400 && res.data?.error === 'WHATSAPP_UNAVAILABLE') {
        setObservationError('El taller no tiene WhatsApp configurado. Probá por email.');
        return;
      }
      if (res.status === 400) {
        setObservationError('Revisá el texto de la observación (1 a 280 caracteres).');
        return;
      }
      setObservationError('No pudimos enviar la observación. Reintentá.');
    },
    [observationStatus, observationText, view.linkId],
  );

  const copyCode = useCallback(async () => {
    if (!decisionVariantId) return;
    const code = approvalCode(view.linkId, decisionVariantId);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }, [decisionVariantId, view.linkId]);

  /* WhatsApp de respaldo cuando la tarjeta se re-renderiza (página recargada):
   * el href se arma en el click para no depender de `window` en SSR. */
  const openApprovalWhatsapp = useCallback(() => {
    const href = whatsappApprovalHref(
      view.workshop.whatsapp,
      canonicalLinkUrl(view.linkId, canonicalSiteOrigin(window.location.origin)),
      approvedLabel,
    );
    if (href) window.location.href = href;
  }, [approvedLabel, view.linkId, view.workshop.whatsapp]);

  const openRejectionWhatsapp = useCallback(() => {
    if (!observation) return;
    const href = whatsappRejectionHref(
      view.workshop.whatsapp,
      canonicalLinkUrl(view.linkId, canonicalSiteOrigin(window.location.origin)),
      observation,
    );
    if (href) window.location.href = href;
  }, [observation, view.linkId, view.workshop.whatsapp]);

  const openObservationWhatsapp = useCallback(() => {
    if (!observation) return;
    const href = whatsappObservationHref(
      view.workshop.whatsapp,
      canonicalLinkUrl(view.linkId, canonicalSiteOrigin(window.location.origin)),
      observation,
    );
    if (href) window.location.href = href;
  }, [observation, view.linkId, view.workshop.whatsapp]);

  /* Payload dañado O (assets cargados y NINGUNO sano) ⇒ página amable (§6). */
  if (view.variants.length === 0 || (!loading && !anyAvailable)) {
    return (
      <main className="flex min-h-screen flex-col bg-[#0b0b0d]">
        <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
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
        </div>
      </main>
    );
  }

  const product = resolveProduct(view.mate.modelId);
  const isThermo = isThermoProduct(product);
  const thermoConfig = normalizeThermoConfig(view.mate.thermo);
  const modelo = formatModeloCard(view.mate.modelId);
  const virola = formatVirolaCard(view.mate.metal, view.mate.virolaColor);
  const cuerpo = formatCuerpoCard(view.mate.cupMaterial, view.mate.cupColor);
  /* R7: el acordeón NO expone escala/rotación/margen; el termo cambia virola
   * por sus medidas fijas y su acabado propio. */
  const summaryRows = isThermo
    ? [
        { title: 'Modelo', body: modelo.etiqueta },
        {
          title: 'Medidas',
          body: `1.0 L · ${formatMmCard(product.thermo.totalHeightMm) ?? '—'} de alto · Ø ${formatMmCard(product.thermo.radiusMm * 2) ?? '—'} de cuerpo`,
        },
        {
          title: 'Acabado',
          body: `${thermoFinishLabel(thermoConfig.finish)} · ${thermoColorName(view.mate.cupColor)}`,
        },
      ]
    : [
        { title: 'Modelo', body: modelo.etiqueta },
        {
          title: 'Virola (mm)',
          body: `${virola} · Ø ${view.mate.extDiameter} mm ext. / Ø ${view.mate.intDiameter} mm int.`,
        },
        { title: 'Cuerpo', body: cuerpo },
      ];
  const sendingDecision = decisionStatus === 'sending';
  const sendingObservation = observationStatus === 'sending';

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

      {/* ── Barra inferior: selector + acordeón + decisión/observación ─────── */}
      <section className="max-h-[38vh] space-y-2.5 overflow-y-auto border-t border-white/10 bg-black/40 px-4 pb-4 pt-3 backdrop-blur">
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
          {summaryRows.map((row) => (
            <details key={row.title} className="group rounded-lg border border-white/10 bg-white/[0.04]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-bold text-stone-200 [&::-webkit-details-marker]:hidden">
                {row.title}
                <ChevronDown className="size-3.5 text-stone-500 transition-transform group-open:rotate-180" />
              </summary>
              <p className="border-t border-white/10 px-3 py-2 text-stone-400">{row.body}</p>
            </details>
          ))}
        </div>

        {/* ── Decisión (R14.1/R14.8) ─────────────────────────────────────── */}
        {decisionStatus === 'novigente' ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
            Esta propuesta ya no está vigente — pedile al taller un enlace nuevo.
          </p>
        ) : decided ? (
          <>
          {isRejected ? (
            /* Tarjeta de RECHAZO: el motivo ES la observación (R14.3). */
            <div className="space-y-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
              <p className="text-[11px] font-bold text-rose-300">RECHAZADO</p>
              <p className="text-[10px] text-rose-200/80">{formatLinkDate(decisionAt)}</p>
              {observation && (
                <p className="whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-stone-200">
                  {observation}
                </p>
              )}
              <p className="text-[9px] text-stone-500">
                Observación: {channelLabel(observationChannel)}
                <EmailStatus
                  channel={observationChannel}
                  sentAt={observationEmailSentAt}
                  error={observationEmailError}
                />
              </p>
              {decisionChannel && decisionChannel !== observationChannel && (
                <p className="text-[9px] text-stone-500">
                  Aviso de rechazo: {channelLabel(decisionChannel)}
                  <EmailStatus
                    channel={decisionChannel}
                    sentAt={decisionEmailSentAt}
                    error={decisionEmailError}
                  />
                </p>
              )}
              {(decisionEmailError || observationEmailError) && hasWhatsapp && (
                <Button
                  variant="green"
                  size="sm"
                  className="min-h-11 w-full"
                  onClick={openRejectionWhatsapp}
                >
                  <MessageCircle className="size-3.5" /> Avisar por WhatsApp
                </Button>
              )}
            </div>
          ) : (
            /* Tarjeta de APROBACIÓN (nueva o legacy R14.13). */
            <div className="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <p className="text-[11px] font-bold text-emerald-300">
                <Check className="mr-1 inline size-3.5" />
                APROBADO{decisionCardLabel ? ` · ${decisionCardLabel}` : ''}
              </p>
              <p className="text-[10px] text-emerald-200/80">
                {formatLinkDate(decisionAt)}
                {isLegacyOnly ? ' · Aprobación registrada previamente' : ''}
              </p>
              {hasWhatsapp ? (
                <Button
                  variant="green"
                  size="sm"
                  className="min-h-11 w-full"
                  onClick={openApprovalWhatsapp}
                >
                  <MessageCircle className="size-3.5" /> Contactar al taller por WhatsApp
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <code className="block rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-center font-mono text-[12px] tracking-wide text-stone-100">
                    {approvalCode(view.linkId, decisionVariantId ?? 'A')}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => void copyCode()}
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    Copiar código de aprobación
                  </Button>
                  <p className="text-[10px] leading-relaxed text-stone-500">
                    {view.variants.length === 1
                      ? 'Ponete en contacto con tu vendedor indicando que aprobaste este diseño.'
                      : `Ponete en contacto con tu vendedor indicando que aprobaste la Opción ${decisionVariantId ?? 'A'}.`}
                  </p>
                </div>
              )}
            </div>
          )}
          {decisionError && <InlineError>{decisionError}</InlineError>}
          </>
        ) : (
          <div className="space-y-1.5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="green"
                size="md"
                className="min-h-11 w-full justify-center"
                disabled={sendingDecision || !targetVariantId || !canvasOf(activeVariant)}
                onClick={() => void approve()}
              >
                {sendingDecision ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Registrando…
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    {view.variants.length === 1
                      ? '¡Aprobar este diseño!'
                      : '¡Aprobar Opción Seleccionada!'}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="md"
                className="min-h-11 w-full justify-center border-rose-500/30 text-rose-200 hover:border-rose-400/50 hover:text-rose-100"
                disabled={sendingDecision || !targetVariantId}
                onClick={() => {
                  setRejectOpen((open) => !open);
                  setDecisionError(null);
                }}
                aria-expanded={rejectOpen}
              >
                Rechazar diseño
              </Button>
            </div>

            {/* Formulario de rechazo: motivo obligatorio si no hay observación. */}
            {rejectOpen && (
              <div className="space-y-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                <p className="text-[10px] font-bold text-rose-200">Rechazar el diseño</p>
                {observation ? (
                  <p className="whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-stone-200">
                    {observation}
                  </p>
                ) : (
                  <>
                    <label htmlFor="reject-observation" className="sr-only">
                      Motivo del rechazo
                    </label>
                    <textarea
                      id="reject-observation"
                      value={rejectText}
                      onChange={(e) => setRejectText(e.target.value)}
                      rows={3}
                      placeholder="Contale al taller por qué rechazás el diseño…"
                      className="w-full resize-none rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] text-stone-100 placeholder:text-stone-600 focus:border-gold/50 focus:outline-none"
                    />
                    <p
                      aria-live="polite"
                      className={`text-right text-[9px] ${rejectTooLong ? 'text-rose-300' : 'text-stone-500'}`}
                    >
                      {rejectLength}/{OBSERVATION_MAX}
                    </p>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={sendingDecision || (!observation && rejectTooLong)}
                    onClick={() => void reject('email')}
                  >
                    {sendingDecision ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" /> Enviando…
                      </>
                    ) : observation ? (
                      'Rechazar y avisar por email'
                    ) : (
                      'Rechazar y enviar por email'
                    )}
                  </Button>
                  {hasWhatsapp && (
                    <Button
                      variant="green"
                      size="sm"
                      className="min-h-11"
                      disabled={sendingDecision || (!observation && rejectTooLong)}
                      onClick={() => void reject('whatsapp')}
                    >
                      {sendingDecision ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" /> Enviando…
                        </>
                      ) : (
                        <>
                          <MessageCircle className="size-3.5" />
                          {observation
                            ? 'Rechazar y avisar por WhatsApp'
                            : 'Rechazar y enviar por WhatsApp'}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={sendingDecision}
                    onClick={() => {
                      setRejectOpen(false);
                      setDecisionError(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {decisionError && <InlineError>{decisionError}</InlineError>}
          </div>
        )}

        {/* ── Observación sola (R14.4): antes o después de aprobar ────────── */}
        {!isRejected && observation && (
          <div className="space-y-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2">
            <p className="text-[10px] font-bold text-sky-300">TU OBSERVACIÓN</p>
            <p className="whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-stone-200">
              {observation}
            </p>
            <p className="text-[9px] text-stone-500">
              {formatLinkDate(observationAt)} · {channelLabel(observationChannel)}
              <EmailStatus
                channel={observationChannel}
                sentAt={observationEmailSentAt}
                error={observationEmailError}
              />
            </p>
            {observationEmailError && hasWhatsapp && (
              <Button
                variant="green"
                size="sm"
                className="min-h-11 w-full"
                onClick={openObservationWhatsapp}
              >
                <MessageCircle className="size-3.5" /> Enviar por WhatsApp
              </Button>
            )}
          </div>
        )}

        {!isRejected && !observation && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setObservationOpen((open) => !open);
                setObservationError(null);
              }}
              aria-expanded={observationOpen}
              className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-stone-200"
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="size-3.5" /> ¿Querés dejar una observación?
              </span>
              <ChevronDown
                className={`size-3.5 text-stone-500 transition-transform ${observationOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {observationOpen && (
              <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                <label htmlFor="link-observation" className="sr-only">
                  Observación para el taller
                </label>
                <textarea
                  id="link-observation"
                  value={observationText}
                  onChange={(e) => setObservationText(e.target.value)}
                  rows={3}
                  placeholder="Contale al taller qué te gustaría cambiar…"
                  className="w-full resize-none rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] text-stone-100 placeholder:text-stone-600 focus:border-gold/50 focus:outline-none"
                />
                <p
                  aria-live="polite"
                  className={`text-right text-[9px] ${observationTooLong ? 'text-rose-300' : 'text-stone-500'}`}
                >
                  {observationLengthNow}/{OBSERVATION_MAX}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={sendingObservation || observationTooLong}
                    onClick={() => void sendObservation('email')}
                  >
                    {sendingObservation ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" /> Enviando…
                      </>
                    ) : (
                      'Enviar por email'
                    )}
                  </Button>
                  {hasWhatsapp && (
                    <Button
                      variant="green"
                      size="sm"
                      className="min-h-11"
                      disabled={sendingObservation || observationTooLong}
                      onClick={() => void sendObservation('whatsapp')}
                    >
                      {sendingObservation ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" /> Enviando…
                        </>
                      ) : (
                        <>
                          <MessageCircle className="size-3.5" /> Enviar por WhatsApp
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {observationError && <InlineError>{observationError}</InlineError>}
          </div>
        )}

        {isRejected && observationError && <InlineError>{observationError}</InlineError>}
      </section>
    </main>
  );
}
