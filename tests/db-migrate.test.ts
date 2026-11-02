import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_SQL,
  MIGRATION_LOCK_KEY,
  migrationScript,
  missingEnv,
  missingEnvError,
  orderMigrations,
  pendingMigrations,
  recordMigration,
  requiredEnv,
  RUNTIME_PASSWORD_SQL,
  runtimeRoleClashes,
  transactionControl,
} from '../scripts/db-migrate.ts';
import { psqlArgs, redact, secretValues } from '../scripts/lib/runtime.ts';

describe('orderMigrations', () => {
  it('sorts by sequence number and ignores files that are not SQL', () => {
    expect(orderMigrations(['002_unfinished_index.sql', 'README.md', '001_runtime_role.sql', '010_later.sql']))
      .toEqual(['001_runtime_role.sql', '002_unfinished_index.sql', '010_later.sql']);
  });

  it('rejects a SQL file whose name lacks the three-digit sequence number', () => {
    expect(() => orderMigrations(['1_runtime_role.sql'])).toThrow(/1_runtime_role\.sql.*001_short_name\.sql/);
    expect(() => orderMigrations(['001-runtime-role.sql'])).toThrow(/001-runtime-role\.sql/);
  });

  it('rejects two files with the same sequence number, so two branches cannot both claim one', () => {
    expect(() => orderMigrations(['003_a.sql', '003_b.sql'])).toThrow(/003_a\.sql and 003_b\.sql share 003/);
  });
});

describe('pendingMigrations', () => {
  it('chooses the files not yet applied, in order', () => {
    expect(pendingMigrations(['001_a.sql', '002_b.sql', '003_c.sql'], new Set(['001_a.sql']))).toEqual(['002_b.sql', '003_c.sql']);
  });

  it('chooses nothing once every file is applied, which is what a second run sees', () => {
    expect(pendingMigrations(['001_a.sql', '002_b.sql'], new Set(['001_a.sql', '002_b.sql']))).toEqual([]);
  });

  it('chooses every file on a database that has applied none', () => {
    expect(pendingMigrations(['001_a.sql', '002_b.sql'], new Set())).toEqual(['001_a.sql', '002_b.sql']);
  });
});

describe('requiredEnv', () => {
  it('lists the environment variables a script reads with \\getenv, once each, in order', () => {
    const sql = ['\\getenv role APP_RUNTIME_DB_USER', 'SELECT 1;', '\\getenv pw APP_RUNTIME_DB_PASSWORD', '\\getenv again APP_RUNTIME_DB_USER'].join('\n');
    expect(requiredEnv(sql)).toEqual(['APP_RUNTIME_DB_USER', 'APP_RUNTIME_DB_PASSWORD']);
  });

  it('finds none in a script that reads no environment', () => {
    expect(requiredEnv('ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);')).toEqual([]);
  });

  it('covers the bootstrap and password scripts db-migrate runs on every call', () => {
    expect(requiredEnv(BOOTSTRAP_SQL)).toEqual(['APP_DB_USER']);
    expect(requiredEnv(RUNTIME_PASSWORD_SQL)).toEqual(['APP_RUNTIME_DB_USER', 'APP_RUNTIME_DB_PASSWORD']);
  });
});

describe('missingEnv and missingEnvError', () => {
  it('treats an unset and an empty value alike, since Compose turns an unset name into an empty one', () => {
    expect(missingEnv(['A', 'B', 'C'], { A: 'set', B: '' })).toEqual(['B', 'C']);
  });

  it('names only the variable, never any value', () => {
    const env = { APP_RUNTIME_DB_USER: 'app_runtime', APP_RUNTIME_DB_PASSWORD: '' };
    const message = missingEnvError('001_runtime_role.sql', missingEnv(['APP_RUNTIME_DB_USER', 'APP_RUNTIME_DB_PASSWORD'], env)).message;
    expect(message).toContain('001_runtime_role.sql');
    expect(message).toContain('APP_RUNTIME_DB_PASSWORD');
    expect(message).not.toContain('app_runtime');
    expect(message).not.toMatch(/APP_RUNTIME_DB_USER/);
  });
});

describe('recordMigration', () => {
  it('records the file name in schema_migrations, as the last statement of the same transaction', () => {
    expect(recordMigration('001_runtime_role.sql')).toBe("INSERT INTO schema_migrations (filename) VALUES ('001_runtime_role.sql');\n");
  });

  it('refuses a name that could break out of the string literal', () => {
    expect(() => recordMigration("001_x');DROP TABLE t;--.sql")).toThrow(/not a migration file name/);
  });
});

