import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { EMPTY_INVOICE, INVOICE_FIELDS } from '../../src/lib/invoice.ts';

const schemaText = readFileSync('schemas/invoice.schema.json', 'utf8');
const schema = JSON.parse(schemaText) as Record<string, unknown>;
const prompt = readFileSync('prompts/extract-invoice.md', 'utf8');
const keysDeep = (v: unknown): string[] =>
  v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : [];

test('schema fields are the invoice fields, all required', () => {
  expect(Object.keys(schema.properties as object)).toEqual([...INVOICE_FIELDS]);
  expect(schema.required).toEqual([...INVOICE_FIELDS]);
  expect(Object.keys(EMPTY_INVOICE)).toEqual([...INVOICE_FIELDS]);
});
test('schema stays inside structured outputs', () => {
  expect(schema.additionalProperties).toBe(false);
  expect((schema.properties as Record<string, { items?: { additionalProperties?: boolean } }>).line_items?.items?.additionalProperties).toBe(false);
  for (const banned of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'multipleOf', 'maxItems'])
    expect(keysDeep(schema)).not.toContain(banned);
});
test('prompt states the rules the checks rely on', () => {
  for (const s of ['Magdaport', 'null', 'YYYY-MM-DD', 'COP', 'USD', '1.190.000']) expect(prompt).toContain(s);
  expect(prompt).not.toMatch(/\d{10}|@/);
});
// I-3: the Information Extractor appends its own format instructions to this text as a LangChain
// template, which treats `{`/`}` as template syntax - a brace here would break the text path.
test('prompt contains no braces', () => expect(prompt).not.toMatch(/[{}]/));
// The inputSchema is this same file's text, so it must pass the same hygiene scan as the prompt -
// no run of 10+ digits, no '@' - or a leaked example would only be caught once it's already
// generated into workflow JSON.
test('schema text passes the hygiene scan too', () => {
  expect(schemaText).not.toMatch(/\d{10}|@/);
});
