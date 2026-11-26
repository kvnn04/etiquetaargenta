/* ============================================================================
 * CONSTANCIA DE PAGO EN PDF — posición 10B (R6 ampliada)
 * ----------------------------------------------------------------------------
 * Genera un A4 descargable por cada pago aprobado (o ajustado) del plan PRO.
 * Es un comprobante COMERCIAL: no reemplaza la factura ARCA, que sigue siendo
 * manual (R6). El PDF se genera on-demand para la descarga de /perfil y una vez
 * más para adjuntarlo al email de recibo; no se persiste ni se guarda en
 * Storage.
 *
 * Datos del emisor: LEGAL_ENTITY_* (misma fuente que las páginas legales).
 * Si un dato falta, la línea se omite: nunca se inventan CUIT ni domicilio.
 * ============================================================================ */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { LEGAL_ENTITY } from '@/lib/legal/config';
import { formatArs, formatDateAR } from '@/lib/payments/core';

export interface PaymentReceiptPdfInput {
  /** UUID interno de `payments.id` (trazabilidad de soporte). */
  paymentId: string;
  mpPaymentId: number;
  amountArs: number;
  currency: string;
  status: string;
  occurredAtMs: number;
  /** Nombre comercial del taller suscriptor (brand_name/base_name). */
  workshopName: string;
  subscriberEmail: string;
  receiptUrl?: string | null;
  refundedAmountArs?: number;
}

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MARGIN_PT = 48;
const CONTENT_WIDTH_PT = A4_WIDTH_PT - MARGIN_PT * 2;
const LABEL_COLUMN_PT = 148;

const INK = rgb(0.13, 0.1, 0.06); // #221A10
const MUTED = rgb(0.43, 0.39, 0.33); // #6E6355
const GOLD = rgb(0.69, 0.52, 0.21); // #B08636
const LINE = rgb(0.86, 0.82, 0.74);
const SOFT = rgb(0.98, 0.96, 0.92);

const STATUS_LABEL: Record<string, string> = {
  approved: 'Aprobado',
  rejected: 'Rechazado',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolso parcial',
  charged_back: 'Contracargo',
};

/**
 * pdf-lib valida estrictamente el encoding de las fuentes estándar: todo lo
 * que no mapee a WinAnsi lanza. Se convierte lo común y se elimina lo que no
 * se puede representar (emojis): el PDF nunca se rompe por un nombre curioso.
 */
function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, '');
}

