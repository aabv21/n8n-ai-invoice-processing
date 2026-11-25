import { expect, test } from 'vitest';
import type { SummaryRow } from '../../src/nodes/render-summary.ts';
import { run } from '../../src/nodes/render-summary.ts';
import { STYLE } from '../../src/lib/email-style.ts';
import { isSummaryPreview } from '../../scripts/check-dev-response.ts';

const day: SummaryRow = {
  report_date: '2026-10-30', arrived: 6, ok: 4, review: 1, duplicates: 1, unfinished: 0, unfinished_events: [],
  totals_by_supplier: [
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'COP', invoices: 1, total: 2082500 },
    { supplier: 'Brackenport Supply LLC', currency: 'USD', invoices: 1, total: 2191 }],
  review_items: [{ supplier: 'Marbetaria S.A.S.', invoice_number: 'MB-5520', currency: 'COP', total: 1416600,
    review_reasons: ['totals_mismatch'], drive_url: 'https://drive.google.com/file/d/abc/view' }],
  due_soon: [{ supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041', due_date: '2026-11-01', currency: 'COP', total: 2082500, status: 'ok' }],
  ai_cost_usd: 0.04,
};
test('summarizes the day in the subject', () =>
  expect(run(day).subject).toBe('Magdaport invoices, October 30, 2026: 6 arrived, 1 to review'));
test('shows the counts', () => {
  for (const s of ['>6</div>', '>4</div>', '>1</div>']) expect(run(day).html).toContain(s);
  for (const s of ['Arrived', 'Processed', 'Review', 'Duplicates']) expect(run(day).html).toContain(`>${s}</div>`);
});
test("shows the day's estimated AI cost in both languages", () => {
  expect(run(day).html).toContain('Estimated AI cost: USD 0.04');
  expect(run({ ...day, team_locale: 'es' }).html).toContain('Costo estimado de IA: USD 0,04');
});
test('a day of small AI cost shows more than two decimals', () =>
  expect(run({ ...day, ai_cost_usd: 0.0042 }).html).toContain('Estimated AI cost: USD 0.0042'));
test('formats COP without decimals and USD with cents', () => {
  expect(run(day).html).toContain('COP 2,082,500');
  expect(run(day).html).toContain('USD 2,191.00');
});
test('keeps currencies apart for the same supplier', () => {
  const html = run({ ...day, totals_by_supplier: [
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'COP', invoices: 1, total: 1000000 },
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'USD', invoices: 1, total: 500.5 }] }).html;
  expect(html).toContain('COP 1,000,000');
  expect(html).toContain('USD 500.50');
  expect(html).not.toContain('1,000,500');
});
test('escapes text that came from invoices', () => {
  const html = run({ ...day, review_items: [{ ...day.review_items[0]!, supplier: 'S&S <Distribuciones> "Ltda"', invoice_number: '<b>7</b>' }] }).html;
  expect(html).toContain('S&amp;S &lt;Distribuciones&gt; &quot;Ltda&quot;');
  expect(html).toContain('&lt;b&gt;7&lt;/b&gt;');
  expect(html).not.toContain('<Distribuciones>');
});
test('lists review reasons and links the PDF', () => {
  expect(run(day).html).toContain('Subtotal plus tax doesn&#39;t match the total');
  expect(run(day).html).toContain('<a href="https://drive.google.com/file/d/abc/view">');
});
// One cell per review row holds the supplier, the invoice number with its PDF link, and the
// reasons, so a phone never has to scroll sideways to reach the link.
test('puts the supplier, the PDF link and the reasons in the same cell', () => {
  const html = run(day).html;
  const notEnd = '(?:(?!</td>)[\\s\\S])*';
  expect(html).toMatch(new RegExp(`<td[^>]*><div><strong>Marbetaria S\\.A\\.S\\.</strong>${notEnd}<a href="https://drive.google.com/file/d/abc/view">PDF, No\\. MB-5520</a>${notEnd}Subtotal plus tax${notEnd}</td>`));
  // The total is the only other cell of the row, right-aligned and unbroken.
  expect(html).toMatch(/text-align:right;white-space:nowrap;"><span style="white-space:nowrap;">COP 1,416,600<\/span><\/td>/);
});
test('no table in the email has more than two columns in the review and due lists', () => {
  const html = run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html;
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    expect((table.match(/<th[\s>]/g) ?? []).length).toBeLessThanOrEqual(4);
  }
  const review = html.slice(html.indexOf('Invoices to review'), html.indexOf('Totals by supplier'));
  expect(review.match(/<th[\s>]/g)).toHaveLength(2);
  const due = html.slice(html.indexOf('Due in the next 7 days'));
  expect(due.match(/<th[\s>]/g)).toHaveLength(2);
});
test('uses no style block, media query or overflow wrapper in the review and due lists', () => {
  const html = run(day).html;
  expect(html).not.toContain('<style');
  expect(html).not.toContain('@media');
  const lists = html.slice(html.indexOf('Invoices to review'), html.indexOf('Totals by supplier')) + html.slice(html.indexOf('Due in the next 7 days'));
  expect(lists).not.toContain('overflow');
});
test('the due list shows the number and status under the supplier, and the total over the date', () => {
  const html = run(day).html;
  const due = html.slice(html.indexOf('Due in the next 7 days'));
  expect(due).toMatch(/<strong>Bolsamar Empaques S\.A\.S\.<\/strong>[\s\S]*?BE-2041[\s\S]*?Processed[\s\S]*?<\/td>/);
  // The long due date is a line of the same cell, so the amount column stays as narrow as the amount.
  expect(due).toMatch(/BE-2041[\s\S]*?Processed[\s\S]*?Due November 1, 2026[\s\S]*?<\/td>/);
  expect(due.match(/<th[\s>]/g)).toHaveLength(2);
  expect(due).toContain('>Total</th>');
});
test('the totals table has no currency column, since every amount carries its currency', () => {
  const html = run(day).html;
  const totals = html.slice(html.indexOf('Totals by supplier'), html.indexOf('Due in the next 7 days'));
  expect(totals.match(/<th[\s>]/g)).toHaveLength(2);
  expect(totals).not.toContain('>Currency</th>');
  // The invoice count is a line under the supplier, so a long supplier name keeps the full width.
  expect(totals).toMatch(/<strong>Bolsamar Empaques S\.A\.S\.<\/strong>[\s\S]*?Invoices: 1[\s\S]*?<\/td>/);
  expect(run({ ...day, team_locale: 'es' }).html).not.toContain('>Moneda</th>');
});
test('the review list headers name what each column holds', () => {
  const en = run(day).html;
  expect(en).toContain('>Supplier / Invoice number</th>');
  expect(en).not.toContain('Invoice #');
  expect(run({ ...day, team_locale: 'es' }).html).toContain('>Proveedor / N.º de factura</th>');
});
// Only an https:// drive_url becomes a link, so a planted javascript: URL can't run in the
// recipient's mail client. No link means no link text at all.
test('renders no link for a non-https drive_url', () => {
  const html = run({ ...day, review_items: [{ ...day.review_items[0]!, drive_url: 'javascript:alert(1)' }] }).html;
  expect(html).not.toContain('javascript:alert(1)');
  expect(html).not.toContain('<a ');
  expect(html).toContain('MB-5520');
});
test('renders no link for a null drive_url', () => {
  expect(run({ ...day, review_items: [{ ...day.review_items[0]!, drive_url: null }] }).html).not.toContain('<a ');
});
test('renders a dash for a review row with no invoice number and no link', () => {
  const html = run({ ...day, review_items: [{ ...day.review_items[0]!, invoice_number: null, drive_url: null }] }).html;
  expect(html).toContain('>—</span>');
});
test('still sends a summary on an empty day', () => {
  const out = run({ ...day, arrived: 0, ok: 0, review: 0, duplicates: 0, totals_by_supplier: [], review_items: [], due_soon: [] });
  expect(out.subject).toBe('Magdaport invoices, October 30, 2026: 0 arrived, 0 to review');
  // The window is the rolling 24 hours ending at the run, so the empty-day line must not claim "today".
  expect(out.html).toContain('No invoices arrived in the last 24 hours.');
});
test.each([[1, '1 invoice did not finish processing.'], [2, '2 invoices did not finish processing.']])(
  'warns about %i unfinished', (n, line) => expect(run({ ...day, unfinished: n }).html).toContain(
    `${line} Open n8n's failed executions, fix the cause, and retry them.`));