describe('migrationScript', () => {
  it('takes the advisory lock first, inside the file\'s own transaction, and records the file last', () => {
    const script = migrationScript('002_x.sql', 'CREATE INDEX IF NOT EXISTS i ON t (c);');
    expect(script.split('\n')[0]).toBe(`SELECT pg_advisory_xact_lock(${String(MIGRATION_LOCK_KEY)});`);
    expect(script.endsWith(recordMigration('002_x.sql'))).toBe(true);
    expect(script).toContain('CREATE INDEX IF NOT EXISTS i ON t (c);');
  });
});

describe('transactionControl', () => {
  it.each([
    ['BEGIN;\nALTER TABLE t ADD c int;', 'BEGIN'],
    ['ALTER TABLE t ADD c int;\ncommit;', 'COMMIT'],
    ['SELECT 1;\n  Rollback ;', 'ROLLBACK'],
    ['ABORT;', 'ABORT'],
    ['START   TRANSACTION;\nSELECT 1;', 'START TRANSACTION'],
    ['SELECT 1;\nEND;', 'END'],
    ['\\getenv owner APP_DB_USER\nBEGIN;', 'BEGIN'],
  ])('finds a transaction-control statement in %j', (sql, keyword) => {
    expect(transactionControl(sql)).toBe(keyword);
  });

  it('ignores the words inside a DO block, a string, a quoted identifier, or a comment', () => {
    const sql = [
      "DO $$\nBEGIN\n  IF true THEN RAISE NOTICE 'x'; END IF;\nEND\n$$;",
      "DO $body$ BEGIN PERFORM 1; END $body$;",
      "INSERT INTO t (note) VALUES ('BEGIN; COMMIT;');",
      'SELECT 1 AS "end";',
      '-- BEGIN; COMMIT;',
      '/* ROLLBACK; */ SELECT CASE WHEN true THEN 1 END;',
    ].join('\n');
    expect(transactionControl(sql)).toBeUndefined();
  });

  it('finds none in any migration in db/migrations', () => {
    for (const file of orderMigrations(readdirSync('db/migrations'))) {
      expect(transactionControl(readFileSync(`db/migrations/${file}`, 'utf8')), file).toBeUndefined();
    }
  });
});

describe('runtimeRoleClashes', () => {
  const env = { POSTGRES_USER: 'postgres', N8N_DB_USER: 'n8n', APP_DB_USER: 'app', APP_RUNTIME_DB_USER: 'app_runtime' };

  it('finds nothing when the runtime role has its own name', () => {
    expect(runtimeRoleClashes(env)).toEqual([]);
  });

  it('names each variable the runtime role shares a name with, never the value', () => {
    expect(runtimeRoleClashes({ ...env, APP_RUNTIME_DB_USER: 'app' })).toEqual(['APP_DB_USER']);
    expect(runtimeRoleClashes({ ...env, APP_RUNTIME_DB_USER: 'postgres' })).toEqual(['POSTGRES_USER']);
    expect(runtimeRoleClashes({ ...env, N8N_DB_USER: 'app_runtime' })).toEqual(['N8N_DB_USER']);
  });

  it('leaves an unset runtime name to the missing-variable check', () => {
    expect(runtimeRoleClashes({ ...env, APP_RUNTIME_DB_USER: '' })).toEqual([]);
  });
});

describe('keeping passwords out of the server log', () => {
  it('raises log_min_error_statement before the password statement, inside its transaction', () => {
    const lines = RUNTIME_PASSWORD_SQL.split('\n');
    expect(lines[0]).toBe('SET LOCAL log_min_error_statement = panic;');
    expect(lines[1]).toBe("SET LOCAL log_statement = 'none';");
    expect(lines.findIndex((l) => l.includes("PASSWORD :'"))).toBeGreaterThan(1);
  });

  it('does the same in db/init, before the first statement that carries a password', () => {
    const init = readFileSync('db/init/01-databases.sh', 'utf8');
    const quiet = init.indexOf('SET log_min_error_statement = panic;');
    expect(quiet).toBeGreaterThan(-1);
    expect(init.indexOf("SET log_statement = 'none';")).toBeGreaterThan(quiet);
    expect(init.indexOf("PASSWORD :'")).toBeGreaterThan(quiet);
  });

  it('makes db/init stop on an empty password instead of creating a role without one', () => {
    expect(readFileSync('db/init/01-databases.sh', 'utf8')).toContain(': "${N8N_DB_PASSWORD:?must be set in .env}" "${APP_DB_PASSWORD:?must be set in .env}"');
  });
});

describe('RUNTIME_PASSWORD_SQL', () => {
  it('re-asserts every attribute on every run, so a hand-granted one does not survive it', () => {
    expect(RUNTIME_PASSWORD_SQL).toContain(
      `ALTER ROLE :"runtime_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';`,
    );
  });
});

