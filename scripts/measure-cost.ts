// Measures what extract-invoice actually spent since a given moment, by reading the token usage
// n8n recorded for each of its executions. Pages through the public API with nextCursor and stops
// at the first execution older than --since, so it never scans the whole execution history.
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/runtime.ts';
import { costUsd } from './lib/pricing.ts';
import { parseSince } from './lib/since.ts';

const EXTRACT_INVOICE_WORKFLOW_ID = 'mgpExtractInv001';
const PAGE_LIMIT = 50;

export interface CostRow {
  path: 'text' | 'vision' | 'all';
  invoices: number;
  retried: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: number;
}

interface InvoiceInput {
  event_id: string;
  path: 'text' | 'vision';
  model: string;
  attempt: number;
}

interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One run's `.data.main[0][0].json`, the shape every node output in runData carries. */
function firstItemJson(runs: unknown): unknown {
  // Array.isArray narrows to any[], not unknown[], so every element is re-widened to unknown here
  // before use - the type-aware lint rules below would otherwise treat each as implicitly any.
  if (!Array.isArray(runs)) return undefined;
  const run: unknown = (runs as unknown[])[0];
  if (!isPlainObject(run)) return undefined;
  const data = run.data;
  if (!isPlainObject(data)) return undefined;
  const main = data.main;
  if (!Array.isArray(main)) return undefined;
  const branch: unknown = (main as unknown[])[0];
  if (!Array.isArray(branch)) return undefined;
  const item: unknown = (branch as unknown[])[0];
  if (!isPlainObject(item)) return undefined;
  return item.json;
}

function readInvoiceInput(runData: Record<string, unknown>): InvoiceInput | undefined {
  const json = firstItemJson(runData['When called']);
  if (!isPlainObject(json)) return undefined;
  const { event_id, path, model, attempt } = json;
  if (typeof event_id !== 'string' || (path !== 'text' && path !== 'vision') || typeof model !== 'string' || typeof attempt !== 'number') return undefined;
  return { event_id, path, model, attempt };
}

/** Every `ai_languageModel` output's `tokenUsage` across every run of a node, as one call each. */
function chatCalls(runs: unknown, model: string): CallUsage[] {
  if (!Array.isArray(runs)) return [];
  const calls: CallUsage[] = [];
  for (const run of runs) {
    if (!isPlainObject(run)) continue;
    const data = run.data;
    if (!isPlainObject(data)) continue;
    const outputs = data.ai_languageModel;
    if (!Array.isArray(outputs)) continue;
    for (const branch of outputs) {
      if (!Array.isArray(branch)) continue;
      for (const item of branch) {
        if (!isPlainObject(item)) continue;
        const json = item.json;
        if (!isPlainObject(json)) continue;
        const usage = json.tokenUsage;
        if (!isPlainObject(usage)) continue;
        const { promptTokens, completionTokens } = usage;
        if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
          calls.push({ model, inputTokens: promptTokens, outputTokens: completionTokens });
        }
      }
    }
  }
  return calls;
}

/** The HTTP call's `main` output `json.usage`, counted as one call when both token fields are present. */
function httpCall(runs: unknown, model: string): CallUsage[] {
  const json = firstItemJson(runs);
  if (!isPlainObject(json)) return [];
  const usage = json.usage;
  if (!isPlainObject(usage)) return [];
  const { input_tokens, output_tokens } = usage;
  if (typeof input_tokens !== 'number' || typeof output_tokens !== 'number') return [];
  return [{ model, inputTokens: input_tokens, outputTokens: output_tokens }];
}

interface InvoiceCost {
  eventId: string;
  path: 'text' | 'vision';
  attempt: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** One execution's extraction attempt, with every model call it made priced and summed. */
function readExecutionCost(execution: unknown): InvoiceCost | undefined {
  if (!isPlainObject(execution)) return undefined;
  const data = execution.data;
  if (!isPlainObject(data)) return undefined;
  const resultData = data.resultData;
  if (!isPlainObject(resultData)) return undefined;
  const runData = resultData.runData;
  if (!isPlainObject(runData)) return undefined;

  const input = readInvoiceInput(runData);
  if (!input) return undefined;

  const calls = [...chatCalls(runData.Claude, input.model), ...httpCall(runData['Read PDF with Claude'], input.model)];
  const inputTokens = calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0);
  const cost = calls.reduce((sum, call) => sum + costUsd(call.model, call.inputTokens, call.outputTokens), 0);

