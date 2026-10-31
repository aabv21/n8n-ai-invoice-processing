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
// I-1: dotted and "No."-suffixed label variants must still strip to the same clean key, or the
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
test('blank strings are missing, not invalid', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, supplier: '   ', issue_date: '' })).toMatchObject({ invoice: { supplier: null, issue_date: null }, reasons: [] }));
// M10: blank currency and due_date must also be missing-not-invalid, same as supplier/issue_date above.
test('blank currency and due_date are also missing, not invalid', () =>
  expect(normalizeInvoice({ ...INVOICE_1_RAW, currency: '  ', due_date: '' })).toMatchObject({ invoice: { currency: null, due_date: null }, reasons: [] }));
// I-2: a non-string, non-blank value is a present-but-wrong-shape value, not a missing one - it
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
test.each([['cop', 'COP', []], ['PESOS', null, ['invalid_currency']], ['$', null, ['invalid_currency']]])(
  'currency %j', (input, out, reasons) => expect(normalizeInvoice({ ...INVOICE_1_RAW, currency: input })).toMatchObject({ invoice: { currency: out }, reasons }));
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
// M11: the empty invoice returned here must be an independent copy - mutating it must never leak
// into the shared EMPTY_INVOICE constant that every other caller also reads.
test('the empty invoice is a fresh copy, not the shared constant', () => {
  const { invoice } = normalizeInvoice(null);
  invoice.line_items.push({ line_no: 99, description: 'x', quantity: null, unit_price: null, line_total: null });
  expect(EMPTY_INVOICE.line_items).toEqual([]);
});
