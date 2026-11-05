// Pinned data for the six demo invoices, plus the extraction result each one should produce. Dates
// are offsets from a base date, so regenerated samples always look current. Every Colombian tax ID
// fails the DIAN check digit, and the US one uses the never-issued "00" prefix, so none can belong
// to a real taxpayer.
import { invoiceFileName } from '../../src/lib/file-name.ts';
import type { NormalizedInvoice, ReviewReason } from '../../src/lib/invoice.ts';
import { normalizeInvoice } from '../../src/lib/normalize-invoice.ts';

export interface SampleLine {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface SampleInvoice {
  file: string;
  supplier: string;
  supplier_tax_id_printed: string;
  supplier_address: string;
  invoice_number: string;
  currency: 'COP' | 'USD';
  tax_label: string;
  tax_rate: number;
  issue_offset_days: number;
  due_offset_days: number;
  lines: SampleLine[];
  date_style: 'iso' | 'us-long';
  lines_per_page: number;
  printed_total?: number;
  scanned?: boolean;
}

export interface SampleExpectation {
  file: string;
  outcome: 'ok' | 'review' | 'duplicate';
  path?: 'text' | 'vision';
  invoice?: NormalizedInvoice;
  drive_file_name?: string;
  review_reasons_include?: ReviewReason[];
  duplicate_of?: string;
}

// The number only; the PDF template prints the "NIT"/"Tax ID" label in front of it.
export const BUYER: { name: string; tax_id_printed: string; address: string } = {
  name: 'Magdaport S.A.S.',
  tax_id_printed: '901.555.210-1',
  address: 'Vía 40 # 77-120, Barranquilla',
};

export const SAMPLES: readonly SampleInvoice[] = [
  {
    file: 'invoice-01-two-items.pdf',
    supplier: 'Bolsamar Empaques S.A.S.',
    supplier_tax_id_printed: '901.384.552-2',
    supplier_address: 'Carrera 51B # 72-29, Barranquilla',
    invoice_number: 'BE-2041',
    currency: 'COP',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    issue_offset_days: -28,
    due_offset_days: 2,
    lines: [
      { description: 'Corrugated box 40x30x30 cm', quantity: 500, unit_price: 1800 },
      { description: 'Stretch film roll 50 cm x 300 m', quantity: 20, unit_price: 42500 },
    ],
    date_style: 'iso',
    lines_per_page: 10,
  },
  {
    file: 'invoice-02-ten-items.pdf',
    supplier: 'Sacoyuca Alimentos S.A.S.',
    supplier_tax_id_printed: '900.947.316-2',
    supplier_address: 'Calle 30 # 20-15, Barranquilla',
    invoice_number: 'SA-77812',
    currency: 'COP',
    tax_label: 'IVA 5%',
    tax_rate: 0.05,
    issue_offset_days: -24,
    due_offset_days: 6,
    lines: [
      { description: 'White rice 25 kg bag', quantity: 40, unit_price: 98000 },
      { description: 'Red beans 1 kg', quantity: 120, unit_price: 9800 },
      { description: 'Refined sugar 50 kg bag', quantity: 15, unit_price: 182000 },
      { description: 'Sunflower oil 3 L', quantity: 60, unit_price: 31500 },
      { description: 'Wheat flour 50 kg bag', quantity: 10, unit_price: 148000 },
      { description: 'Spaghetti 500 g', quantity: 200, unit_price: 3200 },
      { description: 'Lentils 1 kg', quantity: 80, unit_price: 7600 },
      { description: 'Ground coffee 500 g', quantity: 50, unit_price: 16900 },
      { description: 'Cocoa powder 1 kg', quantity: 25, unit_price: 24000 },
      { description: 'Iodized salt 1 kg', quantity: 100, unit_price: 1900 },
    ],
    date_style: 'iso',
    lines_per_page: 4,
  },
  {
    file: 'invoice-03-usd.pdf',
    supplier: 'Brackenport Supply LLC',
    supplier_tax_id_printed: '00-1847263',
    supplier_address: 'Miami, FL, USA',
    invoice_number: 'INV-3307',
    currency: 'USD',
    tax_label: 'Sales tax (export)',
    tax_rate: 0,
    issue_offset_days: -21,
    due_offset_days: 9,
    lines: [
      { description: 'Pallet wrapper turntable motor', quantity: 1, unit_price: 1240.0 },
      { description: 'Pre-stretch roller set', quantity: 2, unit_price: 385.5 },
      { description: 'Freight to Barranquilla', quantity: 1, unit_price: 180.0 },
    ],
    date_style: 'us-long',
    lines_per_page: 10,
  },
  {
    file: 'invoice-04-scanned.pdf',
    supplier: 'Nevaribe Logística S.A.S.',
    supplier_tax_id_printed: '901.120.874-4',
    supplier_address: 'Avenida Circunvalación # 45-10, Barranquilla',
    invoice_number: 'NL-0938',
    currency: 'COP',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    issue_offset_days: -17,
    due_offset_days: 13,
    lines: [
      { description: 'Cold storage, pallet-day', quantity: 120, unit_price: 9500 },
      { description: 'Refrigerated transport Barranquilla–Santa Marta', quantity: 2, unit_price: 680000 },
    ],
    date_style: 'iso',
    lines_per_page: 10,
    scanned: true,
  },
  {
    file: 'invoice-05-bad-totals.pdf',
    supplier: 'Marbetaria S.A.S.',
    supplier_tax_id_printed: '900.612.498-6',
    supplier_address: 'Calle 17 # 41-26, Barranquilla',
    invoice_number: 'MB-5520',
    currency: 'COP',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    issue_offset_days: -14,
    due_offset_days: 16,
    lines: [
      { description: 'Thermal labels 100x150 mm (roll)', quantity: 40, unit_price: 18000 },
      { description: 'Ink ribbon 110 mm x 300 m', quantity: 12, unit_price: 35000 },
    ],
    date_style: 'iso',
    lines_per_page: 10,
    // Printed instead of the true sum of the lines and tax, so the invoice's numbers don't add up.
    printed_total: 1416600,
  },
];

export const COPY_OF_FIRST = 'invoice-06-copy-of-01.pdf';

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function subtotalOf(sample: SampleInvoice): number {
  return round2(sample.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0));
}