/** Fecha + hora en es-AR (mismo huso que el resto de los emails y el perfil). */
function formatDateTimeAR(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const date = formatDateAR(ms) ?? '';
  const time = new Date(ms).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} ${time}`.trim();
}

/**
 * Corta un texto en líneas que caben en `maxWidth`. Incluye corte duro para
 * URLs largas (el comprobante de MP puede no tener espacios).
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = sanitizeWinAnsi(text).trim();
  if (!clean) return [];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    // Palabra más ancha que la columna (URL): corte por caracteres.
    let chunk = '';
    for (const char of word) {
      if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines;
}

/** Dibuja texto envuelto y devuelve la próxima Y (debajo de la última línea). */
function drawWrapped(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    size: number;
    font: PDFFont;
    color: ReturnType<typeof rgb>;
    lineHeight?: number;
  },
): number {
  const lines = wrapText(text, options.font, options.size, options.maxWidth);
  let y = options.y;
  const lineHeight = options.lineHeight ?? options.size * 1.35;
  for (const line of lines) {
    page.drawText(line, {
      x: options.x,
      y,
      size: options.size,
      font: options.font,
      color: options.color,
    });
    y -= lineHeight;
  }
  return y;
}

function drawSection(page: PDFPage, y: number, title: string, fonts: { bold: PDFFont }): number {
  page.drawText(sanitizeWinAnsi(title), {
    x: MARGIN_PT,
    y,
    size: 8,
    font: fonts.bold,
    color: GOLD,
  });
  page.drawLine({
    start: { x: MARGIN_PT, y: y - 4 },
    end: { x: MARGIN_PT + 42, y: y - 4 },
    thickness: 1,
    color: GOLD,
  });
  return y - 17;
}

/** Etiqueta en columna fija + valor envuelto. Omite valores vacíos. */
function drawField(
  page: PDFPage,
  y: number,
  label: string,
  value: string,
  fonts: { regular: PDFFont; bold: PDFFont },
): number {
  const clean = sanitizeWinAnsi(value).trim();
  if (!clean) return y;

  page.drawText(sanitizeWinAnsi(`${label}:`), {
    x: MARGIN_PT,
    y,
    size: 8.5,
    font: fonts.bold,
    color: MUTED,
  });

  const valueX = MARGIN_PT + LABEL_COLUMN_PT;
  const nextY = drawWrapped(page, clean, {
    x: valueX,
    y,
    maxWidth: A4_WIDTH_PT - MARGIN_PT - valueX,
    size: 9.5,
    font: fonts.regular,
    color: INK,
    lineHeight: 13,
  });

  // Al menos una línea de alto, aunque el valor haya entrado en una sola.
  return Math.min(nextY, y - 13) - 2;
}

/**
 * Construye la constancia A4 como Uint8Array listo para `application/pdf`.
 * No lanza por datos faltantes: la sección del emisor se adapta a lo que
 * exista en LEGAL_ENTITY_*.
 */
export async function buildPaymentReceiptPdf(
  input: PaymentReceiptPdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  const page = pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

  /* Encabezado ------------------------------------------------------------ */
  page.drawText('CONSTANCIA DE PAGO', {
    x: MARGIN_PT,
    y: A4_HEIGHT_PT - MARGIN_PT - 18,
    size: 22,
    font: bold,
    color: INK,
  });
  page.drawText(sanitizeWinAnsi('Suscripción PRO - Simulador Mates'), {
    x: MARGIN_PT,
    y: A4_HEIGHT_PT - MARGIN_PT - 36,
    size: 10,
    font: regular,
    color: MUTED,
  });
  page.drawLine({
    start: { x: MARGIN_PT, y: A4_HEIGHT_PT - MARGIN_PT - 50 },
    end: { x: A4_WIDTH_PT - MARGIN_PT, y: A4_HEIGHT_PT - MARGIN_PT - 50 },
    thickness: 1,
    color: GOLD,
  });

  /* Caja del importe ------------------------------------------------------ */
  const amountText = sanitizeWinAnsi(
    formatArs(input.amountArs, input.currency) ?? `${input.currency} ${input.amountArs}`,
  );
  const boxW = 160;
  const boxH = 48;
  const boxX = A4_WIDTH_PT - MARGIN_PT - boxW;
  // La caja queda arriba de la línea dorada del encabezado, sin taparla.
  const boxY = A4_HEIGHT_PT - MARGIN_PT - boxH;
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    color: SOFT,
    borderColor: LINE,
    borderWidth: 0.7,
  });
  page.drawText(sanitizeWinAnsi(`IMPORTE ABONADO (${input.currency})`), {
    x: boxX + 12,
    y: boxY + boxH - 14,
    size: 7,
    font: bold,
    color: MUTED,
  });
  let amountSize = 20;
  while (amountSize > 12 && bold.widthOfTextAtSize(amountText, amountSize) > boxW - 24) {
    amountSize -= 1;
  }
  page.drawText(amountText, {
    x: boxX + 12,
    y: boxY + 10,
    size: amountSize,
    font: bold,
    color: INK,
  });

  let y = A4_HEIGHT_PT - MARGIN_PT - 74;

  /* Emisor ---------------------------------------------------------------- */
  y = drawSection(page, y, 'DATOS DEL EMISOR', fonts);
  const emitterFields: Array<[string, string]> = [];
  if (LEGAL_ENTITY.legalName) {
    emitterFields.push(['Razón social', LEGAL_ENTITY.legalName]);
    if (LEGAL_ENTITY.name && LEGAL_ENTITY.name !== LEGAL_ENTITY.legalName) {
      emitterFields.push(['Nombre comercial', LEGAL_ENTITY.name]);
    }
  } else {
    emitterFields.push(['Emisor', LEGAL_ENTITY.name]);
  }
  if (LEGAL_ENTITY.cuit) emitterFields.push(['CUIT', LEGAL_ENTITY.cuit]);
  if (LEGAL_ENTITY.taxCondition) {
    emitterFields.push(['Condición fiscal', LEGAL_ENTITY.taxCondition]);
  }
  if (LEGAL_ENTITY.address) emitterFields.push(['Domicilio', LEGAL_ENTITY.address]);
  if (LEGAL_ENTITY.email) emitterFields.push(['Email', LEGAL_ENTITY.email]);
  for (const [label, value] of emitterFields) {
    y = drawField(page, y, label, value, fonts);
  }

  y -= 10;

  /* Suscriptor ------------------------------------------------------------ */
  y = drawSection(page, y, 'SUSCRIPTOR', fonts);
  y = drawField(page, y, 'Taller', input.workshopName, fonts);
  y = drawField(page, y, 'Email', input.subscriberEmail, fonts);

  y -= 10;

  /* Detalle del pago ------------------------------------------------------ */
  y = drawSection(page, y, 'DETALLE DEL PAGO', fonts);
  y = drawField(page, y, 'Concepto', 'Suscripción PRO - plan mensual', fonts);
  y = drawField(page, y, 'Importe', `${amountText} (${input.currency})`, fonts);
  y = drawField(page, y, 'Fecha de pago', formatDateTimeAR(input.occurredAtMs), fonts);
  y = drawField(page, y, 'Estado', STATUS_LABEL[input.status] ?? input.status, fonts);
  y = drawField(page, y, 'ID de pago MP', String(input.mpPaymentId), fonts);
  if (input.refundedAmountArs != null && input.refundedAmountArs > 0) {
    y = drawField(
      page,
      y,
      'Monto reembolsado',
      formatArs(input.refundedAmountArs, input.currency) ?? `${input.currency} ${input.refundedAmountArs}`,
      fonts,
    );
  }
  y = drawField(page, y, 'Comprobante MP', input.receiptUrl ?? 'No disponible', fonts);
  y = drawField(page, y, 'ID de constancia', input.paymentId, fonts);

  /* Pie: aclaración fiscal + generación ----------------------------------- */
  const footerTop = Math.max(MARGIN_PT + 120, Math.min(y - 18, 210));
  page.drawLine({
    start: { x: MARGIN_PT, y: footerTop },
    end: { x: A4_WIDTH_PT - MARGIN_PT, y: footerTop },
    thickness: 0.7,
    color: LINE,
  });

  let footerY = footerTop - 14;
  footerY = drawWrapped(
    page,
    'Este documento es una constancia de pago emitida por la plataforma y no constituye factura ni comprobante fiscal. La factura ARCA se emite por separado a pedido del suscriptor.',
    {
      x: MARGIN_PT,
      y: footerY,
      maxWidth: CONTENT_WIDTH_PT,
      size: 8,
      font: regular,
      color: MUTED,
      lineHeight: 10,
    },
  );
  footerY -= 6;
  footerY = drawWrapped(
    page,
    `Documento generado el ${formatDateTimeAR(Date.now())} (hora de Argentina).`,
    {
      x: MARGIN_PT,
      y: footerY,
      maxWidth: CONTENT_WIDTH_PT,
      size: 7.5,
      font: regular,
      color: MUTED,
      lineHeight: 9.5,
    },
  );
  footerY -= 4;
  page.drawText(sanitizeWinAnsi('Verificá este comprobante en Perfil - Suscripción.'), {
    x: MARGIN_PT,
    y: footerY,
    size: 7.5,
    font: regular,
    color: GOLD,
  });

  pdf.setTitle(sanitizeWinAnsi(`Constancia de pago ${input.mpPaymentId}`));
  pdf.setAuthor(sanitizeWinAnsi(LEGAL_ENTITY.name));
  pdf.setSubject('Constancia de pago - Suscripción PRO');
  pdf.setCreator('Simulador Mates');
  pdf.setProducer('Simulador Mates - MOCAP 3D');

  return pdf.save();
}