  return { eventId: input.event_id, path: input.path, attempt: input.attempt, costUsd: cost, inputTokens, outputTokens };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeOnePath(path: 'text' | 'vision' | 'all', invoices: InvoiceCost[][]): CostRow {
  return {
    path,
    invoices: invoices.length,
    retried: invoices.filter((attempts) => attempts.length > 1).length,
    avgInputTokens: average(invoices.map((attempts) => attempts.reduce((sum, a) => sum + a.inputTokens, 0))),
    avgOutputTokens: average(invoices.map((attempts) => attempts.reduce((sum, a) => sum + a.outputTokens, 0))),
    avgCostUsd: average(invoices.map((attempts) => attempts.reduce((sum, a) => sum + a.costUsd, 0))),
  };
}

/**
 * Groups every extract-invoice execution by event_id, prices each model call it made, and
 * averages per path. An invoice's path is its first attempt's path; `retried` counts invoices that
 * also made a second attempt.
 */
export function summarizeCosts(executions: unknown[]): CostRow[] {
  const byEvent = new Map<string, InvoiceCost[]>();
  for (const execution of executions) {
    const cost = readExecutionCost(execution);
    if (!cost) continue;
    const existing = byEvent.get(cost.eventId) ?? [];
    existing.push(cost);
    byEvent.set(cost.eventId, existing);
  }

  const invoices = [...byEvent.values()].map((attempts) => attempts.sort((a, b) => a.attempt - b.attempt));
  const byPath = new Map<'text' | 'vision', InvoiceCost[][]>();
  for (const attempts of invoices) {
    const path = attempts[0]?.path;
    if (!path) continue;
    const existing = byPath.get(path) ?? [];
    existing.push(attempts);
    byPath.set(path, existing);
  }

  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, grouped]) => summarizeOnePath(path, grouped))
    .concat(summarizeOnePath('all', invoices));
}

export interface ExecutionsPage {
  data: unknown[];
  nextCursor: string | null;
}

/** One page of extract-invoice's executions, with their data. A non-OK response throws with n8n's own body, cut to 500 characters. */
export async function fetchPage(n8nUrl: string, apiKey: string, cursor: string | undefined): Promise<ExecutionsPage> {
  const url = new URL('/api/v1/executions', n8nUrl);
  url.searchParams.set('workflowId', EXTRACT_INVOICE_WORKFLOW_ID);
  url.searchParams.set('includeData', 'true');
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (cursor !== undefined) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, { headers: { 'X-N8N-API-KEY': apiKey } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n API returned ${String(res.status)} for ${url.pathname}: ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<ExecutionsPage>;
}

function startedAt(execution: unknown): string | undefined {
  if (!isPlainObject(execution)) return undefined;
  const { startedAt: value } = execution;
  return typeof value === 'string' ? value : undefined;
}

/** Fetches every extract-invoice execution started at or after `since`, newest first, stopping at the first older one. */
async function fetchExecutionsSince(n8nUrl: string, apiKey: string, since: string): Promise<unknown[]> {
  const sinceMs = Date.parse(since);
  const collected: unknown[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await fetchPage(n8nUrl, apiKey, cursor);
    for (const execution of page.data) {
      const at = startedAt(execution);
      if (at !== undefined && Date.parse(at) < sinceMs) return collected;
      collected.push(execution);
    }
    if (!page.nextCursor) return collected;
    cursor = page.nextCursor;
  }
}

function renderTable(rows: CostRow[]): string {
  const header = '| path | invoices | retried | avg input tokens | avg output tokens | avg cost (USD) |';
  const divider = '|---|---|---|---|---|---|';
  const body = rows.map((row) =>
    `| ${row.path} | ${String(row.invoices)} | ${String(row.retried)} | ${row.avgInputTokens.toFixed(0)} | ${row.avgOutputTokens.toFixed(0)} | ${row.avgCostUsd.toFixed(4)} |`);
  return [header, divider, ...body].join('\n');
}

/** Reads --since from argv and validates it against YYYY-MM-DDTHH:MM:SSZ before it reaches the n8n API URL. */
export function parseArgs(argv: readonly string[]): string {
  const index = argv.indexOf('--since');
  const since = index === -1 ? undefined : argv[index + 1];
  if (!since) throw new Error('usage: node scripts/measure-cost.ts --since <ISO>');
  return parseSince(since);
}

async function main(): Promise<void> {
  loadDotEnv();
  const since = parseArgs(process.argv.slice(2));

  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) {
    console.error('N8N_API_KEY is not set (Settings → n8n API)');
    process.exitCode = 1;
    return;
  }

  const n8nUrl = process.env.N8N_URL;
  if (!n8nUrl) throw new Error('N8N_URL is not set');

  const executions = await fetchExecutionsSince(n8nUrl, apiKey, since);
  const rows = summarizeCosts(executions);

  console.log(`extract-invoice cost since ${since} (prices as of 2026-10-30)\n`);
  console.log(renderTable(rows));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
