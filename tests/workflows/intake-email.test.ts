import { expect, test } from 'vitest';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

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

// Regression-prone wiring that a careless edit could silently invert or that a UI save could
// quietly reset to its default.
test('Describe attachment keeps the PDF binary despite dropping every other input field', () => {
  // SetV2.node.js forces options.include to 'none' whenever includeOtherFields is off, and
  // composeReturnItem only keeps binary data when options.include !== 'none' and stripBinary is
  // false (checked against the compiled node source) - so "other fields off" alone would silently
  // drop the PDF. Selecting zero fields keeps the JSON output exactly as empty as "none" would,
  // but leaves options.include at 'selected' (not 'none'), and stripBinary must be turned off
  // explicitly, since it defaults to true once other fields are included at all.
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
