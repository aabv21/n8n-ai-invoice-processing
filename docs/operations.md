# Operations

Procedures for running and changing the stack. [`AGENTS.md`](../AGENTS.md) lists the commands; this page holds the detail behind them.

## Changing a workflow

1. Design the nodes and expressions against n8n's own node reference and real-world examples, especially for a node you haven't configured by hand before.
2. Edit the JSON in `workflows/` (fixed IDs and credential IDs come from `scripts/manifest.ts`), then run `pnpm run build:workflows` to regenerate any Code node or generated text parameter it touches.
3. Validate the workflow JSON with an n8n-aware validation tool until it reports no errors. Ignore its "unknown typeVersion 2.8" on Postgres nodes: its node database stops at 2.7, and this repo needs 2.8 (see the rules in AGENTS.md).
4. Run `pnpm run setup` to import and publish it against the local n8n instance.
5. Run `pnpm run export` and commit that canonical output, not your hand-edited JSON: the two can differ in server-assigned detail, and the exported form is what runs.
6. Run `pnpm run setup` and `pnpm run export` again, then `git diff --exit-code workflows/`. A non-empty diff means a field leaks the instance's state into the committed JSON; extend `export-workflows.ts`'s volatile-fields list.
7. Run the gate in AGENTS.md's "Definition of done" before committing.

## Recovering stuck events

