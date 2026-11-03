import { expect, test } from 'vitest';
import { EMPTY_INVOICE } from '../../src/lib/invoice.ts';
import { normalizeInvoice, normalizeInvoiceNumber, normalizeTaxId } from '../../src/lib/normalize-invoice.ts';
import { INVOICE_1_RAW } from '../fixtures/invoice-1.ts';

test('two formatting variants of invoice 1 share one duplicate key', () => {
  const a = normalizeInvoice({ ...INVOICE_1_RAW, supplier_tax_id: '901.384.552-2', invoice_number: 'BE-2041' }).invoice;
  const b = normalizeInvoice({ ...INVOICE_1_RAW, supplier_tax_id: 'NIT 901384552 - 2', invoice_number: ' be-2041 ' }).invoice;
  expect([a.supplier_tax_id, a.invoice_number]).toEqual(['9013845522', 'BE-2041']);
  expect([b.supplier_tax_id, b.invoice_number]).toEqual([a.supplier_tax_id, a.invoice_number]);
});
test.each([
  ['901.384.552-2', '9013845522'], [' 901 384 552 - 2 ', '9013845522'], ['nit: 901384552-2', '9013845522'],
  ['EIN 00-1847263', '001847263'], ['Tax ID: 00-1847263', '001847263'], ['N/A', null], ['   ', null], [42, null],
])('tax ID %j → %j', (input, out) => expect(normalizeTaxId(input)).toBe(out));
// Dotted and "No."-suffixed label variants must still strip to the same clean key, or the
// same invoice extracted twice with different label punctuation would save as two invoices.
test.each([
  ['N.I.T. 901.384.552-2', '9013845522'], ['NIT No. 901.384.552-2', '9013845522'], ['R.U.T. 901.384.552-2', '9013845522'],
  ['TIN 00-1847263', '001847263'], ['TaxID: 00-1847263', '001847263'],
])('tax ID with a dotted or "No."-suffixed label %j → %j', (input, out) => expect(normalizeTaxId(input)).toBe(out));
test.each([[' be-2041 ', 'BE-2041'], ['BE 2041', 'BE2041'], ['000123', '000123'], ['', null]])(
  'invoice number %j → %j', (input, out) => expect(normalizeInvoiceNumber(input)).toBe(out));
test('trims text and keeps accents', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, supplier: '  Nevaribe Logística S.A.S. ' }).invoice.supplier).toBe('Nevaribe Logística S.A.S.'));
test('impossible or non-ISO dates become null with a reason', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, issue_date: '2026-02-30', due_date: '02/10/2026' }))
    .toMatchObject({ invoice: { issue_date: null, due_date: null }, reasons: ['invalid_issue_date', 'invalid_due_date'] }));
// Postgres's date type rejects year 0000 outright ("date/time field value out of range"), which
// would otherwise fail the save on every retry instead of landing in review.
test('a year-0000 date is invalid, not a real calendar date', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, issue_date: '0000-01-01' }))
    .toMatchObject({ invoice: { issue_date: null }, reasons: ['invalid_issue_date'] }));
test('blank strings are missing, not invalid', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, supplier: '   ', issue_date: '' })).toMatchObject({ invoice: { supplier: null, issue_date: null }, reasons: [] }));
// Blank currency and due_date must also be missing-not-invalid, same as supplier/issue_date above.
test('blank currency and due_date are also missing, not invalid', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, currency: '  ', due_date: '' })).toMatchObject({ invoice: { currency: null, due_date: null }, reasons: [] }));
// A non-string, non-blank value is a present-but-wrong-shape value, not a missing one - it
// must carry the field's own invalid_* reason instead of silently passing as null with no reason.
test('a non-string issue_date is invalid, not silently missing', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, issue_date: 20261101 }))
    .toMatchObject({ invoice: { issue_date: null }, reasons: ['invalid_issue_date'] }));
test('a non-string due_date is invalid, not silently missing', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, due_date: {} }))
    .toMatchObject({ invoice: { due_date: null }, reasons: ['invalid_due_date'] }));
test('a non-string currency is invalid, not silently missing', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, currency: true }))
    .toMatchObject({ invoice: { currency: null }, reasons: ['invalid_currency'] }));
