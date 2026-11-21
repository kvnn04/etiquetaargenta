'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, MessageCircle, RefreshCw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  canonicalLinkUrl,
  editionBadgeText,
  linkDaysLeft,
  linkEditionState,
  type LinkEditionState,
} from '@/lib/links/states';
import { encodeLinkTexture, encodeOriginalFromCanvas, LINK_TEXTURE_MAX_BYTES } from '@/lib/links/asset-encode';
import { includedRows, type LinkVariantRisk, type StoredVariantRow } from '@/lib/links/payload';
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
  rows,
  onPaywallRequest,
  onPublishConfirm,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  designAsset: DesignAsset | null;
  rows: StoredVariantRow[];
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
  /** Errores de publish/copiar DENTRO del modal (la shell queda detrás). */
  const [error, setError] = useState<string | null>(null);

  /* Al abrir: reset + listado de versiones (R1 panel del editor). */
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setCopied(false);
    setBlocker(null);
    setError(null);
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

  const included = rows.filter((r) => r.included);

  /* R7: el desborde SIEMPRE se evalúa por variante (cada opcional tiene su
   * escala) con el ÚNICO motor de la ficha/diseño; el cliente del link jamás
   * ve estos valores — van congelados como `risk` al payload. */
  const perVariantRisk = (row: StoredVariantRow): { check: OverflowCheck | null; risk: LinkVariantRisk } => {
    const s = useEditorStore.getState();
    const check = currentOverflowCheck({
      hasDesignAsset: designAsset != null,
      inkEnvelope: s.inkEnvelope,
      inkScanDegraded: s.inkScanDegraded,
      baseSideMm: designAsset?.baseSideMm ?? s.extDiameter,
      extDiameterMm: s.extDiameter,
      intDiameterMm: s.intDiameter,
      scalePct: row.scalePct,
    });
    const risk: LinkVariantRisk = check
      ? {
          status: check.status,
          outsideMm: check.overflowOuterMm || check.overflowOuter ? check.overflowOuterMm : null,
          innerMm: check.overflowInnerMm || check.overflowInner ? check.overflowInnerMm : null,
          approx: s.inkScanDegraded,
        }
      : { status: 'none', outsideMm: null, innerMm: null, approx: false };
    return { check, risk };
  };

  async function handlePublish(): Promise<void> {
    if (busy) return;
    setBlocker(null);
    setError(null);
    const s = useEditorStore.getState();
    /* §6: publicar exige al menos 1 variante con diseño y mate configurado. */
    if (!projectId) {
      setBlocker('Guardá el proyecto para poder publicar.');
      return;
    }
    if (!designAsset) {
      setBlocker('Cargá el diseño del grabado para congelar la versión (vive en la pestaña Diseño).');
      return;
    }
    const includedIds = includedRows(rows);
    if (includedIds.length === 0) {
      setBlocker('Marcá al menos una opción (A/B/C) para publicar.');
      return;
    }

    setBusy(true);
    try {
      const riskByVariant: Partial<Record<StoredVariantRow['id'], LinkVariantRisk>> = {};
      /* R7: confirmación ANTES de publicar si ALGUNA variante incluida desborda. */
      const offending = included
        .map((row) => ({ row, ...perVariantRisk(row) }))
        .find((x) => x.check?.status === 'overflow');
      if (offending) {
        riskByVariant[offending.row.id] = offending.risk;
        const ok = await onPublishConfirm(offending.check!, PUBLISH_CONFIRM_CTAS);
        if (!ok) return;
      }
      for (const row of included) {
        if (!riskByVariant[row.id]) riskByVariant[row.id] = perVariantRisk(row).risk;
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
          variants: included.map(({ id, label, scalePct, rotationDeg, mirror }) => ({
            id,
            label,
            scalePct,
            rotationDeg,
            mirror,
          })),
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
            {included.length === 0 && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200">
                No hay opciones incluidas: marcalas en la tarjeta «Variantes del Enlace» del panel.
              </p>
            )}
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
                Versiones de este proyecto (nueva primero)
              </h3>
              {versionsLoading && <p className="mt-2 text-[10px] text-stone-600">Cargando versiones…</p>}
              {versions && versions.length === 0 && (
                <p className="mt-2 text-[10px] text-stone-600">Todavía no publicaste enlaces.</p>
              )}
              {versions && versions.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {versions.slice(0, 8).map((v) => {
                    const state: LinkEditionState = linkEditionState(
                      { expiresAtMs: Date.parse(v.expiresAt), approved: v.approvalsCount > 0 },
                      Date.now(),
                    );
                    const url = canonicalLinkUrl(v.linkId, window.location.origin);
                    return (
                      <li
                        key={v.linkId}
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px]"
                      >
                        <span className="text-stone-400">#{v.version}</span>
                        <code className="text-gold-soft">/v/{v.linkId}</code>
                        <span
                          className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                            state === 'vigente'
                              ? 'border-emerald-500/40 text-emerald-400'
                              : state === 'por_vencer'
                                ? 'border-amber-500/40 text-amber-300'
                                : state === 'aprobado'
                                  ? 'border-gold/50 text-gold-soft'
                                  : 'border-line text-stone-600'
                          }`}
                        >
                          {editionBadgeText(state, v.lastApprovedVariant)}
                        </span>
                        <span className="text-[9px] text-stone-600">
                          vence {formatEsDate(v.expiresAt)} ({linkDaysLeft(Date.parse(v.expiresAt), Date.now())} d)
                          {v.approvalsCount > 0 ? ` · ${v.approvalsCount} ✓` : ''}
                        </span>
                        <button
                          onClick={() => navigator.clipboard?.writeText(url).catch(() => {})}
                          className="text-stone-500 hover:text-stone-200"
                          aria-label={`Copiar enlace ${v.linkId}`}
                        >
                          <Copy className="size-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
