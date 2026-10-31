import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, loadDotEnv, waitForHealthy } from './lib/runtime.ts';
import { listJsonFiles, readWorkflow, type Workflow } from './lib/workflow.ts';
import { CREDENTIALS, WORKFLOWS } from './manifest.ts';
import { buildCredentials } from './setup-credentials.ts';

/**
 * IDs of credentials that a trigger node in `wf` needs but `available` doesn't have, in node
 * order and without duplicates. A trigger is any node whose type ends in `Trigger`, or a webhook.
 */
export function missingTriggerCredentials(wf: Workflow, available: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const node of wf.nodes) {
    const isTrigger = node.type.endsWith('Trigger') || node.type === 'n8n-nodes-base.webhook';
    if (!isTrigger) continue;
    for (const credential of Object.values(node.credentials ?? {})) {
      if (!available.has(credential.id) && !seen.has(credential.id)) {
        seen.add(credential.id);
        missing.push(credential.id);
      }
    }
  }
  return missing;
}

const WORKFLOWS_DIR = 'workflows';

/**
 * `err.message` plus the failed command's stdout, when there is one - n8n's CLI prints its own
 * error detail to stdout rather than stderr, so `err.message` alone (just "Command failed: ...")
 * dropped it. Never reads `.env`: this is the stdout of an `n8n` CLI invocation, not env content.
 */
function errorDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const stdout = (err as { stdout?: unknown }).stdout;
  return typeof stdout === 'string' && stdout.trim() !== '' ? `${err.message}\n${stdout.trim()}` : err.message;
}

async function main(): Promise<void> {
  loadDotEnv();

  const hasFiles = listJsonFiles(WORKFLOWS_DIR).length > 0;
  if (hasFiles) {
    await compose(['exec', '-T', 'n8n', 'n8n', 'import:workflow', '--separate', '--input=/workflows']);
  }

  const { credentials } = buildCredentials(process.env);
  const available = new Set(credentials.map((c) => c.id));
  const credentialNames = new Map(CREDENTIALS.map((c) => [c.id, c.name]));

  let publishedCount = 0;
  const failures: string[] = [];
  for (const entry of WORKFLOWS) {
    const path = join(WORKFLOWS_DIR, entry.file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is dir + a manifest file name, not user input
    if (!existsSync(path)) {
      console.log(`skip ${entry.file} (missing)`);
      continue;
    }

    const wf = readWorkflow(path);
    const missing = missingTriggerCredentials(wf, available);
    if (missing.length > 0) {
      const names = missing.map((id) => credentialNames.get(id) ?? id).join(', ');
      console.log(`hold ${entry.file}: needs ${names}`);
      continue;
    }

    try {
      await compose(['exec', '-T', 'n8n', 'n8n', 'publish:workflow', `--id=${entry.id}`]);
      publishedCount += 1;
    } catch (err) {
      failures.push(`publish failed for ${entry.file}: ${errorDetail(err)}`);
    }
  }

  if (publishedCount > 0) {
    await compose(['restart', 'n8n']);
    const n8nUrl = process.env.N8N_URL;
    const healthy = n8nUrl ? await waitForHealthy(n8nUrl, 90_000) : false;
    if (!healthy) failures.push('n8n did not become healthy after restart');
    // NOTE: /healthz reports healthy well before a sub-workflow call is guaranteed to read the
    // version just published. A reconciler syncs workflow_published_version to the active version
    // on its own schedule (10 s by default, N8N_WORKFLOW_PUBLICATION_RECONCILE_INTERVAL_SECONDS),
    // so a call made right after the restart can still run the previous version. This fixed wait
    // is longer than that default interval, not a guarantee against a slower one. Upgrade path:
    // poll workflow_published_version against workflow_entity.activeVersionId instead of sleeping.
    else await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  }

  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(errorDetail(err));
    process.exitCode = 1;
  });
}
