import { expect, test } from 'vitest';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

const wf = workflowFile('gmail-entry.json');

test('the trigger polls labeled PDFs every minute, read or unread', () => expect(nodeOf(wf, 'Gmail Trigger')).toMatchObject({
  typeVersion: 1.4,
  parameters: {
    simple: false, maxResults: 10, pollTimes: { item: [{ mode: 'everyMinute' }] },
    filters: { q: 'label:invoices has:attachment filename:pdf -label:processed -label:review -label:duplicate', readStatus: 'both' },
    options: { downloadAttachments: true, dataPropertyAttachmentsPrefixName: 'attachment_' } } }));

test('the whole poll feeds Hand to intake, nothing else', () =>
  expect(sourcesOf(wf, 'Hand to intake', 0)).toEqual(['Gmail Trigger']));

// Regression-prone wiring that a careless edit could silently invert or that a UI save could
// quietly reset to its default.
test('a failed handoff to intake fires the error workflow, not a silent retry', () => {
  const node = nodeOf(wf, 'Hand to intake');
  expect(node.parameters).toMatchObject({
    mode: 'once', workflowId: { value: 'mgpIntakeEmail01' }, options: { waitForSubWorkflow: true } });
  expect(node.retryOnFail).not.toBe(true);
  expect(node.onError).toBeUndefined();
});
test('intake-email accepts the whole caller item, so Hand to intake carries no field mapping', () => {
  // ExecuteWorkflow's own builder hint says to omit workflowInputs once the target trigger accepts
  // all data (checked against the compiled node source): getWorkflowInputValues returns
  // json: { ...json, ...itemFieldValues } plus binary, and the passthrough trigger on the other side
  // returns that verbatim, so the caller's own item already carries every field it had - an empty or
  // missing mapping loses nothing.
  expect(nodeOf(wf, 'Hand to intake').parameters.workflowInputs).toBeUndefined();
});
