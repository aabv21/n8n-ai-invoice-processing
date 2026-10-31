// Turns a raw model reply into a NormalizedInvoice. Every field is normalized independently. A
// missing value (null, undefined, or a blank string) is just that: null, with no review reason. A
// present value that still fails its own format - an impossible date, a non-ISO-4217 currency -
// is null with that field's own review reason.
import type { LineItem, NormalizedInvoice, ReviewReason } from './invoice.ts';
import { emptyInvoice, isPlainObject, isValidIsoDate } from './util.ts';

const TAX_ID_LABEL_RE =
  // eslint-disable-next-line security/detect-unsafe-regex -- no nested/overlapping quantifier over the same class; a 10,000-char probe still resolves in under 1ms
  /^\s*(?:n\.?\s?i\.?\s?t|r\.?\s?u\.?\s?t|e\.?\s?i\.?\s?n|t\.?\s?i\.?\s?n|tax\s*id|vat)(?![a-z])[\s.:#]*(?:no(?![a-z])\.?)?[\s.:#]*/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const NO_DESCRIPTION = '(no description)';

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
  return CURRENCY_RE.test(upper) ? { value: upper, reasons: [] } : { value: null, reasons: ['invalid_currency'] };
}

function normalizeAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function normalizeLineItems(value: unknown): LineItem[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.filter(isPlainObject).map((item, index) => ({
    line_no: index + 1,
    description: normalizeText(item.description) ?? NO_DESCRIPTION,
    quantity: normalizeAmount(item.quantity),
    unit_price: normalizeAmount(item.unit_price),
    line_total: normalizeAmount(item.line_total),
  }));
}

export function normalizeInvoice(raw: unknown): { invoice: NormalizedInvoice; reasons: ReviewReason[] } {
  if (!isPlainObject(raw)) return { invoice: emptyInvoice(), reasons: [] };

  const issueDate = normalizeDate(raw.issue_date, 'invalid_issue_date');
  const dueDate = normalizeDate(raw.due_date, 'invalid_due_date');
  const currency = normalizeCurrency(raw.currency);

  const invoice: NormalizedInvoice = {
    supplier: normalizeText(raw.supplier),
    supplier_tax_id: normalizeTaxId(raw.supplier_tax_id),
    invoice_number: normalizeInvoiceNumber(raw.invoice_number),
    issue_date: issueDate.value,
    due_date: dueDate.value,
    currency: currency.value,
    subtotal: normalizeAmount(raw.subtotal),
    tax: normalizeAmount(raw.tax),
    total: normalizeAmount(raw.total),
    line_items: normalizeLineItems(raw.line_items),
    confidence: normalizeConfidence(raw.confidence),
  };

  return { invoice, reasons: [...issueDate.reasons, ...dueDate.reasons, ...currency.reasons] };
}
