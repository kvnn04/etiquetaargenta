/* ============================================================================
 * ENVOLTORIO A4 DE LA FICHA PDF — pos 9
 * ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md §3-R6 ("el PDF es UN
 * envoltorio A4 del mismo PNG de la ficha, con pie del taller y el linkId si
 * corresponde") + §5 (nomenclatura `{taller}-ficha-{model}-{aaaammdd}.pdf`).
 * ----------------------------------------------------------------------------
 * · A4 EXACTO: 595.28 × 841.89 pt; márgenes de 24 pt.
 * · La imagen PNG (2160 px de lado mínimo) se embebe SIN re-comprimir
 *   (embedPng) arriba del A4: fit por ancho, escalado extra si el alto del
 *   contenido overflowa la hoja (fichas con observaciones muy largas).
 * · Pie del taller DEBAJO de la imagen (Helvetica/HelveticaBold — fuentes
 *   estándar del PDF, cero descarga): título + fecha + linkId opcional +
 *   placa fina "Ficha generada con MOCAP 3D" (la misma firma del PNG).
 * · Sanidad WinAnsi: las fuentes estándar NO aceptan emojis ni caracteres
 *   fuera de Latin-1: `sanitizeWinAnsi` limpia (— ⇒ -, … ⇒ ..., emoji fuera)
 *   para que pdf-lib jamás lance un error de encoding a mitad del export.
 * · Módulo cargado SOLO con import() dinámico (pdf-lib ~200 kB fuera del
 *   chunk del modal hasta que se pide un PDF — mismo patrón que el three).
 * ============================================================================ */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';

/** A4 EXACTO en puntos (72 pt/inch × 8.2677 in). */
export const PDF_A4_WIDTH_PT = 595.28;
export const PDF_A4_HEIGHT_PT = 841.89;

const MARGIN_PT = 24;

/* -------------------------------------------------------------------------- */
/* WinAnsi (Windows-1252) — dominio de las fuentes estándar                    */
/* -------------------------------------------------------------------------- */

/**
 * pdf-lib valida estrictamente el encoding de las fuentes estándar: todo lo
 * que no mapee a WinAnsi lanza. Conversión elegante de lo común y ELIMINACIÓN
 * de lo no representable (emojis): el PDF nunca se rompe por un texto curioso
 * pegado en el nombre del taller o en el linkId.
 */
function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/\u2013|\u2014/g, '-') // — – ⇒ hyphen
    .replace(/\u2026/g, '...') // … ⇒ puntos suspensivos ASCII
    .replace(/\u2018|\u2019/g, "'") // comillas tipográficas
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u00A0/g, ' ') // nbsp
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, ''); // fuera de WinAnsi ⇒ fuera del PDF
}

/* -------------------------------------------------------------------------- */
/* Pie del taller (debajo de la imagen, R6)                                   */
/* -------------------------------------------------------------------------- */

export interface FichaPdfOptions {
  /** Título del taller (idéntico al encabezado del PNG — R4 canónico). */
  tallerTitle: string;
  /** Fecha legible ya formateada (formatFichaDate — misma del canvas). */
  fecha: string;
  /** Pos 10: id del enlace comercial activo; hoy siempre null. */
  linkId?: string | null;
}

const INK = rgb(0.13, 0.1, 0.06); // #221A10 — misma tinta del canvas (P.ink)
const MUTED = rgb(0.43, 0.39, 0.33); // #6E6355 — idem P.muted
const GOLD = rgb(0.69, 0.52, 0.21); // #B08636 — idem P.gold

