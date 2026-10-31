import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { assertPdfFits, MAX_PDF_BYTES, run } from '../../src/nodes/build-pdf-request.ts';

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
// The guard is checked by base64 length, so none of these tests allocates a real 128 MB string.
test('the PDF budget is 3/4 of the 128 MB request limit, less 1 MB for the rest of the body', () =>
  expect(MAX_PDF_BYTES).toBe(95_250_000));
test('a PDF exactly at the budget fits, and the next base64 block over it throws', () => {
  expect(() => { assertPdfFits(127_000_000); }).not.toThrow();
  expect(() => { assertPdfFits(127_000_004); }).toThrow('PDF too large for the Messages API');
});
test('the error names the PDF size and the limit in MB', () =>
  expect(() => { assertPdfFits(128_000_000); })
    .toThrow('PDF too large for the Messages API: 96.0 MB PDF; the limit is about 95.3 MB of PDF'));
test('run() refuses an oversized PDF before building the request', () => {
  // A stand-in exposing only what the guard reads, so the test needs no 128 MB allocation.
  const oversized = { length: 128_000_000, endsWith: () => false } as unknown as string;
  expect(() => run({ model: 'claude-haiku-5-5', effort: 'low', pdf_base64: oversized, system, schema_json }))
    .toThrow('PDF too large for the Messages API: 96.0 MB PDF; the limit is about 95.3 MB of PDF');
});
