import { expect, test } from 'vitest';
import { nodeOf, workflowFile } from '../helpers/workflow-file.ts';

interface MainConnections {
  main: { node: string }[][];
}

test('the dev harness webhook is a token-gated POST to /webhook/dev', () => {
  const webhook = nodeOf(workflowFile('dev-harness.json'), 'Receive dev call');
  expect(webhook.parameters).toMatchObject({ path: 'dev', httpMethod: 'POST', authentication: 'headerAuth' });
  expect(webhook.credentials?.httpHeaderAuth?.id).toBe('mgpCredDevToken1');
});

test('an unmatched target reaches the 404 responder through the Switch fallback', () => {
  const wf = workflowFile('dev-harness.json');

  const switchNode = nodeOf(wf, 'Route by target');
  const fallbackOutput = (switchNode.parameters.options as { fallbackOutput?: string } | undefined)?.fallbackOutput;
  expect(fallbackOutput).toBe('extra');

  // The "extra" fallback is always the last output n8n appends after every rule's own output, so
  // the fallback branch is the connections array's last entry, not a hard-coded index — this still
  // finds it once a later task adds more rules ahead of it.
  const connections = wf.connections as Record<string, MainConnections>;
  const switchBranches = connections['Route by target']!.main;
  const fallbackBranch = switchBranches[switchBranches.length - 1]!;
  expect(fallbackBranch.map((c) => c.node)).toEqual(['Respond unknown target']);

  const responder = nodeOf(wf, 'Respond unknown target');
  expect(responder.parameters).toMatchObject({
    responseBody: '{\n  "error": "unknown_target"\n}',
    options: { responseCode: 404 },
  });
});
