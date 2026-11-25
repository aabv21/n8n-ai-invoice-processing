import { expect, test } from 'vitest';
import { evaluateExpression, evaluateSegments } from '../helpers/expression.ts';
import { runGenerated } from '../helpers/run-generated.ts';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

const wf = workflowFile('approve-invoice.json');

interface MainConnections {
  main: { node: string }[][];
}
const connections = wf.connections as Record<string, MainConnections>;
const next = (node: string, output = 0) => connections[node]!.main[output]!.map((c) => c.node);

test('a valid row is saved, then the row, then the labels', () => {
  expect(next('When called')).toEqual(['Shape approval input']);
  expect(next('Shape approval input')).toEqual(['Check approval']);
  expect(next('Check approval')).toEqual(['Approval valid?']);
  expect(next('Approval valid?', 0)).toEqual(['Save approval']);
  expect(next('Save approval')).toEqual(['Approved?']);
  expect(next('Approved?', 0)).toEqual(['Mark row approved']);
  expect(next('Mark row approved')).toEqual(['Label as processed']);
  expect(next('Label as processed')).toEqual(['Review still needed?']);
  // Review still needed? true ends the run; false removes the label.
  expect(next('Review still needed?', 0)).toEqual([]);
  expect(next('Review still needed?', 1)).toEqual(['Remove review label']);
  expect(nodeOf(wf, 'Remove review label').parameters).toMatchObject({ operation: 'removeLabels' });
  expect(nodeOf(wf, 'Label as processed').parameters).toMatchObject({ operation: 'addLabels' });
});

test('Save approval binds the id, the corrected fields as JSON, the approver, and the email id', () => {
  const save = nodeOf(wf, 'Save approval');
  expect(save.typeVersion).toBeGreaterThanOrEqual(2.8);
  const invoice = { supplier: 'Bolsamar Empaques S.A.S.', total: 2_082_500 };
  const values = evaluateSegments((save.parameters.options as { queryReplacement: string }).queryReplacement, {
    json: { ok: true, invoice_id: '12', email_id: 'gm12', approved_by: 'Perez, Laura', invoice },
  });
  expect(values).toEqual(['12', JSON.stringify(invoice), 'Perez, Laura', 'gm12']);
});

test('Approved? treats already_approved as approved', () => {
  const condition = (nodeOf(wf, 'Approved?').parameters.conditions as { conditions: { leftValue: string }[] }).conditions[0]!.leftValue;
  const result = (r: string) => evaluateExpression(condition, { json: { result: r } });
  expect(result('approved')).toBe(true);
  expect(result('already_approved')).toBe(true);
  for (const refused of ['duplicate_key', 'not_in_review', 'not_found']) expect(result(refused)).toBe(false);
});

test('a refused approval writes its note to the row', () => {
  expect(next('Approval valid?', 1)).toEqual(['Write approval note']);
  expect(next('Approved?', 1)).toEqual(['Shape note input']);
  expect(next('Shape note input')).toEqual(['Render approval note']);
  expect(next('Render approval note')).toEqual(['Write approval note']);
  const write = nodeOf(wf, 'Write approval note');
  expect(write.parameters).toMatchObject({ operation: 'update', columns: { value: { approval_note: '={{ $json.note }}' } } });
  const shape = (nodeOf(wf, 'Shape note input').parameters.assignments as { assignments: { name: string; value: string }[] }).assignments;
  expect(shape.map((a) => a.name)).toEqual(['team_locale', 'invoice_id', 'email_id', 'result']);
  // The note lands on the row that holds both ids, never on another invoice's row.
  expect(write.parameters).toMatchObject({ columns: { matchingColumns: ['invoice_id', 'email_id'], value: { email_id: '={{ $json.email_id }}' } } });
});

test('Mark row approved writes the values Postgres saved, matches both ids, and clears the note', () => {
  const update = nodeOf(wf, 'Mark row approved');
  const columns = update.parameters.columns as { matchingColumns: string[]; value: Record<string, string> };
  expect(columns.matchingColumns).toEqual(['invoice_id', 'email_id']);
  expect(Object.keys(columns.value)).toEqual([
    'invoice_id', 'email_id', 'status', 'review_reasons', 'approval_note', 'supplier', 'supplier_tax_id', 'invoice_number',
    'issue_date', 'due_date', 'currency', 'subtotal', 'tax', 'total',
  ]);
  expect(columns.value).toMatchObject({ status: 'ok', review_reasons: '', approval_note: '' });
  expect(sourcesOf(wf, 'Mark row approved', 0)).toEqual(['Approved?']);
  // On a replay these are the first approval's values, so the sheet never drifts from Postgres.
  const saved = { supplier: 'Saved SAS', total: 2_082_500 };
  const nodes = { 'Save approval': saved, 'Check approval': { invoice: { supplier: 'Cell', total: 1 }, invoice_id: '12', email_id: 'gm12' } };
  expect(evaluateExpression(columns.value.supplier!, { nodes })).toBe('Saved SAS');
  expect(evaluateExpression(columns.value.total!, { nodes })).toBe(2_082_500);
  expect(evaluateExpression(columns.value.email_id!, { nodes })).toBe('gm12');
});

