// Compares the six sample invoices against what the pipeline actually recorded, by reading
// scripts/sql/scenario-report.sql through the real local Postgres over psql's stdin \bind
// protocol - the same one n8n's own Postgres node binds a Query Parameter through - so this
// exercises that path end to end instead of querying through a separate pg connection.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { NormalizedInvoice } from '../src/lib/invoice.ts';
import { normalizeInvoiceNumber, normalizeTaxId } from '../src/lib/normalize-invoice.ts';
import { compose, loadDotEnv } from './lib/runtime.ts';
import type { SampleExpectation } from './lib/sample-invoices.ts';
import { parseSince } from './lib/since.ts';

export { parseSince };

/**
 * The expectations to compare against, read verbatim from the committed samples/expected.json
 * (`pnpm run samples`'s own output) - never recomputed from --since, which is only the start of
 * the database query window and can fall on a different day than the samples were generated for.
 */
export function loadExpectedSamples(path = 'samples/expected.json'): SampleExpectation[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path defaults to this script's own fixed file; only tests override it, with a path under a temp dir they create
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { samples?: unknown }).samples)) {
    throw new Error(`${path} must be an object with a "samples" array`);
  }
  return (parsed as { samples: SampleExpectation[] }).samples;
}

export interface ScenarioRow {
  file_name: string;
  outcome: 'ok' | 'review' | 'duplicate' | null;
  extraction_path: 'text' | 'vision' | 'none' | null;
  invoice: NormalizedInvoice | null;
  review_reasons: string[];
  drive_file_name: string | null;
  duplicate_of_file: string | null;
}

