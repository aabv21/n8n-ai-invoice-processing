import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { checkConfig, type Config } from '../../src/lib/config.ts';

const VALID = JSON.parse(readFileSync('config/config.example.json', 'utf8')) as Config;
const clone = (): Config => structuredClone(VALID);

test('the committed example config passes unchanged', () => expect(checkConfig(VALID)).toEqual(VALID));
test('a non-object config is rejected', () => expect(() => checkConfig(null)).toThrow('config must be an object'));

test.each([
  ['negative', -0.01],
  ['not a number', '1'],
  ['missing', undefined],
])('rejects validation.totals_tolerance when it is %s', (_label, bad) => {
  const config = clone();
  config.validation.totals_tolerance = bad as unknown as number;
  expect(() => checkConfig(config)).toThrow('config.validation.totals_tolerance');
});
test('accepts validation.totals_tolerance at zero', () => {
  const config = clone();
  config.validation.totals_tolerance = 0;
  expect(() => checkConfig(config)).not.toThrow();
});

test.each([
  ['below the range', -0.1],
  ['above the range', 1.1],
  ['not a number', 'low'],
])('rejects validation.min_confidence when it is %s', (_label, bad) => {
  const config = clone();
  config.validation.min_confidence = bad as unknown as number;
  expect(() => checkConfig(config)).toThrow('config.validation.min_confidence');
});
test.each([0, 1])('accepts validation.min_confidence at the boundary %d', (value) => {
  const config = clone();
  config.validation.min_confidence = value;
  expect(() => checkConfig(config)).not.toThrow();
});

test.each([
  ['zero', 0],
  ['not an integer', 1.5],
  ['not a number', '20'],
  ['missing', undefined],
])('rejects extraction.max_pages when it is %s', (_label, bad) => {
  const config = clone();
  config.extraction.max_pages = bad as unknown as number;
  expect(() => checkConfig(config)).toThrow('config.extraction.max_pages');
});
test('rejects extraction.min_text_chars_per_page when it is zero', () => {
  const config = clone();
  config.extraction.min_text_chars_per_page = 0;
  expect(() => checkConfig(config)).toThrow('config.extraction.min_text_chars_per_page');
});

test('rejects an empty ai.default_model', () => {
  const config = clone();
  config.ai.default_model = '';
  expect(() => checkConfig(config)).toThrow('config.ai.default_model');
});
test.each(['LOW', 'strict', ''])('rejects ai.effort %s', (bad) => {
  const config = clone();
  config.ai.effort = bad as Config['ai']['effort'];
  expect(() => checkConfig(config)).toThrow('config.ai.effort');
});
test.each(['low', 'medium', 'high'] as const)('accepts ai.effort %s', (effort) => {
  const config = clone();
  config.ai.effort = effort;
  expect(() => checkConfig(config)).not.toThrow();
});
test('rejects a non-string ai.retry_model', () => {
  const config = clone();
  const bad: unknown = { ...config, ai: { ...config.ai, retry_model: 5 } };
  expect(() => checkConfig(bad)).toThrow('config.ai.retry_model');
});
test('an empty ai.retry_model means no retry, and passes', () => {
  const config = clone();
  config.ai.retry_model = '';
  expect(() => checkConfig(config)).not.toThrow();
});
test('a missing ai.retry_model passes too', () => {
  const config = clone();
  delete config.ai.retry_model;
  expect(() => checkConfig(config)).not.toThrow();
});

test.each(['processed', 'review', 'duplicate'] as const)('rejects an empty gmail.label_ids.%s', (key) => {
  const config = clone();
  config.gmail.label_ids[key] = '';
  expect(() => checkConfig(config)).toThrow(`config.gmail.label_ids.${key}`);
});
test.each(['drive_root_folder_id', 'spreadsheet_id', 'invoices_tab', 'items_tab'] as const)('rejects an empty google.%s', (key) => {
  const config = clone();
  config.google[key] = '';
  expect(() => checkConfig(config)).toThrow(`config.google.${key}`);
});
test('rejects an empty team_email', () => {
  const config = clone();
  config.team_email = '';
  expect(() => checkConfig(config)).toThrow('config.team_email');
});
