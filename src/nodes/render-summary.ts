// Renders the daily summary's subject and HTML body from the one row daily-summary.sql returns.
// Every value it touches came from the database - a supplier name, an invoice number, a review
// reason, a Drive URL - so every value is escaped before it reaches the HTML, URLs included.
// Pure: no I/O, no clock.
import { escapeHtml, formatMoney } from '../lib/format.ts';

export interface SummaryRow {
  report_date: string;
  arrived: number;
  ok: number;
  review: number;
  duplicates: number;
  unfinished: number;
  totals_by_supplier: { supplier: string | null; currency: string | null; invoices: number; total: number | null }[];
  review_items: {
    supplier: string | null;
    invoice_number: string | null;
    currency: string | null;
    total: number | null;
    review_reasons: string[];
    drive_url: string | null;
  }[];
  due_soon: {
    supplier: string | null;
    invoice_number: string | null;
    due_date: string;
    currency: string | null;
    total: number | null;
    status: 'ok' | 'review';
  }[];
}

/** `text`, escaped, or an em dash when it's null - never an empty cell with no explanation. */
function cell(text: string | null): string {
  return text === null ? '—' : escapeHtml(text);
}

function row(cells: string[]): string {
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<p>None.</p>';
  const head = `<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  return `<table><thead>${head}</thead><tbody>${rows.map(row).join('')}</tbody></table>`;
}

/** A PDF link only when `drive_url` is an `https://` URL - a planted `javascript:` or other
 * scheme in the database must never become a clickable link in the recipient's mail client. The
 * href is escaped like any other attribute value, since an https URL can still carry `&` or `"`.
 * No link renders `cell()`'s own placeholder, not a silently blank cell. */
function pdfLink(driveUrl: string | null): string {
  if (driveUrl === null || !driveUrl.startsWith('https://')) return cell(null);
  const escaped = escapeHtml(driveUrl);
  return `<a href="${escaped}">PDF</a>`;
}

export function run(input: SummaryRow): { subject: string; html: string } {
  // The query's own WITH bounds always computes a report_date from $1, so null here means $1 was
  // itself missing or malformed - make that failure obvious instead of crashing inside escapeHtml.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- report_date is typed as string, but the query's real output isn't type-checked at runtime
  if (input.report_date === null || input.report_date === '') {
    throw new Error('Daily summary: the query returned no report_date; run_at is missing or invalid');
  }

  const subject = `Magdaport invoices ${input.report_date}: ${String(input.arrived)} arrived, ${String(input.review)} to review`;

  const counts = `<p>Arrived: ${String(input.arrived)} | OK: ${String(input.ok)} | Review: ${String(input.review)} | Duplicates: ${String(input.duplicates)}</p>`;

  const unfinishedLine =
    input.unfinished > 0
      ? `<p>${String(input.unfinished)} invoice${input.unfinished === 1 ? '' : 's'} did not finish processing. See n8n's failed executions, or the README's recovery steps for stuck events.</p>`
      : '';

  // The window is rolling (the 24 hours ending at the run's timestamp), not the calendar day, so
  // an empty report never claims "today" - the report could have been run at any hour.
  const emptyDayLine = input.arrived === 0 ? '<p>No invoices arrived in the last 24 hours.</p>' : '';

  const totalsTable = table(
    ['Supplier', 'Currency', 'Invoices', 'Total'],
    input.totals_by_supplier.map((t) => [cell(t.supplier), cell(t.currency), String(t.invoices), escapeHtml(formatMoney(t.total, t.currency))]),
  );

  const reviewTable = table(
    ['Supplier', 'Invoice #', 'Total', 'Reasons', ''],
    input.review_items.map((r) => [
      cell(r.supplier),
      cell(r.invoice_number),
      escapeHtml(formatMoney(r.total, r.currency)),
      escapeHtml(r.review_reasons.join(', ')),
      pdfLink(r.drive_url),
    ]),
  );

  const dueTable = table(
    ['Supplier', 'Invoice #', 'Due', 'Total', 'Status'],
    input.due_soon.map((d) => [cell(d.supplier), cell(d.invoice_number), escapeHtml(d.due_date), escapeHtml(formatMoney(d.total, d.currency)), escapeHtml(d.status)]),
  );

  const html = [
    `<h1>Magdaport invoices: ${escapeHtml(input.report_date)}</h1>`,
    counts,
    unfinishedLine,
    emptyDayLine,
    '<h2>Totals by supplier</h2>',
    totalsTable,
    '<h2>Review items</h2>',
    reviewTable,
    '<h2>Due in the next 7 days</h2>',
    dueTable,
  ]
    .filter((part) => part !== '')
    .join('\n');

  return { subject, html };
}
