// One --since check for check-scenarios.ts (a psql \bind line) and measure-cost.ts (an API URL), so
// a malformed value is rejected before it reaches either.
const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Throws unless a --since value is YYYY-MM-DDTHH:MM:SSZ. */
export function parseSince(value: string): string {
  if (!SINCE_RE.test(value)) throw new Error(`--since must look like YYYY-MM-DDTHH:MM:SSZ, got: ${value}`);
  return value;
}
