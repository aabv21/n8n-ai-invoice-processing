// Small helpers shared by more than one lib/node module, kept here once so the date check used
// for file names and the one used for validation can never drift apart.
import { EMPTY_INVOICE, type NormalizedInvoice } from './invoice.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Postgres's date type rejects year 0000 outright ("date/time field value out of range"), and no
// invoice this pipeline will ever see is genuinely dated outside this range; a model echoing a
// corrupted or out-of-range year lands in review instead of failing the save on every retry.
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** True when `iso` is exactly `YYYY-MM-DD`, names a real calendar date, and falls in a sane year range. */
export function isValidIsoDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  return DateTime.fromObject({ year, month, day }).isValid;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` rounded to `scale` decimal places - the precision a Postgres `numeric(p, scale)` column actually stores, which can round a value up past a bound a raw comparison would have let through. */
export function roundTo(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

/** A fresh, independently-mutable empty invoice - never the shared `EMPTY_INVOICE` reference. */
export function emptyInvoice(): NormalizedInvoice {
  return { ...EMPTY_INVOICE, line_items: [] };
}
