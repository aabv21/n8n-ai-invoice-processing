// Scores the model's reading of the sample invoices. It runs every sample in samples/ and
// samples/eval/ through the real extract-invoice workflow over the dev harness, so it measures the
// prompt, the schema and both paths as production runs them. It spends real AI money: run it by
// hand against a running stack with the Anthropic credential; CI never does.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckOutput, NormalizedInvoice, ValidationRules } from '../src/lib/invoice.ts';
import { callDev } from './lib/dev-client.ts';
import { loadDotEnv } from './lib/runtime.ts';
import { pdfText } from './lib/pdf-text.ts';
import type { SampleExpectation } from './lib/sample-invoices.ts';

export const SCORED_FIELDS = ['supplier', 'supplier_tax_id', 'invoice_number', 'issue_date', 'due_date', 'currency', 'subtotal', 'tax', 'total'] as const;

type ScoredField = (typeof SCORED_FIELDS)[number];

export interface SampleScore {
  file: string;
  expectedStatus: 'ok' | 'review';
  status: string;
  reasonsOk: boolean;
  fields: Record<ScoredField, boolean>;
  lineCountOk: boolean;
  costUsd: number;
}

const AMOUNT_TOLERANCE = 0.005;

function sameValue(expected: string | number | null, actual: string | number | null): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(expected - actual) < AMOUNT_TOLERANCE;
  if (typeof expected === 'string' && typeof actual === 'string') return expected.trim() === actual.trim();
  return expected === actual;
}

export function scoreSample(expected: SampleExpectation, actual: CheckOutput): SampleScore {
  const want: NormalizedInvoice | undefined = expected.invoice;
  if (want === undefined || (expected.outcome !== 'ok' && expected.outcome !== 'review')) {
    throw new Error(`${expected.file} has no expected invoice to score against`);
  }
  const got = actual.invoice;
  const fields: Record<ScoredField, boolean> = {
    supplier: sameValue(want.supplier, got.supplier),
    supplier_tax_id: sameValue(want.supplier_tax_id, got.supplier_tax_id),
    invoice_number: sameValue(want.invoice_number, got.invoice_number),
    issue_date: sameValue(want.issue_date, got.issue_date),
    due_date: sameValue(want.due_date, got.due_date),
    currency: sameValue(want.currency, got.currency),
    subtotal: sameValue(want.subtotal, got.subtotal),
    tax: sameValue(want.tax, got.tax),
    total: sameValue(want.total, got.total),
  };
  return {
    file: expected.file,
    expectedStatus: expected.outcome,
    status: actual.status,
    reasonsOk: (expected.review_reasons_include ?? []).every((reason) => actual.reasons.includes(reason)),
    fields,
    lineCountOk: want.line_items.length === actual.invoice.line_items.length,
    costUsd: actual.cost_usd,
  };
}

/** True when the sample's status differs from the expected one, or an expected review reason is missing. */
export function sampleFailed(score: SampleScore): boolean {
  return score.status !== score.expectedStatus || !score.reasonsOk;
}

/** The score of a sample whose call failed: everything wrong, so the report still lists it. */
export function errorScore(expected: SampleExpectation): SampleScore {
  if (expected.outcome !== 'ok' && expected.outcome !== 'review') throw new Error(`${expected.file} has no expected status`);
  return {
    file: expected.file,
    expectedStatus: expected.outcome,
    status: 'error',
    reasonsOk: false,
    fields: Object.fromEntries(SCORED_FIELDS.map((field) => [field, false])) as Record<ScoredField, boolean>,
    lineCountOk: false,
    costUsd: 0,
  };
}

/** What stops the run before any call: one sentence per missing prerequisite. */
export function preflightProblems(state: { configExists: boolean; anthropicKey: string | undefined }): string[] {
  const problems: string[] = [];
  if (!state.configExists) problems.push('config/config.json not found; create it as the Quick start says.');
  if ((state.anthropicKey ?? '').trim() === '') problems.push('ANTHROPIC_API_KEY is empty in .env; the eval needs the Anthropic credential.');
  return problems;
}

function fieldRight(score: SampleScore, field: ScoredField): boolean {
  return new Map(Object.entries(score.fields)).get(field) === true;
}

export function formatReport(scores: readonly SampleScore[]): string {
  const rows = scores.map((score) => {
    const right = SCORED_FIELDS.filter((field) => fieldRight(score, field)).length;
    return `| ${score.file} | ${score.expectedStatus} | ${score.status} | ${score.reasonsOk ? 'ok' : 'MISSING'} | ${String(right)}/${String(SCORED_FIELDS.length)} | ${score.lineCountOk ? 'ok' : 'DIFF'} |`;
  });
  const accuracy = SCORED_FIELDS.map((field) => `Field accuracy: ${field} ${String(scores.filter((score) => fieldRight(score, field)).length)}/${String(scores.length)}`);
  const cost = scores.reduce((sum, score) => sum + score.costUsd, 0);
  return [
    '| file | expected | got | reasons | fields right | lines |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    ...accuracy,
    '',
    `Run cost (estimated): USD ${cost.toFixed(4)}`,
    '',
  ].join('\n');
}

interface ExpectedFile {
  base_date: string;
  samples: SampleExpectation[];
}

interface EvalConfig {
  ai: { default_model: string; effort: string };
  validation: ValidationRules;
}

function readJson(path: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths are this script's own fixed sample and config locations
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main(): Promise<void> {
  loadDotEnv();
  const problems = preflightProblems({ configExists: existsSync('config/config.json'), anthropicKey: process.env.ANTHROPIC_API_KEY });
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const config = readJson('config/config.json') as EvalConfig;
  const scores: SampleScore[] = [];
  for (const dir of ['samples', 'samples/eval']) {
    const expectedFile = readJson(join(dir, 'expected.json')) as ExpectedFile;
    // The duplicate copy has no extraction path; it is not an extraction to score.
    for (const expected of expectedFile.samples.filter((sample) => sample.path !== undefined)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the file name comes from the committed expected.json
      const bytes = new Uint8Array(readFileSync(join(dir, expected.file)));
      try {
        const result = (await callDev('extract-invoice', {
          event_id: `eval:${expected.file}`,
          received_at: new Date().toISOString(),
          path: expected.path,
          model: config.ai.default_model,
          effort: config.ai.effort,
          text: expected.path === 'text' ? await pdfText(bytes) : '',
          pdf_base64: Buffer.from(bytes).toString('base64'),
          binary_key: 'attachment_0',
          rules: config.validation,
          today: expectedFile.base_date,
          attempt: 1,
          prior_cost_usd: 0,
        })) as CheckOutput;
        scores.push(scoreSample(expected, result));
      } catch (err) {
        // Keep going: the calls already made were paid for, and the report must still list them.
        console.error(`${expected.file}: ${err instanceof Error ? err.message : String(err)}`);
        scores.push(errorScore(expected));
      }
    }
  }
  console.log(formatReport(scores));
  if (scores.some(sampleFailed)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
