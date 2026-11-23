/* ============================================================================
 * NÚCLEO DE PAGOS — posición 10B (spec_pagos.md §3 lógica de negocio + §5)
 * ----------------------------------------------------------------------------
 * ÚNICA FUENTE de la máquina de estados del ciclo de cobro y de las vistas
 * derivadas (plan autoritativo, fechas, montos). Módulo PURO: sin DB, sin
 * envs, sin fetch — todo instante/valor se inyecta y se testa con instantes
 * pinned (igual que el resto de la suite).
 *
 * R1: estados `inactiva → activa → gracia → activa | (FREE)` y
 *     `programada_cierre` (cancelación pedida, operativa hasta period_end).
 *     La posición 13 agrega `revocada` (reembolso total o contracargo): el
 *     dinero volvió y el acceso se corta; NUNCA se reutiliza el preapproval
 *     viejo para resucitar el plan (R11.4/R11.6).
 *     El ciclo se ANCLA al día del primer pago; zona horaria canónica
 *     America/Argentina/Buenos_Aires (sin DST desde 2019: fija UTC−3.
 *     00:00 AR ≙ 03:00 UTC — así se construyen las fechas de ciclo).
 * R3: ARS exclusivo; el fee lo asume la plataforma (reporte para el admin v2).
 * R4: `freezePrice` del patch marca CUÁNDO es legítimo escribir
 *     `price_frozen`: SOLO el alta o la re-activación tras downgrade (que
 *     toman el precio VIGENTE). Un ciclo normal jamás retoca el monto: el
 *     suscriptor vigente no ve su precio subir.
 * R5: sin trial/cupones — no cabe acá ni acá; el FREE permanente es la prueba.
 * R7: `normalizeMpPaymentStatus` es la whitelist del webhook. La posición 13
 *     amplía la lista a refunded/partially_refunded/charged_back; pending y
 *     cualquier estado desconocido siguen ignorándose con log.
 * R8: gracia de 5 días corridos desde el PRIMER rechazo (MP reintenta dentro
 *     de la ventana: un segundo rechazo NO re-abre los 5 días) y resolver de
 *     plan con downgrade a FREE preservando proyectos/assets/links.
 * R9: cancelación solo por Portal de MP ⇒ `programada_cierre` hasta
 *     period_end (fin del ciclo ya pago).
 * R10: sin helper de recuperación — el abandono de checkout es SOLO una fila
 *     de auditoría (`checkout_intents`), acá no vive nada de eso.
 *
 * El caller (webhook, job/reconciliación) aplica el patch con
 * compare-and-set (`WHERE status = current`) — R7 dedupe garantizado.
 * ============================================================================ */

import type { Plan } from '@/lib/permissions';

/** Zona horaria canónica de TODOS los cálculos del ciclo (R1). */
export const TZ = 'America/Argentina/Buenos_Aires' as const;

/** Milisegundos de un día corrido (gracia y ventanas corren en corridos). */
export const DAY_MS = 86_400_000;

/** Gracia EXACTA de la spec (R1/R8): 5 días corridos desde el rechazo. */
export const GRACE_DAYS = 5;

/** Estados de la fila `subscriptions` (§5: check de la columna). */
export const SUBSCRIPTION_STATUSES = [
  'inactiva',
  'activa',
  'gracia',
  'programada_cierre',
  'revocada',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Estados VIVOS: los únicos desde los que un reembolso/contracargo revoca. */
export const LIVE_SUBSCRIPTION_STATUSES = [
  'activa',
  'gracia',
  'programada_cierre',
] as const;

/** Whitelist de estados de PAGO que mutan estado (§5 de payments + R7/R11.2). */
export const PAYMENT_STATUSES = [
  'approved',
  'rejected',
  'refunded',
  'partially_refunded',
  'charged_back',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Motivo del cierre de la suscripción (R11.4/R11.6 + R9). */
export const CLOSURE_REASONS = ['refund', 'chargeback', 'dunning', 'cancel'] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

/** Etiquetas del Centro de Suscripción (§4: Activa / En gracia / Cierre programado). */
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  inactiva: 'Sin suscripción',
  activa: 'Activa',
  gracia: 'En gracia',
  programada_cierre: 'Cierre programado',
  revocada: 'Revocada',
};

/** true ⇒ la suscripción todavía da acceso (o está por vencer) — R8/R9. */
export function isLiveSubscriptionStatus(status: SubscriptionStatus): boolean {
  return (
    status === 'activa' || status === 'gracia' || status === 'programada_cierre'
  );
}

/* -------------------------------------------------------------------------- */
/* Montos (R3: ARS, formato argentino, el CLIENTE no calcula cifras)           */
/* -------------------------------------------------------------------------- */

/**
 * Validación entry-gate de montos (§6: "montos de pricing_config validados
 * > 0 al enviar al Checkout"; en el webhook actúa de type-guard del monto).
 */
export function isPositiveAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
}

