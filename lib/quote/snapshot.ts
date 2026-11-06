/* ============================================================================
 * SNAPSHOT INMUTABLE DE LA FICHA — ÚNICA FUENTE: spec_detalle_del_modelo_en_-
 * fica.md §3-R1/R2/R3/R5/R8 (contrato de grilla de 9 tarjetas en 3 secciones).
 * ----------------------------------------------------------------------------
 * R1 — Al abrir el modal se captura un snapshot inmutable: mientras está
 *      abierto, las ediciones detrás NO alteran la ficha ni el export. El
 *      badge "Actualizado a las HH:MM" + botón Actualizar re-captura.
 * R2 — Grilla canónica de 9 tarjetas en 3 secciones (Producto / Grabado /
 *      Acabados) con formatos EXACTOS: mm con 1 decimal SIEMPRE (`123.0 mm`),
 *      % y ° con decimal SOLO cuando el valor no es entero (`92%`/`92.5%`,
 *      `45°`/`45.5°`), banda auto W=(Dext−Dint)/2. Tarjeta sin dato ⇒ `—`
 *      (jamás celda vacía).
 * R3 — Descriptores de color: color personalizado ⇒ SIEMPRE `#HEX · descriptor
 *      fijo` (`#2A2A2A · Anodizado Personalizado` / `#E6C48E · Color Libre`);
 *      presets ⇒ su nombre propio. Los auto-nombres de color (`(Negro Mate)`)
 *      quedan ELIMINADOS (contradicción con spec_seleccion_de_color R5).
 * R5 — Texto de margen derivado de las funciones ÚNICAS de pos 7
 *      (marginSheetLine: "Margen: seguro" / "con riesgo (excede X mm)").
 * R6/R8 — Degradación de marca vía resolveBranding() (pos 2; white-label SOLO
 *      PRO) y fallbacks legacy (modelo desconocido ⇒ "Mate Camionero";
 *      escala/rotación ausentes ⇒ 100% / 0°; datos inválidos ⇒ `—` + aviso
 *      en consola: el modal jamás se rompe por un dato faltante).
 * §5 — El snapshot es TRANSITORIO (memoria del modal): NO se persiste en
 *      projects.state; todo su contenido es derivable del estado vivo.
 * ============================================================================ */

import { resolveMateModel } from '@/lib/catalog';
import { formatColorDescriptor } from '@/lib/color';
import { formatRotationLabel, normalizeRotation } from '@/lib/design';
import {
  evaluateOverflow,
  evaluateOverflowBBox,
  normalizeScale,
  marginSheetLine,
  type OverflowCheck,
} from '@/lib/overflow';
import type { ResolvedBranding } from '@/lib/branding';
import { OBSERVACIONES_MAX } from './texts';

/* -------------------------------------------------------------------------- */
/* R2 — formatos de tarjeta                                                   */
/* -------------------------------------------------------------------------- */

/**
 * R2: `123.0 mm` — UN decimal exacto SIEMPRE (123 ⇒ "123.0 mm").
 * Dato inválido (NaN/∞/≤0/absente) ⇒ null: la tarjeta imprime `—` (§6) y el
 * capture avisa en consola — el modal nunca se rompe por un dato faltante.
 */
export function formatMmCard(v: number | null | undefined): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return `${v.toFixed(1)} mm`;
}

/** R2: `92%` / `92.5%` — decimal SOLO si no es entero (normalizeScale incluido). */
export function formatPctCard(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const norm = normalizeScale(v);
  return Number.isInteger(norm) ? `${norm}%` : `${norm.toFixed(1)}%`;
}

/** R2: `45°` / `45.5°` — via formatRotationLabel (convenio único de pos 6). */
export function formatDegCard(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return formatRotationLabel(v);
}

/* -------------------------------------------------------------------------- */
/* R3 — etiquetas de acabados (descriptores FIJOS de spec_seleccion R5)       */
/* -------------------------------------------------------------------------- */

/** formatColorDescriptor emite "Virola: …"/"Cuerpo: …": la TARJETA lleva el
 *  título y el valor imprime el resto (R2: "#2A2A2A · Anodizado Personalizado"). */
function stripZonePrefix(descriptor: string): string {
  return descriptor.replace(/^(Virola|Cuerpo):\s*/, '');
}

/** R2/R3: `Alpaca / Plata` o `#2A2A2A · Anodizado Personalizado` (nunca `(Negro Mate)`). */
export function formatVirolaCard(metalPreset: string, virolaColor: string | null): string {
  return stripZonePrefix(formatColorDescriptor('virola', metalPreset, virolaColor));
}

