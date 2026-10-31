import { expect, test } from 'vitest';
import type { NormalizedInvoice } from '../../src/lib/invoice.ts';
import { compareScenario, parseSince, type ScenarioRow } from '../../scripts/check-scenarios.ts';
import { expectations, type SampleExpectation } from '../../scripts/lib/sample-invoices.ts';

const EXPECTED_1 = expectations('2026-10-30')[0]!;

function row(expected: SampleExpectation, overrides: Partial<NormalizedInvoice> = {}): ScenarioRow {
  return {
    file_name: expected.file,
    outcome: expected.outcome,
    extraction_path: expected.path ?? null,
    invoice: expected.invoice ? { ...expected.invoice, ...overrides } : null,
    review_reasons: expected.review_reasons_include ?? [],
    drive_file_name: expected.drive_file_name ?? null,
    duplicate_of_file: expected.duplicate_of ?? null,
  };
}

test('an exact match passes', () => expect(compareScenario(EXPECTED_1, row(EXPECTED_1)).result).toBe('PASS'));
test('supplier names compare without case, accents, or punctuation', () =>
  expect(compareScenario(EXPECTED_1, row(EXPECTED_1, { supplier: 'BOLSAMAR EMPAQUES SAS' })).result).toBe('PASS'));
test('a wrong amount fails with a detail', () => expect(compareScenario(EXPECTED_1, row(EXPECTED_1, { total: 2085000 })))
  .toEqual({ file: 'invoice-01-two-items.pdf', result: 'FAIL', details: ['total: expected 2082500, got 2085000'] }));
test('a wrong path fails', () => expect(compareScenario({ ...EXPECTED_1, path: 'vision' }, row(EXPECTED_1)).details)
  .toContain('path: expected vision, got text'));
test('review reasons must include the expected ones', () => {
  const exp5 = expectations('2026-10-30')[4]!;
  expect(compareScenario(exp5, { ...row(exp5), review_reasons: ['totals_mismatch', 'low_confidence'] }).result).toBe('PASS');
});
test('a duplicate names its original', () => expect(compareScenario(expectations('2026-10-30')[5]!,
  { file_name: 'invoice-06-copy-of-01.pdf', outcome: 'duplicate', extraction_path: null, invoice: null, review_reasons: [],
    drive_file_name: null, duplicate_of_file: 'invoice-01-two-items.pdf' }).result).toBe('PASS'));
test('a missing row fails', () => expect(compareScenario(EXPECTED_1, undefined).details).toEqual(['not processed']));

test('a well-formed --since passes validation', () => expect(parseSince('2026-10-30T15:00:00Z')).toBe('2026-10-30T15:00:00Z'));
test.each([
  '2026-10-31 10:00',
  'x; \\! ls',
  '2026-10-31T10:00:00',
  '2026-1-1T00:00:00Z',
])('an invalid --since %s is rejected before any psql call', (value) => expect(() => parseSince(value)).toThrow(/--since/));