/** `$ 20.000` — es-AR, sin decimales (QA pos 8: interacción idéntica al paywall). */
export function formatArs(amount: number, currency = 'ARS'): string | null {
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`; // divisa rara: eco honesto, sin mascarar
  }
}

/** `$ 20.000 / mes` — la leyenda del paywall y del Centro de Suscripción. */
export function formatPricePerMonth(amount: number, currency = 'ARS'): string | null {
  const base = formatArs(amount, currency);
  return base ? `${base} / mes` : null;
}

/* -------------------------------------------------------------------------- */
/* Fechas (R1 tz canónica; §4: formato DD/MM/YYYY)                             */
/* -------------------------------------------------------------------------- */

export interface ArDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

const AR_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Componentes de calendario en la tz canónica (el rollover midnight AR manda). */
export function arDateParts(ms: number): ArDateParts {
  const parts = AR_DATE_FORMATTER.formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/** `06/11/2026` — las fechas de cobro y cierre (§4). */
export function formatDateAR(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const { year, month, day } = arDateParts(ms);
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${dd}/${mm}/${year}`;
}

/* -------------------------------------------------------------------------- */
/* Gracia (R8: 5 días corridos desde el PRIMER rechazo)                        */
/* -------------------------------------------------------------------------- */

/** Vence la ventana: rechazo + 5 días corridos (R8). */
export function graceExpiresAtMs(rejectedAtMs: number): number {
  return rejectedAtMs + GRACE_DAYS * DAY_MS;
}

/** Días restantes de gracia con techo a 0 (cuenta regresiva del banner §4). */
export function graceDaysLeft(graceExpiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((graceExpiresAtMs - nowMs) / DAY_MS));
}

/* -------------------------------------------------------------------------- */
/* Ciclo (R1: ancla = día del primer pago; el débito se intenta ese día de      */
/* cada mes; en meses que no tienen el día, se clampa al último)                */
/* -------------------------------------------------------------------------- */

/** Día del mes del ancla del ciclo (el instante del primer pago aprobado). */
export function cycleAnchorDayOf(firstApprovalMs: number): number {
  return arDateParts(firstApprovalMs).day;
}

/**
 * Serializa el ancla a 'YYYY-MM-DD' (el tipo DATE de `subscriptions.cycle_anchor`).
 */
export function arDateStrFromMs(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const { year, month, day } = arDateParts(ms);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * 'YYYY-MM-DD' (como PostgREST serializa DATE) ⇒ ms de 00:00 AR de ese día.
 * null si el string no es la forma exacta (columna vacía ⇒ sin ancla aún).
 */
export function arDateStrToMs(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 3); // 00:00 AR
}

/** Día del ancla desde el string DATE (1..31) — null si vacío/roto. */
export function cycleAnchorDayOfStr(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? Number(m[3]) : null;
}

/** URL oficial del Portal de MP (R9: cancelar/actualizar tarjeta SU, no botón in-app). */
export const MERCADOPAGO_PORTAL_URL = 'https://www.mercadopago.com.ar/subscriptions/portal';

/**
 * Próxima fecha del ciclo (00:00 AR de ese día): fin del cierre programado
 * (R9 period_end) y "próxima fecha de cobro" del centro (§4). La fecha SIEMPRE
 * queda ≥ ahora (mismo día del ancla ⇒ próximo mes); ancla mayor que el largo
 * del mes se clampa al último día (31 y febreros: fin de mes).
 */