/** R2/R3: `Algarrobo / Madera` o `#E6C48E · Color Libre` (nunca `(Suela Claro)`). */
export function formatCuerpoCard(bodyPreset: string, bodyColor: string | null): string {
  return stripZonePrefix(formatColorDescriptor('body', bodyPreset, bodyColor));
}

/* -------------------------------------------------------------------------- */
/* R2/R8 — etiqueta del Modelo                                                */
/* -------------------------------------------------------------------------- */

/**
 * R2/QA2: con Imperial activo imprime EXACTAMENTE `Mate Imperial`;
 * con Camionero, `Mate Camionero`. R8: modelo ausente/desconocido ⇒ cae a
 * `Mate Camionero` (resolveMateModel ya implementa el fallback del catálogo).
 */
export function formatModeloCard(
  mateModel: string | null | undefined,
): { etiqueta: string; modelId: string } {
  const product = resolveMateModel(mateModel ?? null);
  return { etiqueta: `Mate ${product.label}`, modelId: product.id };
}

/* -------------------------------------------------------------------------- */
/* Snapshot                                                                   */
/* -------------------------------------------------------------------------- */

/** Estados de la tarjeta Margen: verde / ámbar / neutro (sin diseño). */
export type FichaMarginState = 'safe' | 'overflow' | 'none';

export interface FichaBrandBlock {
  /** R4: encabezado (nombre comercial → cuenta → "MOCAP 3D · MATE PERSONALIZADO"). */
  title: string;
  /** R4: iniciales del escudo neutro cuando no hay logo (SIEMPRE presentes). */
  initials: string;
  /** R4: thumb del logo SOLO si el plan lo habilita (white-label PRO); null ⇒ escudo. */
  logoThumbUrl: string | null;
  /** R4: handle normalizado sin '@'; null ⇒ la columna/ícono NO se emite. */
  instagramHandle: string | null;
  /** R4: E.164 válido; null ⇒ pie sin CTA claro (degradación plana). */
  whatsappE164: string | null;
}

/**
 * §5 — fichaSnapshot (transitorio, en memoria): todo su contenido es
 * derivable del estado del simulador. Nada de esto viaja a projects.state.
 */
export interface FichaSnapshot {
  /** R1: congelamiento (ms epoch) — el badge imprime "Actualizado a las HH:MM". */
  capturedAt: number;
  /** R1/R7: hash corto del contenido — el ticket de export queda ligado a él. */
  hash: string;
  /** §6: ¿hay proyecto del backend cargado/restaurado? (transparencia). */
  hasProject: boolean;
  /** §6/R8: ¿hay archivo de diseño en el slot de sesión? (placeholders Grabado). */
  hasDesign: boolean;
  /** Tarjeta Modelo (R2/R8: `Mate Imperial` / `Mate Camionero`). */
  modeloEtiqueta: string;
  /** Id canónico del modelo (seguro para el nombre de archivo §5). */
  productId: string;
  /** Tarjetas de Producto: D_ext / D_int / banda auto W=(Dext−Dint)/2. */
  extDiameterMm: number | null;
  intDiameterMm: number | null;
  bandaMm: number | null;
  /** true ⇒ Escala/Rotación/Margen muestran el placeholder "Sin diseño cargado". */
  grabadoSinDiseno: boolean;
  /** Tarjetas de Grabado (con diseño): valores ya formateados (R2). */
  escalaEtiqueta: string;
  rotacionEtiqueta: string;
  /** R5/R6 pos 7: texto canónico (`Seguro` / `con riesgo (...)`). */
  margenEtiqueta: string | null;
  /** Estado para colorear la tarjeta (verde/ámbar/neutro). */
  margenEstado: FichaMarginState;
  /** §6: el chequeo de margen cayó al modo envolvente ("Detección aproximada"). */
  margenAproximado: boolean;
  /** Tarjetas de Acabados (R3): descriptores fijos. */
  virolaEtiqueta: string;
  cuerpoEtiqueta: string;
  /** R5: texto libre congelado del momento de captura (máx 280). */
  observaciones: string;
  /** Pos 10 (QA4): linkId del enlace comercial activo; hoy siempre null. */
  linkId: string | null;
  /** R4: bloque de marca resuelto con resolveBranding (única implementación). */
  brand: FichaBrandBlock;
  /** Check crudo de desborde del momento (banner de confirmación del modal). */
  overflow: OverflowCheck | null;
}

