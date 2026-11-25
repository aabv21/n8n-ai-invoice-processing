// Decides whether a second read by the stronger model can change a review verdict. A printed
// arithmetic error, a missing field, or a bad date is the same on every read, so retrying it only
// spends the stronger model's price. Pure: no I/O, no clock.
import type { ReviewReason } from './invoice.ts';

/** Reasons a different read can fix, on either path. */
export const MODEL_DEPENDENT_REASONS: readonly ReviewReason[] = ['unparseable_reply', 'reply_truncated', 'low_confidence'];

/** Reasons that point at a misread scan: the model can fix them only when it read an image. */
export const SCAN_ONLY_REASONS: readonly ReviewReason[] = ['line_items_mismatch', 'line_items_incomplete'];

export function shouldRetry(reasons: readonly ReviewReason[], path: 'text' | 'vision'): boolean {
  return reasons.some((reason) => MODEL_DEPENDENT_REASONS.includes(reason) || (path === 'vision' && SCAN_ONLY_REASONS.includes(reason)));
}