export function taxOf(sample: SampleInvoice): number {
  return round2(subtotalOf(sample) * sample.tax_rate);
}

/** The arithmetically correct total, regardless of what the page prints. */
function totalOf(sample: SampleInvoice): number {
  return round2(subtotalOf(sample) + taxOf(sample));
}

/** The amount the page's Total line prints. */
export function printedTotalOf(sample: SampleInvoice): number {
  return sample.printed_total ?? totalOf(sample);
}

export function taxIdLabel(currency: SampleInvoice['currency']): string {
  return currency === 'COP' ? 'NIT' : 'Tax ID';
}

export function offsetDate(baseDate: string, offsetDays: number): string {
  const result = DateTime.fromISO(baseDate, { zone: 'utc' }).plus({ days: offsetDays }).toISODate();
  if (result === null) throw new Error(`base date is not a valid calendar date: ${baseDate}`);
  return result;
}

/**
 * What a model would extract before normalization: a labeled, punctuated tax ID for
 * `normalizeTaxId` to clean, ISO dates (the schema asks for them), and the printed total, even
 * where it's wrong.
 */
function rawExtraction(sample: SampleInvoice, baseDate: string): unknown {
  return {
    supplier: sample.supplier,
    supplier_tax_id: `${taxIdLabel(sample.currency)} ${sample.supplier_tax_id_printed}`,
    invoice_number: sample.invoice_number,
    issue_date: offsetDate(baseDate, sample.issue_offset_days),
    due_date: offsetDate(baseDate, sample.due_offset_days),
    currency: sample.currency,
    subtotal: subtotalOf(sample),
    tax: taxOf(sample),
    total: printedTotalOf(sample),
    line_items: sample.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_total: round2(line.quantity * line.unit_price),
    })),
  };
}

function expectationFor(sample: SampleInvoice, baseDate: string): SampleExpectation {
  const { invoice } = normalizeInvoice(rawExtraction(sample, baseDate));
  const { name } = invoiceFileName({
    issue_date: invoice.issue_date,
    supplier: invoice.supplier,
    invoice_number: invoice.invoice_number,
    received_at: `${baseDate}T12:00:00Z`,
    event_id: 'unused',
  });
  const reviewing = sample.printed_total !== undefined;

  const base: SampleExpectation = {
    file: sample.file,
    outcome: reviewing ? 'review' : 'ok',
    path: sample.scanned ? 'vision' : 'text',
    invoice,
    drive_file_name: name,
  };
  return reviewing ? { ...base, review_reasons_include: ['totals_mismatch'] } : base;
}

export function expectations(baseDate: string): SampleExpectation[] {
  const [firstSample] = SAMPLES;
  if (!firstSample) throw new Error('SAMPLES must list at least the first invoice');

  return [
    ...SAMPLES.map((sample) => expectationFor(sample, baseDate)),
    { file: COPY_OF_FIRST, outcome: 'duplicate', duplicate_of: firstSample.file },
  ];
}
