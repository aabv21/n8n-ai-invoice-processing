// Renders the sample invoices as PDFs. The five text invoices are drawn with pdf-lib, byte-identical
// for the same base date. The scanned one is rasterized with pdfjs-dist and @napi-rs/canvas; its
// bytes may vary by machine, since only its visible content matters.
import path from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { BUYER, offsetDate, printedTotalOf, subtotalOf, taxIdLabel, taxOf, type SampleInvoice } from './sample-invoices.ts';

const PRODUCER = 'Magdaport demo sample generator';
const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const MARGIN_LEFT = 50;
const RIGHT_EDGE = 545;
const QTY_RIGHT = 335;
const PRICE_RIGHT = 430;
const BODY_SIZE = 11;
const ROW_HEIGHT = 18;

// pdfjs-dist appends a font file name to this and reads it from disk (under Node it never fetches),
// so it must be a plain path with a trailing separator, not a `file://` URL.
const STANDARD_FONT_DATA_URL = `${path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts')}${path.sep}`;

function groupDigits(digits: string, separator: string): string {
  // eslint-disable-next-line security/detect-unsafe-regex -- `(\d{3})+` partitions a digit run into fixed-width chunks with only one possible match per position, so there's no backtracking blowup
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Colombian pesos as `$ 1.750.000`; US dollars as `US$ 2,191.00`. No locale APIs, so the output
 * never depends on the host's ICU data. */
function formatMoney(amount: number, currency: SampleInvoice['currency']): string {
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  if (currency === 'USD') {
    const [whole = '0', cents = '00'] = absolute.toFixed(2).split('.');
    return `${sign}US$ ${groupDigits(whole, ',')}.${cents}`;
  }
  return `${sign}$ ${groupDigits(String(Math.round(absolute)), '.')}`;
}

function formatPrintedDate(iso: string, style: SampleInvoice['date_style']): string {
  if (style === 'iso') return iso;
  return DateTime.fromISO(iso, { zone: 'utc', locale: 'en-US' }).toFormat('LLLL d, yyyy');
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let start = 0; start < items.length; start += size) pages.push(items.slice(start, start + size));
  return pages;
}

/** Draws `text` so its right edge lands exactly at `rightX`, regardless of how wide it measures. */
function drawRight(page: PDFPage, font: PDFFont, text: string, size: number, rightX: number, y: number): void {
  page.drawText(text, { x: rightX - font.widthOfTextAtSize(text, size), y, size, font });
}

