// Renders the daily summary's subject and HTML body from daily-summary.sql's one row, in the
// team_locale language. Every database value (a supplier name, a review reason, a Drive URL) is
// escaped, URLs included. Pure: no I/O, no clock; Luxon's setLocale and Intl.NumberFormat read none.
import { escapeHtml, formatMoney } from '../lib/format.ts';
import { SUMMARY_STRINGS } from '../lib/strings.ts';

export interface SummaryRow {
  report_date: string;
  /** Missing means 'en', as in checkConfig. */
  team_locale?: 'en' | 'es';
  arrived: number;
  ok: number;
  review: number;
  duplicates: number;
  /** Every event still without an outcome 30 minutes before the run, however old. */
  unfinished: number;
  /** The oldest of those events, at most 20; `received_at` is already Bogota time, `YYYY-MM-DD HH:MM`. */
  unfinished_events: { event_id: string; file_name: string | null; received_at: string }[];
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

/** `text`, escaped, or an em dash when it's null, never a blank cell. The dash needs no locale. */
function cell(text: string | null): string {
  return text === null ? '—' : escapeHtml(text);
}

function row(cells: string[]): string {
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

function table(headers: string[], rows: string[][], none: string): string {
  if (rows.length === 0) return `<p>${escapeHtml(none)}</p>`;
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  return `<table><thead>${head}</thead><tbody>${rows.map(row).join('')}</tbody></table>`;
}

/** The ISO due date as a long localized date ("November 1, 2026" / "1 de noviembre de 2026"). An
 * unparseable date falls back to the raw string, so it degrades instead of crashing the summary. */
function formatDueDate(iso: string, locale: 'en' | 'es'): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setLocale(locale);
  return dt.isValid ? dt.toFormat('DDD') : iso;
}

/** A PDF link only for an `https://` `drive_url`: a planted `javascript:` or other scheme must
 * never become clickable in the recipient's mail client. The href is escaped too, since an https
 * URL can carry `&` or `"`. No link renders `cell()`'s placeholder. */
function pdfLink(driveUrl: string | null, linkText: string): string {
  if (driveUrl === null || !driveUrl.startsWith('https://')) return cell(null);
  const escaped = escapeHtml(driveUrl);
  return `<a href="${escaped}">${escapeHtml(linkText)}</a>`;
}

export function run(input: SummaryRow): { subject: string; html: string } {
  // The query always computes report_date from run_at, so null means run_at was missing or
  // malformed: fail clearly here instead of inside escapeHtml.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- report_date is typed as string, but the query's real output isn't type-checked at runtime
  if (input.report_date === null || input.report_date === '') {
    throw new Error('Daily summary: the query returned no report_date; run_at is missing or invalid');
  }

  const locale = input.team_locale ?? 'en';
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to SUMMARY_STRINGS's own two keys, not user input
  const t = SUMMARY_STRINGS[locale];

  const subject = `${t.title} ${input.report_date}: ${String(input.arrived)} ${t.subjectArrived}, ${String(input.review)} ${t.subjectReview}`;

  const counts = `<p>${t.arrived}: ${String(input.arrived)} | ${t.ok}: ${String(input.ok)} | ${t.review}: ${String(input.review)} | ${t.duplicates}: ${String(input.duplicates)}</p>`;

  // Strings-table text, like the headings below, is trusted and skips escapeHtml; only database
  // values need it.
  const unfinishedLine =
    input.unfinished > 0 ? `<p>${(input.unfinished === 1 ? t.unfinishedOne : t.unfinishedMany).replace('{count}', String(input.unfinished))}</p>` : '';
  const unfinishedTable =
    input.unfinished_events.length > 0
      ? table(
          [t.unfinishedColumns.file, t.unfinishedColumns.received, t.unfinishedColumns.eventId],
          input.unfinished_events.map((e) => [cell(e.file_name), cell(e.received_at), cell(e.event_id)]),
          t.none,
        )
      : '';
  const notShown = input.unfinished - input.unfinished_events.length;
  const unfinishedMoreLine = notShown > 0 ? `<p>${t.unfinishedMore.replace('{count}', String(notShown))}</p>` : '';

  // The window is the rolling 24 hours ending at the run, so an empty report never claims "today".
  const emptyDayLine = input.arrived === 0 ? `<p>${t.emptyDay}</p>` : '';

  const totalsTable = table(
    [t.totalsColumns.supplier, t.totalsColumns.currency, t.totalsColumns.invoices, t.totalsColumns.total],
    input.totals_by_supplier.map((row2) => [cell(row2.supplier), cell(row2.currency), String(row2.invoices), escapeHtml(formatMoney(row2.total, row2.currency, locale))]),
    t.none,
  );

  const reviewTable = table(
    [t.reviewColumns.supplier, t.reviewColumns.invoiceNumber, t.reviewColumns.total, t.reviewColumns.reasons, ''],
    input.review_items.map((r) => [
      cell(r.supplier),
      cell(r.invoice_number),
      escapeHtml(formatMoney(r.total, r.currency, locale)),
      escapeHtml(r.review_reasons.join(', ')),
      pdfLink(r.drive_url, t.pdfLink),
    ]),
    t.none,
  );

  const dueTable = table(
    [t.dueColumns.supplier, t.dueColumns.invoiceNumber, t.dueColumns.due, t.dueColumns.total, t.dueColumns.status],
    input.due_soon.map((d) => [cell(d.supplier), cell(d.invoice_number), escapeHtml(formatDueDate(d.due_date, locale)), escapeHtml(formatMoney(d.total, d.currency, locale)), escapeHtml(d.status)]),
    t.none,
  );

  const html = [
    `<h1>${escapeHtml(t.title)}: ${escapeHtml(input.report_date)}</h1>`,
    counts,
    unfinishedLine,
    unfinishedTable,
    unfinishedMoreLine,
    emptyDayLine,
    `<h2>${escapeHtml(t.totalsHeading)}</h2>`,
    totalsTable,
    `<h2>${escapeHtml(t.reviewHeading)}</h2>`,
    reviewTable,
    `<h2>${escapeHtml(t.dueHeading)}</h2>`,
    dueTable,
  ]
    .filter((part) => part !== '')
    .join('\n');

  return { subject, html };
}