/** Dibuja el pie; devuelve el ALTO ocupado (para reservar su lugar). */
function drawFooter(
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  imageBottomY: number,
  opts: FichaPdfOptions,
): number {
  const page = pdf.getPage(0);
  const { width: pageW } = page.getSize();
  const title = sanitizeWinAnsi(opts.tallerTitle).slice(0, 80) || 'Taller';
  const fecha = sanitizeWinAnsi(opts.fecha);

  // Línea fina separadora justo bajo la imagen (misma regla del canvas).
  const hairY = imageBottomY - 12;
  page.drawLine({
    start: { x: MARGIN_PT, y: hairY },
    end: { x: pageW - MARGIN_PT, y: hairY },
    thickness: 0.7,
    color: rgb(0.86, 0.82, 0.74),
  });

  // Fila 1: título (bold, izquierda) + fecha (muted, derecha).
  const rowY = hairY - 15;
  page.drawText(title, {
    x: MARGIN_PT,
    y: rowY,
    size: 10.5,
    font: fonts.bold,
    color: INK,
  });
  const titleW = fonts.bold.widthOfTextAtSize(title, 10.5);
  if (opts.linkId) {
    const link = sanitizeWinAnsi(`Enlace comercial ${opts.linkId}`);
    page.drawText(link, {
      x: Math.min(MARGIN_PT + titleW + 14, pageW - MARGIN_PT - 130),
      y: rowY,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
  }
  const fechaW = fonts.regular.widthOfTextAtSize(fecha, 9);
  page.drawText(fecha, {
    x: pageW - MARGIN_PT - fechaW,
    y: rowY,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });

  // Fila 2: placa fina de la plataforma (mismo copy que el pie del PNG).
  const plateY = rowY - 14;
  const plate = sanitizeWinAnsi('Ficha generada con MOCAP 3D');
  const plateW = fonts.regular.widthOfTextAtSize(plate, 7.5);
  page.drawText(plate, {
    x: (pageW - plateW) / 2,
    y: plateY,
    size: 7.5,
    font: fonts.regular,
    color: GOLD,
  });

  return hairY - plateY + 8;
}

/* -------------------------------------------------------------------------- */
/* Build — un único PNG de la ficha adentro del A4                            */
/* -------------------------------------------------------------------------- */

/**
 * R6: `buildFichaPdf(pngBytes, options)` — recibe los bytes del PNG FINAL de
 * la ficha (el mismo archivo descargable, ≤ 5 MB) y devuelve el PDF A4 como
 * Uint8Array listo para su Blob 'application/pdf'.
 */
export async function buildFichaPdf(
  pngBytes: Uint8Array | ArrayBuffer,
  options: FichaPdfOptions,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([PDF_A4_WIDTH_PT, PDF_A4_HEIGHT_PT]);
  let image: PDFImage;
  try {
    image = await pdf.embedPng(pngBytes);
  } catch {
    // PNG inválido jamás rompe: el A4 sale con el pie y una nota honesta.
    page.drawText('No se pudo embeber la imagen de la ficha.', {
      x: MARGIN_PT,
      y: PDF_A4_HEIGHT_PT - MARGIN_PT - 14,
      size: 10,
      font: regular,
      color: MUTED,
    });
    drawFooter(pdf, { regular, bold }, MARGIN_PT + 60, options);
    return pdf.save();
  }

  const usableW = PDF_A4_WIDTH_PT - MARGIN_PT * 2;
  const FOOTER_H = 36; // fila título/fecha + placa fina (reserva conocida)
  const usableH = PDF_A4_HEIGHT_PT - MARGIN_PT - MARGIN_PT - FOOTER_H - 8;

  // Fit por ancho (24 pt) con tope de alto: fichas MUY largas reducen escala
  // antes que salirse de la hoja (R6: el envoltorio SIEMPRE cabe en A4).
  const scale = Math.min(
    usableW / image.width,
    usableH / image.height,
  );
  const drawW = image.width * scale;
  const drawH = image.height * scale;

  const imageBottomY = PDF_A4_HEIGHT_PT - MARGIN_PT - drawH; // arriba de la hoja
  page.drawImage(image, {
    x: (PDF_A4_WIDTH_PT - drawW) / 2, // centrado horizontal
    y: imageBottomY,
    width: drawW,
    height: drawH,
  });

  drawFooter(pdf, { regular, bold }, imageBottomY, options);

  pdf.setTitle(sanitizeWinAnsi(`Ficha de producto - ${options.tallerTitle}`));
  pdf.setProducer('MOCAP 3D - Simulador de grabado laser');
  pdf.setCreator('MOCAP 3D');

  return pdf.save();
}
