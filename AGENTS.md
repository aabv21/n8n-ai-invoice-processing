# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

This repo builds an AI invoice-processing pipeline for Magdaport S.A.S., a fictional wholesale distributor in Barranquilla, Colombia, as an n8n workflow backed by Postgres. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Repo map

- `compose.yaml`, `.env.example` — the local runtime: Postgres and n8n in Docker Compose.
- `db/schema.sql`, `db/init/` — the application database schema and the one-time role/database bootstrap script.
- `config/config.example.json` — the config template; a developer's own `config/config.json` is gitignored.
- `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `package.json` — the TypeScript toolchain.
- `tests/` — Vitest tests.
- `.n8n-import/` — created locally by the quick start; a scratch directory n8n's CLI reads credentials and workflows from. It's a live bind mount: never `rm -rf` it.

## Commands

- `npm ci` — install dependencies from the lockfile.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — `eslint .`.
- `npm test` — `vitest run`.
- `docker compose up -d --wait` — start Postgres and n8n, and wait for both to report healthy.
- `docker compose down` — stop the stack. Add `-v` to also drop the named volumes (destructive: wipes the database and n8n's data).

## Conventions

- Node 24 LTS, ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `allowImportingTsExtensions`, with `noEmit` — there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo will be the generated `jsCode` inside workflow JSON.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point with `if (process.argv[1] === fileURLToPath(import.meta.url))` so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path. A deliberate lint or ShellCheck exception gets a one-line disable comment naming the reason.
- n8n workflow node names are actions (e.g. "Save invoice"), and sticky notes label each section.
- Every node that calls an external service (Gmail, Google Drive, Google Sheets, HTTP Request, Postgres, Information Extractor) sets Retry On Fail with 3 tries and a 1000 ms wait. Execute Workflow nodes never retry, since a retry would repeat a sub-workflow's side effects.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config.
- Test data is invented: suppliers and NITs are fictional, email addresses are on `example.com`, and every printed NIT carries a check digit that deliberately fails the DIAN algorithm. There are no phone numbers and no real people.
- Everything in the repo is in English.
- Database topology: role `$N8N_DB_USER` owns database `n8n`, role `$APP_DB_USER` owns database `app`, and neither can connect to the other's database (`REVOKE ALL ... FROM PUBLIC`). The Postgres superuser exists only to bootstrap those roles in `db/init/`; it is never configured in the n8n container.
- n8n is pinned to `2.45.6`; never move to an unstable `3.x` tag before one is stable. Dependabot's automated updates for `n8nio/n8n` exclude minor and major bumps, because beta and stable releases share plain semver tags.
- Point tooling only at this repo's local n8n instance (`http://localhost:5678`), never another instance.

## Definition of done

- `npm run typecheck && npm run lint && npm test` all pass locally — run this full gate before every commit that touches TypeScript.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits, on a branch named `task-NN-<slug>`.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and NITs with a failing check digit; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches its task's brief — nothing extra, nothing missing.
