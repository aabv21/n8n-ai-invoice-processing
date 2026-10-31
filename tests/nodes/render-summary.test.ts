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
// Only an https:// drive_url ever becomes a link, so a planted javascript: URL in the database
// can't execute in the recipient's mail client. No link renders a placeholder, the same as any
// other empty cell (cell()'s own rule), not a silently blank one.
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
  // The window is rolling (the last 24 hours ending at the run's timestamp), not a calendar day,
  // so the empty-day line must not claim "today".
  expect(out.html).toContain('No invoices arrived in the last 24 hours.');
});
// The summary can't point only at n8n's own executions: they're pruned after 168 h, and a lost
// Record event response leaves an unfinished invoice with no failed execution at all. The warning
// also names the README's recovery steps for exactly that case.
test.each([[1, '1 invoice did not finish processing.'], [2, '2 invoices did not finish processing.']])(
  'warns about %i unfinished', (n, line) => expect(run({ ...day, unfinished: n }).html).toContain(
    `${line} See n8n's failed executions, or the README's recovery steps for stuck events.`));

// A missing run_at (an invalid or absent query parameter) makes the query return report_date:
// null instead of a string. Without this check, that null reaches escapeHtml's .replace and
// crashes with a message that doesn't say why - throw a clear error here instead.
test('throws a clear error instead of crashing when report_date is missing', () => {
  expect(() => run({ ...day, report_date: null as unknown as string })).toThrow(
    'Daily summary: the query returned no report_date; run_at is missing or invalid');
});