const stuck = (i: number, fileName: string | null = `stuck-${String(i)}.pdf`) =>
  ({ event_id: `stuck-${String(i)}:attachment_0`, file_name: fileName, received_at: '2026-10-30 16:00' });

test('lists unfinished events with their file and Bogota time', () => {
  const html = run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html;
  for (const h of ['File', 'Received (Bogota)', 'Event ID']) expect(html).toContain(`>${h}</th>`);
  for (const c of ['stuck-1.pdf', '2026-10-30 16:00', 'stuck-1:attachment_0']) expect(html).toContain(`>${c}</td>`);
  // The table sits directly under the unfinished line.
  expect(html).toMatch(/retry them\.<\/div>\n<h2[^>]*>Stuck invoices<\/h2>\n<div[^>]*><table[^>]*><thead><tr><th/);
});
test("escapes an unfinished event's file name", () => {
  const html = run({ ...day, unfinished: 1, unfinished_events: [stuck(1, '<img src=x>.pdf')] }).html;
  expect(html).toContain('>&lt;img src=x&gt;.pdf</td>');
  expect(html).not.toContain('<img src=x>');
});
test('renders a placeholder for an unfinished event with no file name', () =>
  expect(run({ ...day, unfinished: 1, unfinished_events: [stuck(1, null)] }).html).toContain('<tr><td style="padding:8px;border-bottom:1px solid #e4e7eb;vertical-align:top;">—</td>'));
