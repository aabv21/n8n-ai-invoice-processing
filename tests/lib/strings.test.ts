import { expect, test } from 'vitest';
import { ERROR_ALERT_STRINGS, SUMMARY_STRINGS } from '../../src/lib/strings.ts';

const LOCALES = ['en', 'es'] as const;

function nonEmptyLeaves(value: unknown, path: string): [string, unknown][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonEmptyLeaves(v, `${path}[${String(i)}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => nonEmptyLeaves(v, path === '' ? k : `${path}.${k}`));
  }
  return [[path, value]];
}

// Completeness (global-constraints.md): every key in the table exists in both languages with a
// non-empty value, and the two languages' own key sets match exactly -- neither table can drift
// by adding a key to one language and forgetting the other.
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

// Spanish register (global-constraints.md): usted, not tú, for anything addressed to a person.
test('the Spanish error alert uses usted register, not tú', () => {
  const blob = JSON.stringify(ERROR_ALERT_STRINGS.es);
  expect(blob).not.toMatch(/\btu\b|\btú\b|\bti\b/i);
});
test('the Spanish summary uses usted register, not tú', () => {
  const blob = JSON.stringify(SUMMARY_STRINGS.es);
  expect(blob).not.toMatch(/\btu\b|\btú\b|\bti\b/i);
});
