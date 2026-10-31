import { expect, test } from 'vitest';
import { EMPTY_INVOICE, type CheckOutput } from '../../src/lib/invoice.ts';
import { VALID_INVOICE } from '../fixtures/invoice-1.ts';
import { run } from '../../src/nodes/prepare-record.ts';

const check: CheckOutput = {
  status: 'ok', reasons: [], invoice: VALID_INVOICE, raw: {}, event_id: 'm1:attachment_0',
  received_at: '2026-10-30T15:00:00.000Z', path: 'text', model: 'claude-haiku-5-5', attempt: 1,
};
test('adds the Drive name and folder to a check result', () => expect(run(check)).toEqual({
  ...check, file: { name: '2026-10-02_bolsamar-empaques-sas_be-2041.pdf', folder: '2026/10' } }));
test.each([['too_many_pages'], ['unreadable_pdf']] as const)('%s becomes a review record without AI', (skip_reason) =>
  expect(run({ skip_reason, event_id: 'm1:attachment_0', received_at: '2026-10-30T15:00:00.000Z' })).toEqual({
    status: 'review', reasons: [skip_reason], invoice: EMPTY_INVOICE, raw: null, path: 'none', model: null, attempt: 0,
    event_id: 'm1:attachment_0', received_at: '2026-10-30T15:00:00.000Z',
    file: { name: '2026-10-30_unknown-supplier_msg-m1-attachment-0.pdf', folder: '2026/10' } }));
