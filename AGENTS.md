# AGENTS.md

Guidance for anyone, human or AI, working in this repository.

## What this is

An AI invoice-processing pipeline for Magdaport S.A.S., a fictional wholesale distributor in Barranquilla, Colombia: n8n workflows backed by Postgres. It is a portfolio demo, so every file should read as production-quality, not a prototype.

## Documentation map

| Document | Covers |
|---|---|
| [`README.md`](README.md) | What it does, the quick start, configuration, the test and live-check tables, cost, design decisions, limitations. |
| [`docs/architecture.md`](docs/architecture.md) | Components, the invoice lifecycle, the data model, failure modes with recovery, scaling, security, the dev harness API, design decisions. |
| [`docs/operations.md`](docs/operations.md) | Changing a workflow, recovering stuck events, the dev harness, reports, database commands, queue mode, and the reasons behind the rules below. |
| [`docs/database.md`](docs/database.md) | Roles, every statement and its grant, migrations, backup and restore, upgrading a volume, what `check-db` proves. |
| [`docs/testing.md`](docs/testing.md) | Every test suite, what CI runs, and where the live checks live. |
| [`docs/red-team.md`](docs/red-team.md) | The AI attack surface, the adversarial fixtures, and the live procedure to run them. |
| [`docs/supply-chain.md`](docs/supply-chain.md) | pnpm settings, pinned images and CI tools, Dependabot, landing a fresh security fix. |
| [`docs/diagrams/README.md`](docs/diagrams/README.md) | Every diagram (source, page, image) and how to regenerate one. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md) | Branches and pull requests; reporting a vulnerability. |

## Repo map