test('caps the unfinished list at 20 and says how many more', () => {
  const events = Array.from({ length: 20 }, (_, i) => stuck(i));
  const html = run({ ...day, unfinished: 25, unfinished_events: events }).html;
  expect(html.match(/>stuck-\d+:attachment_0<\/td>/g)).toHaveLength(20);
  expect(html).toContain('>5 more not shown.</p>');
  expect(run({ ...day, team_locale: 'es', unfinished: 25, unfinished_events: events }).html).toContain('>5 más sin mostrar.</p>');
});
test('says nothing more when the whole unfinished list is shown', () =>
  expect(run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html).not.toContain('more not shown'));
test("tells the reader to retry n8n's failed executions, in both languages", () => {
  const en = run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html;
  expect(en).toContain("1 invoice did not finish processing. Open n8n's failed executions, fix the cause, and retry them.");
  expect(en).not.toContain('AGENTS.md');
  const es = run({ ...day, team_locale: 'es', unfinished: 1, unfinished_events: [stuck(1)] }).html;
  expect(es).toContain('Una factura no terminó de procesarse. Abra las ejecuciones fallidas en n8n, corrija la causa y reinténtelas.');
  expect(es).not.toContain('AGENTS.md');
  for (const h of ['Archivo', 'Recibido (Bogotá)', 'ID del evento']) expect(es).toContain(`>${h}</th>`);
  expect(es).not.toContain('README');
});
test('renders no unfinished table when there are none', () => {
  const out = run({ ...day, report_date: '2026-06-15', arrived: 0, ok: 0, review: 0, duplicates: 0, totals_by_supplier: [], review_items: [], due_soon: [], ai_cost_usd: 0 });
  expect(isSummaryPreview(out)).toBe(true);
  expect(out.html).not.toContain('>File</th>');
  // Byte for byte what scripts/check-dev-response.ts gets back from an empty database.
  const p = 'margin:0 0 8px;';
  const h2 = (text: string): string => `<h2 style="${STYLE.h2}">${text}</h2>`;
  const counter = (value: string, label: string): string =>
    `<td style="${STYLE.counter}"><div style="${STYLE.counterValue}">${value}</div><div style="${STYLE.counterLabel}">${label}</div></td>`;
  expect(out.html).toBe([
    `<div lang="en" style="${STYLE.wrapper}">`,
    `<h1 style="${STYLE.h1}">Magdaport invoices</h1>`,
    `<p style="${STYLE.dateLine}">June 15, 2026</p>`,
    `<table role="presentation" style="${STYLE.table}"><tr>${counter('0', 'Arrived')}${counter('0', 'Processed')}${counter('0', 'Review')}${counter('0', 'Duplicates')}</tr></table>`,
    `<p style="${STYLE.aiCost}">Estimated AI cost: USD 0.00</p>`,
    `<p style="${p}">No invoices arrived in the last 24 hours.</p>`,
    h2('Invoices to review'),
    `<p style="${p}">Nothing needs review.</p>`,
    h2('Totals by supplier'),
    `<p style="${p}">None.</p>`,
    h2('Due in the next 7 days'),
    `<p style="${p}">None.</p>`,
    `<p style="${STYLE.footer}">This report covers the 24 hours before it was generated.</p>`,
    '</div>',
  ].join('\n'));
});

// A missing or invalid run_at makes the query return report_date: null, which would otherwise
// crash inside escapeHtml with no clear reason.
test('throws a clear error instead of crashing when report_date is missing', () => {
  expect(() => run({ ...day, report_date: null as unknown as string })).toThrow(
    'Daily summary: the query returned no report_date; run_at is missing or invalid');
});

