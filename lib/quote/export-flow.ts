/* ============================================================================
 * FLUJO DE EXPORT COMPARTIDO (cliente) — pos 9
 * ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md §3-R7 (ticket server-side)
 * + §3-R6 (cota de archivo) + §7 QA (GET /api/exports registra el artefacto).
 * ----------------------------------------------------------------------------
 * Los DOS consumidores pos 9 — el modal de Ficha Técnica (quote-modal) y la
 * Foto HD (foto-hd) — comparten acá EXACTAMENTE el mismo protocolo:
 *   1) POST /api/exports/ticket {snapshotHash}  · 402 ⇒ Paywall (FREE);
 *   2) POST /api/exports/ticket/verificar {ticket, snapshotHash} ⇒ 403 inválido
 *      → R7: UNA re-emisión + re-verificación (TTL vencido entre el emit y el
 *      uso es el caso normal, jamás un error para el tallerista);
 *   3) descarga local del artefacto + registro QA (GET /api/exports).
 * Nada de esto importa three ni pdf-lib: helpers livianos, importables por la
 * shell sin engordar el chunk inicial.
 * ============================================================================ */

/** R6: cota del archivo final de la ficha (PNG ≤ 5 MB). */
export const QUOTE_MAX_BYTES = 5 * 1024 * 1024;

/** Mensajes canónicos de la UI pos 9 (los muestran modal y Foto HD iguales). */
export const EXPORT_ERR_OFFLINE =
  'Sin conexión: el ticket de export se valida en el servidor. Probá de nuevo cuando vuelva internet.';
export const EXPORT_ERR_TICKET =
  'No se pudo validar el ticket de export. Probá de nuevo (si el plan está activo, el reintento lo arregla).';
export const EXPORT_ERR_RENDER = 'No pudo generarse el archivo; probá de nuevo.';

export type TicketRequest =
  | { kind: 'ok'; ticket: string }
  | { kind: 'paywall' } // 402 — la UI abre el modal Paywall SIEMPRE (spec §6)
  | { kind: 'offline' } // red caída: aviso honrado, jamás error crudo
  | { kind: 'error' };

/** Paso 1: pedir el ticket firmado ligado al hash del snapshot. */
export async function requestExportTicket(snapshotHash: string): Promise<TicketRequest> {
  let res: Response;
  try {
    res = await fetch('/api/exports/ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshotHash }),
    });
  } catch {
    return { kind: 'offline' };
  }
  if (res.status === 402) return { kind: 'paywall' };
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as { ticket?: unknown } | null;
    if (typeof data?.ticket === 'string' && data.ticket.length > 0) {
      return { kind: 'ok', ticket: data.ticket };
    }
  }
  return { kind: 'error' };
}

/** Paso 2: contra-verificación server-side (403 ⇒ false; hash incluido en R7). */
export async function verifyTicketRemote(ticket: string, snapshotHash: string): Promise<boolean> {
  try {
    const res = await fetch('/api/exports/ticket/verificar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, snapshotHash }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * R7 completo para el caller: ticket + verificación y UNA re-emisión si la
 * primera validar falla. Traduce los casos a la UI (Paywall / offline /
 * mensaje de reintentar) y devuelve el ticket usable o null ⇒ cortar el flow.
 */
export async function ensureVerifiedTicket(
  snapshotHash: string,
  handlers: {
    onPaywallRequest: () => void;
    onError: (msg: string) => void;
  },
): Promise<string | null> {
  let outcome = await requestExportTicket(snapshotHash);
  if (outcome.kind === 'paywall') {
    handlers.onPaywallRequest();
    return null;
  }
  if (outcome.kind === 'offline') {
    handlers.onError(EXPORT_ERR_OFFLINE);
    return null;
  }
  if (outcome.kind === 'ok') {
    if (await verifyTicketRemote(outcome.ticket, snapshotHash)) {
      return outcome.ticket;
    }
    // R7: TTL vencido / token alterado ⇒ un ciclo limpio de re-emisión.
    outcome = await requestExportTicket(snapshotHash);
    if (outcome.kind === 'ok' && (await verifyTicketRemote(outcome.ticket, snapshotHash))) {
      return outcome.ticket;
    }
  }
  handlers.onError(EXPORT_ERR_TICKET);
  return null;
}

/** Paso 3a: descarga local (blob → <a download>; la blob URL se libera aparte). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Paso 3b: registro QA (§7) — best-effort: fallar NUNCA estropea el export. */
export async function registerQaArtifact(type: 'png' | 'pdf'): Promise<void> {
  try {
    await fetch(`/api/exports?type=${type}`);
  } catch {
    // sin conexión el registro no existe: el artefacto ya se descargó igual
  }
}
