# How the database is run

One Postgres 17 server holds two databases: `n8n`, n8n's own (workflows, credentials, executions), and `app`, the invoice pipeline's (`invoices`, `invoice_items`, `processed_events`, and the migration ledger `schema_migrations`). This page covers which role reaches what, every statement the workflows issue and the grant behind it, how schema changes ship, how long data stays, backup and restore, and how `node scripts/check-db.ts` proves the protections hold. The [architecture doc](architecture.md) covers the data model's place in the invoice lifecycle.

## Roles

| Role | Owns | Used by | Can |
|---|---|---|---|
| `postgres` (`POSTGRES_USER`) | the server | `db/init/` and `db-migrate`, over the `postgres` container's local socket | Everything. It's never configured in the n8n container. |
| `n8n` (`N8N_DB_USER`) | database `n8n` | n8n itself | Its own database only. |
| `app` (`APP_DB_USER`) | database `app` and its tables | `db-migrate`'s `SET LOCAL ROLE` while creating a table | Everything in `app`. Never used by n8n directly. |
| `app_runtime` (`APP_RUNTIME_DB_USER`) | nothing | the `App DB` credential, which every Postgres node in `workflows/` uses | The DML listed below, and nothing else. |

`db/migrations/001_runtime_role.sql` creates `app_runtime` and grants it, table by table, exactly what the statements below need.

### No node here issues DDL on its own

