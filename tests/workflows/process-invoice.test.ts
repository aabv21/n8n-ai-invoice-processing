import { describe, expect, test } from 'vitest';
import { listJsonFiles, readWorkflow, type WorkflowNode } from '../../scripts/lib/workflow.ts';
import { evaluateExpression, evaluateSegments } from '../helpers/expression.ts';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

interface MainConnections {
  main: { node: string }[][];
}

const wf = workflowFile('process-invoice.json');

test('the PDF is re-attached from the trigger before the retry and the upload', () => {
  for (const merge of ['Attach PDF for retry', 'Attach PDF for Drive']) {
    expect(nodeOf(wf, merge).parameters).toMatchObject({ mode: 'combine', combineBy: 'combineByPosition' });
    expect(sourcesOf(wf, merge, 0)).toEqual(['When called']);
  }
});
test('both attempts call extract-invoice', () => {
  for (const n of ['Extract with default model', 'Retry with stronger model'])
    expect(nodeOf(wf, n).parameters.workflowId).toMatchObject({ value: 'mgpExtractInv001' });
});
test('Sheets rows are written by key, not appended blindly', () => {
  for (const [n, key] of [['Append invoice row', 'invoice_id'], ['Append item rows', 'item_key']] as const) {
    expect(nodeOf(wf, n).parameters).toMatchObject({ operation: 'appendOrUpdate', options: { cellFormat: 'RAW' } });
    expect((nodeOf(wf, n).parameters.columns as { matchingColumns: string[] }).matchingColumns).toEqual([key]);
    // The config value is a tab name ("Items"/"Invoices"), not a numeric sheet id: in 'id' mode
    // n8n compares sheetId === parseInt(value), which is always NaN for a name.
    expect(nodeOf(wf, n).parameters.sheetName).toMatchObject({ mode: 'name' });
  }
});
test('item rows run before the outcome is recorded', () =>
  expect((nodeOf(wf, 'Split items').position as number[])[1]).toBeLessThan((nodeOf(wf, 'Append invoice row').position as number[])[1] ?? 0));
test('every path converges on Prepare record', () => expect(sourcesOf(wf, 'Prepare record', 0).sort()).toEqual([
  'Needs retry?', 'Retry with stronger model', 'Skip: too many pages', 'Skip: unreadable PDF']));

// Regression-prone wiring that a careless edit could silently invert or that a UI save could
// quietly reset to its default.
test('every Postgres node, across workflows, is typeVersion 2.8 or later', () => {
  const found: WorkflowNode[] = [];
  for (const file of listJsonFiles('workflows')) {
    for (const node of readWorkflow(file).nodes) {
      if (node.type === 'n8n-nodes-base.postgres') found.push(node);
    }
  }
  expect(found.length).toBeGreaterThan(0);
  for (const node of found) expect(node.typeVersion).toBeGreaterThanOrEqual(2.8);
});
test('both position merges resolve a field clash in favor of the later input', () => {
  for (const merge of ['Attach PDF for retry', 'Attach PDF for Drive']) {
    const options = nodeOf(wf, merge).parameters.options as { clashHandling?: { values?: { resolveClash?: string } } };
    expect(options.clashHandling?.values?.resolveClash).toBe('preferLast');
  }
});
test('the duplicate, retry, and page-count decisions route true/false to the documented branches', () => {
  const connections = wf.connections as Record<string, MainConnections>;
  const expected: Record<string, readonly [string, string]> = {
    'Is duplicate?': ['Look up the original', 'Ensure year folder'],
    'Is duplicate conflicting?': ['Label as review (conflicting duplicate)', 'Label as duplicate'],
    'Needs retry?': ['Attach PDF for retry', 'Prepare record'],
    'Too many pages?': ['Skip: too many pages', 'Extract with default model'],
  };
  for (const [node, [first, second]] of Object.entries(expected)) {
    const branches = connections[node]!.main;
    expect(branches[0]!.map((c) => c.node)).toEqual([first]);
    expect(branches[1]!.map((c) => c.node)).toEqual([second]);
  }
});
test('a conflicting duplicate (different total or issue date) gets the Review label, not Duplicate', () => {
  const conditions = nodeOf(wf, 'Is duplicate conflicting?').parameters.conditions as { combinator: string; conditions: { leftValue: string }[] };
  expect(conditions.combinator).toBe('or');
  const leftValues = conditions.conditions.map((c) => c.leftValue).join(' ');
  expect(leftValues).toContain("$('Look up the original').first().json.total");
  expect(leftValues).toContain("$('Look up the original').first().json.issue_date");
  expect(leftValues).toContain('.invoice.total');
  expect(leftValues).toContain('.invoice.issue_date');
});
// find-original.sql returns issue_date as YYYY-MM-DD text, so the IF compares it directly, with no
// String(...).slice(0, 10) workaround for a JS Date.
test('the issue-date comparison compares the SQL-formatted string directly, with no Date coercion', () => {
  const conditions = nodeOf(wf, 'Is duplicate conflicting?').parameters.conditions as { conditions: { leftValue: string }[] };
  const dateCondition = conditions.conditions.find((c) => c.leftValue.includes('.issue_date'));
  expect(dateCondition?.leftValue).not.toContain('String(');
  expect(dateCondition?.leftValue).not.toContain('.slice(');
  expect(dateCondition?.leftValue).toBe(
    "={{ $('Look up the original').first().json.issue_date !== $('Prepare record').first().json.invoice.issue_date }}",
  );
});