- `compose.yaml`, `compose.queue.yaml`, `.env.example`: Postgres and n8n in Compose, the opt-in `testdb` (profile `test`), and the queue-mode override.
- `db/schema.sql`, `db/init/`, `db/migrations/`: baseline schema, role bootstrap, and idempotent `NNN_short_name.sql` changes applied once by `pnpm run db:migrate`.
- `db/queries/*.sql`: the parameterized queries the Postgres nodes run verbatim, tested by `tests/db/queries.test.ts`.
- `config/config.example.json`: the config template; `config/config.json` is gitignored. `team_locale` sets the team emails' language.
- `scripts/manifest.ts`: the single source of truth for workflow and credential IDs and the `CODE_NODES` and `TEXT_PARAMS` tables. `scripts/lib/` holds shared helpers, `scripts/*.ts` the CLIs, `scripts/sql/scenario-report.sql` the read-only scenario report.
- `samples/`: the six generated sample PDFs and `expected.json`; `samples/adversarial/` holds the red-team fixtures.
- `schemas/invoice.schema.json`, `prompts/extract-invoice.md`: the extraction contract, copied into workflow JSON by the build.
- `src/nodes/`: one `run()` per Code node; `src/lib/` holds the pure logic and the `{ en, es }` message tables; `src/globals.d.ts` declares `DateTime`.
- `tests/`: the Vitest suites (`tests/helpers/` runs generated Code nodes like n8n's sandbox; `tests/db/` runs apart from `pnpm test`).
- `workflows/`: the eleven n8n workflow JSON files, imported by `pnpm run setup`; `approve-invoices` polls the `Invoices` tab and calls `approve-invoice` per approved row.
- `docs/`: the documents above. Update `architecture.md` when a change alters a component, the lifecycle, the data model, a failure mode, scaling, security, a platform behavior, or a design decision; `database.md` for a new query, table, grant, or migration; `red-team.md` for a new deterministic guard or attack surface; and `testing.md` when a suite is added, renamed, or changes what it covers.
- `.n8n-import/`: a scratch bind mount for the export tooling. Never `rm -rf` it.

## Commands

- `pnpm install --frozen-lockfile`: install from the lockfile.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`: `tsc --noEmit`, `eslint .`, `vitest run`.
- `pnpm run build:workflows`: compile `src/nodes/*.ts` and copy the `TEXT_PARAMS` sources into workflow JSON. `-- --check` fails on a stale build.
- `pnpm run check`: hygiene checks on every file in `workflows/`.
- `pnpm run setup`: migrate, import credentials, publish workflows. `pnpm run export` writes n8n's canonical form back to `workflows/`.
- `node scripts/init-env.ts`: write `.env` with random local secrets.
- `docker compose up -d --wait`: start Postgres and n8n. `docker compose down` stops them; `-v` wipes the volumes.
- `docker compose up -d --wait testdb`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres pnpm run test:db`: the database tests.
- `pnpm run db:migrate`: apply pending migrations. `node scripts/check-db.ts`: prove the runtime role's grants. See [`docs/operations.md`](docs/operations.md#database-commands).
- `pnpm run samples`, `pnpm run adversarial`: regenerate the sample and red-team PDFs (`-- --base-date YYYY-MM-DD` pins the date; the default is today in `America/Bogota`). Run `samples` with today's date before a demo so the summary's "due in the next 7 days" section has entries, and commit the regenerated files whenever the sample data or PDF layout changes.
- `node scripts/dev-call.ts <target> '<json>'`: run a sub-workflow through the dev harness; the targets are in [Dev harness API](docs/architecture.md#dev-harness-api).
- `node scripts/check-dev-response.ts`: assert the harness's empty-database summary; CI's `n8n` job runs it.
- `pnpm run scenarios -- --since <ISO>`, `pnpm run cost -- --since <ISO>`: grade the samples and price the extractions; see [`docs/operations.md`](docs/operations.md#scenario-and-cost-reports).
- Queue mode: the commands are in the README's "When you'd need queue mode".

## Definition of done

- `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build:workflows -- --check && pnpm run check` all pass locally. Run this full gate before every commit that touches TypeScript. Also run `pnpm run test:db` (with `testdb` up and `TEST_DATABASE_URL` set) whenever the change touches `db/schema.sql`, `db/queries/`, or `tests/db/`.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (the Status line, the "Verified offline" and "Live checks" lists, and the quick start if commands changed) and this file match what the change adds; `tests/readme.test.ts` keeps the README's shape.
- Commits follow Conventional Commits, on a descriptively named branch.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and NITs with a failing check digit; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches what the change set out to do: nothing extra, nothing missing.

## Rules an agent must not break

The reasons are in [`docs/operations.md`](docs/operations.md#why-the-rules-exist); the procedure for a workflow edit is [Changing a workflow](docs/operations.md#changing-a-workflow).

- No hand-written Code node: edit `src/nodes/<name>.ts`, never a `jsCode`. Each is a pure `run()` with no I/O and no clock, registered in `scripts/manifest.ts`'s `CODE_NODES` with a `why` that becomes its `Why Code:` note.
- Edit `db/queries/`, the prompt, and the schema, never the generated copies in workflow JSON.
- No `$` followed by a digit in a SQL comment.
- No `{`, `}`, `@`, or run of 10 digits in `prompts/extract-invoice.md`.
- Schema changes go in a new `db/migrations/NNN_short_name.sql`, never hand-run DDL.
- Never `docker compose down -v` on a real stack, and never `rm -rf .n8n-import/`.
- Postgres nodes are typeVersion 2.8 or later.
- `load-config` outputs exactly `{ config }`; a workflow that loads config names no error workflow of itself.
- Every external-service node retries 3 times at 1000 ms; Execute Workflow nodes never retry.
- Keep `build-workflows.ts`'s `hardenAgainstFrozenDefineProperty`.
- Secrets live only in `.env` and n8n credentials, never in code, workflow JSON, or committed config.
- Point tooling only at `http://localhost:5678`, never another instance.
- The dev harness needs `X-Dev-Token` and is localhost only; unpublish it before production use.
- Test data is invented: `example.com` emails, NITs whose check digit fails, no phone numbers, no real people.
- Everything in the repo is in English, except the `es` tables in `src/lib/strings.ts`.
- Node 24 LTS, ESM, strict TypeScript, no `.js` or `.mjs` source; scripts run as `node scripts/<name>.ts`. CLIs use `execFile` or `spawn` with an argument array, and guard their entry point with `process.argv[1] === fileURLToPath(import.meta.url)`.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path. A deliberate lint or ShellCheck exception gets a one-line disable comment naming the reason.
- Node names are actions (`Save invoice`) and sticky notes label each section.
- pnpm is pinned to an exact `11.x`; leave no `minimumReleaseAgeExclude` entry behind, and keep images pinned by digest. See [`docs/supply-chain.md`](docs/supply-chain.md).
- n8n stays on the `2.45` line, by digest; never move to a `3.x` tag before one is stable.

## Branches and pull requests

- `main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green, and repository rulesets block direct pushes, force pushes, and deletion.
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit. Dependabot opens its pull requests against `develop`.
- A release is a pull request from `develop`, or from a `release/*` branch when `main` has diverged, into `main` titled `release: vX.Y.Z` (a summary may follow), merged with a merge commit. `.github/workflows/release.yml` then tags the merge commit `vX.Y.Z` and publishes a GitHub release with generated notes; a `release:` title without a version makes neither. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full flow.
