/* ============================================================================
 * FOTO HD (pos 9) — render HD limpio descargable con el MISMO protocolo de
 * export que la Ficha Técnica.
 * ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md §3-R7 (ticket server-side
 * ligado al hash del snapshot) + R5 de spec_escala_y_alerta_de_desborde.md
 * (confirmación de desborde previa a CUALQUIER export, incluida la Foto HD).
 * ----------------------------------------------------------------------------
 * · El render sale de renderMateView (motor compartido con la ficha): las
 *   mismas 4 luces de la escena, el MISMO pipeline del grabado (compositor
 *   único de lib/compose-engraving a 2048²), sin guías, sin pulso, SIN
 *   watermark.
 * · Encuadre cuadrado 1280 CSS × dpr 2 = lado 2560 px ≥ 2160 (HD); si el PNG
 *   supera la cota de 5 MB, UN re-render a dpr 1.6875 (lado exacto 2160) —
 *   y ahí se descarga sí o sí: la cota guía la calidad, jamás bloquea.
 * · Ticket (R7): request → verificar → UNA re-emisión — el MISMO flujo del
 *   modal (ensureVerifiedTicket en lib/quote/export-flow). FREE ⇒ 402 acá
 *   mismo ⇒ Paywall via onPaywallRequest (server-authoritative).
 * · Nombre §5: `{taller}-foto-mate-{model}-{aaaammdd}.png` (lib/quote/texts).
 * · El módulo three se importa con import() dinámico (chunk separado).
 * ============================================================================ */

import type { MateViewInput } from './ficha-render';
import type { OverflowCheck } from '@/lib/overflow';
import {
  ensureVerifiedTicket,
  EXPORT_ERR_RENDER,
  QUOTE_MAX_BYTES,
} from '@/lib/quote/export-flow';

export interface FotoHdApi {
  /** Insumos del render (estado de sesión leído por la shell). */
  view: Omit<MateViewInput, 'widthCss' | 'heightCss' | 'dpr'>;
  /** Chequeo vigente derivado (null ⇒ sin diseño: nada que confirmar). */
  check: OverflowCheck | null;
  /** R7: hash del snapshot capturado por la shell en el MISMO momento. */
  snapshotHash: string;
  /** §5: nomenclatura del archivo (resolveBranding.title canónico). */
  tallerTitle: string;
  productId: string;
  /** Confirmación de desborde con los CTA EXACTOS ("Exportar de todas formas
   *  / Volver a ajustar") — la shell responde con su mini-diálogo. */
  confirmOverflow: (check: OverflowCheck) => Promise<boolean>;
  onPaywallRequest: () => void;
  onError: (msg: string) => void;
}

/**
 * Flujo COMPLETO de Foto HD: (1) confirmación de desborde honesta, (2) ticket
 * R7 completo, (3) render con escalada de dpr y (4) descarga + registro QA.
 * Devuelve true si el archivo se descargó.
 */
export async function runFotoHdExport(api: FotoHdApi): Promise<boolean> {
  /* R5 spec_escala: exportar con desborde confirmado ⇒ preguntar SIEMPRE antes. */
  if (api.check && api.check.status === 'overflow') {
    const proceed = await api.confirmOverflow(api.check);
    if (!proceed) return false;
  }

  /* R7 — ticket firmado + contra-verificación (402 ⇒ Paywall acá mismo). */
  const ticket = await ensureVerifiedTicket(api.snapshotHash, {
    onPaywallRequest: api.onPaywallRequest,
    onError: api.onError,
  });
  if (!ticket) return false;

  /* Render + descarga: import() dinámico (chunk three separado, patrón pos 3). */
  try {
    const mod = await import('@/components/quote/ficha-render');
    let blob: Blob | null = null;
    for (const dpr of [2, 1.6875]) {
      // Pasada 1: 2560 px de lado (dpr 2); si excede la cota, pasada con el
      // dpr mínimo que respeta el lado HD (1280 × 1.6875 = 2160 exactos).
      const canvas = mod.renderMateView({
        ...api.view,
        widthCss: 1280,
        heightCss: 1280,
        dpr,
      });
      if (!canvas) continue;
      blob = await mod.canvasToPngBlob(canvas);
      if (blob && blob.size <= QUOTE_MAX_BYTES) break;
    }
    if (!blob) {
      api.onError(EXPORT_ERR_RENDER);
      return false;
    }

    const [textsMod, flowMod] = await Promise.all([
      import('@/lib/quote/texts'),
      import('@/lib/quote/export-flow'),
    ]);
    const filename = textsMod.fotoFileName({
      tallerTitle: api.tallerTitle,
      modelId: api.productId,
      capturedAtMs: Date.now(),
    });

    flowMod.downloadBlob(blob, filename);
    void flowMod.registerQaArtifact('png'); // §7 registro QA
    return true;
  } catch {
    api.onError(EXPORT_ERR_RENDER);
    return false;
  }
}
