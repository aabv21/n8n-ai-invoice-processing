# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

This repo builds an AI invoice-processing pipeline for Magdaport S.A.S., a fictional wholesale distributor in Barranquilla, Colombia, as an n8n workflow backed by Postgres. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Repo map

- `compose.yaml`, `.env.example` — the local runtime: Postgres and n8n in Docker Compose, plus the opt-in `testdb` service (profile `test`) used only by `pnpm run test:db`.
- `compose.queue.yaml` — an optional override that adds Redis and `n8n-worker` containers for queue mode; see Commands.
- `db/schema.sql`, `db/init/` — the baseline schema and the one-time role and database bootstrap. `db/migrations/` holds every later change as an idempotent `NNN_short_name.sql` that `pnpm run db:migrate` applies once and records in `schema_migrations`; `docs/database.md` describes each one.
- `db/queries/*.sql` — the parameterized queries the Postgres nodes run verbatim (`$1`, `$2`, ... placeholders only, never string-built SQL), tested by `tests/db/queries.test.ts` against `testdb`.
- `config/config.example.json` — the config template; a developer's own `config/config.json` is gitignored. `team_locale` (`en`, the default, or `es`) sets the language of the team's emails; see the README's "Team email language".
- `scripts/manifest.ts` — the single source of truth for fixed workflow and credential IDs and the `CODE_NODES` and `TEXT_PARAMS` tables. `scripts/lib/` holds the shared helpers: workflow and runtime (Docker, `.env`) access, the dev-harness client, `pricing.ts` (the per-model USD rates `measure-cost.ts` uses), and the sample invoices (`sample-invoices.ts` for data and expected results, `invoice-pdf.ts` for rendering).
- `scripts/*.ts` — the workflow tooling, sample-data, reporting, and database CLIs; see Commands.
- `scripts/sql/scenario-report.sql` — one row per Gmail event from `processed_events`, `invoices`, and `invoice_items`, for `check-scenarios.ts` to compare against `samples/expected.json`. It runs through `psql` directly, not a Postgres node, so `TEXT_PARAMS` doesn't list it.
- `samples/` — the six generated sample invoice PDFs and `expected.json`, the extraction result each should produce (`pnpm run samples`). `samples/adversarial/` holds the AI red team's live fixtures; see `docs/red-team.md`.
- `schemas/invoice.schema.json`, `prompts/extract-invoice.md` — the extraction contract (the structured-output JSON Schema and the system prompt), copied verbatim into workflow JSON by `pnpm run build:workflows` through `TEXT_PARAMS`.
- `src/nodes/` — one `run()` per Code node, compiled into workflow JSON by `pnpm run build:workflows`: `check-config.ts`, `check-invoice.ts`, `build-pdf-request.ts`, `prepare-record.ts`, `render-summary.ts`, and `error-alert.ts`, each described in its header comment. `src/lib/` holds the pure logic behind them, including the `{ en, es }` message tables (`strings.ts`), and `src/globals.d.ts` declares the ambient `DateTime`.
- `tests/` — the Vitest suites, each described in `docs/testing.md`. `tests/helpers/` runs a generated Code node the way n8n's sandbox does and reads real workflows; `tests/db/` runs separately from `pnpm test` (see Commands).
- `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `vitest.db.config.ts`, `package.json` — the TypeScript toolchain.
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n and imported by `pnpm run setup`. `docs/architecture.md` describes each of the nine workflows, their sticky notes label each section, and `scripts/manifest.ts` fixes their IDs and file names.
- `docs/` — the documents in the Documentation map below. Update `architecture.md` when a change alters a component, the lifecycle, the data model, a failure mode, scaling, security, a platform behavior, or a design decision; `database.md` for a new query, table, grant, or migration; `red-team.md` for a new deterministic guard or attack surface; and `testing.md` when a suite is added, renamed, or changes what it covers.
- `docs/diagrams/` — the architecture and invoice-sequence diagrams. Edit only each `*.json` source, then regenerate its `*.html` page and `*.svg` export (see Commands).
- `.n8n-import/` — a scratch directory for the export tooling, created by `node scripts/init-env.ts`. It's a live bind mount, so never `rm -rf` it; no credential data crosses it (see `setup-credentials.ts`'s `IMPORT_SCRIPT` and `EXPORT_SCRIPT`), and on Linux it works only when the host uid matches n8n's container uid (1000).

## Documentation map

| Document | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Components, the invoice lifecycle, the data model, failure modes (with detection and recovery), scaling limits, security notes, platform behaviors, and the design decisions behind each part. |
| [`docs/database.md`](docs/database.md) | The roles (`postgres`, `n8n`, `app`, `app_runtime`), every statement the workflows issue and the grant behind it, migrations (`db/migrations/`, applied by `pnpm run db:migrate`), backup and restore, connections, the upgrade path for an existing local volume, and what `node scripts/check-db.ts` proves. |
| [`docs/red-team.md`](docs/red-team.md) | The AI attack surface map (invoice PDF and extracted text as untrusted input), the adversarial inputs → expected behavior → guard table, the live fixtures in `samples/adversarial/`, and the procedure for running them against the real models once the Anthropic and Google accounts are connected, the pdf.js CVE-2024-4367 check against the pinned n8n image, and the live checks and owner decisions this repo can't settle offline. |
| [`docs/testing.md`](docs/testing.md) | Every test suite: its command, what it covers, and how it stays deterministic and clean, plus what CI actually runs and the deferred live checks. |
| [`docs/diagrams/architecture.json`](docs/diagrams/architecture.json) | The system diagram's archify typed source (type `architecture`): Gmail → `gmail-entry` → `intake-email` → `process-invoice` → `extract-invoice` → Anthropic, with Drive, Sheets, Postgres, `daily-summary`, `error-handler`, and `dev-harness`. |
| [`docs/diagrams/architecture.html`](docs/diagrams/architecture.html) | The system diagram's interactive page, rendered by archify. Open it directly to read the diagram full-size, pan, and inspect each node. |
| [`docs/diagrams/architecture.svg`](docs/diagrams/architecture.svg) | The system diagram's exported image, embedded in `docs/architecture.md` and the README. |
| [`docs/diagrams/invoice-sequence.json`](docs/diagrams/invoice-sequence.json) | The invoice-lifecycle sequence diagram's archify typed source (type `sequence`): poll → idempotency gate → screens, extraction, and check → Sonnet retry → save → duplicate branch → Drive, Sheets, label, and outcome. |
| [`docs/diagrams/invoice-sequence.html`](docs/diagrams/invoice-sequence.html) | The sequence diagram's interactive page. |
| [`docs/diagrams/invoice-sequence.svg`](docs/diagrams/invoice-sequence.svg) | The sequence diagram's exported image, embedded in `docs/architecture.md`. |

`docs/diagrams/*.delivery.json` receipts (one per diagram, written by `archify deliver`) hold local absolute paths and are gitignored; never force-add one.

## Commands

- `pnpm install --frozen-lockfile` — install dependencies from the lockfile.
- `pnpm run typecheck` — `tsc --noEmit`.
- `pnpm run lint` — `eslint .`.
- `pnpm test` — `vitest run`.
- `pnpm run samples` — regenerates `samples/` and `samples/expected.json` from `scripts/lib/sample-invoices.ts`. `-- --base-date YYYY-MM-DD` pins the base date (default: today in `America/Bogota`); run it with today's date before a demo so the summary's "due in the next 7 days" section has entries, and commit the files whenever the sample data or PDF layout changes.
- `pnpm run adversarial` — regenerates `samples/adversarial/` and its `expected.json` (each fixture's attack, safe outcomes, and guard) from `scripts/generate-adversarial-samples.ts`, with the same `--base-date` flag; see `docs/red-team.md`.
- `docker compose up -d --wait` — start Postgres and n8n, and wait for both to report healthy.
- `docker compose down` — stop the stack. `-v` also drops the named volumes (destructive: wipes the database and n8n's data).
- `docker compose up -d --wait testdb` — start the opt-in test database (profile `test`, tmpfs-backed, trust auth, `127.0.0.1:55432`) for `pnpm run test:db`. Naming it starts it without activating the profile; it never holds real data and leaves the main stack alone.
- `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` — switch to queue mode: Redis plus that many `n8n-worker` containers, which extend `compose.yaml`'s `n8n` service and run the executions. It recreates `n8n`, so wait 15 s past `/healthz` before calling a workflow; `docs/architecture.md`'s scaling section records the verified run.
- `docker compose -f compose.yaml -f compose.queue.yaml down && docker compose up -d --wait` — return to the single-process stack. Plain `down`, with no `-v`, keeps the named volumes.
- `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres pnpm run test:db` — runs `tests/db/**` against `testdb`: it resets `schema public` from `db/schema.sql`, applies `db/migrations/` through `scripts/db-migrate.ts`, and runs every `db/queries/` file as `app_runtime`. It refuses any database not named `postgres`, isn't part of `pnpm test`, and runs in CI's `db` job; see `docs/database.md`'s "`pnpm run test:db` applies the same migrations, against `testdb`".
- `pnpm run db:migrate` — applies every pending `db/migrations/` file to the real stack as the Postgres superuser, then sets `app_runtime`'s password from `APP_RUNTIME_DB_PASSWORD` and re-asserts its attributes. A second run prints `no pending migrations`, and `pnpm run setup` runs it first; see `docs/database.md`.
- `node scripts/check-db.ts` — proves the runtime role's denials, its exact grants, every workflow Postgres statement, and the migration ledger, printing `ok` or `FAIL` per check and exiting 1 on any failure. `docs/database.md`'s "Proving it: `check-db`" lists each check, and `tests/check-db.test.ts` unit-tests each predicate.
- Schema changes go in a new idempotent `db/migrations/NNN_short_name.sql`, applied by `pnpm run db:migrate` (or `pnpm run setup`); editing `db/schema.sql` doesn't change a running database. Never hand-run DDL over `docker compose exec`, and never `docker compose down -v` to force a reload: that drops n8n's own data too.
- `pnpm run build:workflows` — compiles each `src/nodes/*.ts` with esbuild into its Code node's `jsCode`, and copies every `TEXT_PARAMS` source (SQL, the prompt, the schema) verbatim into its node. `-- --check` exits 1 if the committed JSON is stale, without writing, as CI runs it; after an esbuild update, rebuild and commit the JSON.
- `pnpm run check` — hygiene checks on every file in `workflows/`: pinned data, a literal email, phone, long id, or secret, an unknown credential id, a hand-written or undocumented Code node or generated query, a missing required setting, an external-service node without retry on fail, and a Postgres query built from an expression instead of `$n` parameters.
- `pnpm run setup` — runs `db:migrate`, imports credentials (`scripts/setup-credentials.ts`), then publishes workflows (`scripts/import-workflows.ts`). It skips a credential with blank `.env` values or an existing Google OAuth2 credential (see Guardrails), skips a workflow not yet in `workflows/`, and holds back one whose trigger needs a missing credential.
- `pnpm run export` — writes n8n's canonical form of every known workflow back to `workflows/` and regenerates its Code nodes and generated text parameters; run it after editing a workflow in the n8n UI, and commit the result.
- `node scripts/dev-call.ts <target> '<json>'` — calls the dev-harness webhook (`POST {N8N_URL}/webhook/dev`) to run a sub-workflow without waiting on Gmail, e.g. `node scripts/dev-call.ts load-config '{}'`. Targets: `load-config`, `extract-invoice`, `process-invoice`, `intake-email` (`{ message_id, file_name, mime_type, pdf_base64 }`, shaped like a Gmail poll item but with no real email to label), and `summary-preview` (`{ run_at, dry_run }`; `dry_run: true` returns the rendered `{ subject, html }` without sending); an unknown target answers `404 {"error":"unknown_target"}`, and a new sub-workflow adds its own target the same way.
- n8n's `import:workflow`, `export:workflow`, `import:credentials`, `export:credentials`, and `publish:workflow` CLI commands need no owner account, `--userId`, or `--projectId` (checked against `2.45.6`). `publish:workflow` takes effect only after a restart, so `pnpm run setup` restarts n8n when it published something, waits for `/healthz` and 15 s more, then polls `dev-harness`'s webhook (the only one in the manifest) until it stops answering 404.
- `node scripts/init-env.ts` — writes `.env` from `.env.example`, filling only the local-stack and dev-harness secrets (`POSTGRES_PASSWORD`, `N8N_DB_PASSWORD`, `APP_DB_PASSWORD`, `APP_RUNTIME_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `DEV_HARNESS_TOKEN`) with random hex and leaving `N8N_API_KEY`, Anthropic, and Google blank. It refuses to run if `.env` exists; the quick start and CI both use it.
- `node scripts/check-dev-response.ts` — calls `summary-preview` with a fixed `run_at` and `dry_run: true`, and asserts the exact `{ subject, html }` an empty database renders, exiting 1 with the response printed on a mismatch. CI's `n8n` job uses it to prove n8n runs a generated Code node (`Render summary`) and a Postgres query (`Query summary`).
- `pnpm run scenarios -- --since <YYYY-MM-DDTHH:MM:SSZ>` — compares the six samples against `scripts/sql/scenario-report.sql`, run on stdin through `docker compose exec -T postgres psql -U <APP_DB_USER's value> -d app -At` (the value is passed as its own argument, never through a shell) with `since` bound by `\bind`. It rejects a malformed `--since` before building any psql input, prints `| file | result | details |`, exits 1 on any `FAIL`, and compares only a file's earliest row, reporting each extra row as its own `FAIL` (`<file>: N extra row`).
- `pnpm run cost -- --since <ISO>` — pages through `extract-invoice`'s executions from the n8n public API (`GET /api/v1/executions`, header `X-N8N-API-KEY`) back to `--since`, and prints a Markdown table of invoice counts, retries, and average tokens and cost per extraction path, priced from `scripts/lib/pricing.ts`. Without `N8N_API_KEY`, it exits 1 with `N8N_API_KEY is not set (Settings → n8n API)`.
- Regenerate a diagram after editing its source in `docs/diagrams/`, with [archify](https://github.com/tt-a1i/archify) v3.0.0 or later (Node.js, no install step; these sources were last checked against v3.2.0). Clone it outside this repo, so `pnpm run lint` never scans it: `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify ../archify`. Run from the repo root, since each source's `meta.output` path is relative to it. For the architecture diagram (type `architecture`):
  1. `node ../archify/archify/bin/archify.mjs validate architecture docs/diagrams/architecture.json --quality showcase --json` after every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
  2. `node ../archify/archify/bin/archify.mjs deliver architecture docs/diagrams/architecture.json docs/diagrams/architecture.html --quality showcase --json` writes the page, plus the gitignored `docs/diagrams/architecture.delivery.json` receipt.
  3. Open the page in a browser, choose **Export**, then **SVG**, and save over `docs/diagrams/architecture.svg`, which `README.md` and `docs/architecture.md` embed.
  4. Optionally, `node ../archify/archify/bin/archify.mjs visual-check docs/diagrams/architecture.html --json --out-dir ../archify-evidence` checks the page in a real browser at four desktop sizes, with screenshots outside the repo.

  For the sequence diagram, run the same steps with type `sequence` and the `invoice-sequence` files.

## Changing a workflow

1. Design the nodes and expressions against n8n's own node reference and real-world examples, especially for a node you haven't configured by hand before.
2. Edit the JSON in `workflows/` (fixed IDs and credential IDs come from `scripts/manifest.ts`), then run `pnpm run build:workflows` to regenerate any Code node or generated text parameter it touches.
3. Validate the workflow JSON with an n8n-aware validation tool until it reports no errors. Ignore its "unknown typeVersion 2.8" on Postgres nodes: its node database stops at 2.7, and this repo needs 2.8 (see Conventions).
4. Run `pnpm run setup` to import and publish it against the local n8n instance.
5. Run `pnpm run export` and commit that canonical output, not your hand-edited JSON: the two can differ in server-assigned detail, and the exported form is what runs.
6. Run `pnpm run setup` and `pnpm run export` again, then `git diff --exit-code workflows/`. A non-empty diff means a field leaks the instance's state into the committed JSON; extend `export-workflows.ts`'s volatile-fields list.
7. Run the full gate below before committing.

## Recovering stuck events

An event is stuck when its `processed_events.outcome` is still NULL after its run should have finished; the daily summary counts it as unfinished 30 minutes after it arrives. List the stuck events in `psql` (`docker compose exec -T postgres sh -c "psql -U \"\$APP_DB_USER\" -d app"`, so the container expands `$APP_DB_USER` from its own environment, not the host's):

```sql
SELECT event_id, file_name, received_at FROM processed_events
WHERE outcome IS NULL ORDER BY received_at;
```

Then match each one to its cause:

- **A lost `Record event` response**: the event has no `invoices` row and no `process-invoice` execution. Delete its row, then forward the source email to the inbox again, so Gmail delivers it as new mail: `DELETE FROM processed_events WHERE source = 'gmail' AND event_id = 'stuck_event_id_here' AND outcome IS NULL;`
- **An Information Extractor parse failure**: retrying alone repeats it. Correct `prompts/extract-invoice.md` or `schemas/invoice.schema.json`, run `pnpm run build:workflows` and `pnpm run setup`, then retry the parent's failed execution (`process-invoice`) from n8n's executions list. The retry resumes at the failed extraction call.
- **A wrong label ID**: the run saved the invoice, filed the PDF, and wrote the Sheets rows before the label call failed. A retry reuses the config its run started with, so it fails again. Fix `config/config.json` and add the label to the email by hand. Then read the saved row with `SELECT id, status FROM invoices WHERE source_event_id = 'stuck_event_id_here';` and record the outcome from it, using its `status` (`ok` or `review`) and `id`: `UPDATE processed_events SET outcome = 'ok', invoice_id = 1234567890123 WHERE source = 'gmail' AND event_id = 'stuck_event_id_here';`
- **A call right after a restart**: `/healthz` reports healthy before the publication reconciler syncs the published version, every 10 s by default (`N8N_WORKFLOW_PUBLICATION_RECONCILE_INTERVAL_SECONDS`), so an early call can run the previous version. `pnpm run setup` waits 15 s past `/healthz` after its own restart (see `import-workflows.ts`'s `NOTE:`), which outlasts the default but not a slower interval. After any other restart, such as `docker compose restart n8n` or a switch to queue mode, wait the same 15 s before calling a workflow.

## Conventions

- Node 24 LTS, ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `allowImportingTsExtensions`, with `noEmit` — there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo is the generated `jsCode` inside workflow JSON.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point with `if (process.argv[1] === fileURLToPath(import.meta.url))` so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path. A deliberate lint or ShellCheck exception gets a one-line disable comment naming the reason.
- n8n workflow node names are actions (e.g. "Save invoice"), and sticky notes label each section.
- Every node that calls an external service (Gmail, Google Drive, Google Sheets, HTTP Request, Postgres, Information Extractor) sets Retry On Fail with 3 tries and a 1000 ms wait. Execute Workflow nodes never retry, since a retry would repeat a sub-workflow's side effects.
- No Code node is hand-written: each is a pure `export function run(input) { ... }` (no I/O, no clock) in `src/nodes/<name>.ts`, compiled by `pnpm run build:workflows`, and `pnpm run check` rejects any Code node missing from `scripts/manifest.ts`'s `CODE_NODES`. Those sources and `src/lib/` use the ambient `DateTime` global (`src/globals.d.ts`), since the sandbox provides Luxon but no `require`; ESLint bans `node:*` imports, `luxon`, `process`, and `fetch` there.
- Generated text parameters (SQL queries in `db/queries/`, the extraction prompt, the invoice JSON Schema) are copied verbatim into workflow JSON by the same build, addressed by `scripts/manifest.ts`'s `TEXT_PARAMS`. Edit the source file, never the JSON; `pnpm run check` rejects a Postgres query that isn't in that table.
- SQL comments never contain `$n`: n8n replaces every `$` followed by a digit in a query's text on the client, comments included. `pnpm run check` rejects a query with one.
- `prompts/extract-invoice.md` contains no `{`, `}`, `@`, or run of 10 or more digits: the Information Extractor treats braces as its own template syntax, and `pnpm run check` scans the same text once it's generated into workflow JSON. `tests/lib/contract.test.ts` enforces this on every change to the prompt or the schema.
- Postgres nodes are typeVersion 2.8 or later wherever a Query Parameters expression can carry text (checked against `2.45.6`'s source): from 2.8, each `{{ }}` binds exactly one value, while 2.5–2.7 split a string on commas unless it parses as JSON, so a file name with a comma would become several values.
- Generated `jsCode` runs under the Code-node Task Runner's `Object.defineProperty = () => ({})`, which would drop every esbuild export. Keep `build-workflows.ts`'s `hardenAgainstFrozenDefineProperty` when touching the build; a test simulates that sandbox.
- `load-config` always outputs exactly `{ config }`: `Read config file` drops the caller's fields (checked against the compiled node source and four real executions). Call `Load config` on its own branch and merge `{ config }` back onto the caller's item, as `daily-summary`'s `Attach config to run` does.
- A workflow that loads config never names an error workflow of itself: n8n runs a sub-execution's error workflow too, and its only loop guard is a workflow naming itself. `error-handler` calls `load-config`, so naming the handler there would have the two retrigger each other for as long as the failure lasted. `pnpm run check` enforces this by the config loader's fixed id, not by name or file pattern.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config. No script prints credential data: `setup-credentials.ts` detects existing credentials from an encrypted CLI export, logs only a credential's name, never its `data`, and moves credentials over stdin and stdout through a temp file in the container's own `/tmp`, never the host filesystem or `.n8n-import/`.
- `pnpm run setup` skips re-importing a Google OAuth2 credential (Gmail, Drive, Sheets) that already exists in n8n, because `import:credentials` overwrites by id and would wipe out an interactive Google sign-in. Pass `--force` to overwrite one deliberately.
- The dev harness (`node scripts/dev-call.ts`) requires an `X-Dev-Token` header and is localhost only — this demo has no tunnel. Unpublish its workflow before any production use.
- `scripts/sql/scenario-report.sql` only ever runs as a `SELECT`; `check-scenarios.ts` never writes to the `app` database.
- Test data is invented: suppliers and NITs are fictional, email addresses are on `example.com`, and every printed NIT carries a check digit that deliberately fails the DIAN algorithm. There are no phone numbers and no real people.
- Everything in the repo is in English.
- Database topology: role `$N8N_DB_USER` owns database `n8n`, role `$APP_DB_USER` owns database `app`, and neither can connect to the other's database (`REVOKE ALL ... FROM PUBLIC`). The Postgres superuser exists only to bootstrap those roles in `db/init/`; it is never configured in the n8n container.
- n8n is pinned to `2.45.6`; never move to an unstable `3.x` tag before one is stable. Dependabot's automated updates for `n8nio/n8n` exclude minor and major bumps, because beta and stable releases share plain semver tags.
- Point tooling only at this repo's local n8n instance (`http://localhost:5678`), never another instance.

## Supply-chain hardening

Package management is pnpm, pinned in `package.json`'s `packageManager` to an exact `11.x` version; never move to pnpm 12 (Dependabot's dependency-graph parser does not yet read its default two-document lockfile). `pnpm-workspace.yaml` holds the settings pnpm 11 no longer reads from `.npmrc`:

- `minimumReleaseAge: 4320` — refuses any package version (transitive included) published less than 3 days ago, so a newly compromised release can be caught and pulled first.
- `minimumReleaseAgeExclude: []` — overrides pnpm 11's default exclusion of `n8n`, `n8n-*`, and `@n8n/*`, so no package is exempt from the age gate.
- `trustPolicy: no-downgrade` — fails an install if a package's trust evidence (provenance or trusted publishing) regresses from an earlier release, or if the pinned pnpm itself would downgrade it.
- `blockExoticSubdeps: true` — only a direct dependency may resolve from a git or tarball URL.
- `strictDepBuilds: true` with `dangerouslyAllowAllBuilds: false` — a dependency's install or postinstall script fails the install unless `allowBuilds` approves it.
- `engineStrict: true` — a dependency whose `engines` range excludes this repo's Node fails the install instead of warning.
- `allowBuilds` lists only packages a real `pnpm install --frozen-lockfile` proved need their build script, each with a one-line reason. `esbuild: true` (its postinstall re-links the platform binary over the `bin/esbuild` shim) is the one entry; add another only after the same proof.

`tests/supply-chain.test.ts` reads these back through `pnpm config list --json`, pnpm's effective config, so a misspelled or ignored key fails. It also asserts `packageManager`'s exact-pnpm-11 shape, that `package-lock.json` doesn't exist, that no tracked file teaches an `npm` command, that every Compose `image:` line carries a `@sha256:` digest, and, through the merged Compose config (`docker compose … config --format json`), that every long-running service (`n8n`, `postgres`, `testdb`, and in queue mode `redis` and `n8n-worker`) runs with `no-new-privileges`, with `n8n` and `n8n-worker` also dropping every Linux capability.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`) to update `pnpm-lock.yaml`, run the gate below, and commit both files together. If `minimumReleaseAge` refuses a version published too recently, wait it out or pin an older compatible version; don't work around it.

**Landing a security fix younger than the 3-day gate:**
1. Add a temporary `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml` for that one `name@version` (e.g. `"esbuild@0.28.3"`; the bare name would exempt every future version too), with a `#` comment naming the advisory ID and today's date.
2. Run `pnpm install` and merge as usual.
3. Remove the entry once that version is older than 3 days.

`tests/supply-chain.test.ts` asserts the exclusion list is empty, so it stays red for that PR on purpose, as the reminder for step 3; don't weaken the assertion. If that would make CI unmergeable, wait out the 3-day gate instead.

**Images** (`compose.yaml`, `compose.queue.yaml`) are pinned `name:tag@sha256:<digest>`, the multi-arch index digest from `docker buildx imagetools inspect name:tag`, so the same reference resolves on arm64 (local) and amd64 (CI). Dependabot keeps an existing digest current but won't add one, so a tag bump needs the digest re-resolved the same way and the tag reviewed by hand.

**CI** installs with `pnpm/setup` (pinned by commit SHA), then `actions/setup-node` with `cache: pnpm`, then `pnpm install --frozen-lockfile`, then `pnpm audit --audit-level=high`.

**Bumping pinned CI tools and zizmor by hand.** The `docker run` images in `.github/workflows/ci.yml` (`koalaman/shellcheck`, `zricethezav/gitleaks`, `rhysd/actionlint`) are pinned by multi-arch digest the same way, and `tests/supply-chain.test.ts` checks every `docker run` image across `.github/workflows/*.yml`. zizmor installs with `pip install --require-hashes -r .github/zizmor-requirements.txt`. To bump it, change the version there, then replace every `--hash=sha256:...` line with each wheel's hash, from PyPI's JSON API (`https://pypi.org/pypi/zizmor/<version>/json`, `urls[].digests.sha256`) or from `pip download zizmor==<version> --no-deps -d <dir>` and `pip hash` on each downloaded wheel. zizmor has no runtime dependencies, so that one requirement is all there is.

**The `n8n` job** (`.github/workflows/ci.yml`) is the one job that boots the real stack and proves a workflow executes, through the app Postgres path and a generated Code node; `docs/testing.md`'s "What CI runs" lists its steps and what CI leaves out. It generates `.env` with `node scripts/init-env.ts`, since CI has no repo secrets, and needs no permissions step for `.n8n-import/`, since no credential data crosses it. Its `docker compose down -v` teardown is safe because CI's volumes are disposable.

**Dependabot** (`.github/dependabot.yml`) adds a cooldown to every ecosystem on top of GitHub's own default: `npm` (which also covers the pnpm lockfile) waits 14 days for a major and 7 for a minor or patch, and `github-actions` and `docker-compose` a flat `default-days: 7`, since neither has a universal semver convention. Every version PR is therefore past pnpm's 3-day `minimumReleaseAge` gate. Security updates skip the cooldown.

## Branches and pull requests

- `main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green, and repository rulesets block direct pushes, force pushes, and deletion.
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit.
- A release is a pull request from `develop` into `main`, merged with a merge commit, then tagged `vX.Y.Z` with a GitHub release.
- Dependabot opens its pull requests against `develop`.

## Definition of done

- `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build:workflows -- --check && pnpm run check` all pass locally — run this full gate before every commit that touches TypeScript. Also run `pnpm run test:db` (with `testdb` up and `TEST_DATABASE_URL` set, see Commands) whenever the change touches `db/schema.sql`, `db/queries/`, or `tests/db/`.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits, on a descriptively named branch.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and NITs with a failing check digit; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches what the change set out to do — nothing extra, nothing missing.
