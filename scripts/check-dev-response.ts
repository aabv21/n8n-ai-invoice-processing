import { fileURLToPath } from 'node:url';
import { callDev } from './lib/dev-client.ts';

/**
 * A fixed moment, not "now": CI's database starts empty on every run, so a fixed `run_at` makes
 * `report_date` (the Bogota calendar date of that moment) deterministic across any future run
 * date, and the empty-day branch (no invoices in the rolling 24h window) always fires. 23:30 UTC
 * is 18:30 in America/Bogota (UTC-5, no DST), so the Bogota date stays the same as the UTC date.
 */
const FIXED_RUN_AT = '2026-06-15T23:30:00Z';
const EXPECTED_REPORT_DATE = '2026-06-15';
const EXPECTED_SUBJECT = `Magdaport invoices ${EXPECTED_REPORT_DATE}: 0 arrived, 0 to review`;

/**
 * True only when `result` is exactly `{ subject, html }` with the deterministic subject a fixed,
 * empty-database `run_at` produces, and an HTML body whose structure (not its exact text) proves
 * `Render summary` — the *generated* Code node from `src/nodes/render-summary.ts` — actually ran:
 * the report-date heading, the "no invoices arrived" empty-day line `render-summary.ts` only
 * emits when `arrived === 0`, and all three section headings it always emits. The subject and the
 * heading both embed `report_date`, which is itself derived from `run_at` by `daily-summary.sql`
 * (the Postgres path `summary-preview` also proves), so asserting it pins both nodes at once
 * without hard-coding the full HTML string, which would also encode incidental whitespace from
 * the generated `jsCode`'s own template joins.
 */
export function isSummaryPreview(result: unknown): result is { subject: string; html: string } {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result).sort();
  if (keys.length !== 2 || keys[0] !== 'html' || keys[1] !== 'subject') return false;
  const r = result as Record<string, unknown>;
  if (r.subject !== EXPECTED_SUBJECT) return false;
  if (typeof r.html !== 'string') return false;
  return (
    r.html.includes(`<h1>Magdaport invoices: ${EXPECTED_REPORT_DATE}</h1>`) &&
    r.html.includes('<p>No invoices arrived in the last 24 hours.</p>') &&
    r.html.includes('<h2>Totals by supplier</h2>') &&
    r.html.includes('<h2>Review items</h2>') &&
    r.html.includes('<h2>Due in the next 7 days</h2>')
  );
}

const CHECKS: readonly { target: string; input: unknown; isExpected: (result: unknown) => boolean }[] = [
  { target: 'summary-preview', input: { run_at: FIXED_RUN_AT, dry_run: true }, isExpected: isSummaryPreview },
];

async function main(): Promise<void> {
  for (const { target, input, isExpected } of CHECKS) {
    const result = await callDev(target, input);
    console.log(JSON.stringify({ target, result }, null, 2));
    if (!isExpected(result)) {
      throw new Error(`${target}: unexpected response ${JSON.stringify(result)}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
