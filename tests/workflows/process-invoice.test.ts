import { expect, test } from 'vitest';
import { listJsonFiles, readWorkflow, type WorkflowNode } from '../../scripts/lib/workflow.ts';
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
    'Is duplicate?': ['Is duplicate conflicting?', 'Ensure year folder'],
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
  expect(leftValues).toContain("$('Save invoice').first().json.duplicate_of_total");
  expect(leftValues).toContain("$('Save invoice').first().json.duplicate_of_issue_date");
  expect(leftValues).toContain('.invoice.total');
  expect(leftValues).toContain('.invoice.issue_date');
});
// save-invoice.sql returns duplicate_of_issue_date as an already-formatted YYYY-MM-DD string
// (to_char, not the raw date column), so the IF compares it directly - no String(...).slice(0, 10)
// workaround for a JS Date the Postgres node (like node-postgres) would otherwise parse a `date`
// column into, which would never equal the extracted invoice's own ISO date string.
test('the issue-date comparison compares the SQL-formatted string directly, with no Date coercion', () => {
  const conditions = nodeOf(wf, 'Is duplicate conflicting?').parameters.conditions as { conditions: { leftValue: string }[] };
  const dateCondition = conditions.conditions.find((c) => c.leftValue.includes('duplicate_of_issue_date'));
  expect(dateCondition?.leftValue).not.toContain('String(');
  expect(dateCondition?.leftValue).not.toContain('.slice(');
  expect(dateCondition?.leftValue).toBe(
    "={{ $('Save invoice').first().json.duplicate_of_issue_date !== $('Prepare record').first().json.invoice.issue_date }}",
  );
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
  expect(recordDuplicate.queryReplacement).toContain("$('Save invoice').first().json.duplicate_of");

  const labelEmail = nodeOf(wf, 'Label email').parameters.labelIds;
  expect(String(labelEmail)).toContain("$('Save Drive link').first().json.invoice");

  const recordOutcome = nodeOf(wf, 'Record outcome').parameters.options as { queryReplacement?: string };
  expect(recordOutcome.queryReplacement).toContain("$('Save Drive link').first().json.invoice");
});