export interface CaptureFichaInput {
  /** Estado del editor (ya normalizado por el store/persistence). */
  state: {
    mateModel: string | null;
    extDiameter: number | null;
    intDiameter: number | null;
    bodyPreset: string | null;
    metalPreset: string | null;
    bodyColor: string | null;
    virolaColor: string | null;
    design: { rotation?: unknown; scale?: unknown; mirror?: unknown } | null;
  };
  /** ¿archivo SVG/PNG en el slot de sesión? (Grabado sin placeholder). */
  designAssetPresent: boolean;
  /** ¿hay proyecto server-side? (transparencia — no bloquea nada). */
  hasProject: boolean;
  /** Chequeo vigente de sesión — derivado al vuelo (R8 pos 7: jamás persistido). */
  overflow: OverflowCheck | null;
  /** El chequeo cayó al modo envolvente (§6 pos 7). */
  inkDegraded?: boolean;
  /** R4: marca ya resuelta por resolveBranding (única implementación). */
  brand: ResolvedBranding;
  /** E.164 válido para el pie (resolveBranding no lo devuelve completo). */
  whatsappE164?: string | null;
  /** Pos 10: linkId del enlace comercial activo (hoy null). */
  linkId?: string | null;
  /** R5: observaciones al capturar (se acotan a 280). */
  observaciones?: string;
  /** Test: reloj inyectable (capturedAt determinista). */
  nowMs?: number;
}

/** R5: el texto libre se poda de espacios y se acota a 280 al capturar. */
function cleanObservaciones(raw: string | null | undefined): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= OBSERVACIONES_MAX ? text : text.slice(0, OBSERVACIONES_MAX);
}

/** Número vigente o null (R8: NaN/∞/≤0/absente ⇒ `—` + consola). */
function vigente(v: number | null | undefined, what: string): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  console.warn(`[ficha] dato ${typeof v === 'number' ? 'inválido' : 'ausente'} (${what}) ⇒ tarjeta em-dash`);
  return null;
}

/**
 * R1 — captura el snapshot al abrir (o al pulsar Actualizar): INMUTABLE a
 * partir de acá; cualquier edición del simulador detrás no lo toca.
 */
export function captureFichaSnapshot(input: CaptureFichaInput): FichaSnapshot {
  const { state, overflow, brand } = input;

  // --- Producto: diámetros (R8) y banda auto (R2: W = (Dext − Dint)/2) ---
  const extMm = vigente(state.extDiameter, 'D_ext');
  const intMm = vigente(state.intDiameter, 'D_int');
  const bandaMm =
    extMm !== null && intMm !== null && intMm < extMm
      ? Number(((extMm - intMm) / 2).toFixed(2))
      : null;

  const modelo = formatModeloCard(state.mateModel);

  // --- Grabado: R8 legacy (scale/rotation ausentes ⇒ 100% / 0°) — los
  // normalizadores canónicos de pos 6/7 cubren cualquier valor del jsonb.
  const d = state.design ?? {};
  const grabadoSinDiseno = !input.designAssetPresent;
  const escalaEtiqueta = grabadoSinDiseno ? '—' : formatPctCard(
    typeof d.scale === 'number' ? d.scale : normalizeScale(undefined as unknown as number),
  );
  const rotacionEtiqueta = grabadoSinDiseno ? '—' : formatDegCard(
    typeof d.rotation === 'number' ? d.rotation : normalizeRotation(undefined as unknown as number),
  );

  // --- Margen (R5/R6 pos 7): texto canónico ÚNICO para modal y canvas.
  let margenEtiqueta: string | null = null;
  let margenEstado: FichaMarginState = 'none';
  if (!grabadoSinDiseno && overflow) {
    if (overflow.status === 'safe') {
      margenEtiqueta = 'Seguro';
      margenEstado = 'safe';
    } else {
      // marginSheetLine() emite "Margen: con riesgo (...)": la tarjeta lleva el
      // título "Margen" y el valor es lo que sigue al ": ".
      margenEtiqueta = marginSheetLine(overflow).replace(/^Margen:\s*/, '');
      margenEstado = 'overflow';
    }
  }

  const capturedAt = input.nowMs ?? Date.now();

  const snapshot: FichaSnapshot = {
    capturedAt,
    hash: '', // se completa a continuación
    hasProject: input.hasProject,
    hasDesign: input.designAssetPresent,
    modeloEtiqueta: modelo.etiqueta,
    productId: modelo.modelId,
    extDiameterMm: extMm,
    intDiameterMm: intMm,
    bandaMm,
    grabadoSinDiseno,
    escalaEtiqueta,
    rotacionEtiqueta,
    margenEtiqueta,
    margenEstado,
    margenAproximado: Boolean(input.inkDegraded) && !grabadoSinDiseno,
    virolaEtiqueta: formatVirolaCard(state.metalPreset ?? 'alpaca', state.virolaColor),
    cuerpoEtiqueta: formatCuerpoCard(state.bodyPreset ?? 'algarrobo', state.bodyColor),
    observaciones: cleanObservaciones(input.observaciones),
    linkId: input.linkId ?? null,
    brand: {
      title: brand.title,
      initials: brand.initials,
      logoThumbUrl: brand.logoThumbUrl,
      instagramHandle: brand.instagramHandle,
      whatsappE164: input.whatsappE164 ?? null,
    },
    overflow: grabadoSinDiseno ? null : overflow,
  };
  snapshot.hash = hashFichaSnapshot(snapshot);
  return snapshot;
}

