// Shared invoice types, in the exact shape the extraction schema, the checks, and every consumer
// (the Code nodes, the SQL tests, and the scenario check) agree on. Pure data: no logic lives here.

export type ReviewReason =
  | 'unparseable_reply'
  | 'reply_truncated'
  | 'model_refused'
  | 'invalid_issue_date'
  | 'invalid_due_date'
  | 'invalid_currency'
  | 'missing_supplier'
  | 'missing_supplier_tax_id'
  | 'missing_invoice_number'
  | 'missing_issue_date'
  | 'missing_currency'
  | 'missing_subtotal'
  | 'missing_tax'
  | 'missing_total'
  | 'due_before_issue'
  | 'issue_date_in_future'
  | 'totals_mismatch'
  | 'line_items_mismatch'
  | 'line_items_incomplete'
  | 'non_positive_total'
  | 'amount_out_of_range'
  | 'low_confidence'
  | 'too_many_pages'
  | 'too_much_text'
  | 'unreadable_pdf';

export interface LineItem {
  line_no: number;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
}

export interface NormalizedInvoice {
  supplier: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  line_items: LineItem[];
  confidence: number | null;
}

// The schema's property names, in schema order (schemas/invoice.schema.json).
export const INVOICE_FIELDS = [
  'supplier',
  'supplier_tax_id',
  'invoice_number',
  'issue_date',
  'due_date',
  'currency',
  'subtotal',
  'tax',
  'total',
  'line_items',
  'confidence',
] as const satisfies readonly (keyof NormalizedInvoice)[];

export const EMPTY_INVOICE: NormalizedInvoice = {
  supplier: null,
  supplier_tax_id: null,
  invoice_number: null,
  issue_date: null,
  due_date: null,
  currency: null,
  subtotal: null,
  tax: null,
  total: null,
  line_items: [],
  confidence: null,
};

export interface ValidationRules {
  totals_tolerance: number;
  min_confidence: number;
}

export interface CheckOutput {
  status: 'ok' | 'review';
  reasons: ReviewReason[];
  invoice: NormalizedInvoice;
  raw: unknown;
  event_id: string;
  received_at: string;
  path: 'text' | 'vision';
  model: string;
  attempt: 1 | 2;
}

export interface InvoiceRecord extends Omit<CheckOutput, 'path' | 'model' | 'attempt'> {
  path: 'text' | 'vision' | 'none';
  model: string | null;
  attempt: 0 | 1 | 2;
  file: { name: string; folder: string };
}
