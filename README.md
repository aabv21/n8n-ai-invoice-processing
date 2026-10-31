# Magdaport AI Invoice Processing

**Demo**

An n8n workflow that reads supplier invoices from Gmail, extracts them with Claude, files each PDF in Google Drive, lists it in Google Sheets, and flags doubtful ones for review.

## Status

In progress: local runtime, toolchain, workflow tooling, the invoice extraction contract, the sample invoices, the SQL the workflow will run, the platform workflows (config loading, error alerts, Drive folder lookup), the `extract-invoice` workflow (text and PDF extraction, routed by path), and a localhost dev harness for exercising them without the Gmail poll.

### What works now

- A strict TypeScript toolchain: `typecheck`, `lint`, and `test` scripts.
- The local runtime: Postgres and n8n in Docker Compose, with separate, least-privilege database roles for n8n and the application, and the app database's time zone set to `America/Bogota`.
- The application schema (`db/schema.sql`): `invoices`, `invoice_items`, and `processed_events`.
- A config template (`config/config.example.json`) for the values the workflows will read at runtime.
- Workflow tooling: `npm run build:workflows` compiles Code-node sources and writes generated text parameters (SQL queries, prompts, schemas) into workflow JSON; `npm run check` runs hygiene checks (no pinned data, no literal secrets or ids, every external call retries, every generated value really is generated); `npm run setup` and `npm run export` import, publish, and export workflows and credentials against the local n8n instance. Verified both against the tooling's own fixtures and, now that real workflows exist, end to end: two back-to-back `setup` + `export` rounds produce an identical `workflows/` directory.
- Three platform workflows: `load-config` (reads and parses `/files/config/config.json` into `{ config }`, with Always Output Data on the read step so a missing file reaches the parse step as an item with no binary data and throws instead of stopping silently), `error-handler` (the shared error workflow: loads config, emails the team a plain-text alert naming the failed node, the error, the execution URL, and the Bogota time), and `ensure-folder` (finds or creates a Drive folder by exact name under a parent, always returning a `folder_id`). `load-config`'s happy path and its missing-config failure are both verified offline through the dev harness. `error-handler` and `ensure-folder` are validated (no errors from an n8n-aware validation tool) and published to the local instance, but their Gmail and Drive calls need real credentials.
- A localhost-only dev harness (`workflows/dev-harness.json`, called through `node scripts/dev-call.ts <target> '<json>'`): a token-protected webhook that routes by `target` to a fixed sub-workflow. Verified offline: `load-config` runs end to end and returns `{ config }`; `extract-invoice`'s text path, called with no working Anthropic credential, fails the execution loudly and never returns `status: 'ok'`; an unknown target answers `404 {"error":"unknown_target"}`; a request without the dev token is rejected. Localhost only (no tunnel in this demo) and must be unpublished before any production use.
- The invoice extraction contract: `schemas/invoice.schema.json` (the structured-output JSON Schema) and `prompts/extract-invoice.md` (the extraction system prompt), plus the pure TypeScript that turns a model reply into a checked result (`src/lib/invoice.ts`, `parse-reply.ts`, `normalize-invoice.ts`, `validate-invoice.ts`, `file-name.ts`, `util.ts`) and the two Code-node sources: `check-invoice.ts` (used by both extraction paths) and `build-pdf-request.ts` (the vision path's request body, which also refuses to build a request for a PDF whose base64 would overflow the Messages API's 32 MB request limit). All verified offline by Vitest, and now wired into the `extract-invoice` workflow below.
- The `extract-invoice` workflow (`workflows/extract-invoice.json`): routes on `path` to a text branch (an Information Extractor reading already-extracted text through an Anthropic Chat Model sub-node, adaptive thinking, no sampling parameters) or a PDF branch (encodes the PDF to base64, builds a Messages API request with a document block and structured output, and posts it to the Anthropic API with the predefined credential, 120 s timeout), and both branches converge on the generated check that applies the review rules; an unmatched `path` is rejected loudly by a Stop and Error node instead of ending the execution with zero items. Rule failures, and a refusal or truncation on the PDF path, come back as `status: 'review'` (see Limitations for the Information Extractor's different failure mode, by design). Validated (no errors from an n8n-aware validation tool) and published to the local instance; two back-to-back `setup` + `export` rounds produce an identical `workflows/` directory. Verified offline through the dev harness: the text path, called with no working Anthropic credential, fails loudly and never returns `status: 'ok'`.
- Sample invoices for testing and demos (`npm run samples`; `scripts/lib/sample-invoices.ts`, `scripts/lib/invoice-pdf.ts`): six PDFs in `samples/` — two short COP invoices, a ten-item COP invoice spanning three pages, a USD invoice, an image-only scanned invoice, one whose printed total doesn't match its own lines, and a byte-for-byte duplicate — plus the extraction result each one should produce (`samples/expected.json`). All verified offline by Vitest: the five text invoices regenerate byte for byte from their recorded base date, the scanned invoice carries no text layer and renders from a real page image, and every printed Colombian tax ID fails the DIAN check digit.
- The five SQL queries the workflow's Postgres nodes will run (`db/queries/`): recording a Gmail event once, saving an invoice and its line items (replay-safe, and duplicate-safe on a repeated supplier tax ID and invoice number), attaching a Drive link, recording an event's outcome, and the daily summary (a rolling 24-hour window ending at the run's timestamp, so the 18:00 report never loses an invoice that arrives that evening). All verified offline by Vitest against a disposable local Postgres (`npm run test:db`); no workflow calls them yet.
- Credential setup skips a Google OAuth2 credential (Gmail, Drive, Sheets) that already exists, so a re-run can't silently wipe out an interactive Google sign-in.
- CI: lint/typecheck/test/build/check and ShellCheck on one job, `npm audit` and gitleaks on another, actionlint and zizmor on a third, the database tests against a Postgres service container on a fourth; CodeQL (once the repo is public); Dependabot for npm, GitHub Actions, and Docker Compose images.

### Limitations

- **A text-path extraction failure has no automatic recovery.** By design, neither AI call node (`Extract from text`, `Read PDF with Claude`) sets `onError`, so a credential, outage, or Information Extractor parse/schema failure fails the `extract-invoice` execution outright instead of becoming a `review` row. A retry alone repeats the failure: recovery is to correct the prompt or schema, rebuild and publish, then retry the parent workflow's failed execution. Only the missing-credential case has actually been exercised (through the dev harness, see above); an actual Information Extractor parse or schema failure is untested. Upgrading this would route the Information Extractor's error output to a review branch, but only once that branch can also check whether it actually produced output and tell a genuine parse failure apart from a credential or outage error, so an API outage doesn't masquerade as a model review.

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
