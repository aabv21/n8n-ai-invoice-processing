import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compose, loadDotEnv } from './lib/runtime.ts';
import { CREDENTIALS } from './manifest.ts';

export interface ImportableCredential {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}

// Every manifest credential type carrying an interactive OAuth2 sign-in — not just Gmail's — must
// survive a re-run of `setup`, which otherwise overwrites by id and wipes the owner's sign-in.
// Derived from the manifest instead of a hand-picked list, so a future OAuth2 credential is
// protected automatically.
const PROTECTED_TYPES = new Set(CREDENTIALS.filter((c) => /OAuth2/.test(c.type)).map((c) => c.type));

const IMPORT_DIR = '.n8n-import';
const CREDENTIALS_FILE = `${IMPORT_DIR}/credentials.json`;
const EXISTING_FILE_NAME = 'existing-credentials.json';
const EXISTING_FILE = `${IMPORT_DIR}/${EXISTING_FILE_NAME}`;

export function buildCredentials(env: Readonly<Record<string, string | undefined>>): {
  credentials: ImportableCredential[];
  skipped: { id: string; missing: string[] }[];
} {
  const credentials: ImportableCredential[] = [];
  const skipped: { id: string; missing: string[] }[] = [];

  for (const entry of CREDENTIALS) {
    const scoped: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of entry.env) {
      // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed `env` list, not user input
      const value = env[key];
      // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed `env` list, not user input
      if (value) scoped[key] = value;
      else missing.push(key);
    }
    if (missing.length > 0) {
      skipped.push({ id: entry.id, missing });
      continue;
    }
    credentials.push({ id: entry.id, name: entry.name, type: entry.type, data: entry.data(scoped) });
  }

  return { credentials, skipped };
}

/** Which credentials to import: an existing OAuth2 credential is kept unless forced. */
export function skipExisting(
  credentials: readonly ImportableCredential[],
  existingIds: ReadonlySet<string>,
  force: boolean,
): { toImport: ImportableCredential[]; alreadyExists: { id: string; name: string }[] } {
  if (force) return { toImport: [...credentials], alreadyExists: [] };

  const toImport: ImportableCredential[] = [];
  const alreadyExists: { id: string; name: string }[] = [];
  for (const credential of credentials) {
    if (PROTECTED_TYPES.has(credential.type) && existingIds.has(credential.id)) {
      alreadyExists.push({ id: credential.id, name: credential.name });
    } else {
      toImport.push(credential);
    }
  }
  return { toImport, alreadyExists };
}

function isExecError(err: unknown): err is { stdout: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

/** IDs already in n8n, read from an (encrypted) CLI export — never the decrypted credential data. */
async function existingCredentialIds(): Promise<Set<string>> {
  try {
    await compose(['exec', '-T', 'n8n', 'n8n', 'export:credentials', '--all', `--output=/import/${EXISTING_FILE_NAME}`]);
  } catch (err) {
    // A brand-new instance with no credentials yet errors instead of exporting an empty list.
    if (isExecError(err) && /No credentials found/i.test(err.stdout)) return new Set();
    throw err;
  }

  chmodSync(EXISTING_FILE, 0o600);
  try {
    const raw = JSON.parse(readFileSync(EXISTING_FILE, 'utf8')) as { id: string }[];
    return new Set(raw.map((c) => c.id));
  } finally {
    rmSync(EXISTING_FILE, { force: true });
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const force = process.argv.includes('--force');
  mkdirSync(IMPORT_DIR, { recursive: true });

  const { credentials, skipped } = buildCredentials(process.env);
  const existingIds = await existingCredentialIds();
  const { toImport, alreadyExists } = skipExisting(credentials, existingIds, force);

  if (toImport.length > 0) {
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(toImport, null, 2), { mode: 0o600 });
    chmodSync(CREDENTIALS_FILE, 0o600);
    try {
      await compose(['exec', '-T', 'n8n', 'n8n', 'import:credentials', '--input=/import/credentials.json']);
    } finally {
      rmSync(CREDENTIALS_FILE, { force: true });
    }
  }

  for (const { id, missing } of skipped) {
    const name = CREDENTIALS.find((c) => c.id === id)?.name ?? id;
    console.log(`skip ${name}: missing ${missing.join(', ')}`);
  }
  for (const { name } of alreadyExists) {
    console.log(`skip ${name}: already exists (use --force to overwrite)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
