# Magdaport AI Invoice Processing

**Demo**

An n8n workflow that reads supplier invoices from Gmail, extracts them with Claude, files each PDF in Google Drive, lists it in Google Sheets, and flags doubtful ones for review.

## Status

In progress: local runtime, toolchain, and workflow tooling. No workflow is built yet.

### What works now

- A strict TypeScript toolchain: `typecheck`, `lint`, and `test` scripts.
- The local runtime: Postgres and n8n in Docker Compose, with separate, least-privilege database roles for n8n and the application, and the app database's time zone set to `America/Bogota`.
- The application schema (`db/schema.sql`): `invoices`, `invoice_items`, and `processed_events`.
- A config template (`config/config.example.json`) for the values the workflows will read at runtime.
- Workflow tooling: `npm run build:workflows` compiles Code-node sources and writes generated text parameters (SQL queries, prompts, schemas) into workflow JSON; `npm run check` runs hygiene checks (no pinned data, no literal secrets or ids, every external call retries, every generated value really is generated); `npm run setup` and `npm run export` import, publish, and export workflows and credentials against the local n8n instance. All verified against the tooling's own fixtures; no real workflow exists yet to run them on.
- Credential setup skips a Google OAuth2 credential (Gmail, Drive, Sheets) that already exists, so a re-run can't silently wipe out an interactive Google sign-in.
- A localhost-only dev harness CLI (`node scripts/dev-call.ts`) for calling a sub-workflow directly once one exists; unpublished and untested until Task 6 adds the harness workflow.
- CI: lint/typecheck/test/build/check and ShellCheck on one job, `npm audit` and gitleaks on another, actionlint and zizmor on a third; CodeQL (once the repo is public); Dependabot for npm, GitHub Actions, and Docker Compose images.

## Quick start

```bash
cp .env.example .env
cp config/config.example.json config/config.json
npm ci
docker compose up -d --wait
npm test
npm run setup   # imports credentials with .env values set; publishes workflows once any exist
```

Fill in the generated secrets in `.env` before bringing up the stack (see `.env.example` for what's required).

## License

MIT — see [LICENSE](./LICENSE).
