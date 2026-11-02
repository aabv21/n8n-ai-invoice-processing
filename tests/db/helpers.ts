// A thin Postgres harness for tests/db/queries.test.ts: opens the local test database, applies
// db/migrations/ to it the same way pnpm run setup does on the real stack, runs a query file from
// db/queries as app_runtime (the way the Postgres node would), and resets state between tests.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

export interface TestDb {
  run<T>(queryFile: string, params: unknown[]): Promise<T[]>;
  sql<T>(text: string, params?: unknown[]): Promise<T[]>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Mirrors how the Postgres node (2.8+) binds one `{{ }}` Query Parameter expression to one value:
 * null or undefined becomes SQL NULL, a plain object is JSON-stringified, and everything else is
 * sent as its string form. An array isn't a valid single value there — the workflow always passes
 * an array as `{{ JSON.stringify(...) }}` instead — so this throws rather than silently guessing.
 */
function bind(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    throw new Error('array parameters are not supported; pass JSON.stringify(...) instead, the way the workflow does');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  // By this point value is a primitive (object, array, null, and undefined are all handled above).
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- see above
  return String(value);
}

/** The runtime role's name this harness creates on testdb — fixed, not read from .env: see `migrateTestDb`. */
const TEST_RUNTIME_ROLE = 'app_runtime';

/**
 * Runs `scripts/db-migrate.ts` against the `testdb` Compose service instead of the real stack's
 * `postgres` container, so there is only one migration implementation to keep correct. `testdb`
 * runs with trust auth and starts with no `app`/`app_runtime` roles of its own (`db/init/` never
 * runs there), so this points db-migrate's roles at ones that already exist or that migration 001
 * itself creates: `POSTGRES_USER` and `APP_DB_USER` both become `postgres`, the one role trust
 * auth and the container already provide, so `SET LOCAL ROLE postgres` in the bootstrap is a valid
 * no-op for a superuser; `APP_RUNTIME_DB_USER` stays `app_runtime`, created by `\gexec` in
 * `001_runtime_role.sql` exactly as it would be on the real stack. The password is never read
 * back — trust auth ignores it — so a fixed placeholder is fine. These are passed as this child
 * process's own environment, which Node's `loadEnvFile` (used by `db-migrate.ts`'s `loadDotEnv`)
 * never overrides once a name is already set, so a developer's own `.env` role names can't leak
 * into this run even if `.env` exists.
 */
async function migrateTestDb(): Promise<void> {
  await execFileAsync('node', ['scripts/db-migrate.ts'], {
    env: {
      ...process.env,
      DB_MIGRATE_CONTAINER: 'testdb',
      DB_MIGRATE_DATABASE: 'postgres',
      POSTGRES_USER: 'postgres',
      APP_DB_USER: 'postgres',
      APP_RUNTIME_DB_USER: TEST_RUNTIME_ROLE,
      APP_RUNTIME_DB_PASSWORD: 'test-db-runtime-password',
    },
  });
}

/**
 * Opens the local test database, resetting `schema public` from db/schema.sql, then applying
 * every file in db/migrations/ through `migrateTestDb`, so the runtime role and its grants exist
 * there too. Refuses to run against anything but a database literally named "postgres" — the one
 * name CI's service and the local `testdb` container both use — so a misconfigured
 * TEST_DATABASE_URL can't drop a real schema. Every query runs as `app_runtime`, over a second
 * pool, so the grants migration 001 creates are proven by every test in this suite, not just by
 * `check-db` against the real stack; `reset()` still needs the superuser pool, since `app_runtime`
 * has no TRUNCATE.
 */
export async function openTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set; start the test database (see AGENTS.md).');

  const superPool = new pg.Pool({ connectionString: url });
  try {
    const { rows } = await superPool.query<{ current_database: string }>('SELECT current_database()');
    const name = rows[0]?.current_database;
    if (name !== 'postgres') {
      throw new Error(`openTestDb() refuses to reset database "${String(name)}": it only resets a database named "postgres" (see AGENTS.md)`);
    }

    await superPool.query('DROP SCHEMA public CASCADE');
    await superPool.query('CREATE SCHEMA public');
    await superPool.query(readFileSync('db/schema.sql', 'utf8'));
    await migrateTestDb();
  } catch (err) {
    await superPool.end();
    throw err;
  }

  const runtimeUrl = new URL(url);
  runtimeUrl.username = TEST_RUNTIME_ROLE;
  runtimeUrl.password = '';
  const runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString() });

  return {
    async run<T>(queryFile: string, params: unknown[]): Promise<T[]> {
      const text = readFileSync(join('db/queries', queryFile), 'utf8');
      // pg's own generic requires T extends QueryResultRow; this helper's callers assert whatever
      // shape their query actually returns, so query() is left untyped and .rows cast at the edge.
      const { rows } = await runtimePool.query(text, params.map(bind));
      return rows as T[];
    },
    async sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const { rows } = await runtimePool.query(text, params);
      return rows as T[];
    },
    async reset(): Promise<void> {
      await superPool.query('TRUNCATE invoices, invoice_items, processed_events RESTART IDENTITY CASCADE');
    },
    async close(): Promise<void> {
      await runtimePool.end();
      await superPool.end();
    },
  };
}
