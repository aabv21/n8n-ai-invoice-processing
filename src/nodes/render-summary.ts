// Renders the daily summary's subject and HTML body from the one row daily-summary.sql returns,
// in the language `team_locale` names. Every value it touches came from the database -
// a supplier name, an invoice number, a review reason, a Drive URL - so every value is escaped
// before it reaches the HTML, URLs included, in either language. Pure: no I/O, no clock (dates and
// money are formatted with Luxon's setLocale and Intl.NumberFormat, both locale tables, no clock
// read of their own).
import { escapeHtml, formatMoney } from '../lib/format.ts';
import { SUMMARY_STRINGS } from '../lib/strings.ts';

export interface SummaryRow {
  report_date: string;
  /** The team's own email language; missing means 'en', the same default checkConfig applies. */
  team_locale?: 'en' | 'es';
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

/** `text`, escaped, or an em dash when it's null - never an empty cell with no explanation. The
 * placeholder itself carries no words, so it needs no locale. */
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

/** The ISO (YYYY-MM-DD) due date as a long localized date (e.g. "November 1, 2026" / "1 de
 * noviembre de 2026"), via Luxon's setLocale - never a hand-rolled month-name table. Falls back to
 * the raw ISO string if the date somehow fails to parse, so a bad value degrades instead of
 * crashing the whole summary. */
function formatDueDate(iso: string, locale: 'en' | 'es'): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setLocale(locale);
  return dt.isValid ? dt.toFormat('DDD') : iso;
}

/** A PDF link only when `drive_url` is an `https://` URL - a planted `javascript:` or other
 * scheme in the database must never become a clickable link in the recipient's mail client. The
 * href is escaped like any other attribute value, since an https URL can still carry `&` or `"`.
 * No link renders `cell()`'s own placeholder, not a silently blank cell. The link text ("PDF") is
 * the same word in both languages, but still comes from the strings table, not a literal. */
function pdfLink(driveUrl: string | null, linkText: string): string {
  if (driveUrl === null || !driveUrl.startsWith('https://')) return cell(null);
  const escaped = escapeHtml(driveUrl);
  return `<a href="${escaped}">${escapeHtml(linkText)}</a>`;
}

export function run(input: SummaryRow): { subject: string; html: string } {
  // The query's own WITH bounds always computes a report_date from $1, so null here means $1 was
  // itself missing or malformed - make that failure obvious instead of crashing inside escapeHtml.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- report_date is typed as string, but the query's real output isn't type-checked at runtime
  if (input.report_date === null || input.report_date === '') {
    throw new Error('Daily summary: the query returned no report_date; run_at is missing or invalid');
  }

  // Missing means 'en', the same default checkConfig applies to a config predating this field.
  const locale = input.team_locale ?? 'en';
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to SUMMARY_STRINGS's own two keys, not user input
  const t = SUMMARY_STRINGS[locale];

  const subject = `${t.title} ${input.report_date}: ${String(input.arrived)} ${t.subjectArrived}, ${String(input.review)} ${t.subjectReview}`;

  const counts = `<p>${t.arrived}: ${String(input.arrived)} | ${t.ok}: ${String(input.ok)} | ${t.review}: ${String(input.review)} | ${t.duplicates}: ${String(input.duplicates)}</p>`;

  // These two lines come from the strings table, not the database, so - like the heading and
  // section titles below - they're trusted text and never pass through escapeHtml (only a
  // database-sourced value, or an attribute value built from one, needs that).
  const unfinishedLine =
    input.unfinished > 0 ? `<p>${(input.unfinished === 1 ? t.unfinishedOne : t.unfinishedMany).replace('{count}', String(input.unfinished))}</p>` : '';

  // The window is rolling (the 24 hours ending at the run's timestamp), not the calendar day, so
  // an empty report never claims "today" - the report could have been run at any hour.
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