test('Review still needed? keeps the Review label unless Postgres says nothing else is in review', () => {
  const condition = (nodeOf(wf, 'Review still needed?').parameters.conditions as { conditions: { leftValue: string }[] }).conditions[0]!.leftValue;
  const left = (review_left: unknown) => evaluateExpression(condition, { nodes: { 'Save approval': { review_left } } });
  expect(left(true)).toBe(true);
  expect(left(false)).toBe(false);
  // Fails closed: a missing answer keeps the label.
  expect(left(undefined)).toBe(true);
});

test('Shape approval input hands Check approval the buyer NIT and today in Bogota', () => {
  const assignments = (nodeOf(wf, 'Shape approval input').parameters.assignments as { assignments: { name: string; value: string }[] }).assignments;
  expect(assignments.map((a) => a.name)).toEqual(['row', 'team_locale', 'buyer_tax_id', 'today']);
  expect(assignments.find((a) => a.name === 'buyer_tax_id')?.value).toBe('={{ $json.config.validation.buyer_tax_id }}');
  expect(assignments.find((a) => a.name === 'today')?.value).toBe('={{ $now.toISODate() }}');
});

test('the labels go on the saved email and use the configured label ids', () => {
  const nodes = { 'Save approval': { gmail_message_id: 'gm1' }, 'When called': { config: { gmail: { label_ids: { processed: 'P', review: 'R' } } } } };
  const add = nodeOf(wf, 'Label as processed').parameters;
  const remove = nodeOf(wf, 'Remove review label').parameters;
  expect(evaluateExpression(add.messageId as string, { nodes })).toBe('gm1');
  expect(evaluateExpression(add.labelIds as string, { nodes })).toEqual(['P']);
  expect(evaluateExpression(remove.labelIds as string, { nodes })).toEqual(['R']);
});

test('every Google node retries 3 times at 1000 ms', () => {
  const google = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets' || n.type === 'n8n-nodes-base.gmail');
  expect(google.map((n) => n.name).sort()).toEqual(['Label as processed', 'Mark row approved', 'Remove review label', 'Write approval note']);
  for (const n of google) expect([n.name, n.retryOnFail, n.maxTries, n.waitBetweenTries]).toEqual([n.name, true, 3, 1000]);
});

test('settings and the error workflow', () => {
  expect(wf.id).toBe('mgpApproveOne001');
  expect(wf.settings).toMatchObject({
    executionOrder: 'v1', timezone: 'America/Bogota', callerPolicy: 'workflowsFromSameOwner',
    errorWorkflow: 'mgpErrorHandler1', saveManualExecutions: false,
  });
});

// Coverage, not a fix: an approval replay (a retry, or two overlapping polls) must be harmless, so
// the workflow only sets Sheets cells, adds or removes a Gmail label, and saves one row; it never
// files in Drive, sends mail or calls a model.
test('an approval only touches Postgres, Sheets and Gmail labels', () => {
  const types = new Set(wf.nodes.map((n) => n.type));
  for (const forbidden of ['n8n-nodes-base.googleDrive', 'n8n-nodes-base.emailSend', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.executeWorkflow']) {
    expect(types.has(forbidden)).toBe(false);
  }
  const gmailOperations = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail').map((n) => n.parameters.operation);
  expect(gmailOperations.sort()).toEqual(['addLabels', 'removeLabels']);
});

// The built Code nodes behave like the sources: the workflow runs the generated code, not the TypeScript.
const generated = (node: string) => String(nodeOf(wf, node).parameters.jsCode);
const row = {
  invoice_id: '12', email_id: 'gm12', approved_by: 'Laura', supplier: 'Bolsamar Empaques S.A.S.', supplier_tax_id: '901.384.552-2',
  invoice_number: 'be-2041', issue_date: 46298, due_date: '2026-11-02', currency: 'COP', subtotal: 1_750_000, tax: 332_500, total: 2_082_500,
};
const context = { buyer_tax_id: '901.555.210-1', today: '2026-10-30' };

test('the generated Check approval approves a corrected row, and refuses a bad date and a negative total with a note', () => {
  const check = (patch: object, team_locale = 'en') => (runGenerated(generated('Check approval'), { row: { ...row, ...patch }, team_locale, ...context }) as { json: unknown }[])[0]!.json;
  expect(check({})).toMatchObject({ ok: true, invoice_id: '12', email_id: 'gm12', approved_by: 'Laura', invoice: { issue_date: '2026-10-03', supplier_tax_id: '9013845522', invoice_number: 'BE-2041' } });
  expect(check({ issue_date: '2026-02-30' })).toEqual({
    ok: false, invoice_id: '12', email_id: 'gm12', note: 'Not approved: Invalid issue date. Fix the cells and keep your name in approved_by.' });
  expect(check({ total: -1 }, 'es')).toMatchObject({ ok: false, note: expect.stringContaining('Total en cero o negativo') as unknown });
});

test('the generated Render approval note picks the language table', () => {
  const render = (team_locale: string) => (runGenerated(generated('Render approval note'), { team_locale, invoice_id: '12', email_id: 'gm12', result: 'row_mismatch' }) as { json: unknown }[])[0]!.json;
  expect(render('en')).toEqual({ invoice_id: '12', email_id: 'gm12', note: "Not approved: invoice_id and email_id don't belong to the same invoice. Don't edit those two columns." });
  expect(render('es')).toMatchObject({ note: expect.stringMatching(/^No se aprobó: /) as unknown });
});
