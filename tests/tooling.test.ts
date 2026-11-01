import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildWorkflows, hardenAgainstFrozenDefineProperty } from '../scripts/build-workflows.ts';
import { checkWorkflow, hasCommentPlaceholder } from '../scripts/check-workflows.ts';
import { normalizeWorkflow } from '../scripts/export-workflows.ts';
import { missingTriggerCredentials } from '../scripts/import-workflows.ts';
import { listJsonFiles, readWorkflow, type Workflow, type WorkflowNode } from '../scripts/lib/workflow.ts';
import { CONFIG_LOADER_ID, CREDENTIALS } from '../scripts/manifest.ts';
import { buildCredentials, skipExisting } from '../scripts/setup-credentials.ts';
import { runGenerated } from './helpers/run-generated.ts';

const fx = (name: string): Workflow => readWorkflow(`tests/fixtures/workflows/${name}.json`);
const opts = {
  credentialIds: new Set(CREDENTIALS.map((c) => c.id)),
  generatedNodes: new Set(['Double value']),
  generatedQueries: new Set(['Read rows']),
};
const errors = (wf: Workflow): string => checkWorkflow(wf, opts).join('\n');
const withNode = (node: WorkflowNode): Workflow => ({ ...fx('clean'), nodes: [...fx('clean').nodes, node] });
const fullEnv = Object.fromEntries(CREDENTIALS.flatMap((c) => c.env).map((k) => [k, `${k.toLowerCase()}-test`]));
const entry = { file: 'clean.json', node: 'Double value', source: 'tests/fixtures/nodes/double-value.ts', why: 'fixture' };
const sqlEntry = { file: 'clean.json', node: 'Read rows', parameter: 'query', source: 'tests/fixtures/text/read-rows.sql' };
const promptEntry = { file: 'clean.json', node: 'Request settings', parameter: 'assignments:system', source: 'tests/fixtures/text/system.md' };
const tempCopy = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mgp-'));
  cpSync('tests/fixtures/workflows/clean.json', join(dir, 'clean.json'));
  return dir;
};
const nodeIn = (dir: string, name: string): WorkflowNode =>
  readWorkflow(join(dir, 'clean.json')).nodes.find((n) => n.name === name) as WorkflowNode;
const built = async (): Promise<string> => {
  const dir = tempCopy();
  await buildWorkflows({ dir, entries: [entry], write: true });
  return String(readWorkflow(join(dir, 'clean.json')).nodes.find((n) => n.name === 'Double value')?.parameters.jsCode);
};

test('clean workflow passes', () => expect(checkWorkflow(fx('clean'), opts)).toEqual([]));
test('pinned data is rejected', () => expect(errors(fx('pinned'))).toMatch(/pinData present/));
test('literal email, phone, long id and secret are rejected', () => {
  for (const m of [/literal email/, /literal phone/, /literal long id/, /secret-like value/]) expect(errors(fx('leaky'))).toMatch(m);
});
test('unknown credential is rejected', () => expect(errors(fx('bad-credential'))).toMatch(/credential nope not in manifest/));
test('code node needs a Why Code line', () => expect(errors(fx('no-why'))).toMatch(/must start with \/\/ Why Code:/));
test('hand-written code node is rejected', () =>
  expect(checkWorkflow(fx('clean'), { ...opts, generatedNodes: new Set() }).join('\n'))
    .toMatch(/code node Double value is not generated from src\/nodes/));
test('hand-written query is rejected', () =>
  expect(checkWorkflow(fx('clean'), { ...opts, generatedQueries: new Set() }).join('\n'))
    .toMatch(/query in node Read rows is not generated from db\/queries/));
test('required settings are enforced', () => {
  const e = errors({ ...fx('clean'), settings: { executionOrder: 'v0', timezone: 'UTC', callerPolicy: 'any', errorWorkflow: 'x' } });
  for (const m of [/executionOrder must be v1/, /timezone must be America\/Bogota/,
    /callerPolicy must be workflowsFromSameOwner/, /errorWorkflow must be mgpErrorHandler1/]) expect(e).toMatch(m);
});
test('the error handler is exempt from the errorWorkflow rule', () => {
  const wf = fx('clean');
  delete wf.settings.errorWorkflow;
  expect(checkWorkflow({ ...wf, id: 'mgpErrorHandler1' }, opts)).toEqual([]);
});
test('the config loader is exempt from the errorWorkflow rule', () => {
  // error-handler calls load-config, so naming the handler as load-config's own error workflow
  // would loop the two into each other -- see check-workflows.ts.
  const wf = fx('clean');
  delete wf.settings.errorWorkflow;
  expect(checkWorkflow({ ...wf, id: CONFIG_LOADER_ID }, opts)).toEqual([]);
});
test('a workflow that is neither the error handler nor the config loader still needs an errorWorkflow', () => {
  const wf = fx('clean');
  delete wf.settings.errorWorkflow;
  expect(errors(wf)).toMatch(/errorWorkflow must be mgpErrorHandler1/);
});
test('explicit null counts as missing', () =>
  expect(errors({ ...fx('clean'), connections: null } as unknown as Workflow)).toMatch(/missing connections/));
