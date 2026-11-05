import { expect, test } from 'vitest';
import type { SummaryRow } from '../../src/nodes/render-summary.ts';
import { run } from '../../src/nodes/render-summary.ts';

const day: SummaryRow = {
  report_date: '2026-10-30', arrived: 6, ok: 4, review: 1, duplicates: 1, unfinished: 0,
  totals_by_supplier: [
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'COP', invoices: 1, total: 2082500 },
    { supplier: 'Brackenport Supply LLC', currency: 'USD', invoices: 1, total: 2191 }],
  review_items: [{ supplier: 'Marbetaria S.A.S.', invoice_number: 'MB-5520', currency: 'COP', total: 1416600,
    review_reasons: ['totals_mismatch'], drive_url: 'https://drive.google.com/file/d/abc/view' }],
  due_soon: [{ supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041', due_date: '2026-11-01', currency: 'COP', total: 2082500, status: 'ok' }],
};
test('summarizes the day in the subject', () =>
  expect(run(day).subject).toBe('Magdaport invoices 2026-10-30: 6 arrived, 1 to review'));
test('shows the counts', () => {
  for (const s of ['Arrived: 6', 'OK: 4', 'Review: 1', 'Duplicates: 1']) expect(run(day).html).toContain(s);
});
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
  expect(run(day).html).toContain('totals_mismatch');
  expect(run(day).html).toContain('<a href="https://drive.google.com/file/d/abc/view">');
});
// Only an https:// drive_url becomes a link, so a planted javascript: URL can't run in the
// recipient's mail client. No link renders the empty-cell placeholder.
test('renders a placeholder, not a blank cell, for a non-https drive_url', () => {
  const html = run({ ...day, review_items: [{ ...day.review_items[0]!, drive_url: 'javascript:alert(1)' }] }).html;
  expect(html).not.toContain('<a href="javascript:alert(1)">');
  expect(html).not.toContain('javascript:alert(1)');
  expect(html).toContain('<td>—</td>');
});
test('renders the same placeholder for a null drive_url', () => {
  const html = run({ ...day, review_items: [{ ...day.review_items[0]!, drive_url: null }] }).html;
  expect(html).toContain('<td>—</td>');
});
test('still sends a summary on an empty day', () => {
  const out = run({ ...day, arrived: 0, ok: 0, review: 0, duplicates: 0, totals_by_supplier: [], review_items: [], due_soon: [] });
  expect(out.subject).toBe('Magdaport invoices 2026-10-30: 0 arrived, 0 to review');
  // The window is the rolling 24 hours ending at the run, so the empty-day line must not claim "today".
  expect(out.html).toContain('No invoices arrived in the last 24 hours.');
});
// n8n prunes executions after 168 h, and a lost Record event response leaves no failed execution
// at all, so the warning also points at the README's recovery steps.
test.each([[1, '1 invoice did not finish processing.'], [2, '2 invoices did not finish processing.']])(
  'warns about %i unfinished', (n, line) => expect(run({ ...day, unfinished: n }).html).toContain(
    `${line} See n8n's failed executions, or the README's recovery steps for stuck events.`));

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
  expect(html).toContain('Magdaport invoices: 2026-10-30');
  expect(html).toContain('Totals by supplier');
});

test('renders the Spanish subject and headings when team_locale is es', () => {
  const out = run({ ...day, team_locale: 'es' });
  expect(out.subject).toBe('Facturas Magdaport 2026-10-30: 6 recibidas, 1 por revisar');
  expect(out.html).toContain('Facturas Magdaport: 2026-10-30');
  expect(out.html).toContain('Recibidas: 6');
  expect(out.html).toContain('Totales por proveedor');
  expect(out.html).toContain('Elementos por revisar');
  expect(out.html).toContain('Vencen en los próximos 7 días');
  expect(out.html).toContain('<th>Proveedor</th>');
  expect(out.html).toContain('<th>N.º de factura</th>');
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
    `${line} Consulte las ejecuciones fallidas de n8n o los pasos de recuperación del README para eventos pendientes.`));

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
