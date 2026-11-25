import { expect, test } from 'vitest';
import type { ReviewReason } from '../../src/lib/invoice.ts';
import { ERROR_ALERT_STRINGS, REASON_LABELS, STATUS_LABELS, SUMMARY_STRINGS, reasonLabel } from '../../src/lib/strings.ts';

const LOCALES = ['en', 'es'] as const;

function nonEmptyLeaves(value: unknown, path: string): [string, unknown][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonEmptyLeaves(v, `${path}[${String(i)}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => nonEmptyLeaves(v, path === '' ? k : `${path}.${k}`));
  }
  return [[path, value]];
}

// Every key exists in both languages with a non-empty value, and the key sets match, so neither
// language can drift.
test.each([
  ['SUMMARY_STRINGS', SUMMARY_STRINGS],
  ['ERROR_ALERT_STRINGS', ERROR_ALERT_STRINGS],
])('%s has the same non-empty keys in en and es', (_name, table) => {
  const en = nonEmptyLeaves(table.en, '');
  const es = nonEmptyLeaves(table.es, '');
  const enKeys = en.map(([k]) => k).sort();
  const esKeys = es.map(([k]) => k).sort();
  expect(esKeys).toEqual(enKeys);
  for (const [path, value] of [...en, ...es]) {
    expect(typeof value, `${path} must be a string`).toBe('string');
    expect(value, `${path} must not be empty`).not.toBe('');
  }
});

test.each(LOCALES)('SUMMARY_STRINGS has every locale %s reachable by its own key', (locale) => {
  expect(SUMMARY_STRINGS[locale]).toBeDefined();
});
test.each(LOCALES)('ERROR_ALERT_STRINGS has every locale %s reachable by its own key', (locale) => {
  expect(ERROR_ALERT_STRINGS[locale]).toBeDefined();
});

// Spanish register: usted, not tú, for anything addressed to a person.
test('the Spanish error alert uses usted register, not tú', () => {
  const blob = JSON.stringify(ERROR_ALERT_STRINGS.es);
  expect(blob).not.toMatch(/\btu\b|\btú\b|\bti\b/i);
});
test('the Spanish summary uses usted register, not tú', () => {
  const blob = JSON.stringify(SUMMARY_STRINGS.es);
  expect(blob).not.toMatch(/\btu\b|\btú\b|\bti\b/i);
});

const ALL_REASONS: Record<ReviewReason, true> = {
  unparseable_reply: true, reply_truncated: true, model_refused: true, invalid_issue_date: true, invalid_due_date: true,
  invalid_currency: true, missing_supplier: true, missing_supplier_tax_id: true, missing_invoice_number: true,
  missing_issue_date: true, missing_currency: true, missing_subtotal: true, missing_tax: true, missing_total: true,
  due_before_issue: true, issue_date_in_future: true, totals_mismatch: true, line_items_mismatch: true,
  line_items_incomplete: true, non_positive_total: true, amount_out_of_range: true, supplier_is_buyer: true,
  low_confidence: true, too_many_pages: true, too_much_text: true, unreadable_pdf: true,
};

test.each(LOCALES)('every review reason has a non-empty label in %s', (locale) => {
  for (const reason of Object.keys(ALL_REASONS) as ReviewReason[]) {
    expect(reasonLabel(reason, locale), reason).not.toBe('');
    expect(reasonLabel(reason, locale), reason).not.toBe(reason);
  }
  expect(Object.keys(REASON_LABELS[locale]).sort()).toEqual(Object.keys(ALL_REASONS).sort());
});

test('an unknown reason falls back to its code', () => {
  expect(reasonLabel('legacy_reason', 'es')).toBe('legacy_reason');
  expect(reasonLabel('toString', 'en')).toBe('toString');
});

test('status labels match the Gmail label words', () => {
  expect(STATUS_LABELS.en).toEqual({ ok: 'Processed', review: 'To review' });
  expect(STATUS_LABELS.es).toEqual({ ok: 'Procesada', review: 'Por revisar' });
});
