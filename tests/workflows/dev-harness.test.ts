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

  // n8n appends the "extra" fallback output after every rule's output, so it's the connections
  // array's last entry, not a fixed index, however many rules come before it.
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

test('intake-email target shapes one Gmail-like item and keeps its binary', () => {
  const wf = workflowFile('dev-harness.json');

  const convert = nodeOf(wf, 'Convert PDF for intake-email');
  expect(convert.parameters).toMatchObject({
    operation: 'toBinary', sourceProperty: 'body.input.pdf_base64', binaryPropertyName: 'attachment_0',
    options: { fileName: '={{ $json.body.input.file_name }}', mimeType: '={{ $json.body.input.mime_type }}' } });

  // Same binary-preserving shape as intake-email's "Describe attachment": include: 'none' (forced
  // when includeOtherFields is off) always drops binary, so selecting zero fields is the only way to
  // drop every other field and keep the binary.
  const shape = nodeOf(wf, 'Shape Gmail item');
  expect(shape.parameters).toMatchObject({
    includeOtherFields: true, include: 'selected', includeFields: '',
    options: { stripBinary: false } });
  const assignments = (shape.parameters.assignments as { assignments: { name: string; value: string }[] }).assignments;
  expect(assignments).toHaveLength(1);
  // Convert to File (checked against the compiled node source) outputs {} plus the binary it added,
  // so "message_id" is read back from the webhook node by name, as "Call process-invoice" does.
  expect(assignments[0]).toMatchObject({ name: 'id', type: 'string', value: "={{ $('Receive dev call').first().json.body.input.message_id }}" });

  // intake-email's trigger accepts all data (checked against the compiled node source): the
  // caller's own item - including the id "Shape Gmail item" just set - rides along whether or not
  // this call maps any field explicitly, so it carries none.
  const call = nodeOf(wf, 'Call intake-email');
  expect(call.parameters).toMatchObject({ workflowId: { value: 'mgpIntakeEmail01' } });
  expect(call.parameters.workflowInputs).toBeUndefined();

  const connections = wf.connections as Record<string, MainConnections>;
  const intakeEmailBranch = connections['Route by target']!.main[3]!;
  expect(intakeEmailBranch.map((c) => c.node)).toEqual(['Convert PDF for intake-email']);
  expect(connections['Convert PDF for intake-email']!.main[0]!.map((c) => c.node)).toEqual(['Shape Gmail item']);
  expect(connections['Shape Gmail item']!.main[0]!.map((c) => c.node)).toEqual(['Call intake-email']);
  expect(connections['Call intake-email']!.main[0]!.map((c) => c.node)).toEqual(['Respond with result']);
});

// summary-preview passes { run_at, dry_run } to daily-summary and returns its output, exercising
// daily-summary's dry_run IF offline, through real Postgres.
test('summary-preview target passes { run_at, dry_run } to daily-summary and responds with its output', () => {
  const wf = workflowFile('dev-harness.json');

  const switchNode = nodeOf(wf, 'Route by target');
  const rules = (switchNode.parameters.rules as { values: { outputKey: string }[] }).values;
  const targetIndex = rules.findIndex((r) => r.outputKey === 'summary-preview');
  expect(targetIndex).toBeGreaterThanOrEqual(0);

  const call = nodeOf(wf, 'Call daily-summary');
  expect(call.parameters).toMatchObject({ workflowId: { value: 'mgpDailySummary1' } });
  const mapped = (call.parameters.workflowInputs as { value: Record<string, string> }).value;
  expect(mapped).toMatchObject({
    run_at: '={{ $json.body.input.run_at }}',
    dry_run: '={{ $json.body.input.dry_run }}',
  });

  const connections = wf.connections as Record<string, MainConnections>;
  const summaryPreviewBranch = connections['Route by target']!.main[targetIndex]!;
  expect(summaryPreviewBranch.map((c) => c.node)).toEqual(['Call daily-summary']);
  expect(connections['Call daily-summary']!.main[0]!.map((c) => c.node)).toEqual(['Respond with result']);
});
