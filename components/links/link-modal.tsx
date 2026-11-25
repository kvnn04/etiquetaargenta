'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  canonicalLinkUrl,
  editionBadgeText,
  linkDaysLeft,
  linkEditionState,
  type LinkEditionState,
} from '@/lib/links/states';
import { encodeLinkTexture, encodeOriginalFromCanvas, LINK_TEXTURE_MAX_BYTES } from '@/lib/links/asset-encode';
import { buildPublishVariant } from '@/lib/links/payload';
import {
  channelLabel,
  emailStatusLabel,
  formatLinkDate,
  type LinkChannel,
  type LinkDecision,
} from '@/lib/links/responses';
import { useEditorStore } from '@/lib/store/editor';
import { currentOverflowCheck } from '@/lib/quote/snapshot';
import type { OverflowCheck } from '@/lib/overflow';
import type { DesignAsset } from '@/lib/design';

/** Modal `#linkModal` — posición 10A (spec shareable-link §3/§4). */

export interface LinkVersionRow {
  linkId: string;
  version: number;
  createdAt: string;
  expiresAt: string;
  approvalsCount: number;
  lastApprovedVariant: string | null;
  /** Posición 14: decisión + observación del cliente (null si no hay fila). */
  decision: LinkDecision | null;
  decisionVariantId: string | null;
  decidedAt: string | null;
  decisionChannel: LinkChannel | null;
  decisionEmailSentAt: string | null;
  decisionEmailError: string | null;
  observation: string | null;
  observedAt: string | null;
  observationChannel: LinkChannel | null;
  observationEmailSentAt: string | null;
  observationEmailError: string | null;
}

export interface PublishResult {
  linkId: string;
  version: number;
  expiresAt: string;
  url: string;
  message: string;
  /** `wa.me/?text=…` sin destinatario: WhatsApp abre el selector de contactos. */
  whatsappHref: string;
}

/** CTA EXACTOS del confirm de desborde al PUBLICAR (adaptación de la voz
 * R5 spec_escala al contexto del link — la medición es la de pos 7). */
export const PUBLISH_CONFIRM_CTAS = ['Publicar de todas formas', 'Volver a ajustar'] as const;

function formatEsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function LinkModal({
  open,
  onClose,
  projectId,
  designAsset,
  onPaywallRequest,
  onPublishConfirm,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  designAsset: DesignAsset | null;
  onPaywallRequest: () => void;
  /** Confirmación de desborde con los CTA de la shell (Promise-based). */
  onPublishConfirm: (check: OverflowCheck, ctas: readonly string[]) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [versions, setVersions] = useState<LinkVersionRow[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);
  /** Errores de publish/copiar/eliminar DENTRO del modal (la shell queda detrás). */
  const [error, setError] = useState<string | null>(null);
  /** Confirmación inline antes de borrar una versión (sin window.confirm). */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* Al abrir: reset + listado de versiones (R1 panel del editor). */
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setCopied(false);
    setBlocker(null);
    setError(null);
    setConfirmDeleteId(null);
    setDeletingId(null);
    if (!projectId) {
      setBlocker('Guardá el proyecto (un cambio en la escena alcanza) para poder publicar.');
    } else {
      setVersionsLoading(true);
      fetch(`/api/links?projectId=${projectId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { versions: LinkVersionRow[] }) => setVersions(data.versions))
        .catch(() => setVersions(null))
        .finally(() => setVersionsLoading(false));
    }
  }, [open, projectId]);

  async function handlePublish(): Promise<void> {
    if (busy) return;
    setBlocker(null);
    setError(null);
    const s = useEditorStore.getState();
    /* §6: publicar exige el diseño cargado y el mate configurado. */
    if (!projectId) {
      setBlocker('Guardá el proyecto para poder publicar.');
      return;
    }
    if (!designAsset) {
      setBlocker('Cargá el diseño del grabado para congelar la versión (vive en la pestaña Diseño).');
      return;
    }

    /* Variantes desactivadas: se publica el diseño VIGENTE como única opción. */
    const variant = buildPublishVariant({
      scale: s.design.scale,
      rotation: s.design.rotation,
      mirror: s.design.mirror,
    });

    setBusy(true);
    try {
      /* R7: confirmación ANTES de publicar si el diseño actual desborda. */
      const check = currentOverflowCheck({
        hasDesignAsset: true,
        inkEnvelope: s.inkEnvelope,
        inkScanDegraded: s.inkScanDegraded,
        baseSideMm: designAsset.baseSideMm,
        extDiameterMm: s.extDiameter,
        intDiameterMm: s.intDiameter,
        scalePct: variant.scalePct,
      });
      if (check?.status === 'overflow') {
        const ok = await onPublishConfirm(check, PUBLISH_CONFIRM_CTAS);
        if (!ok) return;
      }

      /* R3: re-encodación en el cliente (textura ≤300 KB con alpha intacto). */
      const texture = await encodeLinkTexture(designAsset.canvas);
      if (!texture) {
        setError(`El diseño es demasiado denso (${LINK_TEXTURE_MAX_BYTES / 1024} KB max): simplificá el vector.`);
        return;
      }
      const original = await encodeOriginalFromCanvas(designAsset.canvas);
      if (!original) {
        setError('No se pudo congelar el archivo original (cota 10 MB): simplificá el diseño.');
        return;
      }

      const response = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          variants: [variant],
          design: {
            textureBase64: texture.base64,
            textureMime: texture.mime,
            originalBase64: original.base64,
            originalMime: original.mime,
          },
        }),
      });
      if (response.status === 402) {
        onPaywallRequest(); // FREE ⇒ Paywall (decisión server-side, R8)
        return;
      }
      if (response.status === 401 && s.dirty) {
        setError('La sesión venció: iniciá sesión de nuevo.');
        return;
      }
      const data = (await response.json().catch(() => null)) as PublishResult | { error?: string; reason?: string } | null;
      if (!response.ok || !data || !('linkId' in data)) {
        setError('No se pudo publicar el enlace (intenta de nuevo).');
        return;
      }
      setResult(data);
      setCopied(false);
      setError(null);
      /* Refresca el listado con la versión nueva encima (R1). */
      setVersions((prev) => [
        {
          linkId: data.linkId,
          version: data.version,
          createdAt: new Date().toISOString(),
          expiresAt: data.expiresAt,
          approvalsCount: 0,
          lastApprovedVariant: null,
          decision: null,
          decisionVariantId: null,
          decidedAt: null,
          decisionChannel: null,
          decisionEmailSentAt: null,
          decisionEmailError: null,
          observation: null,
          observedAt: null,
          observationChannel: null,
          observationEmailSentAt: null,
          observationEmailError: null,
        },
        ...(prev ?? []),
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('El navegador bloqueó el portapapeles: copiá a mano.');
    }
  }

  async function handleDelete(linkId: string): Promise<void> {
    if (deletingId) return;
    setDeletingId(linkId);
    setError(null);
    try {
      const response = await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
      if (response.status === 401) {
        setError('La sesión venció: iniciá sesión de nuevo.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo eliminar el enlace (intenta de nuevo).');
        return;
      }
      setVersions((prev) => (prev ?? []).filter((v) => v.linkId !== linkId));
      setConfirmDeleteId(null);
      if (result?.linkId === linkId) setResult(null);
    } catch {
      setError('No se pudo eliminar el enlace (revisá la conexión).');
    } finally {
      setDeletingId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Generar Enlace Comercial"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-stone-100">Enlace Comercial (3D para tu cliente)</h2>
            <p className="mt-1 text-[11px] text-stone-500">
              Cada publish crea una versión NUEVA congelada 30 días (R1/R5): las versiones previas
              quedan vivas — lo aprobado por un cliente jamás cambia.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-500 hover:text-stone-200"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[10px] text-rose-200">
            {error}
          </p>
        )}

        {result ? (
          /* ── §4: resultado — link corto + copiar + WhatsApp pre-armado ───── */
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-emerald-400">
              <Check className="size-4" /> Enlace listo ✓ (versión {result.version})
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] text-gold-soft">
                {result.url}
              </code>
              <Button variant="outline" size="sm" onClick={() => void handleCopy(result.url)}>
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                {copied ? '¡Copiado!' : 'Copiar Enlace'}
              </Button>
            </div>
            <a href={result.whatsappHref} target="_blank" rel="noreferrer" className="block">
              <Button variant="green" size="md" className="w-full">
                <MessageCircle className="size-4" />
                Enviar por WhatsApp
              </Button>
            </a>
            <p className="text-[10px] text-stone-600">
              WhatsApp abre el selector de contactos: elegí a tu cliente. El número de tu Perfil
              queda como destino de la aprobación, no como destinatario de este envío.
            </p>
            <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-stone-400">
              {result.message}
            </div>
            <p className="text-[10px] text-stone-600">
              Expira: {formatEsDate(result.expiresAt)} · el badge \"por vencer\" aparece a los 5 días en tu panel.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="md" onClick={() => setResult(null)}>
                <RefreshCw className="size-3.5" />
                Publicar otra versión
              </Button>
              <a href={result.url} target="_blank" rel="noreferrer" className="flex-1">
                <Button variant="ghost" size="md" className="w-full">
                  <ExternalLink className="size-3.5" />
                  Abrir vista del cliente
                </Button>
              </a>
            </div>
          </div>
        ) : (
          /* ── draft + versiones ──────────────────────────────────────────── */
          <div className="mt-4 space-y-3">
            <p className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[10px] leading-relaxed text-stone-500">
              Se publica el <span className="text-stone-300">diseño actual</span> con su rotación,
              escala y espejo. Las variantes A/B/C están desactivadas por ahora.
            </p>
            {blocker && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200">
                {blocker}
              </p>
            )}
            <Button
              variant="primary"
              size="md"
              className="w-full justify-center"
              disabled={busy}
              onClick={() => void handlePublish()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {busy ? 'Publicando…' : 'Publicar versión nueva'}
            </Button>

            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                Versiones de este proyecto{versions ? ` (${versions.length})` : ''} · nueva primero
              </h3>
              {versionsLoading && <p className="mt-2 text-[10px] text-stone-600">Cargando versiones…</p>}
              {versions && versions.length === 0 && (
                <p className="mt-2 text-[10px] text-stone-600">Todavía no publicaste enlaces.</p>
              )}
              {versions && versions.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {versions.map((v) => {
                    const approved =
                      v.decision === 'approved' || (!v.decision && v.approvalsCount > 0);
                    const state: LinkEditionState = linkEditionState(
                      {
                        expiresAtMs: Date.parse(v.expiresAt),
                        approved,
                        rejected: v.decision === 'rejected',
                      },
                      Date.now(),
                    );
                    const badgeVariant =
                      v.decision === 'approved' ? v.decisionVariantId : v.lastApprovedVariant;
                    const observationEmailStatus = emailStatusLabel(
                      v.observationChannel,
                      v.observationEmailSentAt,
                      v.observationEmailError,
                    );
                    const decisionEmailStatus = emailStatusLabel(
                      v.decisionChannel,
                      v.decisionEmailSentAt,
                      v.decisionEmailError,
                    );
                    const url = canonicalLinkUrl(v.linkId, window.location.origin);
                    return (
                      <li
                        key={v.linkId}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-stone-400">#{v.version}</span>
                          <code className="text-gold-soft">/v/{v.linkId}</code>
                          <span
                            className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              state === 'rechazado'
                                ? 'border-rose-500/40 text-rose-300'
                                : state === 'aprobado'
                                  ? 'border-gold/50 text-gold-soft'
                                  : state === 'vigente'
                                    ? 'border-emerald-500/40 text-emerald-400'
                                    : state === 'por_vencer'
                                      ? 'border-amber-500/40 text-amber-300'
                                      : 'border-line text-stone-600'
                            }`}
                          >
                            {editionBadgeText(state, badgeVariant)}
                          </span>
                          {v.observation && (
                            <span className="rounded-full border border-sky-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300">
                              CON OBSERVACIÓN
                            </span>
                          )}
                          <span className="text-[9px] text-stone-600">
                            vence {formatEsDate(v.expiresAt)} (
                            {linkDaysLeft(Date.parse(v.expiresAt), Date.now())} d)
                            {v.approvalsCount > 0 ? ` · ${v.approvalsCount} ✓` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(url).catch(() => {})}
                            className="text-stone-500 hover:text-stone-200"
                            aria-label={`Copiar enlace ${v.linkId}`}
                          >
                            <Copy className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDeleteId((id) => (id === v.linkId ? null : v.linkId))
                            }
                            disabled={deletingId !== null}
                            className={
                              confirmDeleteId === v.linkId
                                ? 'text-rose-300'
                                : 'text-stone-500 hover:text-rose-300'
                            }
                            aria-label={`Eliminar enlace ${v.linkId}`}
                            title="Eliminar enlace"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                        {v.observation && (
                          <details className="mt-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
                            <summary className="cursor-pointer text-[10px] font-bold text-sky-300">
                              {v.decision === 'rejected'
                                ? 'Motivo del rechazo'
                                : 'Observación del cliente'}
                            </summary>
                            <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-stone-300">
                              {v.observation}
                            </p>
                            <p className="mt-1 text-[9px] text-stone-500">
                              {formatLinkDate(v.observedAt)} ·{' '}
                              {channelLabel(v.observationChannel)}
                              {observationEmailStatus ? ` · ${observationEmailStatus}` : ''}
                            </p>
                            {v.decision === 'rejected' && v.decisionChannel && (
                              <p className="mt-0.5 text-[9px] text-stone-500">
                                Aviso de rechazo: {channelLabel(v.decisionChannel)}
                                {decisionEmailStatus ? ` · ${decisionEmailStatus}` : ''}
                              </p>
                            )}
                          </details>
                        )}
                        {v.decision && (
                          <p className="mt-1 text-[9px] text-stone-600">
                            Decisión: {v.decision === 'approved' ? 'aprobada' : 'rechazada'} ·{' '}
                            {formatLinkDate(v.decidedAt)}
                          </p>
                        )}
                        {confirmDeleteId === v.linkId && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5">
                            <span className="text-[10px] text-rose-200">
                              ¿Eliminar /v/{v.linkId} y sus respuestas?
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleDelete(v.linkId)}
                              disabled={deletingId === v.linkId}
                              className="rounded-md border border-rose-400/40 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                            >
                              {deletingId === v.linkId ? 'Eliminando…' : 'Sí, eliminar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={deletingId === v.linkId}
                              className="px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-stone-200 disabled:opacity-60"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <Link
            href="/enlaces"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gold-soft hover:underline"
          >
            <Link2 className="size-3.5" />
            Ver y buscar todos mis enlaces
          </Link>
        </div>
      </div>
    </div>
  );
}
