// Builds the Drive file name and year/month folder for a processed invoice. Uses the printed
// issue date when it's a real calendar date; otherwise falls back to the Gmail receive time
// converted to Bogota, since Colombian invoices arrive in UTC-tagged email metadata but are
// filed by the business's own calendar day.
import { isValidIsoDate } from './util.ts';

const SUPPLIER_SLUG_MAX = 40;
const NUMBER_SLUG_MAX = 30;

/** Deletes `.`/`'`, strips accents (NFKD), lowercases, then collapses every other non-alnum run to one `-`. */
function slug(text: string): string {
  return text
    .replace(/['.]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Slugifies, cuts to `max` characters, and trims any dash the cut exposed. */
function cutSlug(text: string, max: number): string {
  return slug(text).slice(0, max).replace(/^-+|-+$/g, '');
}

export function invoiceFileName(input: {
  issue_date: string | null;
  supplier: string | null;
  invoice_number: string | null;
  received_at: string;
  event_id: string;
}): { name: string; folder: string } {
  const date =
    input.issue_date !== null && isValidIsoDate(input.issue_date)
      ? input.issue_date
      : DateTime.fromISO(input.received_at, { zone: 'utc' }).setZone('America/Bogota').toISODate();
  if (date === null) throw new Error(`received_at is not a valid timestamp: ${input.received_at}`);

  const supplierSlug = cutSlug(input.supplier ?? '', SUPPLIER_SLUG_MAX) || 'unknown-supplier';
  const numberSlug = cutSlug(input.invoice_number ?? '', NUMBER_SLUG_MAX) || `msg-${slug(input.event_id)}`;
  const folder = `${date.slice(0, 4)}/${date.slice(5, 7)}`;

  return { name: `${date}_${supplierSlug}_${numberSlug}.pdf`, folder };
}
