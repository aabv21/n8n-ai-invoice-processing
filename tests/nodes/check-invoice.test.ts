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
test('flags invoice 5 for review', () =>
  expect(run(input({ reply: { ...INVOICE_1_RAW, subtotal: 1_140_000, tax: 216_600, total: 1_416_600 } })))
    .toMatchObject({ status: 'review', reasons: ['totals_mismatch'] }));
test('reports an invalid field once, not also as missing', () =>
  expect(run(input({ reply: { ...INVOICE_1_RAW, issue_date: '2026-02-30', currency: 'PESOS' } })).reasons)
    .toEqual(['invalid_issue_date', 'invalid_currency']));
test('an unparseable reply is a review with an empty invoice', () =>
  expect(run(input({ content: [{ type: 'text', text: 'sorry' }], stop_reason: 'end_turn' })))
    .toEqual({ status: 'review', reasons: ['unparseable_reply'], invoice: EMPTY_INVOICE, raw: null, ...echo }));
