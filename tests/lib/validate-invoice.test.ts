import { expect, test } from 'vitest';
import { EMPTY_INVOICE, type NormalizedInvoice, type ValidationRules } from '../../src/lib/invoice.ts';
import { validateInvoice } from '../../src/lib/validate-invoice.ts';

const valid: NormalizedInvoice = {
  supplier: 'Bolsamar Empaques S.A.S.', supplier_tax_id: '9013845522', invoice_number: 'BE-2041',
  issue_date: '2026-10-02', due_date: '2026-11-01', currency: 'COP',
  subtotal: 1_750_000, tax: 332_500, total: 2_082_500,
  line_items: [
    { line_no: 1, description: 'Corrugated box 40x30x30 cm', quantity: 500, unit_price: 1_800, line_total: 900_000 },
    { line_no: 2, description: 'Stretch film roll 50 cm x 300 m', quantity: 20, unit_price: 42_500, line_total: 850_000 },
  ],
  confidence: 0.95,
};
const rules = { totals_tolerance: 1, min_confidence: 0.8 };
const today = '2026-10-30';

test('accepts a consistent invoice', () => expect(validateInvoice(valid, rules, today)).toEqual([]));
// Invoice 5's real lines (thermal labels 40x18,000 + ink ribbon 12x35,000 = 1,140,000), so patching
// the header to its printed (wrong) total exercises totals_mismatch alone, with the lines still
// agreeing with the (correct) subtotal.
const invoice5Lines = [
  { line_no: 1, description: 'Thermal labels 100x150 mm (roll)', quantity: 40, unit_price: 18_000, line_total: 720_000 },
  { line_no: 2, description: 'Ink ribbon 110 mm x 300 m', quantity: 12, unit_price: 35_000, line_total: 420_000 },
];

test.each([
  ['total off by exactly the tolerance', { total: 2_082_501 }, []],
  ['total off by more than the tolerance', { total: 2_082_501.01 }, ['totals_mismatch']],
  ['invoice 5: printed total 60,000 too high', { line_items: invoice5Lines, subtotal: 1_140_000, tax: 216_600, total: 1_416_600 }, ['totals_mismatch']],
  ['USD cents add up', { currency: 'USD', subtotal: 2_191, tax: 0, total: 2_191, line_items: [{ ...valid.line_items[0]!, line_total: 2_191 }] }, []],
  ['confidence at the threshold', { confidence: 0.8 }, []],
  ['confidence below the threshold', { confidence: 0.79 }, ['low_confidence']],
  ['no confidence', { confidence: null }, ['low_confidence']],
  ['no due date', { due_date: null }, []],
  ['due before issue', { due_date: '2026-10-01' }, ['due_before_issue']],
  ['issued today', { issue_date: '2026-10-30', due_date: null }, []],
  ['issued in the future', { issue_date: '2026-10-31', due_date: null }, ['issue_date_in_future']],
  ['missing total skips the totals check', { total: null, confidence: 0.5 }, ['missing_total', 'low_confidence']],
])('%s', (_name, patch, expected) =>
  expect(validateInvoice({ ...valid, ...patch }, rules, today)).toEqual(expected));
// 1234.56 + 234.57 is 1469.13 to the cent, but floating-point addition leaves a tiny error that a
// zero tolerance would flag.
test('rounds the totals diff to cents, so float noise is not a mismatch at zero tolerance', () =>
  expect(validateInvoice(
    { ...valid, subtotal: 1234.56, tax: 234.57, total: 1469.13, line_items: [{ ...valid.line_items[0]!, line_total: 1234.56 }] },
    { ...rules, totals_tolerance: 0 }, today,
  )).toEqual([]));
test('reports every missing required field in field order', () =>
  expect(validateInvoice({ ...EMPTY_INVOICE, confidence: 0.9 }, rules, today)).toEqual([
    'missing_supplier', 'missing_supplier_tax_id', 'missing_invoice_number', 'missing_issue_date',
    'missing_currency', 'missing_subtotal', 'missing_tax', 'missing_total']));
// With no rules, `> undefined` and `< undefined` are always false, so a wrong total and a
// near-zero confidence would otherwise both pass as `ok` with no reason given.
test('throws when rules are missing required fields, instead of silently passing everything', () =>
  expect(() => validateInvoice({ ...valid, total: 999, confidence: 0.1 }, {} as unknown as ValidationRules, today)).toThrow());

test('header totals ten times the real lines are a line items mismatch', () =>
  expect(validateInvoice({ ...valid, subtotal: 17_500_000, tax: 3_325_000, total: 20_825_000 }, rules, today))
    .toEqual(['line_items_mismatch']));
// A header that zeroes itself out consistently still disagrees with the printed lines.
test('all header amounts zero, with the real lines still printed, is both reasons', () =>
  expect(validateInvoice({ ...valid, subtotal: 0, tax: 0, total: 0 }, rules, today))
    .toEqual(['line_items_mismatch', 'non_positive_total']));
test('a negative total is a non-positive total', () =>
  expect(validateInvoice({
    ...valid, subtotal: -1_750_000, tax: -332_500, total: -2_082_500,
    line_items: valid.line_items.map((li) => ({ ...li, line_total: li.line_total === null ? null : -li.line_total })),
  }, rules, today)).toEqual(['non_positive_total']));
// A model could null a line total, or report no lines, to dodge line_items_mismatch, so incomplete
// line items against a present subtotal are their own review reason.
test('no line items against a present subtotal is line_items_incomplete, not a silent pass', () =>
  expect(validateInvoice({ ...valid, line_items: [] }, rules, today)).toEqual(['line_items_incomplete']));
test('a null line_total is line_items_incomplete, not a silent pass', () =>
  expect(validateInvoice({ ...valid, line_items: [{ ...valid.line_items[0]!, line_total: null }] }, rules, today)).toEqual(['line_items_incomplete']));
test('no line items and no subtotal reports only the missing subtotal, not line_items_incomplete', () =>
  expect(validateInvoice({ ...valid, line_items: [], subtotal: null }, rules, today)).toEqual(['missing_subtotal']));
