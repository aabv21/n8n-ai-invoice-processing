// Pinned data for the six demo invoices, plus the extraction result each one should produce. Dates
// are offsets from a base date, so regenerated samples always look current. Every Colombian tax ID
// fails the DIAN check digit, and the US one uses the never-issued "00" prefix, so none can belong
// to a real taxpayer.
import { invoiceFileName } from '../../src/lib/file-name.ts';
import type { NormalizedInvoice, ReviewReason } from '../../src/lib/invoice.ts';
import { normalizeInvoice } from '../../src/lib/normalize-invoice.ts';

interface SampleLine {
  description: string;
  quantity: number;
  unit_price: number;
  /** Overrides the invoice's `tax_rate` for this line (mixed IVA rates). */
  tax_rate?: number;
  /** A discount rate printed on the line; the line's total is after it. */
  discount?: number;
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
  /** What the page is; a quote is not an invoice, so the model must leave its number null. */
  kind?: 'invoice' | 'credit_note' | 'quote';
  /** Who the page is billed to; defaults to `BUYER`. */
  bill_to?: { name: string; tax_id_printed: string; address: string };
  /** A withholding printed after the total; the total itself stays the pre-withholding amount. */
  withholding?: { label: string; rate: number };
  expected_reasons?: ReviewReason[];
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

const EVAL_DEFAULTS = {
  currency: 'COP',
  date_style: 'iso',
  lines_per_page: 10,
  issue_offset_days: -20,
  due_offset_days: 10,
} as const;

/** Harder Colombian invoices for `pnpm run eval`; see the README's evaluation set. */
export const EVAL_SAMPLES: readonly SampleInvoice[] = [
  {
    ...EVAL_DEFAULTS,
    file: 'eval-01-credit-note.pdf',
    supplier: 'Bolsamar Empaques S.A.S.',
    supplier_tax_id_printed: '901.384.552-2',
    supplier_address: 'Carrera 51B # 72-29, Barranquilla',
    invoice_number: 'NC-0312',
    kind: 'credit_note',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    lines: [{ description: 'Return: Corrugated box 40x30x30 cm', quantity: -100, unit_price: 1800 }],
    expected_reasons: ['non_positive_total'],
  },
  {
    ...EVAL_DEFAULTS,
    file: 'eval-02-mixed-iva.pdf',
    supplier: 'Pradomar Alimentos S.A.S.',
    supplier_tax_id_printed: '900.418.226-9',
    supplier_address: 'Calle 72 # 54-30, Barranquilla',
    invoice_number: 'PA-7781',
    tax_label: 'IVA',
    tax_rate: 0.19,
    lines: [
      { description: 'White rice 25 kg bag', quantity: 10, unit_price: 98000, tax_rate: 0.05 },
      { description: 'Sunflower oil 3 L', quantity: 20, unit_price: 31500, tax_rate: 0.19 },
    ],
  },
  {
    ...EVAL_DEFAULTS,
    file: 'eval-03-withholding.pdf',
    supplier: 'Transribera Carga S.A.S.',
    supplier_tax_id_printed: '901.263.407-1',
    supplier_address: 'Vía 40 # 85-12, Barranquilla',
    invoice_number: 'TR-1205',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    lines: [{ description: 'Freight Barranquilla–Cartagena', quantity: 2, unit_price: 850000 }],
    withholding: { label: 'ReteFuente 3.5%', rate: 0.035 },
  },
  {
    ...EVAL_DEFAULTS,
    file: 'eval-04-quotation.pdf',
    supplier: 'Marbetaria S.A.S.',
    supplier_tax_id_printed: '900.612.498-6',
    supplier_address: 'Calle 17 # 41-26, Barranquilla',
    invoice_number: 'COT-2290',
    kind: 'quote',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    lines: [{ description: 'Thermal labels 100x150 mm (roll)', quantity: 30, unit_price: 18000 }],
    expected_reasons: ['missing_invoice_number'],
  },
  {
    ...EVAL_DEFAULTS,
    file: 'eval-05-accented-scan.pdf',
    supplier: 'Distribuidora Cañaveral – Café Ñandú S.A.S.',
    supplier_tax_id_printed: '900.581.034-8',
    supplier_address: 'Calle 30 # 8-45, Santa Marta',
    invoice_number: 'DC-0448',
    tax_label: 'IVA 5%',
    tax_rate: 0.05,
    lines: [
      { description: 'Café tostado 500 g', quantity: 40, unit_price: 16900 },
      { description: 'Panela orgánica 1 kg', quantity: 25, unit_price: 5200 },
    ],
    scanned: true,
  },
  {
    ...EVAL_DEFAULTS,
    file: 'eval-06-magdaport-as-supplier.pdf',
    supplier: BUYER.name,
    supplier_tax_id_printed: BUYER.tax_id_printed,
    supplier_address: BUYER.address,
    invoice_number: 'MG-0091',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    lines: [{ description: 'Pallet storage, monthly', quantity: 1, unit_price: 450000 }],
    bill_to: { name: 'Tiendas La Ribera S.A.S.', tax_id_printed: '900.733.418-6', address: 'Carrera 46 # 70-15, Barranquilla' },
    expected_reasons: ['supplier_is_buyer'],
  },
  {
    ...EVAL_DEFAULTS,
    file: 'eval-07-line-discount.pdf',
    supplier: 'Aceros del Caribe S.A.S.',
    supplier_tax_id_printed: '900.274.835-5',
    supplier_address: 'Zona Franca, Bodega 14, Barranquilla',
    invoice_number: 'AC-3310',
    tax_label: 'IVA 19%',
    tax_rate: 0.19,
    lines: [
      { description: 'Steel rebar 12 mm', quantity: 50, unit_price: 38000, discount: 0.1 },
      { description: 'Welding wire spool', quantity: 10, unit_price: 64000 },
    ],
  },
];

export const COPY_OF_FIRST = 'invoice-06-copy-of-01.pdf';

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** A line's amount as the page prints it: after the line's own discount. */
export function lineTotalOf(line: SampleLine): number {
  return round2(line.quantity * line.unit_price * (1 - (line.discount ?? 0)));
}

export function subtotalOf(sample: SampleInvoice): number {
  return round2(sample.lines.reduce((sum, line) => sum + (line.discount === undefined ? line.quantity * line.unit_price : lineTotalOf(line)), 0));
}

export function taxOf(sample: SampleInvoice): number {
  if (!sample.lines.some((line) => line.tax_rate !== undefined)) return round2(subtotalOf(sample) * sample.tax_rate);
  return round2(sample.lines.reduce((sum, line) => sum + round2(lineTotalOf(line) * (line.tax_rate ?? sample.tax_rate)), 0));
}

/** The tax rows the page prints: one for a single rate, one per distinct line rate (ascending) otherwise. */
export function taxLinesOf(sample: SampleInvoice): { label: string; amount: number }[] {
  if (!sample.lines.some((line) => line.tax_rate !== undefined)) return [{ label: sample.tax_label, amount: taxOf(sample) }];
  const byRate = new Map<number, number>();
  for (const line of sample.lines) {
    const rate = line.tax_rate ?? sample.tax_rate;
    byRate.set(rate, (byRate.get(rate) ?? 0) + round2(lineTotalOf(line) * rate));
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, amount]) => ({ label: `IVA ${String(Math.round(rate * 100))}%`, amount: round2(amount) }));
}

