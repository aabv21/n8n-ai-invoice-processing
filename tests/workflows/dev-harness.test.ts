import { expect, test } from 'vitest';
import { evaluateExpression } from '../helpers/expression.ts';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

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

// intake-email checks the config it loads; the process-invoice target loads its own copy, so it
// checks it the same way before any AI call can run on a half-filled config.
test('the process-invoice target checks the config before calling it', () => {
  const wf = workflowFile('dev-harness.json');
  expect(sourcesOf(wf, 'Check config for process-invoice', 0)).toEqual(['Load config for process-invoice']);
  expect(sourcesOf(wf, 'Attach config to PDF', 1)).toEqual(['Check config for process-invoice']);
  expect(nodeOf(wf, 'Check config for process-invoice').type).toBe('n8n-nodes-base.code');
});

test('the process-invoice target defaults ai_spent_usd to 0, and extract-invoice prior_cost_usd to 0', () => {
  const wf = workflowFile('dev-harness.json');
  const value = (node: string, name: string) => (nodeOf(wf, node).parameters.workflowInputs as { value: Record<string, string> }).value[name]!;
  const input = (body: Record<string, unknown>) => ({ nodes: { 'Receive dev call': { body: { input: body } } }, json: { body: { input: body } } });
  expect(evaluateExpression(value('Call process-invoice', 'ai_spent_usd'), input({}))).toBe(0);
  expect(evaluateExpression(value('Call process-invoice', 'ai_spent_usd'), input({ ai_spent_usd: 5 }))).toBe(5);
  expect(evaluateExpression(value('Call extract-invoice', 'prior_cost_usd'), input({}))).toBe(0);
  expect(evaluateExpression(value('Call extract-invoice', 'prior_cost_usd'), input({ prior_cost_usd: 0.4 }))).toBe(0.4);
});

test('the ensure-folder target passes parent_id and name and responds with the folder id', () => {
  const wf = workflowFile('dev-harness.json');

  const rules = (nodeOf(wf, 'Route by target').parameters.rules as { values: { outputKey: string }[] }).values;
  // Appended after summary-preview, so every earlier target keeps its output index.
  expect(rules.map((r) => r.outputKey)).toEqual(['load-config', 'extract-invoice', 'process-invoice', 'intake-email', 'summary-preview', 'ensure-folder', 'approve-invoice']);

  const call = nodeOf(wf, 'Call ensure-folder');
  expect(call.parameters).toMatchObject({
    workflowId: { value: 'mgpEnsureFolder1' }, mode: 'once', options: { waitForSubWorkflow: true } });
  expect((call.parameters.workflowInputs as { value: Record<string, string> }).value).toEqual({
    parent_id: '={{ $json.body.input.parent_id }}',
    name: '={{ $json.body.input.name }}',
  });

  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Route by target']!.main[5]!.map((c) => c.node)).toEqual(['Call ensure-folder']);
  expect(connections['Call ensure-folder']!.main[0]!.map((c) => c.node)).toEqual(['Respond with result']);
});

test('the approve-invoice target loads config and passes the row', () => {
  const wf = workflowFile('dev-harness.json');

  const rules = (nodeOf(wf, 'Route by target').parameters.rules as { values: { outputKey: string }[] }).values;
  const index = rules.findIndex((r) => r.outputKey === 'approve-invoice');
  expect(index).toBe(rules.length - 1);

  expect(nodeOf(wf, 'Load config for approve-invoice').parameters).toMatchObject({ workflowId: { value: 'mgpLoadConfig001' } });
  const call = nodeOf(wf, 'Call approve-invoice');
  expect(call.alwaysOutputData).toBe(true);
  expect(call.parameters).toMatchObject({ workflowId: { value: 'mgpApproveOne001' }, mode: 'once', options: { waitForSubWorkflow: true } });
  const mapped = (call.parameters.workflowInputs as { value: Record<string, string> }).value;
  expect(mapped.config).toBe('={{ $json.config }}');
  const body = { input: { row: { invoice_id: '7', approved_by: 'Laura' } } };
  expect(evaluateExpression(mapped.row!, { nodes: { 'Receive dev call': { body } } })).toEqual(body.input.row);

  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Route by target']!.main[index]!.map((c) => c.node)).toEqual(['Load config for approve-invoice']);
  expect(connections['Load config for approve-invoice']!.main[0]!.map((c) => c.node)).toEqual(['Call approve-invoice']);
  expect(connections['Call approve-invoice']!.main[0]!.map((c) => c.node)).toEqual(['Respond with result']);
  // The unknown-target fallback stays last.
  const branches = connections['Route by target']!.main;
  expect(branches[branches.length - 1]!.map((c) => c.node)).toEqual(['Respond unknown target']);
});

test('the extract-invoice target converts pdf_base64 to attachment_0 when present', () => {
  const wf = workflowFile('dev-harness.json');
  const connections = wf.connections as Record<string, { main: { node: string }[][] }>;
  const rules = (nodeOf(wf, 'Route by target').parameters.rules as { values: { outputKey: string }[] }).values;
  const index = rules.findIndex((r) => r.outputKey === 'extract-invoice');
  expect(connections['Route by target']!.main[index]!.map((c) => c.node)).toEqual(['Has PDF for extract-invoice?']);

  const check = nodeOf(wf, 'Has PDF for extract-invoice?');
  expect(check.type).toBe('n8n-nodes-base.if');
  const [condition] = (check.parameters.conditions as { conditions: { leftValue: string }[] }).conditions;
  expect(condition!.leftValue).toBe("={{ ($json.body.input.pdf_base64 ?? '') !== '' }}");
  expect(connections['Has PDF for extract-invoice?']!.main[0]!.map((c) => c.node)).toEqual(['Convert PDF for extract-invoice']);
  expect(nodeOf(wf, 'Convert PDF for extract-invoice').parameters).toMatchObject({
    operation: 'toBinary', sourceProperty: 'body.input.pdf_base64', binaryPropertyName: 'attachment_0' });
  expect(connections['Convert PDF for extract-invoice']!.main[0]!.map((c) => c.node)).toEqual(['Call extract-invoice']);
});

test('without pdf_base64 it calls extract-invoice directly', () => {
  const wf = workflowFile('dev-harness.json');
  const connections = wf.connections as Record<string, { main: { node: string }[][] }>;
  expect(connections['Has PDF for extract-invoice?']!.main[1]!.map((c) => c.node)).toEqual(['Call extract-invoice']);
  const input = (body: Record<string, unknown>) => ({ json: { body: { input: body } } });
  const left = (nodeOf(wf, 'Has PDF for extract-invoice?').parameters.conditions as { conditions: { leftValue: string }[] }).conditions[0]!.leftValue;
  expect(evaluateExpression(left, input({ path: 'bogus' }))).toBe(false);
  expect(evaluateExpression(left, input({ pdf_base64: '' }))).toBe(false);
  expect(evaluateExpression(left, input({ pdf_base64: 'JVBERi0=' }))).toBe(true);
});

test('Call extract-invoice reads its inputs from the dev call, not the converted item', () => {
  const wf = workflowFile('dev-harness.json');
  const mapped = (nodeOf(wf, 'Call extract-invoice').parameters.workflowInputs as { value: Record<string, string> }).value;
  for (const [name, expression] of Object.entries(mapped)) {
    expect(expression, name).toContain("$('Receive dev call').first().json.body.input.");
    expect(expression, name).not.toContain('$json');
  }
  expect(mapped.binary_key).toBe("={{ $('Receive dev call').first().json.body.input.binary_key ?? 'attachment_0' }}");
});