/** NFKD, strip marks, lowercase, alphanumerics only - for loose supplier/description comparison. */
function looseText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Renders a value for a detail line: a bare number or string, not its JSON quoting. */
function render(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function detail(field: string, expected: unknown, got: unknown): string {
  return `${field}: expected ${render(expected)}, got ${render(got)}`;
}

/** Compares one field exactly, pushing a detail line when it differs. */
function checkExact(details: string[], field: string, expected: unknown, got: unknown): void {
  if (expected !== got) details.push(detail(field, expected, got));
}

function checkInvoice(details: string[], expected: NormalizedInvoice, actual: NormalizedInvoice | null): void {
  if (!actual) {
    details.push('invoice: expected a saved invoice, got none');
    return;
  }

  const expectedSupplier = expected.supplier !== null ? looseText(expected.supplier) : null;
  const actualSupplier = actual.supplier !== null ? looseText(actual.supplier) : null;
  checkExact(details, 'supplier', expectedSupplier, actualSupplier);

  checkExact(details, 'supplier_tax_id', normalizeTaxId(expected.supplier_tax_id), normalizeTaxId(actual.supplier_tax_id));
  checkExact(details, 'invoice_number', normalizeInvoiceNumber(expected.invoice_number), normalizeInvoiceNumber(actual.invoice_number));
  checkExact(details, 'issue_date', expected.issue_date, actual.issue_date);
  checkExact(details, 'due_date', expected.due_date, actual.due_date);
  checkExact(details, 'currency', expected.currency, actual.currency);
  checkExact(details, 'subtotal', expected.subtotal, actual.subtotal);
  checkExact(details, 'tax', expected.tax, actual.tax);
  checkExact(details, 'total', expected.total, actual.total);
  // confidence is the model's own self-reported value, not a fact about the invoice, so it's never compared.

  checkExact(details, 'line_items.length', expected.line_items.length, actual.line_items.length);
  for (const [index, expectedLine] of expected.line_items.entries()) {
    // eslint-disable-next-line security/detect-object-injection -- index is .entries()'s own bounded loop counter, not a computed or external key
    const actualLine = actual.line_items[index];
    const prefix = `line_items[${String(index)}]`;
    if (!actualLine) {
      details.push(`${prefix}: expected a line, got none`);
      continue;
    }
    const expectedDescription = looseText(expectedLine.description);
    const actualDescription = looseText(actualLine.description);
    checkExact(details, `${prefix}.description`, expectedDescription, actualDescription);
    checkExact(details, `${prefix}.quantity`, expectedLine.quantity, actualLine.quantity);
    checkExact(details, `${prefix}.unit_price`, expectedLine.unit_price, actualLine.unit_price);
    checkExact(details, `${prefix}.line_total`, expectedLine.line_total, actualLine.line_total);
  }
}

/** Compares one sample's expected outcome against the row the pipeline actually produced. */
export function compareScenario(expected: SampleExpectation, actual: ScenarioRow | undefined): { file: string; result: 'PASS' | 'FAIL'; details: string[] } {
  if (!actual) return { file: expected.file, result: 'FAIL', details: ['not processed'] };

  const details: string[] = [];
  checkExact(details, 'outcome', expected.outcome, actual.outcome);

  if (expected.outcome === 'duplicate') {
    checkExact(details, 'duplicate_of_file', expected.duplicate_of ?? null, actual.duplicate_of_file);
  } else {
    checkExact(details, 'path', expected.path ?? null, actual.extraction_path);
    checkExact(details, 'drive_file_name', expected.drive_file_name ?? null, actual.drive_file_name);
    if (expected.invoice) checkInvoice(details, expected.invoice, actual.invoice);
    for (const reason of expected.review_reasons_include ?? []) {
      if (!actual.review_reasons.includes(reason)) details.push(`review_reasons: expected to include ${reason}, got ${JSON.stringify(actual.review_reasons)}`);
    }
  }

  return { file: expected.file, result: details.length === 0 ? 'PASS' : 'FAIL', details };
}

/** The earliest row per file name; every extra row for an already-seen file name is its own FAIL detail. */
function earliestRowPerFile(rows: ScenarioRow[]): { rows: Map<string, ScenarioRow>; extras: Map<string, number> } {
  const seen = new Map<string, ScenarioRow>();
  const extras = new Map<string, number>();
  for (const row of rows) {
    if (seen.has(row.file_name)) extras.set(row.file_name, (extras.get(row.file_name) ?? 0) + 1);
    else seen.set(row.file_name, row);
  }
  return { rows: seen, extras };
}

async function fetchReport(since: string): Promise<ScenarioRow[]> {
  const appDbUser = process.env.APP_DB_USER;
  if (!appDbUser) throw new Error('APP_DB_USER is not set');

  const sql = readFileSync('scripts/sql/scenario-report.sql', 'utf8');
  const input = `\\bind ${since}\n${sql}`;
  const { stdout } = await compose(['exec', '-T', 'postgres', 'psql', '-U', appDbUser, '-d', 'app', '-At'], { input });

  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  const parsed: unknown = JSON.parse(trimmed);
  return Array.isArray(parsed) ? (parsed as ScenarioRow[]) : [];
}

function renderResults(results: { file: string; result: 'PASS' | 'FAIL'; details: string[] }[], extraRows: Map<string, number>): string {
  const lines = ['| file | result | details |', '|---|---|---|'];
  for (const r of results) lines.push(`| ${r.file} | ${r.result} | ${r.details.join('; ')} |`);
  for (const [file, count] of extraRows) lines.push(`| ${file} | FAIL | ${String(count)} extra row |`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  loadDotEnv();
  const index = process.argv.indexOf('--since');
  const rawSince = index === -1 ? undefined : process.argv[index + 1];
  if (!rawSince) {
    console.error('usage: node scripts/check-scenarios.ts --since <ISO>');
    process.exitCode = 1;
    return;
  }
  const since = parseSince(rawSince);

  const report = await fetchReport(since);
  const { rows, extras } = earliestRowPerFile(report);

  const expected = loadExpectedSamples();
  const results = expected.map((sample) => compareScenario(sample, rows.get(sample.file)));

  console.log(renderResults(results, extras));

  const anyFail = results.some((r) => r.result === 'FAIL') || extras.size > 0;
  if (anyFail) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
