import { expect, test } from 'vitest';
import { nodeOf, workflowFile } from '../helpers/workflow-file.ts';

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
