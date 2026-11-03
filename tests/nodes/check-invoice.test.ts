import { expect, test } from 'vitest';
import { EMPTY_INVOICE } from '../../src/lib/invoice.ts';
import { normalizeInvoice } from '../../src/lib/normalize-invoice.ts';
import { run, type CheckInput } from '../../src/nodes/check-invoice.ts';
import { INVOICE_1_RAW, RULES, TODAY } from '../fixtures/invoice-1.ts';

const echo = { event_id: 'm1:attachment_0', received_at: '2026-10-30T15:00:00.000Z', path: 'vision', model: 'claude-haiku-5-5', attempt: 1 } as const;
const input = (patch: Partial<CheckInput>): CheckInput => ({ rules: RULES, today: TODAY, ...echo, ...patch });
const reply = (raw: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(raw) }], stop_reason: 'end_turn' });

test('passes a valid PDF reply', () => expect(run(input(reply(INVOICE_1_RAW)))).toEqual({
  status: 'ok', reasons: [], invoice: normalizeInvoice(INVOICE_1_RAW).invoice, raw: INVOICE_1_RAW, ...echo }));
// Invoice 5's real lines (thermal labels 40x18,000 + ink ribbon 12x35,000 = 1,140,000) agree with
// the patched subtotal, so only the printed (wrong) total trips totals_mismatch.
const INVOICE_5_LINES = [
  { description: 'Thermal labels 100x150 mm (roll)', quantity: 40, unit_price: 18_000, line_total: 720_000 },
  { description: 'Ink ribbon 110 mm x 300 m', quantity: 12, unit_price: 35_000, line_total: 420_000 },
];
test('flags invoice 5 for review', () =>
  expect(run(input({ reply: { ...INVOICE_1_RAW, line_items: INVOICE_5_LINES, subtotal: 1_140_000, tax: 216_600, total: 1_416_600 } })))
    .toMatchObject({ status: 'review', reasons: ['totals_mismatch'] }));
test('reports an invalid field once, not also as missing', () =>
  expect(run(input({ reply: { ...INVOICE_1_RAW, issue_date: '2026-02-30', currency: 'PESOS' } })).reasons)
    .toEqual(['invalid_issue_date', 'invalid_currency']));
test('an out-of-range total is reported once, not also as missing', () =>
  expect(run(input({ reply: { ...INVOICE_1_RAW, total: 1e16 } })).reasons).toEqual(['amount_out_of_range']));
test('an unparseable reply is a review with an empty invoice', () =>
  expect(run(input({ content: [{ type: 'text', text: 'sorry' }], stop_reason: 'end_turn' })))
    .toEqual({ status: 'review', reasons: ['unparseable_reply'], invoice: EMPTY_INVOICE, raw: null, ...echo }));