/** The withholding printed after the total, 0 when there is none. */
export function withholdingOf(sample: SampleInvoice): number {
  return sample.withholding === undefined ? 0 : round2(subtotalOf(sample) * sample.withholding.rate);
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
    // A quotation is not an invoice: the prompt tells the model to leave its number null, and a quote
    // prints "Valid until" instead of a due date, so there is no due date to read.
    invoice_number: sample.kind === 'quote' ? null : sample.invoice_number,
    issue_date: offsetDate(baseDate, sample.issue_offset_days),
    due_date: sample.kind === 'quote' ? null : offsetDate(baseDate, sample.due_offset_days),
    currency: sample.currency,
    subtotal: subtotalOf(sample),
    tax: taxOf(sample),
    total: printedTotalOf(sample),
    line_items: sample.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_total: lineTotalOf(line),
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
  const reasons: ReviewReason[] | undefined =
    sample.expected_reasons ?? (sample.printed_total === undefined ? undefined : ['totals_mismatch']);

  const base: SampleExpectation = {
    file: sample.file,
    outcome: reasons === undefined ? 'ok' : 'review',
    path: sample.scanned ? 'vision' : 'text',
    invoice,
    drive_file_name: name,
  };
  return reasons === undefined ? base : { ...base, review_reasons_include: reasons };
}

export function evalExpectations(baseDate: string): SampleExpectation[] {
  return EVAL_SAMPLES.map((sample) => expectationFor(sample, baseDate));
}

export function expectations(baseDate: string): SampleExpectation[] {
  const [firstSample] = SAMPLES;
  if (!firstSample) throw new Error('SAMPLES must list at least the first invoice');

  return [
    ...SAMPLES.map((sample) => expectationFor(sample, baseDate)),
    { file: COPY_OF_FIRST, outcome: 'duplicate', duplicate_of: firstSample.file },
  ];
}