describe('psqlArgs', () => {
  it('forwards each environment variable by name only, so its value never reaches an argument list', () => {
    const args = psqlArgs({ role: 'POSTGRES_USER', database: 'app', forwardEnv: ['APP_RUNTIME_DB_PASSWORD'], singleTransaction: true });
    expect(args.slice(0, 4)).toEqual(['exec', '-T', '-e', 'APP_RUNTIME_DB_PASSWORD']);
    expect(args.slice(4, 7)).toEqual(['postgres', 'sh', '-c']);
    expect(args.some((a) => a.includes('APP_RUNTIME_DB_PASSWORD='))).toBe(false);
    expect(args.at(-1)).not.toContain('APP_RUNTIME_DB_PASSWORD');
  });

  it('runs psql inside the container, expanding the role there, with the script on stdin', () => {
    const script = psqlArgs({ role: 'APP_RUNTIME_DB_USER', database: 'n8n', forwardEnv: [], singleTransaction: false }).at(-1);
    expect(script).toBe('psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$APP_RUNTIME_DB_USER" -d n8n -f -');
    const migrate = psqlArgs({ role: 'POSTGRES_USER', database: 'app', forwardEnv: [], singleTransaction: true }).at(-1);
    expect(migrate).toBe('psql -X -q -A -t -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d app -f -');
  });

  it('runs inside a different Compose service when container is overridden, for pnpm run test:db', () => {
    const args = psqlArgs({ role: 'POSTGRES_USER', database: 'app', forwardEnv: [], singleTransaction: false, container: 'testdb' });
    expect(args).toContain('testdb');
    expect(args).not.toContain('postgres');
  });
});

describe('redact and secretValues', () => {
  it('replaces every occurrence of each secret', () => {
    expect(redact('ALTER ROLE x PASSWORD s3cr3t-value; again s3cr3t-value', ['s3cr3t-value'])).toBe('ALTER ROLE x PASSWORD [redacted]; again [redacted]');
  });

  it('collects the values of password, secret, token, and key variables, skipping empty ones', () => {
    const env = { APP_DB_PASSWORD: 'p1', DEV_HARNESS_TOKEN: 't1', N8N_ENCRYPTION_KEY: 'k1', APP_DB_USER: 'app', ANTHROPIC_API_KEY: '' };
    expect(secretValues(env).sort()).toEqual(['k1', 'p1', 't1']);
  });
});

describe('002_unfinished_index.sql', () => {
  it('is a partial index on received_at, for daily-summary.sql\'s unfinished scan, guarded so a second run adds nothing', () => {
    const sql = readFileSync('db/migrations/002_unfinished_index.sql', 'utf8');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS processed_events_unfinished_idx ON processed_events (received_at) WHERE outcome IS NULL;');
  });
});

describe('003_drop_sequence_grant.sql', () => {
  it('revokes the runtime role\'s sequence grant that 001 should never have made, idempotently', () => {
    const sql = readFileSync('db/migrations/003_drop_sequence_grant.sql', 'utf8');
    expect(sql).toContain('REVOKE ALL ON SEQUENCE invoices_id_seq FROM :"runtime_role";');
    expect(requiredEnv(sql)).toEqual(['APP_RUNTIME_DB_USER']);
  });

  it('001 no longer grants anything on invoices_id_seq', () => {
    const sql = readFileSync('db/migrations/001_runtime_role.sql', 'utf8');
    expect(sql).not.toMatch(/GRANT.*invoices_id_seq/);
  });
});

describe('004_source_check.sql', () => {
  const sql = readFileSync('db/migrations/004_source_check.sql', 'utf8');
  const checkValues = (): string[] => {
    const list = /source IN \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '').sort();
  };

  it('is a guarded CHECK on processed_events.source, so a second run adds nothing', () => {
    expect(sql).toContain("ALTER TABLE processed_events ADD CONSTRAINT processed_events_source_check CHECK (source IN ('gmail'));");
    expect(sql).toContain("conname = 'processed_events_source_check'");
  });

  it('covers every value a writer inserts into processed_events.source', () => {
    const recordEvent = readFileSync('db/queries/record-event.sql', 'utf8');
    const written = [...recordEvent.matchAll(/VALUES\s*\(\s*'([a-z_]+)'/g)].map((m) => m[1] ?? '');
    expect(written.length).toBeGreaterThan(0);
    for (const value of written) expect(checkValues()).toContain(value);
  });

  it('covers every value a reader filters processed_events.source by', () => {
    const scenarioReport = readFileSync('scripts/sql/scenario-report.sql', 'utf8');
    const filtered = [...scenarioReport.matchAll(/\.source\s*=\s*'([a-z_]+)'/g)].map((m) => m[1] ?? '');
    const updateFilters = [...readFileSync('db/queries/record-outcome.sql', 'utf8').matchAll(/WHERE\s+source\s*=\s*'([a-z_]+)'/g)].map((m) => m[1] ?? '');
    for (const value of [...filtered, ...updateFilters]) expect(checkValues()).toContain(value);
  });
});
