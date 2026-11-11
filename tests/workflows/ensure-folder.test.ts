import { expect, test } from 'vitest';
import { evaluateExpression } from '../helpers/expression.ts';
import { nodeOf, workflowFile } from '../helpers/workflow-file.ts';

const wf = workflowFile('ensure-folder.json');
const query = (name: string, parentId: string) =>
  evaluateExpression(String(nodeOf(wf, 'Find folder').parameters.queryString), { nodes: { 'When called': { name, parent_id: parentId } } });

test('a year or month folder name builds the plain Drive query', () =>
  expect(query('2026', 'root-id')).toBe(
    "name = '2026' and 'root-id' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"));

// Drive's query language quotes strings with ' and escapes with \, so a name holding either can't
// close the string early and widen the search to another folder.
test("a quote or backslash in the name or parent id is escaped, so it can't change the query", () =>
  expect(query("O'Brien \\ 2099", "par'ent")).toBe(
    "name = 'O\\'Brien \\\\ 2099' and 'par\\'ent' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"));
