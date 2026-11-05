import { fileURLToPath } from 'node:url';
import { callDev } from './lib/dev-client.ts';

/**
 * A fixed moment, not "now", so `report_date` is deterministic and CI's empty database always
 * takes the empty-day branch. 23:30 UTC is 18:30 in Bogota (UTC-5, no DST): the same calendar date.
 */
const FIXED_RUN_AT = '2026-06-15T23:30:00Z';
const EXPECTED_REPORT_DATE = '2026-06-15';
const EXPECTED_SUBJECT = `Magdaport invoices ${EXPECTED_REPORT_DATE}: 0 arrived, 0 to review`;

/**
 * True only when `result` is exactly `{ subject, html }` with the expected subject, and the HTML
 * holds what only the generated `Render summary` node emits: the report-date heading, the empty-day
 * line, and all three section headings. Both embed `report_date`, which `daily-summary.sql` derives
 * from `run_at`, so this pins the Code node and the Postgres path without hard-coding the whole
 * HTML and its incidental whitespace.
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
