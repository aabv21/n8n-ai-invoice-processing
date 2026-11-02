import { expect, test } from 'vitest';
import { listJsonFiles, readWorkflow } from '../../scripts/lib/workflow.ts';
import { nodeOf, workflowFile } from '../helpers/workflow-file.ts';

// A manual execution (run from the editor) is saved by default, with every node's input and
// output. No workflow here may save one: most carry Gmail message content or an invoice's
// supplier/tax/amount fields, dev-harness's own webhook carries its caller's X-Dev-Token header,
// and even load-config starts from a passthrough Execute Workflow Trigger whose callers send no
// input schema, so it receives its caller's whole item too. docs/database.md explains why there's
// no per-workflow list.
const workflowFiles = listJsonFiles('workflows');

test('workflows/ is not empty, so the check below covers something', () => {
  expect(workflowFiles.length).toBeGreaterThan(0);
});

test.each(workflowFiles)('%s never saves a manual execution', (file) => {
  expect(readWorkflow(file).settings.saveManualExecutions).toBe(false);
});

test('load-config reads the mounted config once', () => {
  const wf = workflowFile('load-config.json');
  // alwaysOutputData is pinned here too: a missing config file must still reach "Parse config" as
  // an item with no binary data (which throws) instead of the branch silently stopping.
  expect(nodeOf(wf, 'Read config file')).toMatchObject({
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { fileSelector: '/files/config/config.json' },
  });
  expect(nodeOf(wf, 'Parse config').parameters).toMatchObject({ operation: 'fromJson', destinationKey: 'config' });
});
test('load-config names no error workflow, so error-handler calling it can never loop', () =>
  expect((workflowFile('load-config.json').settings as { errorWorkflow?: string }).errorWorkflow).toBeUndefined());
test('error emails are plain text without n8n attribution', () =>
  expect(nodeOf(workflowFile('error-handler.json'), 'Email the team').parameters)
    .toMatchObject({ emailType: 'text', options: { appendAttribution: false } }));
test('ensure-folder finds exact, non-trashed folders and always returns an item', () => {
  const find = nodeOf(workflowFile('ensure-folder.json'), 'Find folder');
  expect(find.alwaysOutputData).toBe(true);
  for (const s of ["mimeType = 'application/vnd.google-apps.folder'", 'trashed = false', 'in parents'])
    expect(String(find.parameters.queryString)).toContain(s);
});
test('ensure-folder does not swap the Folder exists? branches', () => {
  // Checked directly against raw connections, not sourcesOf: that helper reports a source node by
  // name only, blind to which output port (true/false) it came from, so it can't catch a swap here.
  interface MainConnections {
    main: { node: string }[][];
  }
  const wf = workflowFile('ensure-folder.json');
  const connections = wf.connections as Record<string, MainConnections>;
  expect(connections['Folder exists?']!.main[0]!.map((c) => c.node)).toEqual(['Return folder id']);
  expect(connections['Folder exists?']!.main[1]!.map((c) => c.node)).toEqual(['Create folder']);
  expect(connections['Create folder']!.main[0]!.map((c) => c.node)).toEqual(['Return folder id']);
});