test('external call without retry is rejected', () =>
  expect(errors(withNode({ name: 'Upload file', type: 'n8n-nodes-base.googleDrive', typeVersion: 3, parameters: {} })))
    .toMatch(/node Upload file calls an external service without retry on fail/));
test('an Information Extractor without retry is rejected', () =>
  expect(errors(withNode({ name: 'Extract', type: '@n8n/n8n-nodes-langchain.informationExtractor', typeVersion: 1.2, parameters: {} })))
    .toMatch(/node Extract calls an external service without retry on fail/));
test('expression inside SQL is rejected', () =>
  expect(errors(withNode({ name: 'Insert row', type: 'n8n-nodes-base.postgres', typeVersion: 2.8, retryOnFail: true,
    parameters: { operation: 'executeQuery', query: "SELECT '{{ $json.text }}'" } })))
    .toMatch(/query in node Insert row must use \$n parameters, not expressions/));
test('a $n placeholder inside a SQL comment is rejected', () => {
  const dashComment = withNode({ name: 'Insert row', type: 'n8n-nodes-base.postgres', typeVersion: 2.8, retryOnFail: true,
    parameters: { operation: 'executeQuery', query: '-- $1 file_name (text)\nINSERT INTO t (file_name) VALUES ($1)' } });
  const blockComment = withNode({ name: 'Insert row', type: 'n8n-nodes-base.postgres', typeVersion: 2.8, retryOnFail: true,
    parameters: { operation: 'executeQuery', query: '/* $1 file_name (text) */\nINSERT INTO t (file_name) VALUES ($1)' } });
  for (const wf of [dashComment, blockComment]) {
    expect(errors(wf)).toMatch(/query in node Insert row has a \$n placeholder inside a SQL comment/);
  }
});
test('a $n outside a comment, and a plain numbered word inside one, are both accepted', () => {
  const wf = withNode({ name: 'Insert row', type: 'n8n-nodes-base.postgres', typeVersion: 2.8, retryOnFail: true,
    parameters: { operation: 'executeQuery', query: "-- Parameters, in order: event_id (text), file_name (text)\nINSERT INTO t VALUES ($1, $2)" } });
  expect(errors(wf)).not.toMatch(/\$n placeholder inside a SQL comment/);
});
test('every db/queries source file keeps $n placeholders out of its own comments', () => {
  const dir = 'db/queries';
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));
  expect(files.length).toBeGreaterThan(0);
  for (const name of files) {
    expect(hasCommentPlaceholder(readFileSync(join(dir, name), 'utf8')), `${name} has a $n placeholder in a comment`).toBe(false);
  }
});
test('normalize drops volatile fields and is idempotent', () => {
  const n = normalizeWorkflow(fx('volatile'));
  expect([n.pinData, n.versionId, n.active, n.versionCounter, (n.meta as { instanceId?: string } | undefined)?.instanceId])
    .toEqual([undefined, undefined, undefined, undefined, undefined]);
  expect(n.id).toBe(fx('volatile').id);
  expect(normalizeWorkflow(structuredClone(n))).toEqual(n);
});
test('credentials use the fixed ids', () => {
  const { credentials, skipped } = buildCredentials(fullEnv);
  expect(credentials.map((c) => c.id).sort()).toEqual(CREDENTIALS.map((c) => c.id).sort());
  expect(skipped).toEqual([]);
  expect(credentials.find((c) => c.id === 'mgpCredAnthropic')?.data).toEqual({
    apiKey: 'anthropic_api_key-test',
    url: 'https://api.anthropic.com',
    header: false,
  });
});
test('credentials with missing env are skipped and named', () => {
  const { credentials, skipped } = buildCredentials({ APP_DB_USER: 'u', APP_DB_PASSWORD: 'p' });
  expect(credentials.map((c) => c.id)).toEqual(['mgpCredAppDb0001']);
  expect(skipped.find((s) => s.id === 'mgpCredAnthropic')?.missing).toContain('ANTHROPIC_API_KEY');
});
test('only trigger credentials hold back publishing', () => {
  const trigger = withNode({ name: 'Gmail Trigger', type: 'n8n-nodes-base.gmailTrigger', typeVersion: 1.4, parameters: {},
    credentials: { gmailOAuth2: { id: 'mgpCredGmail0001', name: 'Gmail' } } });
  const mailer = withNode({ name: 'Send email', type: 'n8n-nodes-base.gmail', typeVersion: 2.2, retryOnFail: true, parameters: {},
    credentials: { gmailOAuth2: { id: 'mgpCredGmail0001', name: 'Gmail' } } });
  expect(missingTriggerCredentials(trigger, new Set())).toEqual(['mgpCredGmail0001']);
  expect(missingTriggerCredentials(mailer, new Set())).toEqual([]);
});
test('a missing directory lists no files', () => expect(listJsonFiles('tests/fixtures/does-not-exist')).toEqual([]));
test('generated code runs like a Code node', async () =>
  expect(runGenerated(await built(), { n: 2 })).toEqual([{ json: { n: 4 } }]));
