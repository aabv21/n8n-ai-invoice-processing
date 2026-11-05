// Builds a Messages API body with a PDF document block and structured output, which no native
// node sends. Pure: the HTTP call is a separate node; an oversized PDF is caught here, before it.
export interface PdfRequestInput {
  model: string;
  effort: 'low' | 'medium' | 'high';
  pdf_base64: string;
  system: string;
  schema_json: string;
}

const MAX_TOKENS = 16000;
const INSTRUCTION = 'Extract the invoice from this PDF.';

// The first-party Claude API accepts Messages requests up to 128 MB (read as decimal, safe either
// way); cloud-platform deployments accept less, so this assumes api.anthropic.com, the URL the HTTP
// node calls. `NON_PDF_HEADROOM_BYTES` covers the prompt, schema, and rest of the body. The error
// reports the decoded PDF size (3/4 of the base64 budget), the size a reader recognizes.
const MAX_REQUEST_BYTES = 128_000_000;
const NON_PDF_HEADROOM_BYTES = 1_000_000;
const MAX_PDF_BASE64_BYTES = MAX_REQUEST_BYTES - NON_PDF_HEADROOM_BYTES;
export const MAX_PDF_BYTES = Math.floor((MAX_PDF_BASE64_BYTES * 3) / 4);

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/**
 * Throws when a PDF whose base64 is `base64Length` characters, ending in `padding` `=` signs,
 * decodes past the budget. Takes a length, not the string, so a test needn't allocate 128 MB.
 */
export function assertPdfFits(base64Length: number, padding = 0): void {
  const pdfBytes = base64Length === 0 ? 0 : Math.floor((base64Length * 3) / 4) - padding;
  if (pdfBytes > MAX_PDF_BYTES) {
    throw new Error(`PDF too large for the Messages API: ${megabytes(pdfBytes)} MB PDF; the limit is about ${megabytes(MAX_PDF_BYTES)} MB of PDF`);
  }
}

export function run(input: PdfRequestInput): { body: Record<string, unknown> } {
  const base64 = input.pdf_base64;
  assertPdfFits(base64.length, base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

  const schema: unknown = JSON.parse(input.schema_json);

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: MAX_TOKENS,
    system: input.system,
    thinking: { type: 'adaptive' },
    output_config: { effort: input.effort, format: { type: 'json_schema', schema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdf_base64 } },
          { type: 'text', text: INSTRUCTION },
        ],
      },
    ],
  };

  return { body };
}