// The save statement's snapshot can miss an original that a concurrent save committed (two copies
// in one poll), so every duplicate is compared against its original read back in a new statement.
test('a duplicate looks up its original in a new statement before the comparison', () => {
  expect(sourcesOf(wf, 'Look up the original', 0)).toEqual(['Is duplicate?']);
  expect(sourcesOf(wf, 'Is duplicate conflicting?', 0)).toEqual(['Look up the original']);
  const lookup = nodeOf(wf, 'Look up the original');
  expect(lookup).toMatchObject({ type: 'n8n-nodes-base.postgres', typeVersion: 2.8, retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 });
  const queryReplacement = (lookup.parameters.options as { queryReplacement: string }).queryReplacement;
  expect(evaluateSegments(queryReplacement, {
    nodes: { 'Prepare record': { invoice: { supplier_tax_id: '9013845522', invoice_number: 'BE-2041' } } },
  })).toEqual(['9013845522', 'BE-2041']);
});

describe('Is duplicate conflicting?', () => {
  const conditions = () => (nodeOf(wf, 'Is duplicate conflicting?').parameters.conditions as { conditions: { leftValue: string }[] })
    .conditions.map((c) => c.leftValue);
  const PREPARED = { invoice: { total: 2082500, issue_date: '2026-10-03' } };
  const conflicting = (original: Record<string, unknown>) =>
    conditions().some((leftValue) => evaluateExpression(leftValue, { nodes: { 'Look up the original': original, 'Prepare record': PREPARED } }) === true);

  // A genuine re-send, or a copy that raced the original in the same poll: the lookup runs after
  // the race, so it sees the winner's committed row and the values agree.
  test('a duplicate, racing or not, with a matching total and date is not conflicting', () =>
    expect(conflicting({ id: '7', total: '2082500.00', issue_date: '2026-10-03' })).toBe(false));
  test('a duplicate, racing or not, with a different total or issue date is conflicting', () => {
    expect(conflicting({ id: '7', total: '3082500.00', issue_date: '2026-10-03' })).toBe(true);
    expect(conflicting({ id: '7', total: '2082500.00', issue_date: '2026-10-04' })).toBe(true);
  });
  // Fail closed: a duplicate whose original can't be read back goes to a person, never to Duplicate.
  test('a duplicate whose original is not found is conflicting', () =>
    expect(conflicting({ id: null, total: null, issue_date: null })).toBe(true));
});
test('Record duplicate links the original it looked up, or sends an empty id when there was none', () => {
  const queryReplacement = (nodeOf(wf, 'Record duplicate').parameters.options as { queryReplacement: string }).queryReplacement;
  const values = (id: unknown) => evaluateSegments(queryReplacement, {
    nodes: { 'When called': { event_id: 'm2:attachment_0' }, 'Look up the original': { id } },
  });
  expect(values('7')).toEqual(['m2:attachment_0', 'duplicate', '7']);
  expect(values(null)).toEqual(['m2:attachment_0', 'duplicate', '']);
});
test('a conflicting duplicate still records the duplicate outcome, linked to the original', () => {
  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Label as review (conflicting duplicate)']!.main[0]!.map((c) => c.node)).toEqual(['Record duplicate']);
  const labelIds = nodeOf(wf, 'Label as review (conflicting duplicate)').parameters.labelIds;
  expect(String(labelIds)).toContain('config.gmail.label_ids.review');
});
test('Extract text continues on error instead of failing the execution, into the unreadable-PDF branch', () => {
  expect(nodeOf(wf, 'Extract text').onError).toBe('continueErrorOutput');
  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Extract text']!.main[1]!.map((c) => c.node)).toEqual(['Skip: unreadable PDF']);
});
test('too many pages? also routes on text length, past max_text_chars', () => {
  const leftValue = (nodeOf(wf, 'Too many pages?').parameters.conditions as { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
  expect(leftValue).toContain('numpages > $json.config.extraction.max_pages');
  expect(leftValue).toContain('text.length > $json.config.extraction.max_text_chars');
});
test('the skip reason names which limit was exceeded', () => {
  const skipReason = (nodeOf(wf, 'Skip: too many pages').parameters.assignments as { assignments: { name: string; value: string }[] })
    .assignments.find((a) => a.name === 'skip_reason')?.value;
  expect(skipReason).toContain('too_many_pages');
  expect(skipReason).toContain('too_much_text');
});
test('a missing retry model is treated the same as an empty one', () => {
  // config.ai.retry_model turning the retry off is documented for an *empty* string; a config
  // that omits the key entirely must not read as "a retry model is configured".
  const conditions = nodeOf(wf, 'Needs retry?').parameters.conditions as { conditions: { leftValue: string }[] };
  expect(conditions.conditions[0]?.leftValue).toContain("retry_model ?? '') !== ''");
});
test('the duplicate and outcome paths anchor to their actual source node, not a same-item shorthand', () => {
  // "Record duplicate" and "Record outcome"/"Label email" each run after a Gmail or Sheets node
  // that replaces $json with its own API response, so the value they need is no longer on the
  // current item - it has to be read back from the node that actually produced it.
  const recordDuplicate = nodeOf(wf, 'Record duplicate').parameters.options as { queryReplacement?: string };
  expect(recordDuplicate.queryReplacement).toContain("$('Look up the original').first().json.id");

  const labelEmail = nodeOf(wf, 'Label email').parameters.labelIds;
  expect(String(labelEmail)).toContain("$('Save Drive link').first().json.invoice");

  const recordOutcome = nodeOf(wf, 'Record outcome').parameters.options as { queryReplacement?: string };
  expect(recordOutcome.queryReplacement).toContain("$('Save Drive link').first().json.invoice");
});
