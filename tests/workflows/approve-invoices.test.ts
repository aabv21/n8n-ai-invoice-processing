import { expect, test } from 'vitest';
import { evaluateExpression } from '../helpers/expression.ts';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

const wf = workflowFile('approve-invoices.json');

interface MainConnections {
  main: { node: string }[][];
}
const connections = wf.connections as Record<string, MainConnections>;

test('polls every 5 minutes and reads only review rows', () => {
  expect(nodeOf(wf, 'Every 5 minutes').parameters).toEqual({ rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } });
  const read = nodeOf(wf, 'Read invoice rows');
  expect(read.parameters).toMatchObject({
    operation: 'read',
    documentId: { value: '={{ $json.config.google.spreadsheet_id }}' },
    sheetName: { mode: 'name', value: '={{ $json.config.google.invoices_tab }}' },
    filtersUI: { values: [{ lookupColumn: 'status', lookupValue: 'review' }] },
    options: { outputFormatting: { values: { general: 'UNFORMATTED_VALUE', date: 'SERIAL_NUMBER' } } },
  });
  expect(read.retryOnFail).toBe(true);
  expect([read.maxTries, read.waitBetweenTries]).toEqual([3, 1000]);
  expect(sourcesOf(wf, 'Load config', 0)).toEqual(['Every 5 minutes']);
  expect(sourcesOf(wf, 'Check config', 0)).toEqual(['Load config']);
  expect(sourcesOf(wf, 'Read invoice rows', 0)).toEqual(['Check config']);
});

// A row with no invoice_id or no email_id can't be matched back to its own row, so a refusal note would
// land nowhere or fail on every poll: such a row is ignored.
test('keeps only rows with a non-blank approved_by, invoice_id and email_id', () => {
  const filter = nodeOf(wf, 'Keep approved rows');
  const conditions = (filter.parameters.conditions as { conditions: { leftValue: string; operator: { operation: string } }[] }).conditions;
  expect(conditions).toHaveLength(3);
  for (const condition of conditions) expect(condition.operator.operation).toBe('notEmpty');
  const value = (index: number, cell: string, v: unknown) => evaluateExpression(conditions[index]!.leftValue, { json: { [cell]: v } });
  expect(value(0, 'approved_by', '  ')).toBe('');
  expect(value(0, 'approved_by', '')).toBe('');
  expect(value(0, 'approved_by', null)).toBe('');
  expect(value(0, 'approved_by', 'Laura')).toBe('Laura');
  expect(value(1, 'invoice_id', ' ')).toBe('');
  expect(value(2, 'email_id', null)).toBe('');
  expect(value(1, 'invoice_id', 12)).toBe('12');
  expect(sourcesOf(wf, 'Keep approved rows', 0)).toEqual(['Read invoice rows']);
});

test('calls approve-invoice once per row with its error output going to Fail the approval batch', () => {
  const call = nodeOf(wf, 'Approve invoice');
  expect(call.parameters).toMatchObject({ workflowId: { value: 'mgpApproveOne001' }, mode: 'each', options: { waitForSubWorkflow: true } });
  expect(call.onError).toBe('continueErrorOutput');
  expect(call.retryOnFail).toBeUndefined();
  const mapped = (call.parameters.workflowInputs as { value: Record<string, string> }).value;
  const config = { team_locale: 'es' };
  expect(evaluateExpression(mapped.config!, { json: { invoice_id: '1' }, nodes: { 'Check config': { config } } })).toBe(config);
  expect(mapped.row).toBe('={{ $json }}');
  expect(sourcesOf(wf, 'Approve invoice', 0)).toEqual(['Keep approved rows']);
  expect(connections['Approve invoice']!.main[1]!.map((c) => c.node)).toEqual(['Fail the approval batch']);
  const fail = nodeOf(wf, 'Fail the approval batch');
  expect(fail.type).toBe('n8n-nodes-base.stopAndError');
  expect(evaluateExpression(fail.parameters.errorMessage as string, { inputAll: [1, 2] })).toBe(
    'approve-invoice failed for 2 row(s); see its failed executions.',
  );
});

test('settings and the error workflow', () => {
  expect(wf.id).toBe('mgpApproveInvs01');
  expect(wf.settings).toMatchObject({
    executionOrder: 'v1', timezone: 'America/Bogota', callerPolicy: 'workflowsFromSameOwner',
    errorWorkflow: 'mgpErrorHandler1', saveManualExecutions: false,
  });
});
