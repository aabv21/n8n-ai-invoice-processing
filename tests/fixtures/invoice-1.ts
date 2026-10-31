// Sample invoice #1 (Bolsamar Empaques S.A.S., BE-2041), reused across this repo's invoice tests.
// The NIT's check digit deliberately fails the DIAN algorithm, so it can't belong to a real
// taxpayer.
import type { NormalizedInvoice, ValidationRules } from '../../src/lib/invoice.ts';

/** The invoice once normalized: every field in its clean, check-ready form. */
export const VALID_INVOICE: NormalizedInvoice = {
  supplier: 'Bolsamar Empaques S.A.S.',
  supplier_tax_id: '9013845522',
  invoice_number: 'BE-2041',
  issue_date: '2026-10-02',
  due_date: '2026-11-01',
  currency: 'COP',
  subtotal: 1_750_000,
  tax: 332_500,
  total: 2_082_500,
  line_items: [
    { line_no: 1, description: 'Corrugated box 40x30x30 cm', quantity: 500, unit_price: 1_800, line_total: 900_000 },
    { line_no: 2, description: 'Stretch film roll 50 cm x 300 m', quantity: 20, unit_price: 42_500, line_total: 850_000 },
  ],
  confidence: 0.95,
};

/** The same invoice the way a model returns it: an unnormalized tax ID, and line items with no line_no. */
export const INVOICE_1_RAW = {
  supplier: 'Bolsamar Empaques S.A.S.',
  supplier_tax_id: '901.384.552-2',
  invoice_number: 'BE-2041',
  issue_date: '2026-10-02',
  due_date: '2026-11-01',
  currency: 'COP',
  subtotal: 1_750_000,
  tax: 332_500,
  total: 2_082_500,
  line_items: [
    { description: 'Corrugated box 40x30x30 cm', quantity: 500, unit_price: 1_800, line_total: 900_000 },
    { description: 'Stretch film roll 50 cm x 300 m', quantity: 20, unit_price: 42_500, line_total: 850_000 },
  ],
  confidence: 0.95,
};

export const RULES: ValidationRules = { totals_tolerance: 1, min_confidence: 0.8 };
export const TODAY = '2026-10-30';
