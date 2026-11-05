import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

/** Loads `.env` into `process.env`. Fails with a pointer to `.env.example` if it's missing. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch (err) {
    if (isEnoent(err)) throw new Error('.env not found; copy .env.example to .env and fill in local values.', { cause: err });
    throw err;
  }
}

/** Matches the shape `promisify(execFile)` rejects with, so `isExecError`-style callers treat either branch of `compose` alike. */
function composeError(message: string, stdout: string, stderr: string): Error & { stdout: string; stderr: string } {
  return Object.assign(new Error(message), { stdout, stderr });
}

/**
 * Runs `docker compose <args>`. With `opts.input`, spawns the process and writes `input` to its
 * stdin instead of using execFile — needed by callers that pipe a SQL statement into `psql`
 * through `compose exec`. A non-zero exit rejects either way.
 */
export function compose(args: readonly string[], opts?: { input?: string }): Promise<{ stdout: string; stderr: string }> {
  if (opts?.input === undefined) return execFileAsync('docker', ['compose', ...args]);
  const input = opts.input;

  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // Writing more than the child reads raises EPIPE here, and Node crashes on an unhandled
    // stream 'error', so this rejects instead.
    child.stdin.on('error', (err: Error) => {
      const message = `docker compose ${args.join(' ')} failed to write to stdin: ${err.message}`;
      reject(composeError(stderr ? `${message}\n${stderr}` : message, stdout, stderr));
    });
    child.on('error', (err) => {
      reject(composeError(err.message, stdout, stderr));
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      // stderr goes in the message, as in promisify(execFile)'s "Command failed: ...\n<stderr>":
      // the CLIs print only err.message on failure.
      else reject(composeError(`docker compose ${args.join(' ')} exited with code ${String(code)}\n${stderr}`, stdout, stderr));
    });
    child.stdin.end(input);
  });
}

export interface PsqlOptions {
  /** The environment variable holding the role to connect as, expanded inside the container. */
  role: 'POSTGRES_USER' | 'APP_RUNTIME_DB_USER';
  database: 'app' | 'n8n';
  /** Variables the script reads with `\getenv`, forwarded by name from this process's environment. */
  forwardEnv: readonly string[];
  singleTransaction: boolean;
  /** The Compose service to run psql in: `postgres` by default, `testdb` for `pnpm run test:db`. */
  container?: string;
}

/**
 * The `compose()` arguments that run psql inside `container` over its local socket, reading the
 * script from stdin. Each `forwardEnv` name is passed as a bare `-e NAME`, so Docker copies the
 * value from this process's environment: it never appears in an argument list, and a changed
 * `.env` applies without recreating the container.
 */
export function psqlArgs({ role, database, forwardEnv, singleTransaction, container = 'postgres' }: PsqlOptions): string[] {
  const transaction = singleTransaction ? ' --single-transaction' : '';
  const psql = `psql -X -q -A -t -v ON_ERROR_STOP=1${transaction} -U "$${role}" -d ${database} -f -`;
  return ['exec', '-T', ...forwardEnv.flatMap((name) => ['-e', name]), container, 'sh', '-c', psql];
}

export interface PsqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function hasOutput(err: unknown): err is { stdout: string; stderr: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

/** Runs `sql` through psql with `options`. A psql failure resolves with `ok: false` and its output, instead of throwing. */
export async function runPsql(options: PsqlOptions, sql: string): Promise<PsqlResult> {
  try {
    const { stdout, stderr } = await compose(psqlArgs(options), { input: sql });
    return { ok: true, stdout, stderr };
  } catch (err) {
    if (hasOutput(err)) return { ok: false, stdout: err.stdout, stderr: err.stderr };
    throw err;
  }
}

/** The non-empty values of every variable in `env` whose name ends in `PASSWORD`, `SECRET`, `TOKEN`, or `KEY`. */
export function secretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => /(PASSWORD|SECRET|TOKEN|KEY)$/.test(name) && value !== undefined && value !== '')
    .map(([, value]) => value ?? '');
}

/** `text` with every occurrence of each secret replaced, for output that may echo a statement. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret !== '').reduce((out, secret) => out.replaceAll(secret, '[redacted]'), text);
}

/** Polls `${baseUrl}/healthz` once a second until it responds OK or `budgetMs` elapses. */
export async function waitForHealthy(baseUrl: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch {
      // not up yet; retry below until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}

/** True once a status means the webhook is registered and live — anything but 404 (n8n's "not found" for an unknown path). */
export function isWebhookLive(status: number): boolean {
  return status !== 404;
}

/**
 * Polls `${baseUrl}/webhook/${path}` with an unauthenticated POST, once a second, until
 * `isWebhookLive` or `budgetMs` elapses. The publication reconciler registers the route on its own
 * schedule (10 s by default), so a call right after `/healthz` turns healthy can still 404. The dev
 * harness checks `X-Dev-Token` first, so a live route answers 403: proof the publish took effect,
 * with no credential. `fetchImpl` is injectable for tests.
 */
export async function waitForWebhookLive(
  baseUrl: string,
  path: string,
  budgetMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetchImpl(`${baseUrl}/webhook/${path}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (isWebhookLive(res.status)) return true;
    } catch {
      // not registered yet, or n8n isn't reachable for a moment; retry below until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}
