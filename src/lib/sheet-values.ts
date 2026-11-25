// Reads the cells a reviewer edits in the Invoices tab. The Sheets values API returns unformatted
// values, so a date cell arrives as a serial number and a numeric-looking text cell as a number.

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** A finite number is a Sheets serial (days since 1899-12-30, UTC), returned as `YYYY-MM-DD`; a string is trimmed; anything else is returned as is. */
export function sheetDate(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * MS_PER_DAY).toISOString().slice(0, 10);
  }
  return typeof value === 'string' ? value.trim() : value;
}

/** A string or a finite number as trimmed text; blank or anything else is null. */
export function sheetText(value: unknown): string | null {
  const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}
