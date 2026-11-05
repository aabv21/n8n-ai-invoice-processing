import { expect, test } from 'vitest';
import { nodeOf, sourcesOf, workflowFile } from '../helpers/workflow-file.ts';

interface MainConnections {
  main: { node: string }[][];
}

test('runs at 18:00 Bogota time', () => {
  const wf = workflowFile('daily-summary.json');
  expect(wf.settings.timezone).toBe('America/Bogota');
  expect(JSON.stringify(nodeOf(wf, 'Every day at 18:00').parameters)).toContain('0 18 * * *');
});
test('emails HTML without n8n attribution', () => expect(nodeOf(workflowFile('daily-summary.json'), 'Email summary').parameters)
  .toMatchObject({ emailType: 'html', options: { appendAttribution: false } }));

// A second trigger lets the dev harness preview a summary. It accepts all data; dev-harness.test.ts
// pins what "Call daily-summary" maps onto it (run_at and dry_run).
test('the harness trigger accepts all data, declaring no named inputs of its own', () => {
  const wf = workflowFile('daily-summary.json');
  const trigger = nodeOf(wf, 'When called by the harness');
  expect(trigger.type).toBe('n8n-nodes-base.executeWorkflowTrigger');
  expect(trigger.parameters).toMatchObject({ inputSource: 'passthrough' });
});

test('both triggers normalize into one { run_at, dry_run } item', () => {
  const wf = workflowFile('daily-summary.json');

  const scheduleShape = nodeOf(wf, 'Shape schedule run');
  expect(scheduleShape.parameters).toMatchObject({ mode: 'manual' });
  const scheduleAssignments = (scheduleShape.parameters.assignments as { assignments: { name: string; value: unknown }[] }).assignments;
  expect(scheduleAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'run_at', value: '={{ $now.toISO() }}' }),
    expect.objectContaining({ name: 'dry_run', value: false }),
  ]));

  const harnessShape = nodeOf(wf, 'Shape harness run');
  expect(harnessShape.parameters).toMatchObject({ mode: 'manual' });
  const harnessAssignments = (harnessShape.parameters.assignments as { assignments: { name: string; value: unknown }[] }).assignments;
  // Safe by default: only an explicit dry_run: false sends a real email. An omitted dry_run, or
  // any value other than false, previews instead.
  expect(harnessAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'run_at', value: '={{ $json.run_at }}' }),
    expect.objectContaining({ name: 'dry_run', value: '={{ $json.dry_run !== false }}' }),
  ]));

  // Both shaping nodes feed "Load config" directly: Load config ignores its input, so it needs no
  // merge, only to run once either trigger's item has reached it.
  expect(sourcesOf(wf, 'Load config', 0)).toEqual(expect.arrayContaining(['Shape schedule run', 'Shape harness run']));
});

// Load config outputs only { config }, so this merge puts run_at and dry_run back next to it.
test('Attach config to run merges config back onto the normalized run, since Load config drops it', () => {
  const wf = workflowFile('daily-summary.json');

  const merge = nodeOf(wf, 'Attach config to run');
  expect(merge.type).toBe('n8n-nodes-base.merge');
  expect(merge.parameters).toMatchObject({ mode: 'combine', combineBy: 'combineByPosition', numberInputs: 2 });

  expect(sourcesOf(wf, 'Attach config to run', 0)).toEqual(['Load config']);
  expect(sourcesOf(wf, 'Attach config to run', 1)).toEqual(expect.arrayContaining(['Shape schedule run', 'Shape harness run']));
});

test('Query summary passes the run timestamp, not a date', () => {
  const wf = workflowFile('daily-summary.json');
  const query = nodeOf(wf, 'Query summary');
  expect(query.typeVersion).toBeGreaterThanOrEqual(2.8);
  expect(sourcesOf(wf, 'Query summary', 0)).toEqual(['Attach config to run']);
  const options = query.parameters.options as { queryReplacement?: string } | undefined;
  // The bind parameter is run_at (an ISO timestamp), never $now.toISODate(): midnight Bogota on day D
  // would shift the window to D-1 while report_date still says D.
  expect(options?.queryReplacement).toBe('={{ $json.run_at }}');
  expect(options?.queryReplacement).not.toContain('toISODate');
});

// Query summary outputs only the SQL row, so an extract+merge puts team_locale back next to it
// before Render summary, the same pattern as Attach config to run.
test('Extract team locale reads it off the already-loaded config', () => {
  const wf = workflowFile('daily-summary.json');
  const extract = nodeOf(wf, 'Extract team locale');
  expect(extract.type).toBe('n8n-nodes-base.set');
  expect(sourcesOf(wf, 'Extract team locale', 0)).toEqual(['Attach config to run']);
  const assignments = (extract.parameters.assignments as { assignments: { name: string; value: unknown }[] }).assignments;
  expect(assignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'team_locale', value: "={{ $json.config.team_locale }}" }),
  ]));
});

test('Attach locale to summary merges team_locale onto the summary row by position', () => {
  const wf = workflowFile('daily-summary.json');
  const merge = nodeOf(wf, 'Attach locale to summary');
  expect(merge.type).toBe('n8n-nodes-base.merge');
  expect(merge.parameters).toMatchObject({ mode: 'combine', combineBy: 'combineByPosition', numberInputs: 2 });
  expect(sourcesOf(wf, 'Attach locale to summary', 0)).toEqual(['Query summary']);
  expect(sourcesOf(wf, 'Attach locale to summary', 1)).toEqual(['Extract team locale']);
  expect(sourcesOf(wf, 'Render summary', 0)).toEqual(['Attach locale to summary']);
});

test('an IF on dry_run returns the preview without sending, or emails it', () => {
  const wf = workflowFile('daily-summary.json');
  const branch = nodeOf(wf, 'Dry run?');
  expect(branch.type).toBe('n8n-nodes-base.if');
  expect(JSON.stringify(branch.parameters)).toContain("$('Attach config to run').first().json.dry_run");

  const connections = wf.connections as Record<string, MainConnections>;
  const outputs = connections['Dry run?']!.main;
  expect(outputs[0]!.map((c) => c.node)).toEqual(['Return preview']);
  expect(outputs[1]!.map((c) => c.node)).toEqual(['Email summary']);

  const preview = nodeOf(wf, 'Return preview');
  expect(JSON.stringify(preview.parameters)).toContain('subject');
  expect(JSON.stringify(preview.parameters)).toContain('html');
});

test('Email summary sends the rendered subject and body to the configured team address', () => {
  const wf = workflowFile('daily-summary.json');
  const email = nodeOf(wf, 'Email summary');
  expect(email.type).toBe('n8n-nodes-base.gmail');
  expect(email.parameters).toMatchObject({
    sendTo: "={{ $('Attach config to run').first().json.config.team_email }}",
    subject: '={{ $json.subject }}',
    message: '={{ $json.html }}',
  });
});
