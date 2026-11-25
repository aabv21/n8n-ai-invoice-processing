import { expect, test } from 'vitest';
import { run, type ApprovalRow } from '../../src/nodes/check-approval.ts';
import { RULES, TODAY } from '../fixtures/invoice-1.ts';

const ROW: ApprovalRow = {
  invoice_id: '12',
  email_id: 'gm12',
  approved_by: 'Laura',
  supplier: 'Bolsamar Empaques S.A.S.',
  supplier_tax_id: '901.384.552-2',
  invoice_number: 'be-2041',
  issue_date: 46298,
  due_date: '2026-11-02',
  currency: 'COP',
  subtotal: 1_750_000,
  tax: 332_500,
  total: 2_082_500,
};
const row = (patch: Partial<ApprovalRow>): ApprovalRow => ({ ...ROW, ...patch });
const ctx = { buyer_tax_id: RULES.buyer_tax_id, today: TODAY };
const check = (r: ApprovalRow, team_locale?: 'en' | 'es') => run({ row: r, ...(team_locale ? { team_locale } : {}), ...ctx });
const noteOf = (r: ApprovalRow) => {
  const result = check(r);
  return 'note' in result ? result.note : '';
};

test('a corrected, complete row is approved', () => {
  expect(check(ROW)).toEqual({
    ok: true,
    invoice_id: '12',
    email_id: 'gm12',
    approved_by: 'Laura',
    invoice: {
      supplier: 'Bolsamar Empaques S.A.S.',
      supplier_tax_id: '9013845522',
      invoice_number: 'BE-2041',
      issue_date: '2026-10-03',
      due_date: '2026-11-02',
      currency: 'COP',
      subtotal: 1_750_000,
      tax: 332_500,
      total: 2_082_500,
    },
  });
});

test('an invalid issue date is a note, not an approval', () => {
  expect(check(row({ issue_date: '2026-02-30' }))).toEqual({
    ok: false,
    invoice_id: '12',
    email_id: 'gm12',
    note: 'Not approved: Invalid issue date. Fix the cells and keep your name in approved_by.',
  });
});

test('a missing total is a note, in Spanish too', () => {
  const result = check(row({ total: '' }), 'es');
  expect(result.ok).toBe(false);
  expect('note' in result && result.note).toContain('Falta el total');
  expect('note' in result && result.note).toMatch(/^No se aprobó: /);
});

test('several problems are listed together', () => {
  const result = check(row({ total: '', currency: 'PESOS' }));
  expect('note' in result && result.note).toBe(
    'Not approved: Unsupported currency; Missing total. Fix the cells and keep your name in approved_by.',
  );
});

test('a totals mismatch and unread line items do not block an approval', () => {
  expect(check(row({ total: 2_000_000 })).ok).toBe(true);
});

test('a non-numeric invoice_id is a note', () => {
  expect(check(row({ invoice_id: 'abc' }))).toEqual({
    ok: false,
    invoice_id: 'abc',
    email_id: 'gm12',
    note: 'Not approved: invoice_id must be the number this pipeline wrote.',
  });
  expect(check(row({ invoice_id: '' }), 'es')).toMatchObject({
    ok: false,
    note: 'No se aprobó: invoice_id debe ser el número que escribió el sistema.',
  });
});

test('a numeric invoice_id cell is accepted', () => {
  expect(check(row({ invoice_id: 12 }))).toMatchObject({ ok: true, invoice_id: '12' });
});

test('a blank or overlong approved_by is a note', () => {
  const expected = 'Not approved: write your name, up to 100 characters, in approved_by.';
  expect(check(row({ approved_by: '  ' }))).toMatchObject({ ok: false, note: expected });
  expect(check(row({ approved_by: 'x'.repeat(101) }))).toMatchObject({ ok: false, note: expected });
  expect(check(row({ approved_by: 'x'.repeat(100) })).ok).toBe(true);
});

test('an id longer than a bigint is a note, not a database error', () => {
  const note = 'Not approved: invoice_id must be the number this pipeline wrote.';
  expect(check(row({ invoice_id: '1'.repeat(19) }))).toMatchObject({ ok: false, note });
  expect(check(row({ invoice_id: '1'.repeat(18) })).ok).toBe(true);
});

test.each([
  ['a negative total', { total: -1_356_600 }, 'Total is zero or negative'],
  ['a zero total', { total: 0 }, 'Total is zero or negative'],
  ["the buyer's own NIT as supplier", { supplier_tax_id: '901.555.210' }, "Supplier NIT is Magdaport's own"],
  ['a due date before the issue date', { due_date: '2026-09-01' }, 'Due before its issue date'],
  ['an issue date in the future', { issue_date: '2062-10-03', due_date: '2062-11-03' }, 'Issue date in the future'],
])('%s is a note, not an approval', (_label, patch, label) => {
  expect(noteOf(row(patch))).toContain(label);
  expect(check(row(patch)).ok).toBe(false);
});

test('the same rules speak Spanish', () => {
  const result = check(row({ total: -5 }), 'es');
  expect('note' in result && result.note).toContain('Total en cero o negativo');
});

test('the email_id travels with the answer, and a blank one is empty text', () => {
  expect(check(row({ email_id: '  gm12 ' }))).toMatchObject({ email_id: 'gm12' });
  expect(check(row({ email_id: null }))).toMatchObject({ ok: true, email_id: '' });
});
