import { expect, test } from 'vitest';
import { evaluateExpression } from '../helpers/expression.ts';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

interface MainConnections {
  main: ({ node: string }[] | null)[];
}

const wf = workflowFile('intake-email.json');

test('each attachment becomes one item', () =>
  expect(nodeOf(wf, 'Split attachments').parameters).toMatchObject({ fieldToSplitOut: '$binary', include: 'allOtherFields' }));
test('only newly recorded attachments reach the core, with their PDF', () => {
  expect(nodeOf(wf, 'Keep new attachments').parameters).toMatchObject({ mode: 'combine', combineBy: 'combineByFields', joinMode: 'keepMatches' });
  expect(sourcesOf(wf, 'Keep new attachments', 0)).toEqual(['Keep PDFs']);
  expect(sourcesOf(wf, 'Keep new attachments', 1)).toEqual(['Record event']);
});
test('one failing invoice does not stop the others', () => expect(nodeOf(wf, 'Process invoice')).toMatchObject({
  onError: 'continueErrorOutput',
  parameters: { mode: 'each', workflowId: { value: 'mgpProcessInv001' }, options: { waitForSubWorkflow: true } } }));

// Gmail can send a PDF as application/octet-stream; Keep PDFs lets it through by its .pdf name,
// and Mark as PDF relabels it so Drive stores it as a PDF.
test('every new attachment is marked as a PDF before Process invoice', () => {
  expect(sourcesOf(wf, 'Mark as PDF', 0)).toEqual(['Keep new attachments']);
  expect(sourcesOf(wf, 'Process invoice', 0)).toEqual(['Mark as PDF']);
  expect(nodeOf(wf, 'Mark as PDF')).toMatchObject({ type: 'n8n-nodes-base.code', parameters: { mode: 'runOnceForEachItem' } });
});
// One bad PDF fails only its own call, so the rest of the batch still runs. Its error item then
// fails this execution once, so error-handler alerts even when the call failed before
// process-invoice could start (and so had no execution of its own to alert from).
test('a failed Process invoice item ends the batch at Fail the batch', () => {
  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Process invoice']!.main[1]!.map((c) => c.node)).toEqual(['Fail the batch']);
  expect(connections['Process invoice']!.main[0] ?? []).toEqual([]);
  expect(nodeOf(wf, 'Fail the batch')).toMatchObject({ type: 'n8n-nodes-base.stopAndError', typeVersion: 1, parameters: { errorType: 'errorMessage' } });
});
// The batch semantics rest on this wiring, not on a stack run: Process invoice calls process-invoice
// once per item and routes each failed item to its error output instead of stopping, and n8n's v1
// order runs a node once on everything its parent output, so Fail the batch runs once, after every
// attachment had its call, with all the failed items as its input.
test('a failed attachment never stops the others, and the batch fails once after every call', () => {
  expect(wf.settings.executionOrder).toBe('v1');
  const call = nodeOf(wf, 'Process invoice');
  expect(call).toMatchObject({ onError: 'continueErrorOutput', parameters: { mode: 'each' } });
  expect(call.continueOnFail).toBeUndefined();
  expect(sourcesOf(wf, 'Fail the batch', 0)).toEqual(['Process invoice']);
  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Fail the batch']).toBeUndefined();
  expect(String(nodeOf(wf, 'Fail the batch').parameters.errorMessage)).toContain('$input.all().length');
});
test('Fail the batch names how many attachments failed', () => {
  const message = nodeOf(wf, 'Fail the batch').parameters.errorMessage as string;
  expect(evaluateExpression(message, { inputAll: [{}, {}] }))
    .toBe('process-invoice failed for 2 attachment(s) in this batch; see its failed executions.');
});

// Regression-prone wiring that a careless edit could silently invert or that a UI save could
// quietly reset to its default.
test('Describe attachment keeps the PDF binary despite dropping every other input field', () => {
  // SetV2 forces options.include to 'none' when includeOtherFields is off, and keeps binary only when
  // include !== 'none' and stripBinary is false (checked against the compiled node source), so
  // "other fields off" would drop the PDF. Selecting zero fields keeps the JSON as empty with include
  // at 'selected'; stripBinary defaults to true there, so it's turned off explicitly.
  expect(nodeOf(wf, 'Describe attachment').parameters).toMatchObject({
    includeOtherFields: true, include: 'selected', includeFields: '',
    options: { stripBinary: false } });
});
test('Keep PDFs matches on MIME type or file extension, not both at once', () =>
  expect((nodeOf(wf, 'Keep PDFs').parameters.conditions as { combinator: string }).combinator).toBe('or'));
test('config is checked before the rest of the workflow ever sees it', () => {
  expect(sourcesOf(wf, 'Check config', 0)).toEqual(['Load config']);
  expect(sourcesOf(wf, 'Attach config', 1)).toEqual(['Check config']);
});
test('the trigger item feeds both Load config and Attach config input 1', () => {
  expect(sourcesOf(wf, 'Load config', 0)).toEqual(['When called']);
  expect(sourcesOf(wf, 'Attach config', 0)).toEqual(['When called']);
});
test('the trigger accepts the caller whole item, not a declared subset', () => {
  // If this were switched to declared inputs without mapping id, every event_id downstream
  // (Describe attachment builds it from $json.id) would read as undefined:attachment_N, and
  // attachments from different calls would collide on that one id instead of keeping their own.
  expect(nodeOf(wf, 'When called').parameters).toMatchObject({ inputSource: 'passthrough' });
});