Unlike demo 1's Postgres Chat Memory node (which runs `CREATE TABLE IF NOT EXISTS` on every execution and so needs its own owner-role credential), nothing in this repo's `workflows/` does that: every AI node here is `@n8n/n8n-nodes-langchain.informationExtractor` (text extraction) or `@n8n/n8n-nodes-langchain.lmChatAnthropic` (its model sub-node), neither of which touches Postgres at all, and every Postgres node is a plain `n8n-nodes-base.postgres` Execute Query node running one of the statements below. So there is exactly one Postgres credential (`App DB`), and it connects as `app_runtime` everywhere. Checked by reading `n8n-nodes-base.postgres` and `@n8n/n8n-nodes-langchain.*` node usage straight from every file in `workflows/` (see `tests/check-db.test.ts`'s `workflow statements` describe block, which lists every Postgres node found).

## Every statement and what covers it

The six Postgres node statements all run as `app_runtime`. Each `UPDATE`'s `WHERE`, and an `INSERT ... ON CONFLICT`'s own conflict check, read columns, so they need `SELECT` as well; checked against Postgres 17.11 with a role that held only the write privilege. The "Served by" column comes from `EXPLAIN` on Postgres 17.11.

| Workflow › node | Statement | Privileges it needs | Served by |
|---|---|---|---|
| `intake-email` › Record event | `INSERT INTO processed_events (source, event_id, file_name) VALUES ('gmail', $1, $2) ON CONFLICT DO NOTHING RETURNING event_id, ...` | `INSERT`, `SELECT` on `processed_events` | primary key `(source, event_id)`, as the conflict arbiter |
| `process-invoice` › Save invoice | an `INSERT INTO invoices ... RETURNING id` (skipped on replay via `WHERE NOT EXISTS`), then an `INSERT INTO invoice_items ...` per line item, then a final `SELECT` that re-reads `invoices` for the replay and duplicate checks | `SELECT`, `INSERT` on `invoices`; `INSERT` on `invoice_items` — no privilege on `invoices_id_seq` is needed (see below) | `invoices_source_event_id_key` (the replay check), `invoices_supplier_tax_id_invoice_number_key` (the duplicate check) |
| `process-invoice` › Record duplicate | `UPDATE processed_events SET outcome = 'duplicate', invoice_id = $3 WHERE source = 'gmail' AND event_id = $1` | `UPDATE`, `SELECT` on `processed_events` | primary key `(source, event_id)` |
| `process-invoice` › Save Drive link | `UPDATE invoices SET drive_file_id = $2, drive_url = $3 WHERE id = $1 RETURNING *`, then a `SELECT` of its `invoice_items`, ordered | `UPDATE`, `SELECT` on `invoices`; `SELECT` on `invoice_items` | primary key on `invoices`; `invoice_items_pkey` `(invoice_id, line_no)` for the ordered read |
| `process-invoice` › Record outcome | `UPDATE processed_events SET outcome = $2, invoice_id = $3 WHERE source = 'gmail' AND event_id = $1` | `UPDATE`, `SELECT` on `processed_events` | primary key `(source, event_id)` |
| `daily-summary` › Query summary | reads the last 24h window of `processed_events`, the unfinished count, and `invoices` joined to it for totals/review, plus `invoices` alone for "due soon" | `SELECT` on `processed_events` and `invoices` | `processed_events_received_at_idx` (the window and "due soon" aren't the same table — see below), `processed_events_unfinished_idx` (the partial index added in `002_unfinished_index.sql`), `invoices_due_date_idx`; the `finished_invoices` join itself is a documented exception (below) |

So `app_runtime` holds `SELECT, INSERT, UPDATE` on `processed_events`, `SELECT, INSERT, UPDATE` on `invoices`, and `SELECT, INSERT` on `invoice_items`. No `DELETE` anywhere: nothing in this pipeline ever deletes a row (see Retention below), and no migration has granted it. It needs no privilege on `schema_migrations`, which only `db-migrate` ever touches, and no privilege at all on `invoices_id_seq` — see below.

### No grant on `invoices_id_seq`

`invoices.id` is `GENERATED ALWAYS AS IDENTITY`. Postgres backs an identity column with its own sequence (named `<table>_<column>_seq` by default), but an `INSERT` that doesn't explicitly list the identity column calls that sequence's `nextval()` implicitly, and **the implicit call runs with no privilege check on the sequence at all** — unlike an explicit `nextval('invoices_id_seq')` in a hand-written query, which would need `USAGE`. `001_runtime_role.sql` originally granted `app_runtime` `USAGE, SELECT` on `invoices_id_seq`, reasoning (wrongly) that the implicit call needed it.

Proven empirically on Postgres 17.11: a throwaway role holding only `SELECT, INSERT` on a table with a `GENERATED ALWAYS AS IDENTITY` column, and no grant whatsoever on that column's backing sequence, still inserts into it successfully (`has_sequence_privilege` for both `USAGE` and `SELECT` reads `false` for the role the whole time). The same check was repeated against this repo's own `invoices` table and `app_runtime`, with the same result, and `pnpm run test:db`'s `save-invoice.sql` test (which inserts into `invoices` as `app_runtime` on every run) passes with no sequence grant at all.

Because `001` has already run on CI's fresh volumes and on an upgraded local volume, the grant isn't simply deleted from `001` — that would leave it standing on any volume where `001` already applied. `003_drop_sequence_grant.sql` runs `REVOKE ALL ON SEQUENCE invoices_id_seq FROM app_runtime` (idempotently: revoking a privilege a role doesn't hold is a no-op, not an error) so an existing volume loses the grant too. `invoice_items` has no identity column (`(invoice_id, line_no)` is a natural composite key), so it never needed a sequence grant in the first place.

### `scripts/sql/scenario-report.sql` is not part of this list

`check-scenarios.ts` runs that report directly through `psql` as the owner role (`APP_DB_USER`), not through a Postgres node — see AGENTS.md's Repo map. It's a read-only `SELECT`, used only by offline scenario grading, so it's outside `app_runtime`'s grant surface and outside what `check-db.ts` proves.

## The checklist

### 1. Roles

- **The schema owner isn't the runtime role.** `app` owns every table in `app`, including `schema_migrations`, which `db-migrate` creates under `SET LOCAL ROLE`. n8n's app credential, `App DB`, connects as `app_runtime`.
- **What `app_runtime` can't do.**
  - **DML only.** It has DML only on the three tables above, no privilege on any sequence (see "No grant on `invoices_id_seq`" above), and no DDL in `app`: `001_runtime_role.sql` runs `REVOKE CREATE ON SCHEMA public FROM PUBLIC` and grants it nothing on the schema beyond `USAGE`.
  - **No wider grants.** It has no `TRUNCATE`, and no column-level grant beyond its table grants.
  - **No membership.** It's a member of no role, so it can't `SET ROLE` to the owner.
  - **No attributes.** `db-migrate` re-asserts `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` every time it sets the password.
  - **No `n8n`.** `db/init/` revokes `PUBLIC`'s access, and the migration revokes `app_runtime`'s own access when that database exists (see below).
  - **`CONNECT` on `app`, without `TEMP`.** `db/init/` revoked `PUBLIC`'s defaults there.
- **Its own name.** `db-migrate` refuses to run when `APP_RUNTIME_DB_USER` equals `POSTGRES_USER`, `N8N_DB_USER`, or `APP_DB_USER`, which would aim the runtime grants and password at another role.
- **No default privileges.** A new table gets its grants in its own migration.
- **The superuser stays out of n8n.** It runs only `db/init/` and `db-migrate`, and neither n8n container is configured with it.
- **No DDL-issuing node here** (unlike demo 1's Postgres Chat Memory node), so there's no second, owner-credentialed node to carve out — see above.
- **The `postgres` maintenance database** keeps its default `PUBLIC` `CONNECT` and `TEMP`, so `app_runtime` can connect there and create temporary tables. This repo leaves that database alone: it holds no data, and nothing in it reaches `app` or `n8n`.

NOTE: `001_runtime_role.sql`'s `n8n`-revoke and `app`-connect-grant statements are guarded (`WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = 'n8n')`, and `current_database()` rather than a literal `app`) so the same migration file can also run against `pnpm run test:db`'s `testdb` service, which has neither database — see Migrations below and that test's own section. This doesn't weaken the real stack: on it, `n8n` always exists and `current_database()` always evaluates to `app`, so both statements run exactly as a hardcoded version would.

NOTE: Grants are table-level. Column-level `UPDATE` grants would stop a leaked runtime credential from rewriting a column such as `status`, but every grant check would then have to compare columns too. `check-db` already flags any column grant beyond the table-level list.

### 2. Schema

- **Primary keys:** every table has one: `invoices (id)`, `invoice_items (invoice_id, line_no)`, `processed_events (source, event_id)`, and `schema_migrations (filename)`.
- **CHECKs on enumerated columns:** `invoices.status` (`ok`, `review`) and `invoices.extraction_path` (`text`, `vision`, `none`) have had one since the baseline, each derived from every writer of the column — both are written only by `process-invoice`'s "Save invoice" node, whose values come from `src/nodes/prepare-record.ts`'s `run()` (the only place that decides a record's `status`/`extraction_path`). `processed_events.outcome` (`ok`, `review`, `duplicate`, or `NULL`) is also checked in the baseline; it's written by "Record duplicate" (always `'duplicate'`) and "Record outcome" (`$('Save Drive link').first().json.invoice.status`, which is `invoices.status`'s own value read back, so it can only ever be `ok` or `review`).
- **`NOT NULL`:** set on every required value: `source_event_id`, `gmail_message_id`, `received_at`, `status`, `review_reasons`, `extraction_path`, `attempts`, `drive_file_name`, `drive_folder`, `created_at` on `invoices`; `invoice_id`, `line_no`, `description` on `invoice_items`; `source`, `event_id`, `file_name`, `received_at` on `processed_events`; `filename`, `applied_at` on `schema_migrations`. Every other column on `invoices` (supplier, dates, amounts, `drive_file_id`, `drive_url`, `model`, `raw_extraction`) is nullable because an extraction can legitimately fail to read a field, and the Drive fields aren't known until after the row is saved; `processed_events.outcome` and `.invoice_id` are nullable until processing finishes.
- **Timestamps** are `timestamptz`. This repo has no MySQL.

### 3. Indexes

Every statement a production path runs is served by a primary key, a unique constraint, or an index, as the table above shows, except one documented join.

- **`invoices_received_at_idx`, `invoices_due_date_idx`, `processed_events_received_at_idx`** (the baseline). The first two serve `daily-summary`'s per-supplier totals/review windows and its "due soon" scan; the third serves the 24-hour arrival window.
- **`invoices_source_event_id_key`, `invoices_supplier_tax_id_invoice_number_key`** (the baseline's `UNIQUE` constraints, which Postgres backs with an index automatically). These serve "Save invoice"'s own replay check (by `source_event_id`) and duplicate check (by the tax-id/invoice-number pair).
- **The unfinished scan.** `002_unfinished_index.sql` adds `processed_events_unfinished_idx`, a partial index on `(received_at) WHERE outcome IS NULL`, for `daily-summary.sql`'s "unfinished" count (`outcome IS NULL AND received_at < now() - interval '30 minutes'`). Without it, Postgres would have to range-scan the full `received_at` index and re-check `outcome` for every row in range; the partial index only ever holds rows still mid-pipeline, so it stays small regardless of how many invoices the table accumulates over time (see Retention below — `invoices`/`processed_events` are never pruned).

One documented exception reads by a sequential scan, on purpose:

- **The `finished_invoices` join** (`invoices i JOIN processed_events pe ON pe.invoice_id = i.id WHERE pe.outcome IS NOT NULL`) plans as two `Seq Scan`s joined with a hash, because neither table has an index on `invoice_id`/`id` sized for this shape (the join key is already each table's own primary key or a foreign key with no secondary index), and the planner judges a full read of the small result sets cheaper than building one for a single daily report. It runs once a day; `invoices` never shrinks, but a sequential read of one table a day is the acceptable cost for a report this infrequent. A busier deployment proving this plan degrades could add an index on `processed_events (invoice_id)`.

### 4. Queries

- **Bound values only.** Every Postgres node passes its values as `$n` Query Parameters. `pnpm run check` rejects a query that contains a `{{ }}` expression inside the SQL text itself.
- **CI runs every statement.** `check-db` runs each workflow statement exactly as the workflow wrote it, with psql's `\bind` supplying the values.

### 5. Migrations

`db/schema.sql` is the baseline, which `db/init/` loads on an empty volume. Every change after it is a file in `db/migrations/`, named `NNN_short_name.sql`. `pnpm run db:migrate` (`scripts/db-migrate.ts`) applies them, and `pnpm run setup` runs it first. On each run, it:

1. **Checks the files and `.env` first.** It stops before touching the database in three cases. Each error names files and variables, never a value.
   - A file contains a transaction-control statement (`BEGIN`, `COMMIT`, `ROLLBACK`, `ABORT`, `START TRANSACTION`, or `END`), which would split the file from its ledger row.
   - `APP_RUNTIME_DB_USER` names the same role as another role variable.
   - A variable that a pending file reads with `\getenv` is unset or empty.
2. **Opens the ledger.** As the owner role, it creates `schema_migrations` if it's missing, then reads the files already recorded there.
3. **Applies each pending file in order,** as the superuser over the container's local socket, with `--single-transaction` and `ON_ERROR_STOP`. Each file's transaction first takes a fixed advisory lock (`pg_advisory_xact_lock`), so two runs can't interleave. A concurrent second run then fails on the ledger's primary key instead of recording a file twice. The `INSERT` into `schema_migrations` is the file's last statement, so a failed file leaves no change and no record.
4. **Sets `app_runtime`'s password and attributes** from `APP_RUNTIME_DB_PASSWORD`, even when no migration ran, with `ALTER ROLE … WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD …`. A hand-granted attribute doesn't survive the next run. `setup-credentials` rebuilds the `App DB` credential from `.env` on every run, so the role's password must follow it the same way. To rotate it, change `.env` and run `pnpm run setup`.

`db-migrate` passes each variable to `docker compose exec` as a bare `-e NAME`. Docker copies the value from `db-migrate`'s own environment, so it never appears in an argument list or in `ps`, and psql reads it with `\getenv`. A password reaches the server only inside `ALTER ROLE … PASSWORD`, which psql quotes itself. `db-migrate` redacts every `.env` secret from psql's output before printing an error.

Postgres also logs a failed statement's full text by default (`log_min_error_statement = error`), and `ALTER ROLE … PASSWORD` carries the password. So the password step first runs `SET LOCAL log_min_error_statement = panic` and `SET LOCAL log_statement = 'none'` inside its own transaction. `db/init/` does the same for its session before it creates the n8n and app roles. A failed `ALTER ROLE` then logs its error, never its statement. `db/init/` also stops at once if `N8N_DB_PASSWORD` or `APP_DB_PASSWORD` is empty — checked locally by searching `docker compose logs postgres` for `PASSWORD '` after a deliberately failed password statement: zero matches.

A file must be safe to run twice:

- `001` creates the role through `\gexec` only `WHERE NOT EXISTS`. Its `n8n`-revoke and `app`-connect-grant statements are also conditional `\gexec` calls (see the role checklist's NOTE above), so the file is idempotent regardless of which database it runs against.
- `002` creates its partial index `IF NOT EXISTS`. An index belongs to its table's owner, so it needs no `SET ROLE`. A plain `CREATE INDEX` blocks writes while it builds, which is brief at this size; a large production table would need `CREATE INDEX CONCURRENTLY`, which can't run inside a transaction, as a separate step.
- `003` runs `REVOKE ALL ON SEQUENCE invoices_id_seq FROM app_runtime`, which is naturally idempotent: revoking a privilege a role doesn't hold succeeds with no error (proven empirically — running it twice in a row against a role holding nothing on the sequence both times returned plain `REVOKE`).
- `GRANT` and `REVOKE` are idempotent.

The ledger already skips applied files, so a second `pnpm run setup` prints `no pending migrations`. A migration that creates a table starts with `\getenv owner APP_DB_USER` and `SET LOCAL ROLE :"owner";`, so `app` owns the table, not the superuser (neither migration here creates a table, but this still applies to any future one).

#### `pnpm run test:db` applies the same migrations, against `testdb`

`db-migrate.ts` reads two optional environment variables, `DB_MIGRATE_CONTAINER` and `DB_MIGRATE_DATABASE`, defaulting to `postgres` and `app` — the real stack's own container and database. `tests/db/helpers.ts`'s `openTestDb()` runs `scripts/db-migrate.ts` as a child process with `DB_MIGRATE_CONTAINER=testdb`, `DB_MIGRATE_DATABASE=postgres` (the one database `testdb`'s trust-auth container has), `POSTGRES_USER=postgres` and `APP_DB_USER=postgres` (the one role that already exists there, so the bootstrap's `SET LOCAL ROLE postgres` is a superuser no-op), and `APP_RUNTIME_DB_USER=app_runtime` with a fixed placeholder password (trust auth never checks it). These are passed as the child process's own environment, which Node's `loadEnvFile` (`loadDotEnv`) never overrides once a name is already set, so a developer's own `.env` role names can't leak into this run even when `.env` exists. This keeps **one** migration implementation: the same `001_runtime_role.sql`/`002_unfinished_index.sql`/`003_drop_sequence_grant.sql` files, run by the same script, prove themselves against both the real stack and the test database.

Every query test in `tests/db/queries.test.ts` then runs over a second connection pool, opened as `app_runtime` (not the superuser), so the exact grants these migrations create are proven by every one of those tests, not only by `check-db.ts` against the real stack. `reset()` (the per-test `TRUNCATE`) still runs over the superuser pool, since `app_runtime` has no `TRUNCATE` — proving that gap is `check-db`'s job, not this harness's. Because `testdb` runs with trust auth, this proves **authorization** — that the grants `app_runtime` holds are exactly right for the queries the workflow runs — not **authentication**; the password check `app_runtime`'s real-stack `scram-sha-256` connection enforces is only exercised against the real stack, through `check-db.ts` and `check-dev-response.ts`.

CI's `db` job now brings up `testdb` the same way a local run does (`docker compose --profile test up -d --wait testdb`), rather than a separate GitHub Actions service container, so CI exercises the identical path.

### 6. Retention

**App tables:**

| Table | Personal/business data | Deleted by | When |
|---|---|---|---|
| `invoices` | supplier name and tax id, amounts, dates | nothing | kept indefinitely — see below |
| `invoice_items` | line descriptions and amounts | nothing | kept indefinitely, tied to its invoice (`ON DELETE CASCADE`, never exercised) |
| `processed_events` | a Gmail attachment's file name and arrival time | nothing | kept indefinitely |
| `schema_migrations` | none | nothing | it's the ledger |

**Why invoices are kept, not deleted.** `invoices` and `invoice_items` are accounting records: Magdaport needs them to reconcile what it was billed, when, and for how much, for as long as the business itself needs that trail — there is no point at which an invoice becomes safe to discard the way a chat transcript or a support ticket eventually does. This repo ships no retention job for them, by design, not by oversight. A real deployment's actual retention period is **the client's call, set by the jurisdiction they file taxes and keep accounting records in** (in Colombia, DIAN's own rules on supporting documents; a different country's tax and corporate-records law would set a different number) — this demo doesn't pick a number because it would be wrong for some real client's actual legal obligation. `processed_events` is kept alongside them because it's the only record of *which* Gmail attachment produced *which* invoice row (or that one was a duplicate of another); deleting it independently of `invoices` would break that trail without actually freeing any invoice data.

**n8n execution data:** `compose.yaml` keeps `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168`, so n8n deletes executions after 168 hours. A manual execution, started from the editor, is saved by default with every node's input and output. Every workflow in `workflows/` sets `settings.saveManualExecutions: false`, and `tests/workflows/platform.test.ts` asserts it for every file.

A per-workflow list wouldn't hold. Most workflows carry Gmail message content or an invoice's supplier/tax-id/amount fields; `dev-harness`'s own webhook carries its caller's `X-Dev-Token` header; and even `load-config`, which only reads a mounted file, starts from a passthrough Execute Workflow Trigger whose callers send no input schema, so it receives its caller's whole item too — the same reasoning demo 1 documents for its own config loader.

Production executions are still saved, then pruned at 168 hours.

### 7. Backup and restore

Back up `app` from the running stack. Every command runs in the `postgres` container, so no port or password crosses the host. A dump holds business data, so write it outside the repo, with a `0600` mode:

```bash
mkdir -p ~/magdaport-backups
(umask 077; docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d app' > ~/magdaport-backups/app.dump)
```

To check a dump, restore it into a scratch database, compare the row counts, then drop only that database:

```bash
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" -O "$APP_DB_USER" app_restore_check'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d app_restore_check --exit-on-error' < ~/magdaport-backups/app.dump
for db in app app_restore_check; do
  docker compose exec -T postgres sh -c "psql -X -At -U \"\$POSTGRES_USER\" -d $db -c \"SELECT 'invoices', count(*) FROM invoices UNION ALL SELECT 'invoice_items', count(*) FROM invoice_items UNION ALL SELECT 'processed_events', count(*) FROM processed_events UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations\""
done
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" app_restore_check'
```

This was run once against the local stack, on an empty database (no invoices processed yet, since the demo's Gmail/Drive/Sheets credentials aren't configured). Both databases counted 0 `invoices`, 0 `invoice_items`, 0 `processed_events`, and 2 `schema_migrations` rows. The restore also kept every table's owner, `app`, along with `app_runtime`'s exact grants (no privilege on `invoices_id_seq`, included).

To restore over `app` itself, stop n8n first, so nothing writes during the restore. `--clean --if-exists` drops each object in the dump before recreating it:

```bash
docker compose stop n8n
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d app --clean --if-exists --exit-on-error' < ~/magdaport-backups/app.dump
docker compose start n8n
```

Roles live at the server level, so a dump doesn't carry them; on a fresh volume, `db/init/` and `pnpm run db:migrate` recreate them from `.env`.

**n8n's own database** backs up the same way, with `-d n8n`. Its credentials are encrypted with `N8N_ENCRYPTION_KEY`, so keep that key, from `.env`, alongside the dump. A dump without the key restores workflows, but none of their credentials.

### 8. Connections

- **No published port.** `compose.yaml` publishes no port for the `postgres` service. Only containers on the Compose network reach it, and the dumps above go through `docker compose exec`. The one documented exception is `testdb` (profile `test`), bound to `127.0.0.1:55432` and used only by `pnpm run test:db`; it never holds real data and is tmpfs-backed, so nothing survives a restart.
- **Where credentials live.** Only in `.env`, which git ignores, and in n8n's credential store, which `N8N_ENCRYPTION_KEY` encrypts.
- **Authentication by path.** n8n connects over the Compose network, where `pg_hba.conf` requires `scram-sha-256`. Inside the `postgres` container, the local socket and loopback use the official image's `trust` default, which `db/init/`, `db-migrate`, and `check-db` rely on. Reaching that socket takes `docker exec`, and Docker access on the host is already root-equivalent.
- **No TLS on the network.** The credentials set `ssl: disable`, and the server runs with `ssl = off`. That's a limit of this local, single-host demo.
- **What production would need:**
  - TLS with a CA-signed server certificate, and the client verifying it (`sslmode=verify-full`);
  - Postgres on a private network or a managed service;
  - `pg_hba.conf` narrowed to n8n's own address;
  - no `trust` lines;
  - rotated passwords.

## Upgrading an existing local stack

These steps take a volume created before `db/migrations/` existed to the current state, without losing data. Never run `docker compose down -v`: the volume also holds n8n's own database, with its credentials and sign-ins.

1. **Pull the change.**
2. **Add the two new `.env` names.** `.env.example` shows them. Write the password straight into the file, so it never reaches the terminal:

   ```bash
   { echo; echo 'APP_RUNTIME_DB_USER=app_runtime'; printf 'APP_RUNTIME_DB_PASSWORD='; openssl rand -hex 32; echo; } >> .env
   ```

   The leading `echo` keeps a `.env` without a final newline from running its last line into the first new one.

   Don't regenerate `.env` with `node scripts/init-env.ts` on an existing volume. It would replace `N8N_ENCRYPTION_KEY` and every role password, which locks n8n out of its credentials and its own database. If you skip this step, `pnpm run db:migrate` stops before it touches anything and names the missing variables.
3. **Start the stack with `docker compose up -d --wait`.** This recreates `postgres` with the two new variables in its environment. `db-migrate` doesn't depend on that, since it forwards the current `.env` values itself, but the service definition changed.
4. **Run `pnpm run setup`.** It applies `001_runtime_role.sql`, `002_unfinished_index.sql`, and `003_drop_sequence_grant.sql`, sets `app_runtime`'s password, and re-imports the `App DB` credential so it connects as `app_runtime` instead of `app`. Then it publishes the workflows and restarts n8n.
5. **No credential refresh is needed.** `setup-credentials` re-imports every credential that isn't Google OAuth2 on every run — `App DB` isn't OAuth2, so it's rebuilt from `.env` automatically. Only the Gmail, Drive, and Sheets credentials are skipped when they already exist. After step 4, n8n's only session on `app` is `app_runtime`.
6. **Run `node scripts/check-db.ts`.** A second `pnpm run setup` prints `no pending migrations`.

This exact path was run once locally: a volume created from `origin/main` (before this change), `pnpm run setup` on it, then the steps above, then a second `pnpm run setup`, which printed `no pending migrations`.

## Proving it: `check-db`

`node scripts/check-db.ts` runs psql inside the `postgres` container, mostly as `app_runtime`, and prints `ok` or `FAIL` for each check. It exits 1 if any check fails. Each check has a unit-tested predicate in `tests/check-db.test.ts`.

| Check | Passes when |
|---|---|
| CREATE TABLE is denied | Postgres answers `permission denied for schema public` |
| DROP TABLE is denied, for each granted table | `must be owner of table …` |
| TRUNCATE is denied, for each granted table | `permission denied for table …` |
| connecting to the n8n database is denied | `permission denied for database "n8n"` |
| SET ROLE to the owner is denied | `permission denied to set role` |
| no role attribute, membership, column grant, or TEMP on app beyond the grant list | Checked as the superuser: `app_runtime` holds none of `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`; `pg_auth_members` lists it as a member of nothing; `has_any_column_privilege` finds no column privilege its table grants don't cover; and it has no `TEMP` on `app` |
| table and sequence privileges are exactly the grant list | `app_runtime`'s privileges on every table and sequence in `public` equal `RUNTIME_GRANTS`: none missing, none extra |
| every workflow Postgres statement runs (6, rolled back) | all six statements run as `app_runtime`, inside one transaction it rolls back — "Save invoice"'s real `invoice_id` is captured with psql's `\gset` and fed into the three statements that act on that row, since `processed_events.invoice_id` and the Drive-link update are both foreign keys into `invoices` |
| `schema_migrations` lists every file in `db/migrations` | every file is recorded |

- **What counts as a denial.** Only the expected one passes. A statement that succeeds fails the check, and so does psql failing for any other reason, such as a missing role or a stopped container.
- **Nothing persists.** Every statement that could change data runs inside `BEGIN … ROLLBACK`.
- **The statement check reads the workflows.** It runs each Postgres node's query straight from the workflow JSON. A unit test fails when a new Postgres node has no probe values in `PROBES`.
- **Two checks cover what `has_table_privilege` can't see.** The role-attribute check catches an attribute, a membership, or a column-level grant, since `has_table_privilege` only reports whole-table privileges. The `SET ROLE` denial catches a membership that would let the role act as the owner.

CI's `n8n` job runs `check-db` after `pnpm run setup` on a fresh volume. Then `check-dev-response.ts` drives `summary-preview` through n8n, which proves `app_runtime`'s grants hold for a real run (the generated `Render summary` Code node and the `Query summary` Postgres node both execute).

To prove the check can fail, grant a forbidden privilege by hand as the superuser, then run it. Each of these makes `check-db` exit 1 (run locally and confirmed):

- `ALTER ROLE app_runtime CREATEDB` fails "no role attribute, membership, column grant, or TEMP on app beyond the grant list" with `holds CREATEDB`. The table-privilege check misses it.
- `GRANT app TO app_runtime` fails "TRUNCATE … is denied" (now it succeeds instead, through the owner's privileges), "SET ROLE to the owner is denied", the role-attribute check (`is a member of app`, plus every column privilege `app` itself holds, which `app_runtime` now inherits), and the table-privilege check (every privilege `app` holds on every table, inherited the same way).
- `GRANT INSERT (filename) ON schema_migrations TO app_runtime` fails only the role-attribute check, with `has INSERT on columns of schema_migrations`. The table-privilege check misses it, since `has_table_privilege` only sees whole-table grants.
- `GRANT TRUNCATE ON invoices TO app_runtime` fails "TRUNCATE invoices is denied" (the statement now fails for a different reason — `invoice_items` still references it by foreign key — which still isn't the expected denial text, so the check still correctly reports `FAIL`) and the table-privilege check, with `extra invoices:TRUNCATE`.

Revoke each one afterward. `pnpm run db:migrate` also resets the role's attributes on its own.

### The log proof

Locally, after running `db-migrate` (which always runs `ALTER ROLE ... PASSWORD`) and deliberately running a failing password statement with the same `SET LOCAL log_min_error_statement = panic; SET LOCAL log_statement = 'none';` guard, `docker compose logs postgres` was searched for the literal text `PASSWORD '` and for a marker string planted inside the deliberately-failed statement: zero matches either way.