interface Row {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

export async function renderInvoicePdf(sample: SampleInvoice, baseDate: string): Promise<Uint8Array> {
  const issueDate = formatPrintedDate(offsetDate(baseDate, sample.issue_offset_days), sample.date_style);
  const dueDate = formatPrintedDate(offsetDate(baseDate, sample.due_offset_days), sample.date_style);
  const subtotal = subtotalOf(sample);
  const tax = taxOf(sample);
  const printedTotal = printedTotalOf(sample);

  const rows: Row[] = sample.lines.map((line) => ({
    description: line.description,
    quantity: String(line.quantity),
    unitPrice: formatMoney(line.unit_price, sample.currency),
    total: formatMoney(line.quantity * line.unit_price, sample.currency),
  }));
  const pages = chunk(rows, sample.lines_per_page);

  // `updateMetadata: false` stops pdf-lib stamping the wall clock and its own name; the four fields
  // below are set explicitly, so the same base date always gives the same bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fixedDate = new Date(`${baseDate}T12:00:00Z`);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  // NOTE: Helvetica is a WinAnsi standard font, so sample text is limited to WinAnsi characters and pdf-lib throws on anything else. Upgrade path: embed a TTF through `@pdf-lib/fontkit`.
  const font = await doc.embedFont(StandardFonts.Helvetica);

  pages.forEach((pageRows, pageIndex) => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirst = pageIndex === 0;
    const isLast = pageIndex === pages.length - 1;
    page.drawRectangle({ x: 40, y: 30, width: 515, height: 780, borderWidth: 1, borderColor: rgb(0, 0, 0) });

    let y = 782;
    if (isFirst) {
      page.drawText(sample.supplier, { x: MARGIN_LEFT, y, size: 16, font });
      drawRight(page, font, 'INVOICE', 20, RIGHT_EDGE, y + 4);
      y -= 18;
      page.drawText(`${taxIdLabel(sample.currency)} ${sample.supplier_tax_id_printed}`, { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      drawRight(page, font, `Number: ${sample.invoice_number}`, BODY_SIZE, RIGHT_EDGE, y);
      y -= 16;
      page.drawText(sample.supplier_address, { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      drawRight(page, font, `Issue date: ${issueDate}`, BODY_SIZE, RIGHT_EDGE, y);
      y -= 16;
      drawRight(page, font, `Due date: ${dueDate}`, BODY_SIZE, RIGHT_EDGE, y);
      y -= 22;
      page.drawLine({ start: { x: MARGIN_LEFT, y }, end: { x: RIGHT_EDGE, y }, thickness: 1 });
      y -= 20;
      page.drawText('Bill to:', { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      y -= 16;
      page.drawText(BUYER.name, { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      y -= 16;
      page.drawText(`NIT ${BUYER.tax_id_printed}`, { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      y -= 16;
      page.drawText(BUYER.address, { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      y -= 22;
      page.drawLine({ start: { x: MARGIN_LEFT, y }, end: { x: RIGHT_EDGE, y }, thickness: 1 });
      y -= 18;
    }

    page.drawText('Description', { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
    drawRight(page, font, 'Qty', BODY_SIZE, QTY_RIGHT, y);
    drawRight(page, font, 'Unit price', BODY_SIZE, PRICE_RIGHT, y);
    drawRight(page, font, 'Total', BODY_SIZE, RIGHT_EDGE, y);
    y -= 14;
    page.drawLine({ start: { x: MARGIN_LEFT, y }, end: { x: RIGHT_EDGE, y }, thickness: 1 });
    y -= ROW_HEIGHT;

    for (const row of pageRows) {
      page.drawText(row.description, { x: MARGIN_LEFT, y, size: BODY_SIZE, font });
      drawRight(page, font, row.quantity, BODY_SIZE, QTY_RIGHT, y);
      drawRight(page, font, row.unitPrice, BODY_SIZE, PRICE_RIGHT, y);
      drawRight(page, font, row.total, BODY_SIZE, RIGHT_EDGE, y);
      y -= ROW_HEIGHT;
    }

    if (isLast) {
      y -= 8;
      page.drawLine({ start: { x: PRICE_RIGHT - 80, y }, end: { x: RIGHT_EDGE, y }, thickness: 1 });
      y -= 20;
      drawRight(page, font, 'Subtotal', BODY_SIZE, PRICE_RIGHT, y);
      drawRight(page, font, formatMoney(subtotal, sample.currency), BODY_SIZE, RIGHT_EDGE, y);
      y -= 16;
      drawRight(page, font, sample.tax_label, BODY_SIZE, PRICE_RIGHT, y);
      drawRight(page, font, formatMoney(tax, sample.currency), BODY_SIZE, RIGHT_EDGE, y);
      y -= 14;
      page.drawLine({ start: { x: PRICE_RIGHT - 80, y }, end: { x: RIGHT_EDGE, y }, thickness: 1 });
      y -= 20;
      drawRight(page, font, 'Total', 13, PRICE_RIGHT, y);
      drawRight(page, font, formatMoney(printedTotal, sample.currency), 13, RIGHT_EDGE, y);
    }

    const footer = `Page ${String(pageIndex + 1)} of ${String(pages.length)}`;
    drawRight(page, font, footer, 9, (MARGIN_LEFT + RIGHT_EDGE) / 2 + font.widthOfTextAtSize(footer, 9) / 2, 45);
  });

  return doc.save();
}

export async function renderPage(pdf: Uint8Array, pageNumber: number, dpi: number): Promise<Canvas> {
  const loadingTask = getDocument({
    data: pdf,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // pdfjs-dist types this as a DOM `HTMLCanvasElement`, outside this project's lib list;
  // @napi-rs/canvas's `Canvas` has what `render` calls (getContext, width, height).
  const renderParams = { canvas, canvasContext: context, viewport } as unknown as Parameters<typeof page.render>[0];
  await page.render(renderParams).promise;
  await loadingTask.destroy();
  return canvas;
}

const SCAN_DPI = 150;
const SCAN_ROTATION_DEGREES = 0.6;
const SCAN_NOISE_SEED = 20261030;
const SCAN_NOISE_SPREAD = 8;
const SCAN_JPEG_QUALITY = 70;

/** A small deterministic generator (Mulberry32) so the "scanner noise" below never calls
 * `Math.random`: a fixed seed always produces the same sequence of adjustments. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function rasterizeToScan(pdf: Uint8Array): Promise<Uint8Array> {
  // The source's creation date ties this file's metadata to the same base date. Must run before
  // `renderPage`: pdfjs-dist's Node loader transfers, and so empties, the buffer it's given.
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  const sourceDate = source.getCreationDate() ?? new Date(`${String(new Date().getUTCFullYear())}-01-01T12:00:00Z`);

  const rendered = await renderPage(pdf, 1, SCAN_DPI);
  const renderedContext = rendered.getContext('2d');
  const image = renderedContext.getImageData(0, 0, rendered.width, rendered.height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i] ?? 255;
    const green = pixels[i + 1] ?? 255;
    const blue = pixels[i + 2] ?? 255;
    const gray = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
    pixels[i] = gray;
    pixels[i + 1] = gray;
    pixels[i + 2] = gray;
  }
  renderedContext.putImageData(image, 0, 0);

  const rotated = createCanvas(rendered.width, rendered.height);
  const rotatedContext = rotated.getContext('2d');
  rotatedContext.fillStyle = 'white';
  rotatedContext.fillRect(0, 0, rotated.width, rotated.height);
  rotatedContext.translate(rotated.width / 2, rotated.height / 2);
  rotatedContext.rotate((SCAN_ROTATION_DEGREES * Math.PI) / 180);
  rotatedContext.drawImage(rendered, -rendered.width / 2, -rendered.height / 2);
  rotatedContext.setTransform(1, 0, 0, 1, 0, 0);

  const scanned = rotatedContext.getImageData(0, 0, rotated.width, rotated.height);
  const scannedPixels = scanned.data;
  const nextRandom = seededRandom(SCAN_NOISE_SEED);
  for (let i = 0; i < scannedPixels.length; i += 4) {
    const noise = (nextRandom() - 0.5) * SCAN_NOISE_SPREAD;
    for (const channel of [0, 1, 2]) {
      const value = (scannedPixels[i + channel] ?? 255) + noise;
      scannedPixels[i + channel] = Math.min(255, Math.max(0, Math.round(value)));
    }
  }
  rotatedContext.putImageData(scanned, 0, 0);

  const jpeg = await rotated.encode('jpeg', SCAN_JPEG_QUALITY);

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(sourceDate);
  doc.setModificationDate(sourceDate);
  const embedded = await doc.embedJpg(jpeg);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(embedded, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });

  return doc.save();
}
