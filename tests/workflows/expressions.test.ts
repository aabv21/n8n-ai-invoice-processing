// Compiles every `={{ }}` expression in every committed workflow as JavaScript. n8n's import, the
// validator and the gate all accept an expression with a syntax error (an unescaped apostrophe in
// a quoted string, say) and the workflow then fails at run time, so this is the only check that
// would catch it. Nothing runs: `vm.Script` only compiles.
import { readdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { expect, test } from 'vitest';
import { readWorkflow } from '../../scripts/lib/workflow.ts';

const SEGMENT = /\{\{([\s\S]*?)\}\}/g;

/** Every string value under `value` that starts with `=`, with its path. */
function expressionsIn(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === 'string') return value.startsWith('=') ? [{ path, text: value }] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => expressionsIn(item, `${path}[${String(index)}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => expressionsIn(item, `${path}.${key}`));
  }
  return [];
}

/** The syntax error of one expression body, or null when it parses. */
export function syntaxError(body: string): string | null {
  try {
    // Compiling never runs the code, and a free identifier such as $json or DateTime is only a
    // reference, so n8n's globals need no stubs to parse.
    new Script(`(${body})`);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function brokenExpressions(workflowName: string, nodes: { name: string; parameters: unknown }[]): string[] {
  const broken: string[] = [];
  for (const node of nodes) {
    for (const { path, text } of expressionsIn(node.parameters, 'parameters')) {
      for (const match of text.matchAll(SEGMENT)) {
        const error = syntaxError(match[1]!);
        if (error !== null) broken.push(`${workflowName} › ${node.name} › ${path}: ${error}`);
      }
    }
  }
  return broken;
}

test('a broken expression is reported with its node and parameter', () => {
  const nodes = [{ name: 'Say', parameters: { text: "={{ 'it's' }}", fine: '={{ $json.a ?? 1 }}' } }];
  const broken = brokenExpressions('demo', nodes);
  expect(broken).toHaveLength(1);
  expect(broken[0]).toContain('demo › Say › parameters.text');
});

const brokenIn = (text: string) => brokenExpressions('demo', [{ name: 'Node', parameters: { value: text } }]);

test('a broken segment is found after good ones in a multi-segment string', () => {
  expect(brokenIn('={{ $json.a }},{{ $json.b ?? 0 }},{{ $json.c ?? \'it\'s\' }}')).toHaveLength(1);
  expect(brokenIn('={{ $json.a }},{{ $json.b ?? 0 }},{{ $json.c }}')).toEqual([]);
});

test('an apostrophe inside a $fromAI argument is reported', () => {
  expect(brokenIn("={{ $fromAI('body', 'the model's body', 'string') }}")).toHaveLength(1);
  expect(brokenIn("={{ $fromAI('body', 'the body', 'string') }}")).toEqual([]);
});

test('a JSON-template body with a missing comma is reported', () => {
  expect(brokenIn('={{ { "a": $json.a "b": 2 } }}')).toHaveLength(1);
  expect(brokenIn('={{ { "a": $json.a, "b": 2 } }}')).toEqual([]);
});

for (const file of readdirSync('workflows').filter((name) => name.endsWith('.json'))) {
  test(`${file}: every expression compiles`, () => {
    const workflow = readWorkflow(`workflows/${file}`);
    expect(brokenExpressions(file, workflow.nodes)).toEqual([]);
  });
}