test('generated code still exports run when Object.defineProperty is frozen, like the real n8n Task Runner sandbox', async () => {
  // @n8n/task-runner's createVmExecutableCode runs Code-node JS after `Object.defineProperty = ()
  // => ({})`. esbuild's own export plumbing calls that function, so without
  // hardenAgainstFrozenDefineProperty, __node.run silently comes back undefined there.
  const hardened = `Object.defineProperty = () => ({});\n${await built()}`;
  expect(runGenerated(hardened, { n: 2 })).toEqual([{ json: { n: 4 } }]);
});
test('hardenAgainstFrozenDefineProperty rejects a bundle without the expected esbuild helper', () =>
  expect(() => hardenAgainstFrozenDefineProperty('var x = 1;')).toThrow(/esbuild output didn't contain/));
test('generated code carries the header and footer', async () => {
  const lines = (await built()).trimEnd().split('\n');
  expect(lines[0]).toBe('// Why Code: fixture. Generated from tests/fixtures/nodes/double-value.ts by npm run build:workflows; edit the source.');
  expect(lines.at(-1)).toBe('return [{ json: __node.run($input.first().json) }];');
});
test('check mode reports a stale node and write mode fixes it', async () => {
  const dir = tempCopy();
  expect((await buildWorkflows({ dir, entries: [entry], write: false })).stale).toEqual(['clean.json › Double value']);
  await buildWorkflows({ dir, entries: [entry], write: true });
  expect((await buildWorkflows({ dir, entries: [entry], write: false })).stale).toEqual([]);
});
test('text parameters are written verbatim', async () => {
  const dir = tempCopy();
  await buildWorkflows({ dir, entries: [sqlEntry, promptEntry], write: true });
  expect(nodeIn(dir, 'Read rows').parameters.query).toBe('SELECT $1::int AS n;\n');
  const assignments = (nodeIn(dir, 'Request settings').parameters.assignments as { assignments: { name: string; value: unknown }[] }).assignments;
  expect(assignments.find((a) => a.name === 'system')?.value).toBe('Fixture prompt with {braces}.\n');
});
test('check mode reports a stale text parameter', async () =>
  expect((await buildWorkflows({ dir: tempCopy(), entries: [sqlEntry], write: false })).stale).toEqual(['clean.json › Read rows › query']));
test('an unknown assignment name is an error', async () =>
  await expect(buildWorkflows({ dir: tempCopy(), entries: [{ ...promptEntry, parameter: 'assignments:nope' }], write: true }))
    .rejects.toThrow('assignment nope not found in clean.json › Request settings'));
// The parent object of a nested dot path (here `options`) may not exist yet on the node, the way
// `options.systemPromptTemplate` won't on a freshly hand-written Information Extractor node before
// its first build. buildWorkflows must create the missing intermediate object.
test('a nested parameter path is created when its parent object is absent', async () => {
  const dir = tempCopy();
  const nestedEntry = { file: 'clean.json', node: 'Read rows', parameter: 'options.systemPromptTemplate', source: 'tests/fixtures/text/system.md' };
  await buildWorkflows({ dir, entries: [nestedEntry], write: true });
  const options = nodeIn(dir, 'Read rows').parameters.options as { systemPromptTemplate?: string } | undefined;
  expect(options?.systemPromptTemplate).toBe('Fixture prompt with {braces}.\n');
});

// setup-credentials.ts must not silently overwrite a Google OAuth2 credential that already exists
// (import:credentials overwrites by id, which would wipe the owner's sign-in).
test('an existing Google OAuth2 credential is skipped unless forced', () => {
  const drive = { id: 'mgpCredGDrive001', name: 'Google Drive', type: 'googleDriveOAuth2Api', data: {} };
  const appDb = { id: 'mgpCredAppDb0001', name: 'App DB', type: 'postgres', data: {} };
  const existing = new Set([drive.id, appDb.id]);
  expect(skipExisting([drive, appDb], existing, false)).toEqual({
    toImport: [appDb],
    alreadyExists: [{ id: drive.id, name: drive.name }],
  });
  expect(skipExisting([drive, appDb], existing, true)).toEqual({ toImport: [drive, appDb], alreadyExists: [] });
});
