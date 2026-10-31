// Builds a Messages API body with a PDF document block and structured output, which no native
// node sends. Pure: it only builds the JSON body - the HTTP call is a separate node, so a
// network failure surfaces there; an oversized PDF is caught here, before that call.
export interface PdfRequestInput {
  model: string;
  effort: 'low' | 'medium' | 'high';
  pdf_base64: string;
  system: string;
  schema_json: string;
}

const MAX_TOKENS = 16000;
const INSTRUCTION = 'Extract the invoice from this PDF.';

// The first-party Claude API accepts a Messages request of up to 128 MB (decimal, the reading
// that's safe either way); Anthropic's cloud-platform deployments accept less, so this budget
// assumes api.anthropic.com, the URL the HTTP node calls. `pdf_base64` is almost all of a request's
// weight; `NON_PDF_HEADROOM_BYTES` reserves a little of it for the system prompt, schema, and the
// rest of the JSON body. Base64 inflates the original bytes by 4/3, so the decoded-PDF-equivalent
// limit is 3/4 of the base64 budget - reported that way in the error message because that's the
// file size a reader actually recognizes.
const MAX_REQUEST_BYTES = 128_000_000;
const NON_PDF_HEADROOM_BYTES = 1_000_000;
const MAX_PDF_BASE64_BYTES = MAX_REQUEST_BYTES - NON_PDF_HEADROOM_BYTES;
export const MAX_PDF_BYTES = Math.floor((MAX_PDF_BASE64_BYTES * 3) / 4);

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/**
 * Throws when a PDF whose base64 is `base64Length` characters long, ending in `padding` `=` signs,
 * decodes to more than the budget. It takes the length rather than the string, so a test can check
 * the limit without allocating a 128 MB string.
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
