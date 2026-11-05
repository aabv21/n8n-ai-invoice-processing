// Helpers shared by more than one module, so the date check for file names and the one for
// validation can't drift apart.
import { EMPTY_INVOICE, type NormalizedInvoice } from './invoice.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Postgres's date type rejects year 0000 ("date/time field value out of range"), and no real
// invoice is dated outside this range, so a bad year lands in review instead of failing every save.
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

/** `value` rounded to `scale` decimal places, as a Postgres `numeric(p, scale)` column stores it. */
export function roundTo(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

/** A fresh, independently-mutable empty invoice - never the shared `EMPTY_INVOICE` reference. */
export function emptyInvoice(): NormalizedInvoice {
  return { ...EMPTY_INVOICE, line_items: [] };
}
