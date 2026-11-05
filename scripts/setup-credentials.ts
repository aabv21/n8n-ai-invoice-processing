import { fileURLToPath } from 'node:url';
import { compose, loadDotEnv } from './lib/runtime.ts';
import { CREDENTIALS } from './manifest.ts';

export interface ImportableCredential {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}

// Every credential with an interactive OAuth2 sign-in must survive a re-run of `setup`, which
// otherwise overwrites by id and wipes the sign-in. Derived from the manifest, so a new OAuth2
// credential is covered automatically.
const PROTECTED_TYPES = new Set(CREDENTIALS.filter((c) => /OAuth2/.test(c.type)).map((c) => c.type));

/**
 * Copies the decrypted credential JSON from stdin into a temp file in the container's own `/tmp`
 * (strict umask, removed either way) and imports it, so plaintext never touches the host or the
 * `.n8n-import/` bind mount. A host-written file there fails on Linux: it stays owned by the
 * runner's uid (1001), which n8n (uid 1000) can't read. macOS hides this, since Docker Desktop
 * makes a bind-mounted file appear owned by whichever uid reads it.
 */
export const IMPORT_SCRIPT = 'umask 077; tmp="$(mktemp)"; cat > "$tmp"; n8n import:credentials --input="$tmp"; status=$?; rm -f "$tmp"; exit $status';

/** The exact `compose()` call that imports `toImport`: the credential JSON travels only as `input`, never as an argument or a file. */
export function buildImportCall(toImport: readonly ImportableCredential[]): { args: string[]; input: string } {
  return { args: ['exec', '-T', 'n8n', 'sh', '-c', IMPORT_SCRIPT], input: JSON.stringify(toImport) };
}

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

function isExecError(err: unknown): err is { stdout: string; stderr: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

/**
 * Exports the (still encrypted) credentials into a temp file in the container's own `/tmp` and
 * `cat`s it to stdout only on success, so a partial export can't pass for a real one; n8n's
 * progress messages go to stderr, keeping stdout pure JSON. A file on the bind mount would be owned
 * by n8n (uid 1000), which a Linux runner (uid 1001) can't `chmod` (EPERM).
 */
export const EXPORT_SCRIPT = 'umask 077; tmp="$(mktemp)"; n8n export:credentials --all --output="$tmp" >&2; status=$?; [ "$status" -eq 0 ] && cat "$tmp"; rm -f "$tmp"; exit $status';

/**
 * IDs already in n8n, read from an (encrypted) CLI export over stdout — never the decrypted
 * credential data, and never a file on the bind mount (see `EXPORT_SCRIPT`'s own comment).
 */
export async function existingCredentialIds(): Promise<Set<string>> {
  let stdout: string;
  try {
    ({ stdout } = await compose(['exec', '-T', 'n8n', 'sh', '-c', EXPORT_SCRIPT]));
  } catch (err) {
    // A brand-new instance errors instead of exporting an empty list, on either stream.
    if (isExecError(err) && (/No credentials found/i.test(err.stderr) || /No credentials found/i.test(err.stdout))) return new Set();
    throw err;
  }

  let raw: { id: string }[];
  try {
    raw = JSON.parse(stdout) as { id: string }[];
  } catch {
    throw new Error('could not parse the credential listing from n8n export:credentials');
  }
  return new Set(raw.map((c) => c.id));
}

async function main(): Promise<void> {
  loadDotEnv();
  const force = process.argv.includes('--force');

  const { credentials, skipped } = buildCredentials(process.env);
  const existingIds = await existingCredentialIds();
  const { toImport, alreadyExists } = skipExisting(credentials, existingIds, force);

  if (toImport.length > 0) {
    const { args, input } = buildImportCall(toImport);
    await compose(args, { input });
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