// A missing team_locale (an older config, or a caller that forgot it) renders in English, as in
// checkConfig.
test('renders in English when team_locale is missing, matching the default', () => {
  const html = run(day).html;
  expect(html).toContain('>Magdaport invoices</h1>');
  expect(html).toContain('Totals by supplier');
});

test('renders the Spanish subject and headings when team_locale is es', () => {
  const out = run({ ...day, team_locale: 'es' });
  expect(out.subject).toBe('Facturas Magdaport, 30 de octubre de 2026: 6 recibidas, 1 por revisar');
  expect(out.html).toContain('>Facturas Magdaport</h1>');
  expect(out.html).toContain('>Recibidas</div>');
  expect(out.html).toContain('Totales por proveedor');
  expect(out.html).toContain('>Facturas por revisar</h2>');
  expect(out.html).toContain('Vencen en los próximos 7 días');
  expect(out.html).toContain('>Proveedor</th>');
  expect(out.html).toContain('>Proveedor / N.º de factura</th>');
});

test('renders the Spanish empty-day line', () => {
  const out = run({ ...day, team_locale: 'es', arrived: 0, ok: 0, review: 0, duplicates: 0, totals_by_supplier: [], review_items: [], due_soon: [] });
  expect(out.html).toContain('No llegaron facturas en las últimas 24 horas.');
});

test.each([
  [1, 'Una factura no terminó de procesarse.'],
  [2, '2 facturas no terminaron de procesarse.'],
])('renders the Spanish unfinished line for %i', (n, line) =>
  expect(run({ ...day, team_locale: 'es', unfinished: n }).html).toContain(
    `${line} Abra las ejecuciones fallidas en n8n, corrija la causa y reinténtelas.`));

test('formats COP and USD totals with Spanish (es-CO) separators', () => {
  const html = run({ ...day, team_locale: 'es' }).html;
  // es-CO uses '.' as the thousands separator and ',' as the decimal separator.
  expect(html).toContain('COP 2.082.500');
  expect(html).toContain('USD 2.191,00');
});

test('formats the due date in Spanish long form', () => {
  const html = run({ ...day, team_locale: 'es' }).html;
  expect(html).toContain('1 de noviembre de 2026');
});

test('formats the due date in English long form by default', () => {
  const html = run(day).html;
  expect(html).toContain('November 1, 2026');
});

// Escaping must not depend on the locale: a planted <script> in a supplier name is neutralized
// the same way whether the email renders in English or Spanish.
test('escaping is unchanged in Spanish', () => {
  const html = run({ ...day, team_locale: 'es', review_items: [{ ...day.review_items[0]!, supplier: 'S&S <Distribuciones> "Ltda"', invoice_number: '<b>7</b>' }] }).html;
  expect(html).toContain('S&amp;S &lt;Distribuciones&gt; &quot;Ltda&quot;');
  expect(html).toContain('&lt;b&gt;7&lt;/b&gt;');
  expect(html).not.toContain('<Distribuciones>');
});

const esLabels: SummaryRow = { ...day, team_locale: 'es', review_items: [{ ...day.review_items[0]!, review_reasons: ['totals_mismatch', 'low_confidence'] }] };
const empty: SummaryRow = { ...day, arrived: 0, ok: 0, review: 0, duplicates: 0, totals_by_supplier: [], review_items: [], due_soon: [] };

test('shows labels, never internal reason codes, in the Spanish email', () => {
  const html = run(esLabels).html;
  expect(html).toContain('Subtotal más impuesto no coincide con el total; Lectura poco confiable');
  expect(html).not.toContain('totals_mismatch');
});
test('falls back to the code for an unknown reason', () =>
  expect(run({ ...day, review_items: [{ ...day.review_items[0]!, review_reasons: ['legacy_reason'] }] }).html).toContain('legacy_reason'));
