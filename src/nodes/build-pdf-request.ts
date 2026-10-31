// Builds a Messages API body with a PDF document block and structured output, which no native
// node sends. Pure: it only builds the JSON body - the HTTP call is a separate node, so a
// request-size or network failure surfaces there, not here.
export interface PdfRequestInput {
  model: string;
  effort: 'low' | 'medium' | 'high';
  pdf_base64: string;
  system: string;
  schema_json: string;
}

const MAX_TOKENS = 16000;
const INSTRUCTION = 'Extract the invoice from this PDF.';

export function run(input: PdfRequestInput): { body: Record<string, unknown> } {
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
