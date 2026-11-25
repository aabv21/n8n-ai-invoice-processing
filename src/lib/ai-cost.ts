// Estimates what one extraction call costs, in USD, so the daily AI budget has a figure to add up.
// Pure: no I/O, no clock. NOTE: the text path's cost is estimated from the text length because the
// Information Extractor exposes no token usage to the main flow; the PDF path uses the API's real
// usage. `pnpm run cost` stays the measured figure.
import { costUsd } from './pricing.ts';
import { roundTo } from './util.ts';

/** The system prompt, the schema and the framing around the invoice text. */
export const TEXT_PROMPT_OVERHEAD_TOKENS = 1_500;
export const CHARS_PER_TOKEN = 3;
export const ESTIMATED_OUTPUT_TOKENS = 2_000;
/** A PDF call whose reply carried no usage: a typical few-page invoice. */
export const VISION_FALLBACK_INPUT_TOKENS = 20_000;

export interface CallUsage {
  input_tokens: number;
  output_tokens: number;
}

export function callCostUsd(call: { model: string; path: 'text' | 'vision'; text_chars?: number; usage?: CallUsage | null }): number {
  if (call.path === 'vision') {
    const cost = call.usage
      ? costUsd(call.model, call.usage.input_tokens, call.usage.output_tokens)
      : costUsd(call.model, VISION_FALLBACK_INPUT_TOKENS, ESTIMATED_OUTPUT_TOKENS);
    return roundTo(cost, 6);
  }
  const inputTokens = TEXT_PROMPT_OVERHEAD_TOKENS + Math.ceil((call.text_chars ?? 0) / CHARS_PER_TOKEN);
  return roundTo(costUsd(call.model, inputTokens, ESTIMATED_OUTPUT_TOKENS), 6);
}
