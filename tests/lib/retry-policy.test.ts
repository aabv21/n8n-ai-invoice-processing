import { expect, test } from 'vitest';
import type { ReviewReason } from '../../src/lib/invoice.ts';
import { shouldRetry } from '../../src/lib/retry-policy.ts';

type Path = 'text' | 'vision';
const both: Path[] = ['text', 'vision'];

test.each(both)('a printed totals mismatch is not retried (%s)', (path) =>
  expect(shouldRetry(['totals_mismatch'], path)).toBe(false));
test.each([['missing_total'], ['due_before_issue'], ['issue_date_in_future'], ['supplier_is_buyer']] as [ReviewReason][])(
  'missing fields, dates and a supplier_is_buyer are not retried (%s)', (reason) =>
    expect(both.map((path) => shouldRetry([reason], path))).toEqual([false, false]));
test.each([['low_confidence'], ['unparseable_reply'], ['reply_truncated']] as [ReviewReason][])(
  'low confidence and an unreadable or cut reply are retried (%s)', (reason) =>
    expect(both.map((path) => shouldRetry([reason], path))).toEqual([true, true]));
test('line items that do not add up are retried on a scan only', () => {
  expect(shouldRetry(['line_items_mismatch'], 'vision')).toBe(true);
  expect(shouldRetry(['line_items_mismatch'], 'text')).toBe(false);
  expect(shouldRetry(['line_items_incomplete'], 'vision')).toBe(true);
});
test('one retryable reason among others is enough', () =>
  expect(shouldRetry(['totals_mismatch', 'low_confidence'], 'text')).toBe(true));
test('no reasons is not retried', () => expect(shouldRetry([], 'vision')).toBe(false));
