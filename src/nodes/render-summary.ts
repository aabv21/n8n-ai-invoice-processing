// Renders the daily summary's subject and HTML body from daily-summary.sql's one row, in the
// team_locale language. Every database value (a supplier name, a review reason, a Drive URL) is
// escaped, URLs included. Pure: no I/O, no clock; Luxon's setLocale and Intl.NumberFormat read none.
import { escapeHtml, formatAiCost, formatMoney } from '../lib/format.ts';
import { STYLE } from '../lib/email-style.ts';
import { reasonLabel, STATUS_LABELS, SUMMARY_STRINGS } from '../lib/strings.ts';

type Locale = 'en' | 'es';
type Strings = (typeof SUMMARY_STRINGS)[Locale];

export interface SummaryRow {
  report_date: string;
  /** Missing means 'en', as in checkConfig. */
  team_locale?: 'en' | 'es';
  arrived: number;
  ok: number;
  review: number;
  duplicates: number;
  /** Every event the query counts as stuck. */
  unfinished: number;
  /** The oldest of those events, up to the query's cap; `received_at` is already Bogota time, `YYYY-MM-DD HH:MM`. */
  unfinished_events: { event_id: string; file_name: string | null; received_at: string }[];
  totals_by_supplier: { supplier: string | null; currency: string | null; invoices: number; total: number | null }[];
  /** The estimated AI cost of every invoice received in the window, in USD. */
  ai_cost_usd: number;
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

/** `numeric[i]` right-aligns column i (money and counts), in the header and in every row. */
function table(headers: string[], numeric: boolean[], rows: string[][]): string {
  const th = headers.map((h, i) => `<th scope="col" style="${numeric.at(i) === true ? STYLE.thNumber : STYLE.th}">${escapeHtml(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td style="${numeric.at(i) === true ? STYLE.tdNumber : STYLE.td}">${c}</td>`).join('')}</tr>`).join('');
  // The wrapper lets a wide table (the five-column review one in Spanish) scroll inside the report
  // on a phone instead of widening the whole message.
  return `<div style="overflow-x:auto;"><table style="${STYLE.table}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 8px;">${text}</p>`;
}

function heading(text: string): string {
  return `<h2 style="${STYLE.h2}">${escapeHtml(text)}</h2>`;
}

/** The ISO date as a long localized date ("November 1, 2026" / "1 de noviembre de 2026"). An
 * unparseable date falls back to the raw string, so it degrades instead of crashing the summary. */
function formatDueDate(iso: string, locale: Locale): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setLocale(locale);
  return dt.isValid ? dt.toFormat('DDD') : iso;
}

/** A PDF link only for an `https://` `drive_url`: a planted `javascript:` or other scheme must
 * never become clickable in the recipient's mail client. The href is escaped too, since an https
 * URL can carry `&` or `"`. The link text names the invoice so a screen reader's link list is not
 * a column of identical "PDF"s. No link, no text: ''. The replacement is a function because the
 * number is data, and a string replacement would read `$&` or `$'` in it as patterns. */
function pdfLink(driveUrl: string | null, invoiceNumber: string | null, t: Strings): string {
  if (driveUrl === null || !driveUrl.startsWith('https://')) return '';
  const text = invoiceNumber === null ? t.pdfLink : t.pdfLinkNumbered.replace('{number}', () => invoiceNumber);
  return `<a href="${escapeHtml(driveUrl)}">${escapeHtml(text)}</a>`;
}

/** `left` and `right` are the two header labels. Each row is a record: `main` (the left cell, several
 * lines) and `side` (the right cell, an amount). Two columns hold at phone width in every mail
 * client without media queries, scrolling or a `<style>` block. */
function recordTable(left: string, right: string, rows: { main: string; side: string }[]): string {
  const body = rows.map((r) => `<tr><td style="${STYLE.tdMain}">${r.main}</td><td style="${STYLE.tdNumber}">${r.side}</td></tr>`).join('');
  return `<table style="${STYLE.table}"><thead><tr><th scope="col" style="${STYLE.th}">${escapeHtml(left)}</th><th scope="col" style="${STYLE.thNumber}">${escapeHtml(right)}</th></tr></thead><tbody>${body}</tbody></table>`;
}

const NOWRAP = 'white-space:nowrap;';

/** Four counters in one row. The Review cell is tinted only when something needs review; its
 * label always shows, so the color is never the only cue. */
export function countersSection(input: SummaryRow, t: Strings, locale: Locale): string {
  const counter = (label: string, value: number, style: string): string =>
    `<td style="${style}"><div style="${STYLE.counterValue}">${String(value)}</div><div style="${STYLE.counterLabel}">${label}</div></td>`;
  return `<table role="presentation" style="${STYLE.table}"><tr>${[
    counter(t.arrived, input.arrived, STYLE.counter),
    counter(t.ok, input.ok, STYLE.counter),
    counter(t.review, input.review, input.review > 0 ? STYLE.counterAlert : STYLE.counter),
    counter(t.duplicates, input.duplicates, STYLE.counter),
  ].join('')}</tr></table>
<p style="${STYLE.aiCost}">${t.aiCost}: ${formatAiCost(input.ai_cost_usd, locale)}</p>`;
}

/** The stuck-events warning, its table, and the "more not shown" line; '' when nothing is stuck. */
export function unfinishedSection(input: SummaryRow, t: Strings): string {
  if (input.unfinished === 0) return '';
  const line = (input.unfinished === 1 ? t.unfinishedOne : t.unfinishedMany).replace('{count}', String(input.unfinished));
  const events =
    input.unfinished_events.length > 0
      ? table(
          [t.unfinishedColumns.file, t.unfinishedColumns.received, t.unfinishedColumns.eventId],
          [false, false, false],
          input.unfinished_events.map((e) => [cell(e.file_name), cell(e.received_at), cell(e.event_id)]),
        )
      : '';
  const notShown = input.unfinished - input.unfinished_events.length;
  return [`<div style="${STYLE.alertBox}">${line}</div>`, events === '' ? '' : heading(t.unfinishedHeading), events, notShown > 0 ? paragraph(t.unfinishedMore.replace('{count}', String(notShown))) : '']
    .filter((part) => part !== '')
    .join('\n');
}

export function reviewSection(input: SummaryRow, t: Strings, locale: Locale): string {
  const body =
    input.review_items.length === 0
      ? paragraph(t.reviewNone)
      : recordTable(
          `${t.reviewColumns.supplier} / ${t.reviewColumns.invoiceNumber}`,
          t.reviewColumns.total,
          input.review_items.map((r) => {
            const link = pdfLink(r.drive_url, r.invoice_number, t);
            const reasons = r.review_reasons.map((reason) => reasonLabel(reason, locale)).join('; ');
            return {
              main: [
                `<strong>${cell(r.supplier)}</strong>`,
                [`<span style="${NOWRAP}">${cell(r.invoice_number)}</span>`, link].filter((part) => part !== '').join(' · '),
                reasons === '' ? '' : `<span style="${STYLE.muted}">${escapeHtml(reasons)}</span>`,
              ].filter((line) => line !== '').map((line) => `<div>${line}</div>`).join(''),
              side: `<span style="${NOWRAP}">${escapeHtml(formatMoney(r.total, r.currency, locale))}</span>`,
            };
          }),
        );
  return `${heading(t.reviewHeading)}\n${body}`;
}

export function totalsSection(input: SummaryRow, t: Strings, locale: Locale): string {
  const body =
    input.totals_by_supplier.length === 0
      ? paragraph(t.none)
      : recordTable(
          t.totalsColumns.supplier,
          t.totalsColumns.total,
          input.totals_by_supplier.map((r) => ({
            main: `<div><strong>${cell(r.supplier)}</strong></div><div style="${STYLE.muted}">${escapeHtml(t.totalsColumns.invoices)}: ${String(r.invoices)}</div>`,
            side: `<span style="${NOWRAP}">${escapeHtml(formatMoney(r.total, r.currency, locale))}</span>`,
          })),
        );
  return `${heading(t.totalsHeading)}\n${body}`;
}

export function dueSection(input: SummaryRow, t: Strings, locale: Locale): string {
  const body =
    input.due_soon.length === 0
      ? paragraph(t.none)
      : recordTable(
          `${t.dueColumns.supplier} / ${t.dueColumns.invoiceNumber}`,
          t.dueColumns.total,
          input.due_soon.map((d) => ({
            main: [
              `<strong>${cell(d.supplier)}</strong>`,
              // eslint-disable-next-line security/detect-object-injection -- locale and status are typed to STATUS_LABELS's own keys, not user input
              `<span style="${NOWRAP}">${cell(d.invoice_number)}</span> · ${escapeHtml(STATUS_LABELS[locale][d.status])}`,
              `<span style="${STYLE.muted}">${escapeHtml(t.dueColumns.due)} ${escapeHtml(formatDueDate(d.due_date, locale))}</span>`,
            ].map((line) => `<div>${line}</div>`).join(''),
            side: `<span style="${NOWRAP}">${escapeHtml(formatMoney(d.total, d.currency, locale))}</span>`,
          })),
        );
  return `${heading(t.dueHeading)}\n${body}`;
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
  const longDate = formatDueDate(input.report_date, locale);

  const stuck = input.unfinished > 0 ? `, ${String(input.unfinished)} ${input.unfinished === 1 ? t.stuckOne : t.stuckMany}` : '';
  const subject = `${t.title}, ${longDate}: ${String(input.arrived)} ${t.subjectArrived}, ${String(input.review)} ${t.subjectReview}${stuck}`;

  // The window is the rolling 24 hours ending at the run, so an empty report never claims "today".
  // Strings-table text skips escapeHtml; only database values need it.
  const html = [
    `<div lang="${locale}" style="${STYLE.wrapper}">`,
    `<h1 style="${STYLE.h1}">${escapeHtml(t.title)}</h1>`,
    `<p style="${STYLE.dateLine}">${escapeHtml(longDate)}</p>`,
    countersSection(input, t, locale),
    unfinishedSection(input, t),
    input.arrived === 0 ? paragraph(t.emptyDay) : '',
    reviewSection(input, t, locale),
    totalsSection(input, t, locale),
    dueSection(input, t, locale),
    `<p style="${STYLE.footer}">${t.footer}</p>`,
    '</div>',
  ]
    .filter((part) => part !== '')
    .join('\n');

  return { subject, html };
}