test('amounts must be numbers', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, total: '2082500' }).invoice.total).toBeNull());
// numeric(18,2): the magnitude must stay below 1e16, or the save would fail with a Postgres
// "numeric field overflow" on every retry, leaving the event stuck unfinished instead of reviewed.
test('a total at or above the numeric(18,2) column range becomes null with a reason', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, total: 1e16 })).toMatchObject({ invoice: { total: null }, reasons: ['amount_out_of_range'] }));
// 1e16 - 1 rounds back to 1e16 at this magnitude in IEEE-754 double precision, so "just inside"
// uses a value far enough under the boundary to actually be distinct from it.
test('a total just inside the numeric(18,2) column range is kept', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, total: 9_999_999_999_999_998 }).invoice.total).toBe(9_999_999_999_999_998));
test('a negative total at or beyond the column range is also out of range', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, total: -1e16 })).toMatchObject({ invoice: { total: null }, reasons: ['amount_out_of_range'] }));
test('subtotal and tax are checked against the same numeric(18,2) range as total', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, subtotal: 1e16, tax: 1e16 }))
    .toMatchObject({ invoice: { subtotal: null, tax: null }, reasons: ['amount_out_of_range', 'amount_out_of_range'] }));
// quantity numeric(14,3) < 1e11; unit_price numeric(18,4) < 1e14; line_total numeric(18,2) < 1e16.
test('a line item field at or beyond its own column range becomes null', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, line_items: [{ description: 'x', quantity: 1e11, unit_price: 1e14, line_total: 1e16 }] }).invoice.line_items)
    .toEqual([{ line_no: 1, description: 'x', quantity: null, unit_price: null, line_total: null }]));
test('a line item field just inside its own column range is kept', () =>
  expect(normalizeInvoice({
    ...INVOICE_1_RAW, line_items: [{ description: 'x', quantity: 1e11 - 1, unit_price: 1e14 - 1, line_total: 9_999_999_999_999_998 }],
  }).invoice.line_items).toEqual([{ line_no: 1, description: 'x', quantity: 1e11 - 1, unit_price: 1e14 - 1, line_total: 9_999_999_999_999_998 }]));
// A value under the raw max can still round up past it at the column's own stored scale (3 decimal
// places for quantity): 99999999999.9996 rounds to 100000000000.000 once Postgres stores it,
// which is exactly 1e11 - a raw, unrounded comparison would have let this one overflow the save.
test('a quantity that rounds up to the column max at its own scale is rejected', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, line_items: [{ description: 'x', quantity: 99_999_999_999.9996, unit_price: 1, line_total: 1 }] }).invoice.line_items)
    .toEqual([{ line_no: 1, description: 'x', quantity: null, unit_price: 1, line_total: 1 }]));
test('a quantity that stays under the column max even after rounding to its own scale is accepted, with its original value kept', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, line_items: [{ description: 'x', quantity: 99_999_999_999.9994, unit_price: 1, line_total: 1 }] }).invoice.line_items)
    .toEqual([{ line_no: 1, description: 'x', quantity: 99_999_999_999.9994, unit_price: 1, line_total: 1 }]));
test.each([
  ['cop', 'COP', []], ['usd', 'USD', []], ['PESOS', null, ['invalid_currency']], ['$', null, ['invalid_currency']],
  // Three letters alone used to pass CURRENCY_RE; only COP and USD are currencies Magdaport is
  // actually billed in, so anything else - however well-formed - is invalid.
  ['XYZ', null, ['invalid_currency']], ['EUR', null, ['invalid_currency']],
])('currency %j', (input, out, reasons) => expect(normalizeInvoice({ ...INVOICE_1_RAW, currency: input })).toMatchObject({ invoice: { currency: out }, reasons }));
test('line items are numbered and keep a description', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, line_items: [
    { description: 'A', quantity: 1, unit_price: 5, line_total: 5 },
    { description: null, quantity: 2, unit_price: 5, line_total: 10 }, 'junk'] }).invoice.line_items).toEqual([
    { line_no: 1, description: 'A', quantity: 1, unit_price: 5, line_total: 5 },
    { line_no: 2, description: '(no description)', quantity: 2, unit_price: 5, line_total: 10 }]));
test('confidence outside 0..1 is dropped', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, confidence: 1.2 }).invoice.confidence).toBeNull());
test.each([[null], ['text'], [[1]]])('a non-object reply %j is an empty invoice', (raw) =>
  expect(normalizeInvoice(raw)).toEqual({ invoice: EMPTY_INVOICE, reasons: [] }));
// The empty invoice returned here must be an independent copy - mutating it must never leak
// into the shared EMPTY_INVOICE constant that every other caller also reads.
test('the empty invoice is a fresh copy, not the shared constant', () => {
  const { invoice } = normalizeInvoice(null);
  invoice.line_items.push({ line_no: 99, description: 'x', quantity: null, unit_price: null, line_total: null });
  expect(EMPTY_INVOICE.line_items).toEqual([]);
});