export function nextCycleDateMs(anchorDay: number, nowMs: number): number {
  const now = arDateParts(nowMs);
  let year = now.year;
  let month = now.month;
  if (now.day >= anchorDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  // Date.UTC(y, month, 0) = último día del mes `month` (febrero incl.) — clamp.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(anchorDay, lastDay);
  return Date.UTC(year, month - 1, day, 3); // 00:00 AR = 03:00 UTC
}

/* -------------------------------------------------------------------------- */
/* Resolver de plan — el gating del server (matriz R2 de permissions.ts)       */
/* -------------------------------------------------------------------------- */

/** Cursor del ciclo: las dos fechas que cambian + el estado de subscriptions. */
export interface SubscriptionCursor {
  status: SubscriptionStatus;
  graceExpiresAtMs: number | null;
  periodEndMs: number | null;
}

/**
 * Plan AUTORITATIVO para los renders server (editor/perfil/paywall). El plan
 * de `users.plan` queda escrito pero aquí está la REGLA que lo decide, para
 * que webhook y reconciliación no puedan desincronizarse en el "cómo":
 *   activa ⇒ pro · gracia viva ⇒ pro_grace · programada_cierre (pre period_end)
 *   ⇒ pro · gracia vencida / programada expirada / inactiva / revocada ⇒ free
 *   (R8/R9/R11.4/R11.6).
 */
export function resolvePlan(sub: SubscriptionCursor, nowMs: number): Plan {
  switch (sub.status) {
    case 'activa':
      return 'pro';
    case 'gracia':
      return sub.graceExpiresAtMs != null && nowMs < sub.graceExpiresAtMs
        ? 'pro_grace'
        : 'free';
    case 'programada_cierre':
      return sub.periodEndMs != null && nowMs < sub.periodEndMs ? 'pro' : 'free';
    case 'inactiva':
    case 'revocada':
      return 'free';
  }
}

/* -------------------------------------------------------------------------- */
/* Máquina de estados — decision pura; el caller persiste con compare-and-set  */
/* -------------------------------------------------------------------------- */

/** Eventos que la fila `subscriptions` entiende (R7 webhook + R8 job + R11). */
export type SubscriptionEvent =
  | { kind: 'cobro_aprobado' }
  | { kind: 'cobro_rechazado'; rejectedAtMs: number }
  /** Portal de MP (cancelled) o pausa (paused) ⇒ sin más cobros (R9). */
  | { kind: 'cancelacion_programada'; periodEndMs: number }
  /** El reconciliador venció la ventana (R8). */
  | { kind: 'gracia_vencida' }
  /** Reembolso TOTAL del ciclo vigente (R11.4): acceso cortado ya. */
  | { kind: 'reembolso_total'; occurredAtMs: number }
  /** Contracargo del ciclo vigente (R11.6): suspensión inmediata. */
  | { kind: 'contracargo'; occurredAtMs: number };

/** Patch a aplicar: `undefined` = no tocar, `null` = limpiar a NULL. */
export interface SubscriptionPatch {
  status: SubscriptionStatus;
  /** R4 — true SOLO en alta / re-activación tras downgrade (precio VIGENTE). */
  freezePrice: boolean;
  graceExpiresAtMs?: number | null;
  periodEndMs?: number | null;
  /** R11.4/R11.6 — motivo y fecha del cierre por revocación. */
  closureReason?: ClosureReason | null;
  closedAtMs?: number | null;
}

/** period_end correcto para UNA cancelación según el estado de origen (R9). */
export function cancelationPeriodEndMs(
  current: SubscriptionStatus,
  input: { graceExpiresAtMs: number | null; anchorDay: number | null; nowMs: number },
): number | null {
  // Cancelada durante la gracia: el downgrade sucede al VENCER la ventana
  // ("si el cobro no llega igualmente", §6 edge) — period_end = ventana vencida.
  if (current === 'gracia') return input.graceExpiresAtMs;
  // Cancelada estando activa: fin del ciclo YA pago (próximo cobro que no ocurrirá).
  if (input.anchorDay == null) return null;
  return nextCycleDateMs(input.anchorDay, input.nowMs);
}

/**
 * Cambios de pago normalizados (R7/R11.2): approved | rejected | refunded |
 * partially_refunded | charged_back. Cualquier otro (pending/in_process/…) ⇒
 * null: se logea y NO muta nada.
 */
export function normalizeMpPaymentStatus(raw: string): PaymentStatus | null {
  switch (raw) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'refunded':
      return 'refunded';
    case 'partially_refunded':
      return 'partially_refunded';
    case 'charged_back':
      return 'charged_back';
    default:
      return null;
  }
}

