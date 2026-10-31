import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { run } from '../../src/nodes/build-pdf-request.ts';

const system = readFileSync('prompts/extract-invoice.md', 'utf8');
const schema_json = readFileSync('schemas/invoice.schema.json', 'utf8');
const { body } = run({ model: 'claude-haiku-5-5', effort: 'low', pdf_base64: 'JVBERi0x', system, schema_json });

test('sends the PDF first, then the instruction', () => expect(body.messages).toEqual([{ role: 'user', content: [
  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } },
  { type: 'text', text: 'Extract the invoice from this PDF.' }] }]));
test('asks for structured output against the repository schema', () =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse's `any` is compared by toEqual, not used as typed data
  expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: JSON.parse(schema_json) } }));
test('thinks adaptively with the prompt and a roomy budget', () => {
  expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16000, system, thinking: { type: 'adaptive' } });
});
test('sends no sampling parameters', () => {
  for (const k of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(k);
});
test('a broken schema fails loudly', () =>
  expect(() => run({ model: 'm', effort: 'low', pdf_base64: 'x', system, schema_json: '{' })).toThrow());
test('a PDF whose base64 would overflow the Messages API request limit throws before the call', () => {
  const oversized = 'A'.repeat(32_000_000);
  expect(() => run({ model: 'claude-haiku-5-5', effort: 'low', pdf_base64: oversized, system, schema_json }))
    .toThrow('PDF too large for the Messages API: 24.0 MB PDF; the limit is about 23.3 MB of PDF');
});
