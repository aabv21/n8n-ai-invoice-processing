// Parses the model reply and applies ordered invoice rules that must yield one verdict. Pure: no
// I/O, no clock - `rules` and `today` arrive from the caller, never read ambiently.
import { callCostUsd, type CallUsage } from '../lib/ai-cost.ts';
import type { CheckOutput, ReviewReason, ValidationRules } from '../lib/invoice.ts';
import { normalizeInvoice } from '../lib/normalize-invoice.ts';
import { parseReply } from '../lib/parse-reply.ts';
import { shouldRetry } from '../lib/retry-policy.ts';
import { emptyInvoice, roundTo } from '../lib/util.ts';
import { validateInvoice } from '../lib/validate-invoice.ts';

export interface CheckInput {
  reply?: unknown;
  content?: unknown;
  stop_reason?: string | null;
  rules: ValidationRules;
  today: string;
  event_id: string;
  received_at: string;
  path: 'text' | 'vision';
  model: string;
  attempt: 1 | 2;
  /** The text path's input length, which prices it. */
  text_chars?: number;
  /** The PDF path's token usage from the Messages API reply. */
  usage?: CallUsage | null;
  /** What the earlier attempt on this invoice cost, in USD. */
  prior_cost_usd?: number;
}

function echoOf(input: CheckInput): Pick<CheckOutput, 'event_id' | 'received_at' | 'path' | 'model' | 'attempt' | 'cost_usd'> {
  const cost_usd = roundTo((input.prior_cost_usd ?? 0) + callCostUsd(input), 6);
  return { event_id: input.event_id, received_at: input.received_at, path: input.path, model: input.model, attempt: input.attempt, cost_usd };
}

export function run(input: CheckInput): CheckOutput {
  const parsed = parseReply(input);
  if (!parsed.ok) {
    return { status: 'review', reasons: [parsed.reason], retry: shouldRetry([parsed.reason], input.path), invoice: emptyInvoice(), raw: null, ...echoOf(input) };
  }

  const { invoice, reasons: normalizeReasons } = normalizeInvoice(parsed.value);
  const validateReasons = validateInvoice(invoice, input.rules, input.today);

  // A field already reported as invalid (bad format, or out of range) isn't also reported as
  // missing: that would be one defect under two names.
  const suppressed: ReviewReason[] = [];
  if (normalizeReasons.includes('invalid_issue_date')) suppressed.push('missing_issue_date');
  if (normalizeReasons.includes('invalid_currency')) suppressed.push('missing_currency');
  if (normalizeReasons.includes('amount_out_of_range')) {
    if (invoice.subtotal === null) suppressed.push('missing_subtotal');
    if (invoice.tax === null) suppressed.push('missing_tax');
    if (invoice.total === null) suppressed.push('missing_total');
  }
  const reasons = [...normalizeReasons, ...validateReasons.filter((r) => !suppressed.includes(r))];

  return { status: reasons.length === 0 ? 'ok' : 'review', reasons, retry: shouldRetry(reasons, input.path), invoice, raw: parsed.value, ...echoOf(input) };
}
