import { expect, test } from 'vitest';
import { EMPTY_INVOICE, type CheckOutput, type NormalizedInvoice } from '../../src/lib/invoice.ts';
import { errorScore, formatReport, preflightProblems, sampleFailed, scoreSample, SCORED_FIELDS } from '../../scripts/run-eval.ts';
import type { SampleExpectation } from '../../scripts/lib/sample-invoices.ts';

const invoice: NormalizedInvoice = {
  ...EMPTY_INVOICE,
  supplier: 'Pradomar Alimentos S.A.S.',
  supplier_tax_id: '9004182269',
  invoice_number: 'PA-7781',
  issue_date: '2026-10-11',
  due_date: '2026-11-10',
  currency: 'COP',
  subtotal: 1610000,
  tax: 168700,
  total: 1778700,
  line_items: [
    { line_no: 1, description: 'White rice', quantity: 10, unit_price: 98000, line_total: 980000 },
    { line_no: 2, description: 'Oil', quantity: 20, unit_price: 31500, line_total: 630000 },
  ],
};
const expected: SampleExpectation = { file: 'eval-02-mixed-iva.pdf', outcome: 'ok', path: 'text', invoice };
const actual = (over: Partial<NormalizedInvoice> = {}, rest: Partial<CheckOutput> = {}): CheckOutput => ({
  status: 'ok', reasons: [], retry: false, invoice: { ...invoice, ...over }, raw: {}, event_id: 'eval:x',
  received_at: '2026-11-25T00:00:00Z', path: 'text', model: 'claude-haiku-5-5', attempt: 1, cost_usd: 0.004, ...rest,
});
const wrong = (score: ReturnType<typeof scoreSample>) => SCORED_FIELDS.filter((f) => !score.fields[f]);

test('scores a perfect extraction as all fields right', () => {
  const score = scoreSample(expected, actual());
  expect(wrong(score)).toEqual([]);
  expect(score).toMatchObject({ file: 'eval-02-mixed-iva.pdf', expectedStatus: 'ok', status: 'ok', reasonsOk: true, lineCountOk: true, costUsd: 0.004 });
});

test('counts a wrong total and a missing number as two wrong fields', () => {
  expect(wrong(scoreSample(expected, actual({ total: 1778000, invoice_number: null })))).toEqual(['invoice_number', 'total']);
});

test('numbers within half a cent are equal', () => {
  expect(wrong(scoreSample(expected, actual({ total: 1778700.004 })))).toEqual([]);
  expect(wrong(scoreSample(expected, actual({ total: 1778700.01 })))).toEqual(['total']);
});

test('text fields compare exactly after trimming', () => {
  expect(wrong(scoreSample(expected, actual({ supplier: ' Pradomar Alimentos S.A.S. ' })))).toEqual([]);
  expect(wrong(scoreSample(expected, actual({ supplier: 'Pradomar Alimentos' })))).toEqual(['supplier']);
});

test('reasonsOk needs every expected reason', () => {
  const review: SampleExpectation = { ...expected, outcome: 'review', review_reasons_include: ['totals_mismatch', 'low_confidence'] };
  expect(scoreSample(review, actual({}, { status: 'review', reasons: ['totals_mismatch'] })).reasonsOk).toBe(false);
  expect(scoreSample(review, actual({}, { status: 'review', reasons: ['low_confidence', 'totals_mismatch'] })).reasonsOk).toBe(true);
  expect(scoreSample(expected, actual()).reasonsOk).toBe(true);
});

test('a different line count is flagged', () => {
  expect(scoreSample(expected, actual({ line_items: [] })).lineCountOk).toBe(false);
});

test('the report prints one row per sample, per-field accuracy and the run cost', () => {
  const good = scoreSample(expected, actual());
  const bad = scoreSample({ ...expected, file: 'b.pdf' }, actual({ total: 1 }, { status: 'review', reasons: ['totals_mismatch'], cost_usd: 0.0061 }));
  expect(formatReport([good, bad])).toBe([
    '| file | expected | got | reasons | fields right | lines |',
    '|---|---|---|---|---|---|',
    '| eval-02-mixed-iva.pdf | ok | ok | ok | 9/9 | ok |',
    '| b.pdf | ok | review | ok | 8/9 | ok |',
    '',
    'Field accuracy: supplier 2/2',
    'Field accuracy: supplier_tax_id 2/2',
    'Field accuracy: invoice_number 2/2',
    'Field accuracy: issue_date 2/2',
    'Field accuracy: due_date 2/2',
    'Field accuracy: currency 2/2',
    'Field accuracy: subtotal 2/2',
    'Field accuracy: tax 2/2',
    'Field accuracy: total 1/2',
    '',
    'Run cost (estimated): USD 0.0101',
    '',
  ].join('\n'));
});

test('a sample fails on a different status or on a missing expected reason', () => {
  const review: SampleExpectation = { ...expected, outcome: 'review', review_reasons_include: ['missing_invoice_number'] };
  expect(sampleFailed(scoreSample(expected, actual()))).toBe(false);
  expect(sampleFailed(scoreSample(expected, actual({}, { status: 'review', reasons: ['low_confidence'] })))).toBe(true);
  expect(sampleFailed(scoreSample(review, actual({}, { status: 'review', reasons: ['missing_invoice_number'] })))).toBe(false);
  // Right status, wrong reason: the guard the sample exists to prove never fired.
  expect(sampleFailed(scoreSample(review, actual({}, { status: 'review', reasons: ['low_confidence'] })))).toBe(true);
});

test('an errored sample counts as failed and shows as error in the report', () => {
  const score = errorScore(expected);
  expect(score).toMatchObject({ file: 'eval-02-mixed-iva.pdf', expectedStatus: 'ok', status: 'error', reasonsOk: false, lineCountOk: false, costUsd: 0 });
  expect(wrong(score)).toEqual([...SCORED_FIELDS]);
  expect(sampleFailed(score)).toBe(true);
  expect(formatReport([score])).toContain('| eval-02-mixed-iva.pdf | ok | error | MISSING | 0/9 | DIFF |');
});

test('preflight names each missing prerequisite and passes when both are there', () => {
  expect(preflightProblems({ configExists: true, anthropicKey: 'sk-test' })).toEqual([]);
  expect(preflightProblems({ configExists: false, anthropicKey: 'sk-test' })).toEqual([expect.stringContaining('config/config.json')]);
  expect(preflightProblems({ configExists: true, anthropicKey: '  ' })).toEqual([expect.stringContaining('ANTHROPIC_API_KEY')]);
  expect(preflightProblems({ configExists: false, anthropicKey: undefined })).toHaveLength(2);
});
