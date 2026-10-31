import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readWorkflow, writeWorkflow, type WorkflowNode } from './lib/workflow.ts';
import { BUILD_ENTRIES, type BuildEntry, type CodeNodeEntry, type TextParamEntry } from './manifest.ts';

export function wrapBundle(bundle: string, entry: Pick<CodeNodeEntry, 'source' | 'why'>): string {
  const header = `// Why Code: ${entry.why}. Generated from ${entry.source} by npm run build:workflows; edit the source.`;
  const footer = 'return [{ json: __node.run($input.first().json) }];';
  return `${header}\n${bundle.trim()}\n${footer}\n`;
}

// n8n's Code-node Task Runner sandbox runs generated code after `Object.defineProperty = () =>
// ({})` (@n8n/task-runner's createVmExecutableCode freezes builtins this way). esbuild's IIFE
// output attaches every named export through that same function (`__defProp(target, name, {
// get: ... })`), so under that sandbox each export silently never lands and `__node.run` comes
// back undefined. Swapping esbuild's own `__defProp` helper for a plain assignment sidesteps
// `Object.defineProperty` entirely; a plain function export needs no live binding or descriptor.
// NOTE: this patches esbuild's current codegen for this exact helper, pinned by esbuild's version
// in package.json. If a future esbuild renames or restructures it, the guard below throws instead
// of silently shipping a broken Code node; the fix is to update the needle/replacement together.
const ESBUILD_DEFINE_PROP = 'var __defProp = Object.defineProperty;';
const HARDENED_DEFINE_PROP =
  'var __defProp = (obj, key, desc) => { obj[key] = desc && "get" in desc ? desc.get() : desc.value; return obj; };';

export function hardenAgainstFrozenDefineProperty(bundle: string): string {
  if (!bundle.includes(ESBUILD_DEFINE_PROP)) {
    throw new Error("esbuild output didn't contain the expected __defProp assignment; esbuild's codegen may have changed");
  }
  return bundle.replace(ESBUILD_DEFINE_PROP, HARDENED_DEFINE_PROP);
}

export async function bundleSource(source: string): Promise<string> {
  const result = await build({
    entryPoints: [source],
    bundle: true,
    format: 'iife',
    globalName: '__node',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    absWorkingDir: process.cwd(),
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild produced no output for ${source}`);
  return hardenAgainstFrozenDefineProperty(output.text);
}

function isTextParam(entry: BuildEntry): entry is TextParamEntry {
  return 'parameter' in entry;
}

function readTextSource(source: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- source is a manifest-listed source file, not user input
  return readFileSync(source, 'utf8');
}

/** The dot-addressed value, or `undefined` if any segment of the path is absent. */
function getDotPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed manifest path, not user input
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Sets a dot-addressed value, creating any missing intermediate object along the way. */
function setDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (last === undefined) throw new Error('empty parameter path');

  let current = obj;
  for (const key of keys) {
    // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed manifest path, not user input
    const next = current[key];
    if (next === null || typeof next !== 'object') {
      const created: Record<string, unknown> = {};
      // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed manifest path, not user input
      current[key] = created;
      current = created;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed manifest path, not user input
  current[last] = value;
}

interface Assignment {
  name: string;
  value: unknown;
}

function findAssignment(node: WorkflowNode, name: string, file: string): Assignment {
  const assignments = (node.parameters.assignments as { assignments?: Assignment[] } | undefined)?.assignments;
  const found = assignments?.find((a) => a.name === name);
  if (!found) throw new Error(`assignment ${name} not found in ${file} › ${node.name}`);
  return found;
}

function readParamValue(node: WorkflowNode, parameter: string, file: string): unknown {
  if (parameter.startsWith('assignments:')) return findAssignment(node, parameter.slice('assignments:'.length), file).value;
  return getDotPath(node.parameters, parameter);
}

function writeParamValue(node: WorkflowNode, parameter: string, value: string, file: string): void {
  if (parameter.startsWith('assignments:')) {
    findAssignment(node, parameter.slice('assignments:'.length), file).value = value;
    return;
  }
  setDotPath(node.parameters, parameter, value);
}

export async function buildWorkflows(opts: {
  dir: string;
  entries: readonly BuildEntry[];
  write: boolean;
}): Promise<{ updated: string[]; stale: string[]; skipped: string[] }> {
  const updated: string[] = [];
  const stale: string[] = [];
  const skipped: string[] = [];

  const byFile = new Map<string, BuildEntry[]>();
  for (const entry of opts.entries) {
    const entries = byFile.get(entry.file) ?? [];
    entries.push(entry);
    byFile.set(entry.file, entries);
  }

  for (const [file, entries] of byFile) {
    const path = join(opts.dir, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is dir + a manifest file name, not user input
    if (!existsSync(path)) {
      skipped.push(file);
      continue;
    }

    const wf = readWorkflow(path);
    let dirty = false;
    for (const entry of entries) {
      const node = wf.nodes.find((n) => n.name === entry.node);
      if (!node) throw new Error(`node ${entry.node} missing from ${file}`);

      if (isTextParam(entry)) {
        const text = readTextSource(entry.source);
        const label = `${file} › ${entry.node} › ${entry.parameter}`;
        if (readParamValue(node, entry.parameter, file) === text) continue;

        if (opts.write) {
          writeParamValue(node, entry.parameter, text, file);
          dirty = true;
          updated.push(label);
        } else {
          stale.push(label);
        }
        continue;
      }

      const jsCode = wrapBundle(await bundleSource(entry.source), entry);
      const label = `${file} › ${entry.node}`;
      if (node.parameters.jsCode === jsCode) continue;

      if (opts.write) {
        node.parameters.jsCode = jsCode;
        dirty = true;
        updated.push(label);
      } else {
        stale.push(label);
      }
    }
    if (dirty) writeWorkflow(path, wf);
  }

  return { updated, stale, skipped };
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const result = await buildWorkflows({ dir: 'workflows', entries: BUILD_ENTRIES, write: !check });
  for (const file of result.skipped) console.log(`skip ${file} (missing)`);
  for (const label of result.updated) console.log(`updated ${label}`);
  for (const label of result.stale) console.log(`stale ${label}`);
  if (check && result.stale.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