test('labels the due status in words', () => {
  expect(run({ ...day, team_locale: 'es', due_soon: [{ ...day.due_soon[0]!, status: 'review' }] }).html).toMatch(/BE-2041<\/span> · Por revisar/);
  expect(run(day).html).toMatch(/BE-2041<\/span> · Processed/);
  // The counter uses the same word as the status and the Gmail label.
  expect(run({ ...day, team_locale: 'es' }).html).toContain('>Procesadas</div>');
});
test('puts stuck events in the subject', () => {
  expect(run({ ...day, unfinished: 1 }).subject).toMatch(/, 1 stuck$/);
  expect(run({ ...day, team_locale: 'es', unfinished: 2 }).subject).toMatch(/, 2 atascadas$/);
  expect(run(day).subject).toMatch(/to review$/);
});
test('uses the long localized date in the subject and the date line', () => {
  const en = run({ ...day, report_date: '2026-11-25' });
  expect(en.subject).toContain('November 25, 2026');
  expect(en.html).toContain('>November 25, 2026</p>');
  expect(run({ ...day, report_date: '2026-11-25', team_locale: 'es' }).html).toContain('>25 de noviembre de 2026</p>');
});
test('every header cell has scope="col" and the PDF column has a header', () => {
  const html = run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html;
  expect(html.match(/<th(?=[\s>])(?![^>]*scope="col")/g)).toBeNull();
  expect(html).toContain('>Supplier / Invoice number</th>');
});
test('names each PDF link after its invoice number', () => {
  expect(run(day).html).toContain('>PDF, No. MB-5520</a>');
  expect(run({ ...day, team_locale: 'es' }).html).toContain('>PDF, N.º MB-5520</a>');
  expect(run({ ...day, review_items: [{ ...day.review_items[0]!, invoice_number: null }] }).html).toContain('>PDF</a>');
});
test('right-aligns money and count columns', () => {
  expect(run(day).html).toMatch(/text-align:right[^>]*><span[^>]*>COP 1,416,600</);
  expect(run(day).html).toMatch(/text-align:right[^>]*><span[^>]*>COP 2,082,500</);
});
test('the counters leave room for "Por revisar" on one line at phone width', () => {
  expect(run(day).html).toContain('padding:12px 6px;border:1px solid #d9e2ec;text-align:center;width:25%;');
  expect(run(day).html).toContain('padding:12px 6px;border:1px solid #f0b429;background:#fff8e1;');
});
test('highlights the review counter only when something needs review', () => {
  const html = run(day).html;
  expect(html.match(/background:#fff8e1/g)).toHaveLength(1);
  expect(html).toContain('>Review</div>');
  expect(run({ ...day, review: 0 }).html).not.toContain('#fff8e1');
});
test('wraps the report in a 640px container that names its language', () => {
  expect(run({ ...day, team_locale: 'es' }).html.startsWith('<div lang="es" style="max-width:640px;')).toBe(true);
});
test('titles the review list as invoices, and the stuck table with its own heading', () => {
  const en = run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html;
  expect(en).toContain('>Invoices to review</h2>');
  expect(en).toContain('>Stuck invoices</h2>');
  expect(en).not.toContain('Review items');
  const es = run({ ...day, team_locale: 'es', unfinished: 1, unfinished_events: [stuck(1)] }).html;
  expect(es).toContain('>Facturas atascadas</h2>');
  // The heading sits between the warning box and the table.
  expect(en).toMatch(/retry them\.<\/div>\n<h2[^>]*>Stuck invoices<\/h2>\n<div[^>]*><table/);
});
test('no stuck heading when nothing is stuck', () => expect(run(day).html).not.toContain('Stuck invoices'));
test('says nothing needs review on a day with arrivals and no review', () =>
  expect(run({ ...day, review: 0, review_items: [] }).html).toContain('Nothing needs review.'));
test('ends with the 24-hour footer', () => {
  expect(run(day).html).toContain('This report covers the 24 hours before it was generated.');
  expect(run(empty).html.endsWith('</div>')).toBe(true);
});
test('escapes the PDF link text', () =>
  expect(run({ ...day, review_items: [{ ...day.review_items[0]!, invoice_number: '<i>' }] }).html).toContain('>PDF, No. &lt;i&gt;</a>'));

// String.replace reads $&, $' and $` in a replacement string; an invoice number is data.
test('a $ pattern in an invoice number reaches the link text unchanged', () => {
  const html = run({ ...day, review_items: [{ ...day.review_items[0]!, invoice_number: "MB-5520$'x" }] }).html;
  expect(html).toContain('>PDF, No. MB-5520$&#39;x</a>');
});

test('the footer meets AA contrast and the stuck box has a full border, not a side stripe', () => {
  const html = run({ ...day, unfinished: 1, unfinished_events: [stuck(1)] }).html;
  expect(html).toContain('color:#52606d;font-size:12px;');
  expect(html).not.toContain('#7b8794');
  expect(html).toContain('border:1px solid #d64545;background:#fdecea;');
  expect(html).not.toContain('border-left');
});
