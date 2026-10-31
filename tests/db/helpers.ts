// A thin Postgres harness for tests/db/queries.test.ts: opens the local test database, runs a
// query file from db/queries the way the Postgres node would, and resets state between tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

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

/**
 * Opens the local test database, resetting `schema public` from db/schema.sql first. Refuses to
 * run against anything but a database literally named "postgres" — the one name CI's service and
 * the local `testdb` container both use — so a misconfigured TEST_DATABASE_URL can't drop a real
 * schema.
 */
export async function openTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set; start the test database (see AGENTS.md).');

  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows } = await pool.query<{ current_database: string }>('SELECT current_database()');
    const name = rows[0]?.current_database;
    if (name !== 'postgres') {
      throw new Error(`openTestDb() refuses to reset database "${String(name)}": it only resets a database named "postgres" (see AGENTS.md)`);
    }

    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(readFileSync('db/schema.sql', 'utf8'));
  } catch (err) {
    await pool.end();
    throw err;
  }

  return {
    async run<T>(queryFile: string, params: unknown[]): Promise<T[]> {
      const text = readFileSync(join('db/queries', queryFile), 'utf8');
      // pg's own generic requires T extends QueryResultRow; this helper's callers assert whatever
      // shape their query actually returns, so query() is left untyped and .rows cast at the edge.
      const { rows } = await pool.query(text, params.map(bind));
      return rows as T[];
    },
    async sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const { rows } = await pool.query(text, params);
      return rows as T[];
    },
    async reset(): Promise<void> {
      await pool.query('TRUNCATE invoices, invoice_items, processed_events RESTART IDENTITY CASCADE');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