/* -------------------------------------------------------------------------- */
/* R1/R7 — hash corto del contenido (liga el ticket de export al snapshot)    */
/* -------------------------------------------------------------------------- */

/** FNV-1a 32-bit: hash corto, estable, determinista y barato (R1 "hash corto"). */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Hash del CONTENIDO del snapshot (R7: el ticket queda ligado a él). EXCLUYE
 * capturedAt: dos capturas con el mismo contenido comparten hash, así el
 * ticket vigente sigue sirviendo a través de un Actualizar sin cambios.
 */
export function hashFichaSnapshot(s: FichaSnapshot): string {
  const parts = [
    s.productId,
    s.extDiameterMm === null ? '—' : s.extDiameterMm.toFixed(2),
    s.intDiameterMm === null ? '—' : s.intDiameterMm.toFixed(2),
    s.bandaMm === null ? '—' : s.bandaMm.toFixed(2),
    s.grabadoSinDiseno ? 'sin-diseno' : s.escalaEtiqueta,
    s.grabadoSinDiseno ? 'sin-diseno' : s.rotacionEtiqueta,
    s.margenEtiqueta ?? 'sin-margen',
    s.margenAproximado ? 'aprox' : 'exacto',
    s.virolaEtiqueta,
    s.cuerpoEtiqueta,
    s.observaciones,
    s.brand.title,
    s.brand.logoThumbUrl ?? 'nologo',
    s.brand.instagramHandle ?? 'noig',
    s.brand.whatsappE164 ?? 'nowapp',
    s.hasDesign ? 'design' : 'nodesign',
    s.hasProject ? 'project' : 'noproject',
  ];
  // '|' no aparece en ninguno de los valores (descriptores y textos canónicos).
  return `f1:${fnv1a32(parts.join('|'))}`;
}

/* -------------------------------------------------------------------------- */
/* R5/R8 — chequeo vigente de sesión (única derivación compartida)             */
/* -------------------------------------------------------------------------- */

export interface OverflowCheckInput {
  /** ¿hay archivo de diseño en el slot de sesión? (sin asset ⇒ null). */
  hasDesignAsset: boolean;
  /** Envolvente medida al cargar el asset (mm al 100 %) o null. */
  inkEnvelope: { inkMaxMm: number; inkMinMm: number } | null;
  /** §6: raster del chequeo falló ⇒ modo envolvente conservador. */
  inkScanDegraded: boolean;
  /** Side de la base congelada del asset (mm) — input del modo bbox. */
  baseSideMm: number;
  /** D_ext / D_int vigentes (mm) ⇒ radios del anillo. */
  extDiameterMm: number;
  intDiameterMm: number;
  /** Escala vigente (%; normalizeScale cubre ausentes/basura). */
  scalePct: number;
}

/**
 * Deriva el OverflowCheck vigente EXACTAMENTE como el panel del Grabado
 * (design-card pos 7): envolvente medida ⇒ escaneo polar; medición fallida
 * ⇒ modo bbox conservador; sin asset ⇒ null. Los consumidores pos 9 (modal de
 * Ficha + Foto HD) leen de ESTA función: una sola definición del chequeo
 * vigente para panel, banner, ficha y export.
 */
export function currentOverflowCheck(input: OverflowCheckInput): OverflowCheck | null {
  if (!input.hasDesignAsset) return null;
  if (input.inkEnvelope) {
    return evaluateOverflow(
      input.inkEnvelope,
      input.extDiameterMm / 2,
      input.intDiameterMm / 2,
      input.scalePct,
    );
  }
  if (input.inkScanDegraded) {
    return evaluateOverflowBBox(
      input.baseSideMm,
      input.scalePct,
      input.extDiameterMm / 2,
      input.intDiameterMm / 2,
    );
  }
  return null; // medición en curso / asset sin trazado
}
