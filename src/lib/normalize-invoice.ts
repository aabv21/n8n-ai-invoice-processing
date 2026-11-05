// Turns a raw model reply into a NormalizedInvoice. Every field is normalized independently. A
// missing value (null, undefined, or a blank string) is just that: null, with no review reason. A
// present value that still fails its own format - an impossible date, a non-ISO-4217 currency -
// is null with that field's own review reason.
import type { LineItem, NormalizedInvoice, ReviewReason } from './invoice.ts';
import { emptyInvoice, isPlainObject, isValidIsoDate, roundTo } from './util.ts';

const TAX_ID_LABEL_RE =
  // eslint-disable-next-line security/detect-unsafe-regex -- no nested/overlapping quantifier over the same class; a 10,000-char probe still resolves in under 1ms
  /^\s*(?:n\.?\s?i\.?\s?t|r\.?\s?u\.?\s?t|e\.?\s?i\.?\s?n|t\.?\s?i\.?\s?n|tax\s*id|vat)(?![a-z])[\s.:#]*(?:no(?![a-z])\.?)?[\s.:#]*/i;
// Magdaport is billed only in Colombian pesos or US dollars, so any other ISO 4217 code is invalid.
const ACCEPTED_CURRENCIES = new Set(['COP', 'USD']);
const NO_DESCRIPTION = '(no description)';

// Column ranges in db/schema.sql: an amount at or past one fails the save with "numeric field
// overflow" on every retry, leaving the event stuck instead of reviewed. The bound is checked after
// rounding to the column's scale, since a value just under it can round past it
// (99999999999.9996 is 100000000000.000 in numeric(14,3)).
const SUBTOTAL_TAX_TOTAL_RANGE = { max: 1e16, scale: 2 } as const; // numeric(18,2)
const LINE_TOTAL_RANGE = { max: 1e16, scale: 2 } as const; // numeric(18,2)
const QUANTITY_RANGE = { max: 1e11, scale: 3 } as const; // numeric(14,3)
const UNIT_PRICE_RANGE = { max: 1e14, scale: 4 } as const; // numeric(18,4)

export function normalizeTaxId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutLabel = value.replace(TAX_ID_LABEL_RE, '');
  const kept = withoutLabel.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /\d/.test(kept) ? kept : null;
}

export function normalizeInvoiceNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim().toUpperCase().replace(/\s+/g, '');
  return result === '' ? null : result;
}

/** A plain text field: trimmed, blank (or non-string) becomes null, with no review reason. */
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A date field: missing (`null`/`undefined`/blank) is just missing (no reason); present but not a
 * real `YYYY-MM-DD` date - including a non-string value - is invalid (`reason`).
 */
function normalizeDate(value: unknown, reason: 'invalid_issue_date' | 'invalid_due_date'): { value: string | null; reasons: ReviewReason[] } {
  if (value === null || value === undefined) return { value: null, reasons: [] };
  if (typeof value !== 'string') return { value: null, reasons: [reason] };
  const trimmed = value.trim();
  if (trimmed === '') return { value: null, reasons: [] };
  return isValidIsoDate(trimmed) ? { value: trimmed, reasons: [] } : { value: null, reasons: [reason] };
}

function normalizeCurrency(value: unknown): { value: string | null; reasons: ReviewReason[] } {
  if (value === null || value === undefined) return { value: null, reasons: [] };
  if (typeof value !== 'string') return { value: null, reasons: ['invalid_currency'] };
  const trimmed = value.trim();
  if (trimmed === '') return { value: null, reasons: [] };
  const upper = trimmed.toUpperCase();
  return ACCEPTED_CURRENCIES.has(upper) ? { value: upper, reasons: [] } : { value: null, reasons: ['invalid_currency'] };
}

/** A plain amount, with no column range to check against - never reports amount_out_of_range. */
function normalizeAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * An amount bound to a column's range: at or beyond `range.max` either way, once rounded to
 * `scale`, it's null with a reason. An in-range value is kept unrounded: rounding only checks the
 * bound, it never corrects what the model reported.
 */
function normalizeBoundedAmount(value: unknown, range: { max: number; scale: number }): { value: number | null; reasons: ReviewReason[] } {
  const amount = normalizeAmount(value);
  if (amount === null) return { value: null, reasons: [] };
  return Math.abs(roundTo(amount, range.scale)) < range.max ? { value: amount, reasons: [] } : { value: null, reasons: ['amount_out_of_range'] };
}

function normalizeConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function normalizeLineItems(value: unknown): { items: LineItem[]; reasons: ReviewReason[] } {
  const raw: unknown[] = Array.isArray(value) ? value : [];
  const reasons: ReviewReason[] = [];
  const items = raw.filter(isPlainObject).map((item, index) => {
    const quantity = normalizeBoundedAmount(item.quantity, QUANTITY_RANGE);
    const unitPrice = normalizeBoundedAmount(item.unit_price, UNIT_PRICE_RANGE);
    const lineTotal = normalizeBoundedAmount(item.line_total, LINE_TOTAL_RANGE);
    reasons.push(...quantity.reasons, ...unitPrice.reasons, ...lineTotal.reasons);
    return {
      line_no: index + 1,
      description: normalizeText(item.description) ?? NO_DESCRIPTION,
      quantity: quantity.value,
      unit_price: unitPrice.value,
      line_total: lineTotal.value,
    };
  });
  return { items, reasons };
}

export function normalizeInvoice(raw: unknown): { invoice: NormalizedInvoice; reasons: ReviewReason[] } {
  if (!isPlainObject(raw)) return { invoice: emptyInvoice(), reasons: [] };

  const issueDate = normalizeDate(raw.issue_date, 'invalid_issue_date');
  const dueDate = normalizeDate(raw.due_date, 'invalid_due_date');
  const currency = normalizeCurrency(raw.currency);
  const subtotal = normalizeBoundedAmount(raw.subtotal, SUBTOTAL_TAX_TOTAL_RANGE);
  const tax = normalizeBoundedAmount(raw.tax, SUBTOTAL_TAX_TOTAL_RANGE);
  const total = normalizeBoundedAmount(raw.total, SUBTOTAL_TAX_TOTAL_RANGE);
  const lineItems = normalizeLineItems(raw.line_items);

  const invoice: NormalizedInvoice = {
    supplier: normalizeText(raw.supplier),
    supplier_tax_id: normalizeTaxId(raw.supplier_tax_id),
    invoice_number: normalizeInvoiceNumber(raw.invoice_number),
    issue_date: issueDate.value,
    due_date: dueDate.value,
    currency: currency.value,
    subtotal: subtotal.value,
    tax: tax.value,
    total: total.value,
    line_items: lineItems.items,
    confidence: normalizeConfidence(raw.confidence),
  };

  return {
    invoice,
    reasons: [
      ...issueDate.reasons, ...dueDate.reasons, ...currency.reasons,
      ...subtotal.reasons, ...tax.reasons, ...total.reasons, ...lineItems.reasons,
    ],
  };
}