An event is stuck when its `processed_events.outcome` is still NULL after its run should have finished; the daily summary counts it as unfinished 30 minutes after it arrives, and lists the oldest 20 stuck events with their file name, Bogota arrival time, and event ID, so the summary email alone names each one to recover. List the stuck events in `psql` (`docker compose exec -T postgres sh -c "psql -U \"\$APP_DB_USER\" -d app"`, so the container expands `$APP_DB_USER` from its own environment, not the host's):

```sql
SELECT event_id, file_name, received_at FROM processed_events
WHERE outcome IS NULL ORDER BY received_at;
```

Then match each one to its cause:

- **A lost `Record event` response**: the event has no `invoices` row and no `process-invoice` execution. Delete its row, then forward the source email to the inbox again, so Gmail delivers it as new mail: `DELETE FROM processed_events WHERE source = 'gmail' AND event_id = 'stuck_event_id_here' AND outcome IS NULL;`
- **An Information Extractor parse failure**: retrying alone repeats it. Correct `prompts/extract-invoice.md` or `schemas/invoice.schema.json`, run `pnpm run build:workflows` and `pnpm run setup`, then retry the parent's failed execution (`process-invoice`) from n8n's executions list. The retry resumes at the failed extraction call.
- **A wrong label ID**: the run saved the invoice, filed the PDF, and wrote the Sheets rows before the label call failed. A retry reuses the config its run started with, so it fails again. Fix `config/config.json` and add the label to the email by hand. Then read the saved row with `SELECT id, status FROM invoices WHERE source_event_id = 'stuck_event_id_here';` and record the outcome from it, using its `status` (`ok` or `review`) and `id`: `UPDATE processed_events SET outcome = 'ok', invoice_id = 1234567890123 WHERE source = 'gmail' AND event_id = 'stuck_event_id_here';`
- **A call right after a restart**: `/healthz` reports healthy before the publication reconciler syncs the published version, every 10 s by default (`N8N_WORKFLOW_PUBLICATION_RECONCILE_INTERVAL_SECONDS`), so an early call can run the previous version. `pnpm run setup` waits 15 s past `/healthz` after its own restart (see `import-workflows.ts`'s `NOTE:`), which outlasts the default but not a slower interval. After any other restart, such as `docker compose restart n8n` or a switch to queue mode, wait the same 15 s before calling a workflow.

## Running a sub-workflow through the dev harness

`node scripts/dev-call.ts <target> '<json>'` calls the dev-harness webhook (`POST {N8N_URL}/webhook/dev`) to run a sub-workflow without waiting on Gmail, for example `node scripts/dev-call.ts load-config '{}'`. [Dev harness API](architecture.md#dev-harness-api) lists every target, its input, its result, and what fails it. The `process-invoice` target checks the config it loads, as `intake-email` does, so a `REPLACE_ME` placeholder fails it before any AI call. A new sub-workflow adds its own target the same way.

## Setup, export and the n8n CLI

- n8n's `import:workflow`, `export:workflow`, `import:credentials`, `export:credentials`, and `publish:workflow` CLI commands need no owner account, `--userId`, or `--projectId` (checked against 2.45.7 on 2026-11-11). `publish:workflow` takes effect only after a restart, so `pnpm run setup` restarts n8n when it published something, waits for `/healthz` and 15 s more, then polls `dev-harness`'s webhook (the only one in the manifest) until it stops answering 404.
- `pnpm run setup`: runs `db:migrate`, imports credentials (`scripts/setup-credentials.ts`), then publishes workflows (`scripts/import-workflows.ts`). It skips a credential with blank `.env` values or an existing Google OAuth2 credential (see "Why the rules exist" below), skips a workflow not yet in `workflows/`, and holds back one whose trigger needs a missing credential.
- `pnpm run export`: writes n8n's canonical form of every known workflow back to `workflows/` and regenerates its Code nodes and generated text parameters; run it after editing a workflow in the n8n UI, and commit the result.
- `node scripts/init-env.ts`: writes `.env` from `.env.example`, filling only the local-stack and dev-harness secrets (`POSTGRES_PASSWORD`, `N8N_DB_PASSWORD`, `APP_DB_PASSWORD`, `APP_RUNTIME_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `DEV_HARNESS_TOKEN`) with random hex and leaving `N8N_API_KEY`, Anthropic, and Google blank. It refuses to run if `.env` exists; the quick start and CI both use it.
- `node scripts/check-dev-response.ts`: calls `summary-preview` with a fixed `run_at` and `dry_run: true`, and asserts the exact `{ subject, html }` an empty database renders, exiting 1 with the response printed on a mismatch. CI's `n8n` job uses it to prove n8n runs a generated Code node (`Render summary`) and a Postgres query (`Query summary`).
- `pnpm run build:workflows`: compiles each `src/nodes/*.ts` with esbuild into its Code node's `jsCode`, and copies every `TEXT_PARAMS` source (SQL, the prompt, the schema) verbatim into its node. `-- --check` exits 1 if the committed JSON is stale, without writing, as CI runs it; after an esbuild update, rebuild and commit the JSON.
- `pnpm run check`: hygiene checks on every file in `workflows/`: pinned data, a literal email, phone, long id, or secret, an unknown credential id, a hand-written or undocumented Code node or generated query, a missing required setting, an external-service node without retry on fail, and a Postgres query built from an expression instead of `$n` parameters.

## Scenario and cost reports

- `pnpm run scenarios -- --since <YYYY-MM-DDTHH:MM:SSZ>`: compares the six samples against `scripts/sql/scenario-report.sql`, run on stdin through `docker compose exec -T postgres psql -U <APP_DB_USER's value> -d app -At` (the value is passed as its own argument, never through a shell) with `since` bound by `\bind`. It rejects a malformed `--since` before building any psql input, prints `| file | result | details |`, exits 1 on any `FAIL`, and compares only a file's earliest row, reporting each extra row as its own `FAIL` (`<file>: N extra row`).
- `pnpm run cost -- --since <ISO>`: pages through `extract-invoice`'s executions from the n8n public API (`GET /api/v1/executions`, header `X-N8N-API-KEY`) back to `--since`, and prints a Markdown table of invoice counts, retries, and average tokens and cost per extraction path, priced from `scripts/lib/pricing.ts`. Without `N8N_API_KEY`, it exits 1 with `N8N_API_KEY is not set (Settings → n8n API)`.

## Database commands

- `docker compose up -d --wait testdb`: start the opt-in test database (profile `test`, tmpfs-backed, trust auth, `127.0.0.1:55432`) for `pnpm run test:db`. Naming it starts it without activating the profile; it never holds real data and leaves the main stack alone.
- `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres pnpm run test:db`: runs `tests/db/**` against `testdb`: it resets `schema public` from `db/schema.sql`, applies `db/migrations/` through `scripts/db-migrate.ts`, and runs every `db/queries/` file as `app_runtime`. It refuses any database not named `postgres`, isn't part of `pnpm test`, and runs in CI's `db` job; see `docs/database.md`'s "`pnpm run test:db` applies the same migrations, against `testdb`".
- `pnpm run db:migrate`: applies every pending `db/migrations/` file to the real stack as the Postgres superuser, then sets `app_runtime`'s password from `APP_RUNTIME_DB_PASSWORD` and re-asserts its attributes. A second run prints `no pending migrations`, and `pnpm run setup` runs it first; see `docs/database.md`.
- `node scripts/check-db.ts`: proves the runtime role's denials, its exact grants, every workflow Postgres statement, and the migration ledger, printing `ok` or `FAIL` per check and exiting 1 on any failure. `docs/database.md`'s "Proving it: `check-db`" lists each check, and `tests/check-db.test.ts` unit-tests each predicate.
- Schema changes go in a new idempotent `db/migrations/NNN_short_name.sql`, applied by `pnpm run db:migrate` (or `pnpm run setup`); editing `db/schema.sql` doesn't change a running database. Never hand-run DDL over `docker compose exec`, and never `docker compose down -v` to force a reload: that drops n8n's own data too.

## Queue mode

The commands to switch to queue mode and back are in the README's "When you'd need queue mode". It recreates `n8n`, so wait 15 s past `/healthz` before calling a workflow (see the failure table in [`architecture.md`](architecture.md#failure-modes-behavior-detection-and-recovery)); `docs/architecture.md`'s scaling section records the verified run.

## Why the rules exist

The short rules in [`AGENTS.md`](../AGENTS.md) have these reasons.

- No Code node is hand-written: each is a pure `export function run(input) { ... }` (no I/O, no clock) in `src/nodes/<name>.ts`, compiled by `pnpm run build:workflows`, and `pnpm run check` rejects any Code node missing from `scripts/manifest.ts`'s `CODE_NODES` or without a `Why Code:` note, which the build writes from the entry's `why`. Those sources and `src/lib/` use the ambient `DateTime` global (`src/globals.d.ts`), since the sandbox provides Luxon but no `require`; ESLint bans `node:*` imports, `luxon`, `process`, and `fetch` there.
- A Code node runs once for all items by default, and its generated wrapper passes `run()` the first item's `json`. A node that must touch each item's binary (`Mark as PDF`) sets `perItem: true` in its `CODE_NODES` entry and runs in mode `runOnceForEachItem`: its wrapper passes `run()` the whole item (`$input.item`, `json` and `binary`) and returns the item it builds. `pnpm run build:workflows` refuses a `perItem` entry whose node runs in any other mode.
- Generated text parameters (SQL queries in `db/queries/`, the extraction prompt, the invoice JSON Schema) are copied verbatim into workflow JSON by the same build, addressed by `scripts/manifest.ts`'s `TEXT_PARAMS`. Edit the source file, never the JSON; `pnpm run check` rejects a Postgres query that isn't in that table.
- SQL comments never contain `$n`: n8n replaces every `$` followed by a digit in a query's text on the client, comments included. `pnpm run check` rejects a query with one.
- `prompts/extract-invoice.md` contains no `{`, `}`, `@`, or run of 10 or more digits: the Information Extractor treats braces as its own template syntax, and `pnpm run check` scans the same text once it's generated into workflow JSON. `tests/lib/contract.test.ts` enforces this on every change to the prompt or the schema.
- Postgres nodes are typeVersion 2.8 or later wherever a Query Parameters expression can carry text (checked against 2.45.7's source on 2026-11-11): from 2.8, each `{{ }}` binds exactly one value, while 2.5–2.7 split a string on commas unless it parses as JSON, so a file name with a comma would become several values.
- Generated `jsCode` runs under the Code-node Task Runner's `Object.defineProperty = () => ({})`, which would drop every esbuild export. Keep `build-workflows.ts`'s `hardenAgainstFrozenDefineProperty` when touching the build; a test simulates that sandbox.
- `load-config` always outputs exactly `{ config }`: `Read config file` drops the caller's fields (checked against the compiled node source and four real executions). Call `Load config` on its own branch and merge `{ config }` back onto the caller's item, as `daily-summary`'s `Attach config to run` does.
- A workflow that loads config never names an error workflow of itself: n8n runs a sub-execution's error workflow too, and its only loop guard is a workflow naming itself. `error-handler` calls `load-config`, so naming the handler there would have the two retrigger each other for as long as the failure lasted. `pnpm run check` enforces this by the config loader's fixed id, not by name or file pattern.
- Secrets live only in `.env` (gitignored) and n8n credentials: never in code, workflow JSON, or committed config. No script prints credential data: `setup-credentials.ts` detects existing credentials from an encrypted CLI export, logs only a credential's name, never its `data`, and moves credentials over stdin and stdout through a temp file in the container's own `/tmp`, never the host filesystem or `.n8n-import/`.
- `pnpm run setup` skips re-importing a Google OAuth2 credential (Gmail, Drive, Sheets) that already exists in n8n, because `import:credentials` overwrites by id and would wipe out an interactive Google sign-in. Pass `--force` to overwrite one deliberately.
- `scripts/sql/scenario-report.sql` only ever runs as a `SELECT`; `check-scenarios.ts` never writes to the `app` database.
- Test data is invented: suppliers and NITs are fictional, email addresses are on `example.com`, and every printed NIT carries a check digit that deliberately fails the DIAN algorithm. There are no phone numbers and no real people.
- Database topology: role `$N8N_DB_USER` owns database `n8n`, role `$APP_DB_USER` owns database `app`, and neither can connect to the other's database (`REVOKE ALL ... FROM PUBLIC`). The Postgres superuser exists only to bootstrap those roles in `db/init/`; it is never configured in the n8n container.
- n8n is pinned to the `2.45` line, by digest: patch releases arrive through Dependabot once CI's `n8n` job passes on them, and `tests/runtime.test.ts` rejects any other line. Never move to an unstable `3.x` tag before one is stable. Dependabot's automated updates for `n8nio/n8n` exclude minor and major bumps, because beta and stable releases share plain semver tags.
- Point tooling only at this repo's local n8n instance (`http://localhost:5678`), never another instance.

### Toolchain and layout

- Node 24 LTS, ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `allowImportingTsExtensions`, with `noEmit`, so there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo is the generated `jsCode` inside workflow JSON.
- `.n8n-import/`: a scratch directory for the export tooling, created by `node scripts/init-env.ts`. It's a live bind mount, so never `rm -rf` it; no credential data crosses it (see `setup-credentials.ts`'s `IMPORT_SCRIPT` and `EXPORT_SCRIPT`), and on Linux it works only when the host uid matches n8n's container uid (1000).
