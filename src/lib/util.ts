// Small helpers shared by more than one lib/node module, kept here once so the date check used
// for file names and the one used for validation can never drift apart.
import { EMPTY_INVOICE, type NormalizedInvoice } from './invoice.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `iso` is exactly `YYYY-MM-DD` and names a real calendar date. */
export function isValidIsoDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return DateTime.fromObject({ year, month, day }).isValid;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A fresh, independently-mutable empty invoice - never the shared `EMPTY_INVOICE` reference. */
export function emptyInvoice(): NormalizedInvoice {
  return { ...EMPTY_INVOICE, line_items: [] };
}