/**
 * Transición PURA del ciclo (R1). Devuelve el patch a persistir o `null` si el
 * evento NO aplica en el estado actual (caller logea; no muta). Reglas:
 *   · `cobro_aprobado` desde `inactiva` ⇒ activa re-congelando precio (alta o
 *     re-activación tras downgrade: precio VIGENTE, R4).
 *   · `cobro_aprobado` desde `activa` ⇒ activa sin retocar nada (ciclo normal:
 *     el patch NO pide UPDATE de fila — el webhook inserta payment + email).
 *   · desde `gracia`/`programada_cierre` ⇒ restauración extiende/corrige
 *     (QA3: pago aprobado en cierre programado vuelve a activa).
 *   · `cobro_rechazado` desde `gracia` ⇒ null: NO re-abre los 5 días (R1:
 *     corridos desde el PRIMER rechazo) — el payment rechazado igual se registra.
 *   · `cobro_aprobado` desde `revocada` ⇒ null: un cobro del preapproval VIEJO
 *     no resucita el plan (R11.3/R11.8). La re-alta legítima pasa por un
 *     checkout nuevo, que deja la fila en `inactiva` antes de cobrar.
 *   · `reembolso_total`/`contracargo` desde un estado vivo ⇒ `revocada` con
 *     `closure_reason` y `closed_at`; desde `inactiva`/`revocada` ⇒ null
 *     (solo se audita el pago, R11.3/§3.3).
 *   · `gracia_vencida` ⇒ `inactiva` (downgrade R8 preservando TODO el contenido).
 */
export function transitionSubscription(
  current: SubscriptionStatus,
  event: SubscriptionEvent,
): SubscriptionPatch | null {
  switch (event.kind) {
    case 'cobro_aprobado': {
      if (current === 'revocada') {
        // R11.3/R11.8: el reembolso/contracargo GANA. Un approved tardío del
        // preapproval viejo se registra como pago, pero no activa PRO.
        return null;
      }
      if (current === 'activa') {
        return { status: 'activa', freezePrice: false }; // ciclo normal: sin UPDATE
      }
      if (current === 'inactiva') {
        // Alta primera O re-activación tras downgrade ⇒ congelar precio VIGENTE (R4).
        return { status: 'activa', freezePrice: true, graceExpiresAtMs: null, periodEndMs: null };
      }
      // gracia (restauración en ventana, R8) / programada_cierre (QA3: extiende).
      return { status: 'activa', freezePrice: false, graceExpiresAtMs: null, periodEndMs: null };
    }
    case 'cobro_rechazado': {
      if (current !== 'activa') return null;
      return {
        status: 'gracia',
        freezePrice: false,
        graceExpiresAtMs: graceExpiresAtMs(event.rejectedAtMs),
        periodEndMs: null,
      };
    }
    case 'cancelacion_programada': {
      if (current === 'activa' || current === 'gracia') {
        // R9: sigue operativa hasta period_end (o ventana de gracia, ver edge).
        return {
          status: 'programada_cierre',
          freezePrice: false,
          graceExpiresAtMs: null,
          periodEndMs: event.periodEndMs,
        };
      }
      return null;
    }
    case 'gracia_vencida': {
      if (current === 'gracia' || current === 'programada_cierre') {
        // Downgrade a FREE (R8): proyectos, assets y links se PRESERVAN —
        // acá no hay DELETE ni anulación: solo baja el plan.
        return { status: 'inactiva', freezePrice: false, graceExpiresAtMs: null, periodEndMs: null };
      }
      return null;
    }
    case 'reembolso_total':
    case 'contracargo': {
      // Solo desde un ciclo VIVO: `inactiva` ya está en FREE y `revocada` ya
      // fue cerrada (un contracargo posterior no duplica email ni transición).
      if (
        current !== 'activa' &&
        current !== 'gracia' &&
        current !== 'programada_cierre'
      ) {
        return null;
      }
      return {
        status: 'revocada',
        freezePrice: false,
        graceExpiresAtMs: null,
        periodEndMs: null,
        closureReason: event.kind === 'reembolso_total' ? 'refund' : 'chargeback',
        closedAtMs: event.occurredAtMs,
      };
    }
  }
}
