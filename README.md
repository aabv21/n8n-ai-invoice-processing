# Magdaport AI Invoice Processing

**Demo**

An n8n workflow that reads supplier invoices from Gmail, extracts them with Claude, files each PDF in Google Drive, lists it in Google Sheets, and flags doubtful ones for review.

## Status

In progress: local runtime, toolchain, workflow tooling, the invoice extraction contract, and the sample invoices. No workflow is built yet.

### What works now

- A strict TypeScript toolchain: `typecheck`, `lint`, and `test` scripts.
- The local runtime: Postgres and n8n in Docker Compose, with separate, least-privilege database roles for n8n and the application, and the app database's time zone set to `America/Bogota`.
- The application schema (`db/schema.sql`): `invoices`, `invoice_items`, and `processed_events`.
- A config template (`config/config.example.json`) for the values the workflows will read at runtime.
- Workflow tooling: `npm run build:workflows` compiles Code-node sources and writes generated text parameters (SQL queries, prompts, schemas) into workflow JSON; `npm run check` runs hygiene checks (no pinned data, no literal secrets or ids, every external call retries, every generated value really is generated); `npm run setup` and `npm run export` import, publish, and export workflows and credentials against the local n8n instance. All verified against the tooling's own fixtures; no real workflow exists yet to run them on.
- The invoice extraction contract: `schemas/invoice.schema.json` (the structured-output JSON Schema) and `prompts/extract-invoice.md` (the extraction system prompt), plus the pure TypeScript that turns a model reply into a checked result (`src/lib/invoice.ts`, `parse-reply.ts`, `normalize-invoice.ts`, `validate-invoice.ts`, `file-name.ts`, `util.ts`) and the two Code-node sources: `check-invoice.ts` (used by both extraction paths) and `build-pdf-request.ts` (the vision path's request body). All verified offline by Vitest; none of it is wired into a workflow yet.
- Sample invoices for testing and demos (`npm run samples`; `scripts/lib/sample-invoices.ts`, `scripts/lib/invoice-pdf.ts`): six PDFs in `samples/` — two short COP invoices, a ten-item COP invoice spanning three pages, a USD invoice, an image-only scanned invoice, one whose printed total doesn't match its own lines, and a byte-for-byte duplicate — plus the extraction result each one should produce (`samples/expected.json`). All verified offline by Vitest: the five text invoices regenerate byte for byte from their recorded base date, the scanned invoice carries no text layer and renders from a real page image, and every printed Colombian tax ID fails the DIAN check digit.
- Credential setup skips a Google OAuth2 credential (Gmail, Drive, Sheets) that already exists, so a re-run can't silently wipe out an interactive Google sign-in.
- A localhost-only dev harness CLI (`node scripts/dev-call.ts`) for calling a sub-workflow directly once one exists; unpublished and untested until Task 6 adds the harness workflow.
- CI: lint/typecheck/test/build/check and ShellCheck on one job, `npm audit` and gitleaks on another, actionlint and zizmor on a third; CodeQL (once the repo is public); Dependabot for npm, GitHub Actions, and Docker Compose images.

## Send the samples

Owner step, once the Gmail, Drive, and Sheets pipeline is live: from the demo Gmail account, send each PDF in `samples/` to that same account, one PDF per email. Send `invoice-06-copy-of-01.pdf` last, after `invoice-01-two-items.pdf` already shows its `Processed` label — it's a byte-for-byte copy of that first invoice, so sending it too soon would make both look like the first arrival. The Gmail filter applies the `Invoices` label to each one as it arrives.

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
