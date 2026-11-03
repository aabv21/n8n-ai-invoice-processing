// Shared --since validation for check-scenarios.ts and measure-cost.ts: both take a --since value
// that ends up on a shell or psql command line (measure-cost.ts builds a URL from it;
// check-scenarios.ts's fetchReport puts it on a psql \bind meta-command line), so both reject a
// malformed value before it reaches either, with one implementation instead of two that could
// drift apart.
const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Validates a --since value against YYYY-MM-DDTHH:MM:SSZ. Throws, never passes the value on, on a mismatch. */
export function parseSince(value: string): string {
  if (!SINCE_RE.test(value)) throw new Error(`--since must look like YYYY-MM-DDTHH:MM:SSZ, got: ${value}`);
  return value;
}
