// A thin Postgres harness for tests/db/queries.test.ts: opens the test database, applies
// db/migrations/ as pnpm run setup does, runs a db/queries file as app_runtime (as the Postgres
// node would), and resets state between tests.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

export interface TestDb {
  run<T>(queryFile: string, params: unknown[]): Promise<T[]>;
  sql<T>(text: string, params?: unknown[]): Promise<T[]>;
  /** A client from the runtime pool, for a test that needs its own explicit `BEGIN`/`COMMIT`. The caller releases it. */
  connect(): Promise<pg.PoolClient>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Mirrors how the Postgres node (2.8+) binds one `{{ }}` Query Parameter: null or undefined is SQL
 * NULL, a plain object is JSON-stringified, anything else is its string form. The workflow passes
 * arrays as `{{ JSON.stringify(...) }}`, so an array throws instead of guessing.
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
 * Runs `scripts/db-migrate.ts` against `testdb`, so one migration implementation serves both
 * stacks. `db/init/` never runs on testdb, so `POSTGRES_USER` and `APP_DB_USER` both become
 * `postgres`, the one role it has (`SET LOCAL ROLE postgres` is then a no-op), and
 * `APP_RUNTIME_DB_USER` stays `app_runtime`, which migration 001 creates. Trust auth ignores the
 * placeholder password. These go in the child's environment, which `loadEnvFile` never overrides,
 * so a developer's `.env` can't leak in.
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
 * Opens the test database: resets `schema public` from db/schema.sql, then applies db/migrations/
 * through `migrateTestDb`. Refuses any database not named "postgres" (the name testdb uses
 * locally and in CI), so a misconfigured TEST_DATABASE_URL can't drop a real schema. Queries run as
 * `app_runtime` over a second pool, so every test proves migration 001's grants; `reset()` uses
 * the superuser pool, since `app_runtime` has no TRUNCATE.
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
    connect(): Promise<pg.PoolClient> {
      return runtimePool.connect();
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
