// Evaluates an n8n parameter expression (`={{ ... }}`) in a plain V8 context, so a workflow
// expression gets a behavioral test without moving it into a Code node. It covers the subset the
// workflows use: `$json`, `$('Node').first().json`, and `$input.all()`. n8n's own evaluator adds
// helpers this one doesn't, so an expression that needs one throws here instead of passing.
import { runInNewContext } from 'node:vm';

export interface ExpressionContext {
  /** The current item's `json`, exposed as `$json`. */
  json?: Record<string, unknown>;
  /** Each referenced node's first output item's `json`, exposed through `$(name).first().json`. */
  nodes?: Record<string, Record<string, unknown>>;
  /** The node's input items, exposed as `$input.all()`. */
  inputAll?: unknown[];
}

const SEGMENT = /\{\{([\s\S]*?)\}\}/g;

function sandbox(ctx: ExpressionContext): Record<string, unknown> {
  const nodes = ctx.nodes ?? {};
  return {
    $json: ctx.json ?? {},
    $: (name: string) => {
      if (!Object.hasOwn(nodes, name)) throw new Error(`expression references node "${name}", which the test context doesn't define`);
      return { first: () => ({ json: nodes[name] }) };
    },
    $input: { all: () => ctx.inputAll ?? [] },
  };
}

function body(expression: string): string {
  if (!expression.startsWith('=')) throw new Error(`not an n8n expression (no leading "="): ${expression}`);
  return expression.slice(1);
}

/** The value of a parameter that is exactly one `={{ body }}`; throws on anything else. */
export function evaluateExpression(expression: string, ctx: ExpressionContext): unknown {
  const text = body(expression).trim();
  const segments = [...text.matchAll(SEGMENT)];
  if (segments.length !== 1 || segments[0]![0] !== text) {
    throw new Error(`expected a single {{ }} expression, got: ${expression}`);
  }
  return runInNewContext(`(${segments[0]![1]!})`, sandbox(ctx)) as unknown;
}

/** Each `{{ }}` segment's value, in order, for a parameter such as a Postgres node's `={{ a }},{{ b }}`. */
export function evaluateSegments(expression: string, ctx: ExpressionContext): unknown[] {
  const segments = [...body(expression).matchAll(SEGMENT)];
  if (segments.length === 0) throw new Error(`no {{ }} segment in: ${expression}`);
  return segments.map((m) => runInNewContext(`(${m[1]!})`, sandbox(ctx)) as unknown);
}
