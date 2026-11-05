import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { listJsonFiles, readWorkflow, type WorkflowNode } from '../../scripts/lib/workflow.ts';
import type { CheckInput } from '../../src/nodes/check-invoice.ts';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

interface MainConnections {
  main: { node: string }[][];
}

interface SwitchRuleValue {
  outputKey: string;
  conditions: { conditions: { rightValue: string }[] };
}

const wf = workflowFile('extract-invoice.json');
const schema: unknown = JSON.parse(readFileSync('schemas/invoice.schema.json', 'utf8'));

// The shared fields check-invoice's CheckInput needs on every call, echoed from "When called" by
// both Collect nodes. `satisfies` ties this list to CheckInput itself, so a renamed field there
// fails typecheck here, not just the runtime assertion below.
const ECHO_FIELDS = ['event_id', 'received_at', 'path', 'model', 'attempt', 'rules', 'today'] as const satisfies readonly (keyof CheckInput)[];

function assignmentNames(node: WorkflowNode): string[] {
  const assignments = (node.parameters.assignments as { assignments: { name: string }[] }).assignments;
  return assignments.map((a) => a.name);
}

test('the chat model thinks adaptively and sends no sampling parameters', () => {
  const claude = nodeOf(wf, 'Claude');
  expect(claude).toMatchObject({ type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.6 });
  expect(claude.parameters.options).toMatchObject({ thinkingMode: 'adaptive', effort: '={{ $json.effort }}', maxTokensToSample: 16000 });
  for (const k of ['temperature', 'topK', 'topP']) expect(claude.parameters.options).not.toHaveProperty(k);
});
test('the text path extracts against the repository schema', () => {
  const ie = nodeOf(wf, 'Extract from text');
  expect(ie.parameters.schemaType).toBe('manual');
  expect(JSON.parse(String(ie.parameters.inputSchema))).toEqual(schema);
});
test('the PDF path posts to the Messages API with the Anthropic credential', () => {
  const http = nodeOf(wf, 'Read PDF with Claude');
  expect(http.parameters).toMatchObject({
    method: 'POST', url: 'https://api.anthropic.com/v1/messages',
    authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi', jsonBody: '={{ $json.body }}' });
  expect(JSON.stringify(http.parameters.headerParameters)).toContain('anthropic-version');
  expect(http.credentials).toMatchObject({ anthropicApi: { id: 'mgpCredAnthropic' } });
});
test('both paths end in the generated check', () => {
  expect(sourcesOf(wf, 'Check invoice', 0).sort()).toEqual(['Collect PDF result', 'Collect text result']);
  expect(String(nodeOf(wf, 'Check invoice').parameters.jsCode)).toMatch(/^\/\/ Why Code: parses the model reply/);
});

// Regression-prone wiring that a careless edit could silently invert.
test('neither AI call node swallows its own failure', () => {
  for (const name of ['Extract from text', 'Read PDF with Claude']) {
    const node = nodeOf(wf, name);
    expect(node.onError).toBeUndefined();
    // n8n 2.45.6 still honors this legacy flag; when set, the input item passes through the
    // success output instead of the execution failing.
    expect(node.continueOnFail).not.toBe(true);
  }
});
test('Route by path sends output 0 to the text path and output 1 to the PDF path', () => {
  const connections = wf.connections as Record<string, MainConnections>;
  const branches = connections['Route by path']!.main;
  expect(branches[0]!.map((c) => c.node)).toEqual(['Extract from text']);
  expect(branches[1]!.map((c) => c.node)).toEqual(['Encode PDF']);
});
test('Route by path matches text at rule 0 and vision at rule 1', () => {
  // Pinned by rightValue, not just by output position above: a rule reorder (values[0] <->
  // values[1]) would still leave two outputs in the same positions but silently invert which
  // path each one actually matches.
  const values = (nodeOf(wf, 'Route by path').parameters.rules as { values: SwitchRuleValue[] }).values;
  expect(values[0]?.conditions.conditions[0]?.rightValue).toBe('text');
  expect(values[1]?.conditions.conditions[0]?.rightValue).toBe('vision');
});
test('an unknown path is rejected loudly instead of ending silently', () => {
  const switchNode = nodeOf(wf, 'Route by path');
  const fallbackOutput = (switchNode.parameters.options as { fallbackOutput?: string } | undefined)?.fallbackOutput;
  expect(fallbackOutput).toBe('extra');

  // n8n appends the "extra" fallback after every rule's output, so it's always the last entry.
  const connections = wf.connections as Record<string, MainConnections>;
  const branches = connections['Route by path']!.main;
  const fallbackBranch = branches[branches.length - 1]!;
  expect(fallbackBranch.map((c) => c.node)).toEqual(['Reject unknown path']);

  const reject = nodeOf(wf, 'Reject unknown path');
  expect(reject.type).toBe('n8n-nodes-base.stopAndError');
  expect(reject.parameters.errorMessage).toBe('=Unknown extraction path: {{ $json.path }}');
});
test('Collect text result covers every field check-invoice needs for the text path', () => {
  const names = assignmentNames(nodeOf(wf, 'Collect text result'));
  for (const field of ['reply', ...ECHO_FIELDS]) expect(names).toContain(field);
});
test('Collect PDF result covers every field check-invoice needs for the PDF path', () => {
  const names = assignmentNames(nodeOf(wf, 'Collect PDF result'));
  for (const field of ['content', 'stop_reason', ...ECHO_FIELDS]) expect(names).toContain(field);
});
test('no Execute Workflow node in any workflow retries', () => {
  // Scoped to every workflow file, not just this one: extract-invoice.json itself has no Execute
  // Workflow node, so a check limited to this file alone could never fail.
  const found: WorkflowNode[] = [];
  for (const file of listJsonFiles('workflows')) {
    for (const node of readWorkflow(file).nodes) {
      if (node.type === 'n8n-nodes-base.executeWorkflow') found.push(node);
    }
  }
  expect(found.length).toBeGreaterThan(0);
  for (const node of found) expect(node.retryOnFail).not.toBe(true);
});
