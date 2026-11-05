// Prices as of 2026-10-30, from platform.claude.com/docs/en/about-claude/pricing (Model pricing
// table). Haiku 5.5's higher tier applies per request, once that request's prompt passes 100,000
// tokens.
export const PRICES: Readonly<Record<string, { inputPerMTok: number; outputPerMTok: number; longPromptTokens?: number; longInputPerMTok?: number; longOutputPerMTok?: number }>> = {
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5, longPromptTokens: 100_000, longInputPerMTok: 0.5, longOutputPerMTok: 2.5 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
};

/** The cost of one model call, in USD. Throws for a model this table doesn't price. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  // eslint-disable-next-line security/detect-object-injection -- model is a caller-supplied id looked up in a fixed price table, not used to access a dynamic resource
  const price = PRICES[model];
  if (!price) throw new Error(`no price for model ${model}`);

  const long = price.longPromptTokens !== undefined && inputTokens > price.longPromptTokens;
  const inputRate = (long ? price.longInputPerMTok : undefined) ?? price.inputPerMTok;
  const outputRate = (long ? price.longOutputPerMTok : undefined) ?? price.outputPerMTok;

  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}
